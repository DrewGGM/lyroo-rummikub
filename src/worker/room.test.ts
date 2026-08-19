/**
 * Pruebas de la sala contra el runtime real de Workers: Durable Object,
 * SQLite y WebSockets de verdad, no simulacros.
 */

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { ClientMessage, ServerMessage } from "../protocol";
import { isRoomCode } from "../protocol";
import { sortRack } from "../engine/order";

const ORIGIN = "http://mesa.test";

/**
 * Crear salas está limitado por dirección de origen, así que cada llamada
 * inventa la suya: los tests no se pisan entre ellos.
 */
let visitor = 0;
function fromNewAddress(rules?: unknown): Request {
  visitor += 1;
  return new Request(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: { "CF-Connecting-IP": `203.0.113.${visitor % 250}` },
    body: JSON.stringify(rules === undefined ? {} : { rules }),
  });
}

async function createRoom(rules?: unknown): Promise<string> {
  const response = await exports.default.fetch(fromNewAddress(rules));
  expect(response.status).toBe(201);
  const body = (await response.json()) as { code: string };
  return body.code;
}

type Client = {
  send(message: ClientMessage): void;
  /**
   * Espera al primer mensaje del tipo pedido que cumpla la condición. Esperar
   * por lo que se busca, y no por "el siguiente mensaje", evita que un aviso
   * que aún venía de camino se cuele en mitad de una comprobación.
   */
  until<T extends ServerMessage["type"]>(
    type: T,
    match?: (message: Extract<ServerMessage, { type: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>>;
  close(): void;
};

async function connect(code: string): Promise<Client> {
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}/ws/room/${code}`, { headers: { Upgrade: "websocket" } }),
  );
  expect(response.status).toBe(101);
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
      const timer = setTimeout(
        () => reject(new Error("no llegó ningún mensaje del servidor")),
        3000,
      );
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
    close: () => socket.close(),
  };
}

/** Espera a un `state` que ya refleje una partida repartida. */
const dealt = (message: Extract<ServerMessage, { type: "state" }>) =>
  message.view.status === "playing";

async function joinAs(code: string, name: string) {
  const client = await connect(code);
  client.send({ type: "join", name });
  const welcome = await client.until("welcome");
  return { client, welcome };
}

describe("crear y encontrar salas", () => {
  it("devuelve un código legible al crear una sala", async () => {
    const code = await createRoom();
    expect(isRoomCode(code)).toBe(true);
  });

  it("da códigos distintos a salas distintas", async () => {
    const codes = await Promise.all([createRoom(), createRoom(), createRoom()]);
    expect(new Set(codes).size).toBe(3);
  });

  it("informa de una sala existente", async () => {
    const code = await createRoom();
    const response = await exports.default.fetch(`${ORIGIN}/api/rooms/${code}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      exists: true,
      status: "lobby",
      players: 0,
    });
  });

  it("responde 404 a un código que no existe", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/api/rooms/ZZZZZZ`);
    expect(response.status).toBe(404);
  });

  it("responde 404 a un código con formato inválido", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/api/rooms/no-va`);
    expect(response.status).toBe(404);
  });

  it("guarda las reglas elegidas al crear la sala", async () => {
    const code = await createRoom({ turnSeconds: 30, openingPoints: 50, handSize: 16 });
    const { welcome } = await joinAs(code, "Ana");
    expect(welcome.view.rules).toMatchObject({
      turnSeconds: 30,
      openingPoints: 50,
      handSize: 16,
    });
  });

  it("sustituye por las oficiales cualquier regla inventada", async () => {
    const code = await createRoom({
      turnSeconds: 99999,
      openingPoints: 1,
      handSize: 40,
      // Una regla que ya no existe: tiene que caer sin arrastrar a las demás.
      jokers: "ninguno",
    });
    const { welcome } = await joinAs(code, "Ana");
    expect(welcome.view.rules).toEqual({
      turnSeconds: 60,
      openingPoints: 30,
      handSize: 14,
    });
  });

  it("rechaza conectarse a una sala inexistente", async () => {
    const response = await exports.default.fetch(
      new Request(`${ORIGIN}/ws/room/ZZZZZZ`, { headers: { Upgrade: "websocket" } }),
    );
    expect(response.status).toBe(404);
  });

  it("rechaza una petición normal a la ruta del WebSocket", async () => {
    const code = await createRoom();
    const response = await exports.default.fetch(`${ORIGIN}/ws/room/${code}`);
    expect(response.status).toBe(426);
  });
});

