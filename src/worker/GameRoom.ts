/**
 * Una sala de Rummikub: un Durable Object por partida.
 *
 * El objeto es el árbitro. Guarda el estado real, valida cada intención que
 * llega por WebSocket y reparte a cada jugador su propia vista. Entre jugada y
 * jugada hiberna: los WebSockets siguen abiertos en la red de Cloudflare pero
 * el objeto no consume tiempo de cómputo, que es lo que mantiene la partida
 * dentro del plan gratuito.
 */

import { DurableObject } from "cloudflare:workers";

import type { Board } from "../engine/types";

import {
  addPlayer,
  commitTurn,
  createGame,
  drawTile,
  prepareRematch,
  setConnected,
  setRules,
  startGame,
  timeoutTurn,
  turnDeadline,
  type GameEvent,
  type GameState,
  type Transition,
} from "../engine/game";
import {
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "../protocol";
import type { RoomRules } from "../engine/rules";
import { buildView } from "../protocol/view";

type SocketAttachment = { playerId: string };

/** Sondeo de limpieza mientras la sala está parada. */
const IDLE_SWEEP_MS = 3 * 60 * 60 * 1000;
/** Una sala sin actividad se borra pasado este tiempo. */
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
/** Margen para no dar un turno por vencido antes de tiempo. */
const ALARM_SLACK_MS = 250;
/** Ninguna alarma se programa más cerca que esto: en el pasado, jamás. */
const ALARM_FLOOR_MS = 500;
/** Tope de conexiones por sala: 8 asientos más reconexiones en curso. */
const MAX_SOCKETS = 20;

export class GameRoom extends DurableObject<Env> {
  #cached: GameState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room (
        id INTEGER PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS seat (
        player_id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE
      );
    `);
    // Los pings del navegador se contestan en el borde: mantienen viva la
    // conexión sin despertar al objeto ni facturar tiempo.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ type: "ping" }), JSON.stringify({ type: "pong" })),
    );
  }

  // --- API para el Worker --------------------------------------------------

  /**
   * Reserva el código para una sala nueva. Devuelve false si ya estaba en uso,
   * para que quien crea la partida pueda probar con otro código.
   */
  claim(code: string, rules: RoomRules): boolean {
    if (this.#load()) return false;
    this.#save(createGame(code, rules));
    return true;
  }

  /** Resumen público de la sala, para decidir si merece la pena conectarse. */
  summary(): { exists: boolean; status?: string; players?: number; max?: number } {
    const state = this.#load();
    if (!state) return { exists: false };
    return {
      exists: true,
      status: state.status,
      players: state.players.length,
      max: 8,
    };
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Se esperaba una conexión WebSocket.", { status: 426 });
    }
    if (!this.#load()) {
      return new Response("Esa sala no existe.", { status: 404 });
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) {
      return new Response("La sala tiene demasiadas conexiones abiertas.", {
        status: 429,
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- WebSocket -----------------------------------------------------------

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const message = parseClientMessage(typeof raw === "string" ? raw : "");
    if (!message) return;

    const state = this.#load();
    if (!state) return;

    if (message.type === "join") {
      this.#handleJoin(ws, state, message);
      return;
    }

    const seat = this.#seatOf(ws);
    if (!seat) {
      this.#send(ws, {
        type: "denied",
        reason: "unknown-seat",
        message: "Vuelve a entrar en la sala.",
      });
      return;
    }

    this.#handleAction(ws, state, seat, message);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const seat = this.#seatOf(ws);
    if (!seat) return;
    const state = this.#load();
    if (!state) return;

    // El asiento se guarda: recargar la página o perder la cobertura no debe
    // costarte el sitio en la mesa ni tus fichas.
    const next = setConnected(state, seat, false);
    this.#save(next);
    this.#broadcast(next, []);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // --- Reloj de la sala ----------------------------------------------------

  override async alarm(): Promise<void> {
    const state = this.#load();
    if (!state) return;

    const now = Date.now();
    const watching = this.ctx.getWebSockets().length > 0;

    // Con la sala vacía el reloj se para: nadie debe perder su turno mientras
    // todos están desconectados.
    if (
      watching &&
      state.status === "playing" &&
      state.turnEndsAt !== null &&
      now >= state.turnEndsAt - ALARM_SLACK_MS
    ) {
      this.#apply(state, timeoutTurn(state, now));
      return;
    }

    if (!watching && now - this.#updatedAt() >= ROOM_TTL_MS) {
      for (const socket of this.ctx.getWebSockets()) socket.close(1001, "Sala cerrada");
      this.ctx.storage.deleteAll();
      this.#cached = null;
      return;
    }

    this.#scheduleAlarm(state);
  }

  // --- Acciones ------------------------------------------------------------

  #handleJoin(
    ws: WebSocket,
    state: GameState,
    message: Extract<ClientMessage, { type: "join" }>,
  ): void {
    const existing = message.token ? this.#seatForToken(message.token) : null;

    if (existing) {
      const player = state.players.find((entry) => entry.id === existing);
      if (player) {
        this.#claimSocket(ws, existing);
        let next = setConnected(state, existing, true);
        next = this.#restartStalledTurn(next);
        this.#save(next);
        this.#send(ws, {
          type: "welcome",
          playerId: existing,
          token: message.token!,
          view: buildView(next, existing, Date.now()),
        });
        this.#broadcast(next, [], ws);
        this.#scheduleAlarm(next);
        return;
      }
    }

    const joined = addPlayer(state, crypto.randomUUID(), message.name);
    if (!joined.ok) {
      this.#send(ws, {
        type: "denied",
        reason: joined.reason,
        message: DENIAL_MESSAGES[joined.reason],
      });
      return;
    }

    const token = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO seat (player_id, token) VALUES (?, ?)",
      joined.player.id,
      token,
    );
    this.#claimSocket(ws, joined.player.id);
    this.#save(joined.state);
    this.#send(ws, {
      type: "welcome",
      playerId: joined.player.id,
      token,
      view: buildView(joined.state, joined.player.id, Date.now()),
    });
    this.#broadcast(joined.state, [{ type: "joined", playerId: joined.player.id }], ws);
  }

  #handleAction(
    ws: WebSocket,
    state: GameState,
    seat: string,
    message: ClientMessage,
  ): void {
    const now = Date.now();

    switch (message.type) {
      case "start":
        this.#apply(state, startGame(state, seat, freshSeed(), now), ws);
        return;
      case "commit":
        this.#apply(
          state,
          commitTurn(state, { actorId: seat, board: message.board, rack: message.rack }, now),
          ws,
        );
        return;
      case "draw":
        this.#apply(state, drawTile(state, seat, now), ws);
        return;
      case "rematch":
        this.#apply(state, prepareRematch(state, seat), ws);
        return;
      case "settings":
        this.#apply(state, setRules(state, seat, message.rules), ws);
        return;
      case "preview": {
        // No se valida ni se guarda: es un reflejo de lo que hay en la pantalla
        // de quien juega, y el siguiente estado autoritativo lo sustituye.
        if (state.status !== "playing") return;
        if (state.players[state.turnIndex]?.id !== seat) return;
        this.#relayPreview(ws, seat, message.board);
        return;
      }
      case "sort": {
        // Reordenar el atril es cosmético, pero se guarda para que el jugador
        // recupere su orden si recarga la página.
        const next = reorderRack(state, seat, message.rack);
        if (!next) return;
        this.#save(next);
        this.#send(ws, {
          type: "state",
          view: buildView(next, seat, now),
          events: [],
        });
        return;
      }
      default:
        return;
    }
  }

  /** Aplica una transición del motor: guarda y reparte, o devuelve el rechazo. */
  #apply(previous: GameState, transition: Transition, origin?: WebSocket): void {
    if (!transition.ok) {
      if (origin) {
        const rejected: ServerMessage = transition.error.setIndexes
          ? {
              type: "rejected",
              code: transition.error.code,
              message: transition.error.message,
              setIndexes: transition.error.setIndexes,
            }
          : {
              type: "rejected",
              code: transition.error.code,
              message: transition.error.message,
            };
        this.#send(origin, rejected);
      }
      // El estado no se ha tocado: la mesa sigue como estaba para todos. Aun
      // así hay que dejar una cita pendiente, o la sala se quedaría sin reloj.
      this.#scheduleAlarm(previous);
      return;
    }

    this.#save(transition.state);
    this.#broadcast(transition.state, transition.events);
    this.#scheduleAlarm(transition.state);
  }

  /**
   * Si la sala despierta con un turno ya vencido (porque todos estaban
   * desconectados), el turno vuelve a empezar en vez de perderse.
   */
  #restartStalledTurn(state: GameState): GameState {
    if (state.status !== "playing" || state.turnEndsAt === null) return state;
    const now = Date.now();
    if (state.turnEndsAt > now) return state;
    state.turnEndsAt = turnDeadline(state, now);
    return state;
  }

  // --- Sockets -------------------------------------------------------------

  #claimSocket(ws: WebSocket, playerId: string): void {
    // Un mismo asiento solo puede tener una pestaña activa: al abrir otra, la
    // anterior se cierra en vez de recibir estados a medias.
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === ws) continue;
      if (this.#seatOf(socket) === playerId) socket.close(1000, "Sesión abierta en otro sitio");
    }
    ws.serializeAttachment({ playerId } satisfies SocketAttachment);
  }

  #seatOf(ws: WebSocket): string | null {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    return attachment?.playerId ?? null;
  }

  #seatForToken(token: string): string | null {
    const rows = this.ctx.storage.sql
      .exec<{ player_id: string }>("SELECT player_id FROM seat WHERE token = ?", token)
      .toArray();
    return rows[0]?.player_id ?? null;
  }

  /** Reenvía la mesa en curso al resto de la mesa, sin tocar nada. */
  #relayPreview(origin: WebSocket, playerId: string, board: Board): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === origin) continue;
      if (!this.#seatOf(socket)) continue;
      this.#send(socket, { type: "preview", playerId, board });
    }
  }

  #send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  #broadcast(state: GameState, events: readonly GameEvent[], skip?: WebSocket): void {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === skip) continue;
      const seat = this.#seatOf(socket);
      if (!seat) continue;
      this.#send(socket, {
        type: "state",
        view: buildView(state, seat, now),
        events,
      });
    }
  }

  // --- Persistencia --------------------------------------------------------

  #load(): GameState | null {
    if (this.#cached) return this.#cached;
    const rows = this.ctx.storage.sql
      .exec<{ state: string }>("SELECT state FROM room WHERE id = 1")
      .toArray();
    const raw = rows[0]?.state;
    if (!raw) return null;
    this.#cached = JSON.parse(raw) as GameState;
    return this.#cached;
  }

  #save(state: GameState): void {
    this.#cached = state;
    this.ctx.storage.sql.exec(
      "INSERT INTO room (id, state, updated_at) VALUES (1, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
      JSON.stringify(state),
      Date.now(),
    );
  }

  #updatedAt(): number {
    const rows = this.ctx.storage.sql
      .exec<{ updated_at: number }>("SELECT updated_at FROM room WHERE id = 1")
      .toArray();
    return rows[0]?.updated_at ?? 0;
  }

  /**
   * Cuándo hay que volver a despertar.
   *
   * Con la mesa vacía el reloj del turno está parado, así que la próxima cita
   * es la de limpieza y nunca la hora del turno: esa ya pasó, y programar una
   * alarma en el pasado hace que salte al instante, vuelva a programarse en el
   * pasado y se repita sin parar. Un bucle así se come el presupuesto de un día
   * entero en cuestión de minutos.
   */
  #scheduleAlarm(state: GameState): void {
    const now = Date.now();
    const watching = this.ctx.getWebSockets().length > 0;
    const enJuego =
      watching && state.status === "playing" && state.turnEndsAt !== null;

    const when = enJuego
      ? Math.max(state.turnEndsAt!, now + ALARM_FLOOR_MS)
      : now + IDLE_SWEEP_MS;
    this.ctx.storage.setAlarm(when);
  }
}

const DENIAL_MESSAGES: Record<"full" | "started" | "name", string> = {
  full: "La sala ya está completa.",
  started: "Esta partida ya ha empezado.",
  name: "Escribe un nombre para entrar.",
};

function reorderRack(
  state: GameState,
  seat: string,
  rack: readonly string[],
): GameState | null {
  const player = state.players.find((entry) => entry.id === seat);
  if (!player) return null;
  // Solo se acepta una permutación exacta del atril: reordenar no puede
  // inventar, duplicar ni perder fichas.
  if (rack.length !== player.rack.length) return null;
  if ([...rack].sort().join() !== [...player.rack].sort().join()) return null;

  state.players = state.players.map((entry) =>
    entry.id === seat ? { ...entry, rack: rack.slice() } : entry,
  );
  return state;
}

function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}
