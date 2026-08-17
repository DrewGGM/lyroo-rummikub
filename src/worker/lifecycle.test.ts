/**
 * El ciclo de vida de la sala: el reloj del turno y la hibernación.
 *
 * Son las dos piezas de las que depende que una partida no se quede colgada y
 * que jugar salga gratis, y ninguna se puede comprobar mirando el estado del
 * juego: hay que hacer que el objeto se duerma y despierte de verdad.
 */

import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { GameState } from "../engine/game";
import type { ClientMessage, ServerMessage } from "../protocol";

const ORIGIN = "http://mesa.test";

/** Crear salas está limitado por origen: cada test llega desde el suyo. */
let visitor = 0;

async function createRoom(turnSeconds?: number): Promise<string> {
  visitor += 1;
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: { "CF-Connecting-IP": `192.0.2.${visitor % 250}` },
      body: JSON.stringify(turnSeconds === undefined ? {} : { rules: { turnSeconds } }),
    }),
  );
  const body = (await response.json()) as { code: string };
  return body.code;
}

function roomStub(code: string) {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
}

/** Lee el estado autoritativo tal y como está guardado en SQLite. */
async function storedState(code: string): Promise<GameState> {
  let game!: GameState;
  await runInDurableObject(roomStub(code), (_instance, state) => {
    const row = state.storage.sql
      .exec<{ state: string }>("SELECT state FROM room WHERE id = 1")
      .one();
    game = JSON.parse(row.state) as GameState;
  });
  return game;
}

type Client = {
  send(message: ClientMessage): void;
  until<T extends ServerMessage["type"]>(
    type: T,
    match?: (message: Extract<ServerMessage, { type: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>>;
};

async function connect(code: string): Promise<Client> {
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}/ws/room/${code}`, { headers: { Upgrade: "websocket" } }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("el servidor no devolvió un WebSocket");
  socket.accept();

  const pending: ServerMessage[] = [];
  const waiting: ((message: ServerMessage) => void)[] = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    const waiter = waiting.shift();
    if (waiter) waiter(message);
    else pending.push(message);
  });

  const next = () =>
    new Promise<ServerMessage>((resolve, reject) => {
      const ready = pending.shift();
      if (ready) return resolve(ready);
      const timer = setTimeout(() => reject(new Error("sin respuesta del servidor")), 3000);
      waiting.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });

  return {
    send: (message) => socket.send(JSON.stringify(message)),
    async until(type, match) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const message = await next();
        if (message.type !== type) continue;
        const typed = message as Extract<ServerMessage, { type: typeof type }>;
        if (!match || match(typed)) return typed;
      }
      throw new Error(`nunca llegó un mensaje "${type}" que encajara`);
    },
  };
}

async function join(code: string, name: string, token?: string) {
  const client = await connect(code);
  client.send(token ? { type: "join", name, token } : { type: "join", name });
  const welcome = await client.until("welcome");
  return { client, welcome };
}

/** Deja el turno actual ya vencido, sin esperar los segundos reales. */
async function expireTurn(code: string): Promise<void> {
  const stub = roomStub(code);
  // El objeto guarda el estado en memoria además de en SQLite, así que primero
  // se le hace olvidar; al despertar leerá lo que dejemos escrito.
  await evictDurableObject(stub);
  await runInDurableObject(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec<{ state: string }>("SELECT state FROM room WHERE id = 1")
      .one();
    const game = JSON.parse(row.state) as GameState;
    game.turnEndsAt = Date.now() - 1000;
    state.storage.sql.exec("UPDATE room SET state = ? WHERE id = 1", JSON.stringify(game));
  });
}

async function dealtRoom(turnSeconds?: number) {
  const code = await createRoom(turnSeconds);
  const ana = await join(code, "Ana");
  const beto = await join(code, "Beto");
  ana.client.send({ type: "start" });
  const view = (await ana.client.until("state", (m) => m.view.status === "playing")).view;
  return { code, ana, beto, view };
}

describe("reloj del turno", () => {
  it("roba y pasa por quien se queda sin tiempo", async () => {
    const { code, beto, view } = await dealtRoom(30);
    expect(view.turnPlayerId).toBe(view.you);

    await expireTurn(code);
    expect(await runDurableObjectAlarm(roomStub(code))).toBe(true);

    // Ana pierde el turno con una ficha más, y la mesa queda intacta: lo que
    // estuviera montando en su pantalla nunca llegó al servidor.
    const after = await beto.client.until(
      "state",
      (m) => m.view.turnPlayerId !== view.you,
    );
    expect(after.view.players[0]!.tileCount).toBe(15);
    expect(after.view.board).toEqual([]);
    expect(after.view.poolCount).toBe(78 - 1);
  });

  it("para el reloj cuando no queda nadie mirando", async () => {
    const { code } = await dealtRoom(30);

    await expireTurn(code);
    // Cerrar los WebSockets al descargar el objeto es lo que ocurre cuando
    // todos pierden la conexión a la vez.
    await evictDurableObject(roomStub(code), { webSockets: "close" });
    await runDurableObjectAlarm(roomStub(code));

    const game = await storedState(code);
    expect(game.players[0]!.rack).toHaveLength(14);
    expect(game.turnIndex).toBe(0);
  });

  it("reabre el turno vencido cuando el jugador vuelve", async () => {
    const { code, ana } = await dealtRoom(30);
    await expireTurn(code);
    await evictDurableObject(roomStub(code), { webSockets: "close" });

    const back = await join(code, "Ana", ana.welcome.token);
    // No se le castiga por haber estado desconectado: el turno empieza de cero.
    expect(back.welcome.view.turnEndsAt).toBeGreaterThan(back.welcome.view.serverTime);
    expect(back.welcome.view.rack).toHaveLength(14);
  });
});

describe("hibernación", () => {
  it("la partida sigue igual después de que el objeto se duerma", async () => {
    const { code, ana, beto, view } = await dealtRoom();

    // El objeto se descarga de memoria; los WebSockets siguen abiertos.
    await evictDurableObject(roomStub(code));

    // El primer mensaje después de dormir lo despierta y lo encuentra todo
    // donde estaba.
    ana.client.send({ type: "draw" });
    const after = await ana.client.until("state", (m) => m.view.rack.length === 15);
    expect(after.view.rack.slice(0, 14)).toEqual(view.rack);
    expect(after.view.turnPlayerId).not.toBe(after.view.you);

    const seen = await beto.client.until(
      "state",
      (m) => m.view.players[0]!.tileCount === 15,
    );
    expect(seen.view.rack).toHaveLength(14);
  });

  it("devuelve el asiento y las fichas al reconectar tras dormir", async () => {
    const { code, ana, view } = await dealtRoom();

    await evictDurableObject(roomStub(code), { webSockets: "close" });

    const back = await join(code, "Ana", ana.welcome.token);
    expect(back.welcome.playerId).toBe(ana.welcome.playerId);
    expect(back.welcome.view.rack).toEqual(view.rack);
    expect(back.welcome.view.players).toHaveLength(2);
  });
});