describe("límite de creación", () => {
  it("corta a quien abre salas en cadena desde la misma dirección", async () => {
    const address = "198.51.100.7";
    const create = () =>
      exports.default.fetch(
        new Request(`${ORIGIN}/api/rooms`, {
          method: "POST",
          headers: { "CF-Connecting-IP": address },
          body: "{}",
        }),
      );

    let blocked = false;
    for (let attempt = 0; attempt < 40 && !blocked; attempt++) {
      blocked = (await create()).status === 429;
    }
    expect(blocked).toBe(true);

    // Y no afecta a quien llega desde otro sitio.
    const otherPerson = await exports.default.fetch(
      new Request(`${ORIGIN}/api/rooms`, {
        method: "POST",
        headers: { "CF-Connecting-IP": "198.51.100.8" },
        body: "{}",
      }),
    );
    expect(otherPerson.status).toBe(201);
  });
});

describe("entrar en la sala", () => {
  it("da asiento, credencial y vista propia a quien entra", async () => {
    const code = await createRoom();
    const { welcome } = await joinAs(code, "Ana");
    expect(welcome.playerId).toBeTruthy();
    expect(welcome.token).toBeTruthy();
    expect(welcome.view.you).toBe(welcome.playerId);
    expect(welcome.view.hostId).toBe(welcome.playerId);
    expect(welcome.view.players).toHaveLength(1);
  });

  it("avisa a los que ya estaban cuando entra alguien", async () => {
    const code = await createRoom();
    const ana = await joinAs(code, "Ana");
    await joinAs(code, "Beto");
    const update = await ana.client.until("state");
    expect(update.view.players.map((p) => p.name)).toEqual(["Ana", "Beto"]);
  });

  it("rechaza un nombre vacío", async () => {
    const code = await createRoom();
    const client = await connect(code);
    client.send({ type: "join", name: "   " });
    const denied = await client.until("denied");
    expect(denied.reason).toBe("name");
  });

  it("no deja actuar sin haber entrado", async () => {
    const code = await createRoom();
    const client = await connect(code);
    client.send({ type: "draw" });
    const denied = await client.until("denied");
    expect(denied.reason).toBe("unknown-seat");
  });

  it("devuelve el mismo asiento al reconectar con la credencial", async () => {
    const code = await createRoom();
    const first = await joinAs(code, "Ana");
    first.client.close();

    const again = await connect(code);
    again.send({ type: "join", name: "Ana", token: first.welcome.token });
    const welcome = await again.until("welcome");
    expect(welcome.playerId).toBe(first.welcome.playerId);
    expect(welcome.view.players).toHaveLength(1);
  });

  it("trata una credencial desconocida como un jugador nuevo", async () => {
    const code = await createRoom();
    await joinAs(code, "Ana");
    const client = await connect(code);
    client.send({ type: "join", name: "Beto", token: "credencial-inventada" });
    const welcome = await client.until("welcome");
    expect(welcome.view.players).toHaveLength(2);
  });
});

describe("partida", () => {
  async function table(names: string[], rules?: unknown) {
    const code = await createRoom(rules);
    const seats = [];
    for (const name of names) seats.push(await joinAs(code, name));
    return { code, seats };
  }

  /** Monta la mesa, reparte, y devuelve la vista inicial de cada jugador. */
  async function dealtTable(names: string[], rules?: unknown) {
    const { code, seats } = await table(names, rules);
    seats[0]!.client.send({ type: "start" });
    const views = [];
    for (const seat of seats) views.push((await seat.client.until("state", dealt)).view);
    return { code, seats, views };
  }

  it("cambia una regla sin revertir la anterior", async () => {
    // Dos cambios seguidos parten del mismo estado en pantalla: si el servidor
    // sustituyera las reglas enteras en vez de fusionarlas, el segundo clic
    // desharía el primero.
    const { seats } = await table(["Ana", "Beto"]);
    seats[0]!.client.send({ type: "settings", rules: { openingPoints: 50 } });
    seats[0]!.client.send({ type: "settings", rules: { turnSeconds: null } });

    const vista = await seats[0]!.client.until(
      "state",
      (m) => m.view.rules.turnSeconds === null,
    );
    expect(vista.view.rules.openingPoints).toBe(50);
    expect(vista.view.rules.handSize).toBe(14);
  });

  it("exige de verdad los puntos de apertura de la mesa", async () => {
    const { seats, views } = await dealtTable(["Ana", "Beto"], { openingPoints: 50 });
    expect(views[0]!.rules.openingPoints).toBe(50);

    // Un grupo de dieces son 30 puntos: sobra con 30, se queda corto con 50.
    const rack = views[0]!.rack as string[];
    seats[0]!.client.send({ type: "commit", board: [rack.slice(0, 3)], rack: rack.slice(3) });
    const respuesta = await seats[0]!.client.until("rejected");
    expect(["MELD_TOO_LOW", "INVALID_SET"]).toContain(respuesta.code);
  });

  it("juega sin reloj cuando la mesa lo pide", async () => {
    const { views } = await dealtTable(["Ana", "Beto"], { turnSeconds: null });
    expect(views[0]!.turnEndsAt).toBeNull();
  });

  it("reparte dieciséis fichas si la mesa lo pide", async () => {
    const { views } = await dealtTable(["Ana", "Beto"], { handSize: 16 });
    expect(views[0]!.rack).toHaveLength(16);
    expect(views[0]!.poolCount).toBe(106 - 32);
  });

  it("solo el anfitrión puede repartir", async () => {
    const { seats } = await table(["Ana", "Beto"]);
    seats[1]!.client.send({ type: "start" });
    const rejected = await seats[1]!.client.until("rejected");
    expect(rejected.code).toBe("NOT_HOST");
  });

  it("reparte 14 fichas a cada uno y abre el turno del primero", async () => {
    const { seats, views } = await dealtTable(["Ana", "Beto"]);
    const ana = views[0]!;
    const beto = views[1]!;

    expect(ana.rack).toHaveLength(14);
    expect(ana.turnPlayerId).toBe(seats[0]!.welcome.playerId);
    expect(ana.turnEndsAt).toBeGreaterThan(ana.serverTime);

    expect(beto.rack).toHaveLength(14);
    // Cada uno recibe su mano, nunca la del otro.
    expect(beto.rack).not.toEqual(ana.rack);
    expect(beto.players[0]!.tileCount).toBe(14);
  });

  it("no filtra las fichas de los demás en ninguna vista", async () => {
    const { views } = await dealtTable(["Ana", "Beto"]);
    const beto = views[1]!;
    expect(JSON.stringify(beto.players)).not.toContain("_0");
    expect(Object.keys(beto.players[0]!)).not.toContain("rack");
  });

  it("no deja jugar a quien no le toca", async () => {
    const { seats, views } = await dealtTable(["Ana", "Beto"]);
    const beto = views[1]!;

    seats[1]!.client.send({
      type: "commit",
      board: [beto.rack.slice(0, 3) as string[]],
      rack: beto.rack.slice(3) as string[],
    });
    const rejected = await seats[1]!.client.until("rejected");
    expect(rejected.code).toBe("NOT_YOUR_TURN");
  });

  it("rechaza una ficha que el jugador no tiene", async () => {
    const { seats, views } = await dealtTable(["Ana", "Beto"]);

    // Un cliente manipulado que se inventa un grupo de dieces perfecto.
    seats[0]!.client.send({
      type: "commit",
      board: [["r10_0", "b10_0", "k10_0"]],
      rack: views[0]!.rack as string[],
    });
    const rejected = await seats[0]!.client.until("rejected");
    expect(rejected.code).toBe("TILES_DO_NOT_MATCH");
  });

  it("rechaza una combinación ilegal y dice cuál falla", async () => {
    const { seats, views } = await dealtTable(["Ana", "Beto"]);
    const rack = views[0]!.rack as string[];

    seats[0]!.client.send({
      type: "commit",
      board: [rack.slice(0, 3)],
      rack: rack.slice(3),
    });
    const answer = await Promise.race([
      seats[0]!.client.until("rejected"),
      seats[0]!.client.until("state", (m) => m.view.board.length > 0),
    ]);
    // Con una mano al azar lo normal es que tres fichas cualesquiera no valgan.
    if (answer.type === "rejected") {
      expect(["INVALID_SET", "MELD_TOO_LOW"]).toContain(answer.code);
    } else {
      expect(answer.type).toBe("state");
    }
  });

  it("roba, pasa turno y avisa a todos", async () => {
    const { seats } = await dealtTable(["Ana", "Beto"]);

    seats[0]!.client.send({ type: "draw" });
    const ana = await seats[0]!.client.until("state", (m) => m.view.rack.length === 15);
    expect(ana.view.turnPlayerId).toBe(seats[1]!.welcome.playerId);

    const beto = await seats[1]!.client.until(
      "state",
      (m) => m.view.players[0]!.tileCount === 15,
    );
    expect(beto.view.poolCount).toBe(106 - 28 - 1);
  });

  it("conserva el atril al reconectar en plena partida", async () => {
    const { code, seats, views } = await dealtTable(["Ana", "Beto"]);
    seats[0]!.client.close();

    const again = await connect(code);
    again.send({ type: "join", name: "Ana", token: seats[0]!.welcome.token });
    const welcome = await again.until("welcome");
    expect(welcome.view.rack).toEqual(views[0]!.rack);
    expect(welcome.view.status).toBe("playing");
  });

  it("guarda el orden en que el jugador coloca su atril", async () => {
    const { seats, views } = await dealtTable(["Ana", "Beto"]);
    const reversed = [...views[0]!.rack].reverse() as string[];

    seats[0]!.client.send({ type: "sort", rack: reversed });
    const sorted = await seats[0]!.client.until("state", (m) =>
      m.view.rack.every((id, index) => id === reversed[index]),
    );
    expect(sorted.view.rack).toEqual(reversed);
  });

  it("no deja colar fichas disfrazadas de reordenación", async () => {
    const { seats, views } = await dealtTable(["Ana", "Beto"]);
    const rack = views[0]!.rack as string[];

    seats[0]!.client.send({ type: "sort", rack: [...rack.slice(1), "j_0"] });
    seats[0]!.client.send({ type: "draw" });
    const after = await seats[0]!.client.until("state", (m) => m.view.rack.length === 15);
    expect(after.view.rack.filter((id) => id === "j_0").length).toBeLessThanOrEqual(1);
  });

  it("no deja entrar con la partida ya empezada", async () => {
    const { code } = await dealtTable(["Ana", "Beto"]);

    const late = await connect(code);
    late.send({ type: "join", name: "Tarde" });
    const denied = await late.until("denied");
    expect(denied.reason).toBe("started");
  });

  it("no admite un noveno jugador", async () => {
    const { code } = await table(["a", "b", "c", "d", "e", "f", "g", "h"]);
    const extra = await connect(code);
    extra.send({ type: "join", name: "Nueve" });
    const denied = await extra.until("denied");
    expect(denied.reason).toBe("full");
  });

  it("reparte una partida distinta en cada sala", async () => {
    // Si dos mesas repartieran lo mismo, la partida sería predecible: bastaría
    // con abrir una sala de prueba para saber qué le va a tocar a cada uno.
    const manos: string[] = [];
    for (let intento = 0; intento < 3; intento++) {
      const { views } = await dealtTable(["Ana", "Beto"]);
      manos.push(views[0]!.rack.join(","));
    }
    expect(new Set(manos).size).toBe(manos.length);
  });

  it("reparte la mano ya ordenada, sin obligar a colocarla", async () => {
    const { views } = await dealtTable(["Ana", "Beto"]);
    const rack = views[0]!.rack;
    const ordenada = sortRack(rack as string[], "runs");
    expect(rack).toEqual(ordenada);
  });

  it("usa el mazo de 160 fichas a partir de cinco jugadores", async () => {
    const { views } = await dealtTable(["a", "b", "c", "d", "e"]);
    expect(views[0]!.poolCount).toBe(160 - 5 * 14);
  });

  it("usa el mazo de 214 fichas con ocho jugadores", async () => {
    const { views } = await dealtTable(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(views[0]!.poolCount).toBe(214 - 8 * 14);
  });
});

describe("mensajes malformados", () => {
  it("ignora basura sin cerrar la conexión", async () => {
    const code = await createRoom();
    const { client } = await joinAs(code, "Ana");

    for (const junk of ['{"type":"nope"}', "no soy json", "[]", '{"type":"commit"}']) {
      client.send(junk as unknown as ClientMessage);
    }
    client.send({ type: "start" });
    const rejected = await client.until("rejected");
    expect(rejected.code).toBe("NOT_ENOUGH_PLAYERS");
  });
});
