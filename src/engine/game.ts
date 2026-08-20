/**
 * Estado autoritativo de una partida y las transiciones que lo hacen avanzar.
 *
 * Todo aquí es puro: recibe estado, devuelve estado nuevo. No hay red, ni
 * almacenamiento, ni relojes. El servidor le pasa el tiempo y la semilla del
 * barajado, así que una partida entera se puede reproducir en un test.
 */

import { commitMove } from "./board";
import { rejection, type Rejection, type RejectionCode } from "./errors";
import { sortRack } from "./order";
import { DEFAULT_RULES, sanitizeRules, type RoomRules } from "./rules";
import { deal, HAND_SIZE, MAX_PLAYERS, MIN_PLAYERS, rackPenalty } from "./tiles";
import type { Board, TileId } from "./types";

export type GameStatus = "lobby" | "playing" | "finished";

export type Player = {
  id: string;
  name: string;
  rack: TileId[];
  hasMelded: boolean;
  connected: boolean;
  /** Puntuación acumulada entre rondas de la misma sala. */
  score: number;
};

export type GameEvent =
  | { type: "joined"; playerId: string }
  | { type: "left"; playerId: string }
  | { type: "started" }
  | { type: "played"; playerId: string; tiles: number; meldValue: number }
  | { type: "drew"; playerId: string }
  | { type: "passed"; playerId: string }
  | { type: "timedOut"; playerId: string }
  | { type: "finished"; winnerId: string | null };

export type GameState = {
  readonly code: string;
  status: GameStatus;
  hostId: string;
  players: Player[];
  /** Índice en `players` de quien tiene el turno. */
  turnIndex: number;
  board: Board;
  /**
   * Las fichas de la última jugada confirmada.
   *
   * Está para que todos vean qué acaba de poner quien jugó, no solo quien lo
   * puso. Con la mesa llena, enterarte de que alguien ha añadido un 7 en la
   * cuarta fila mirando fijamente es imposible.
   */
  lastPlayed: TileId[];
  pool: TileId[];
  /** La variante que se juega en esta mesa. Se fija antes de repartir. */
  rules: RoomRules;
  /** Momento en que expira el turno actual, o null si se juega sin reloj. */
  turnEndsAt: number | null;
  /** Pasadas seguidas con el pozo vacío; sirve para detectar el bloqueo. */
  passStreak: number;
  winnerId: string | null;
  round: number;
  log: GameEvent[];
};

/**
 * Completa un estado guardado antes de que existieran los campos de ahora.
 *
 * Las salas viven en el disco del Durable Object y sobreviven a los despliegues:
 * una partida empezada con la versión anterior se rehidrata con la nueva. Sin
 * esto, añadir un campo bastaba para que la sala reventara al leerse, con gente
 * dentro y a mitad de partida.
 */
export function hydrateGame(raw: unknown): GameState {
  const state = raw as Omit<GameState, "lastPlayed"> & {
    lastPlayed?: TileId[];
  };
  return { ...state, lastPlayed: state.lastPlayed ?? [] };
}

export type Failure = { readonly ok: false; readonly error: Rejection };
export type Success = {
  readonly ok: true;
  readonly state: GameState;
  readonly events: GameEvent[];
};
export type Transition = Success | Failure;

export function createGame(code: string, rules: RoomRules = DEFAULT_RULES): GameState {
  return {
    code,
    status: "lobby",
    hostId: "",
    players: [],
    turnIndex: 0,
    board: [],
    lastPlayed: [],
    pool: [],
    rules: sanitizeRules(rules),
    turnEndsAt: null,
    passStreak: 0,
    winnerId: null,
    round: 0,
    log: [],
  };
}

/**
 * Cambia la variante de la mesa. Solo antes de repartir: nadie debe encontrarse
 * con que la apertura sube a 50 puntos cuando ya lleva media partida.
 */
export function setRules(state: GameState, actorId: string, raw: unknown): Transition {
  if (state.status !== "lobby") {
    return fail("ALREADY_STARTED", "Las reglas se ajustan antes de repartir.");
  }
  if (actorId !== state.hostId) {
    return fail("NOT_HOST", "Solo quien creó la sala puede cambiar las reglas.");
  }
  // Se fusiona sobre lo que ya hay en vez de sustituirlo entero: así cambiar
  // dos reglas seguidas no revierte la primera si el cliente todavía no había
  // recibido el estado nuevo.
  state.rules = sanitizeRules(raw, state.rules);
  return succeed(state);
}

export function findPlayer(state: GameState, playerId: string): Player | undefined {
  return state.players.find((player) => player.id === playerId);
}

export function currentPlayer(state: GameState): Player | undefined {
  return state.players[state.turnIndex];
}

function fail(code: RejectionCode, message: string): Failure {
  return { ok: false, error: rejection(code, message) };
}

function succeed(state: GameState, ...events: GameEvent[]): Success {
  pushLog(state, ...events);
  return { ok: true, state, events };
}

/** El registro guarda solo lo reciente: es para la mesa, no es un historial. */
function pushLog(state: GameState, ...events: GameEvent[]): void {
  state.log = [...state.log, ...events].slice(-LOG_LIMIT);
}

const LOG_LIMIT = 60;

// --- Sala ------------------------------------------------------------------

export type JoinResult =
  | { readonly ok: true; readonly state: GameState; readonly player: Player }
  | { readonly ok: false; readonly reason: "full" | "started" | "name" };

export function addPlayer(
  state: GameState,
  playerId: string,
  rawName: string,
): JoinResult {
  const name = sanitizeName(rawName);
  if (!name) return { ok: false, reason: "name" };
  if (state.status !== "lobby") return { ok: false, reason: "started" };
  // Un asiento solo se libera cuando hace falta: así recargar la página te
  // devuelve tu sitio, pero nadie se queda bloqueando una sala llena.
  if (state.players.length >= MAX_PLAYERS) purgeDisconnected(state);
  if (state.players.length >= MAX_PLAYERS) return { ok: false, reason: "full" };

  const player: Player = {
    id: playerId,
    name: uniqueName(state, name),
    rack: [],
    hasMelded: false,
    connected: true,
    score: 0,
  };
  state.players = [...state.players, player];
  if (!state.hostId) state.hostId = playerId;
  pushLog(state, { type: "joined", playerId });
  return { ok: true, state, player };
}

export function sanitizeName(raw: string): string {
  return raw
    .replace(/[\p{C}]/gu, "")
    .trim()
    .slice(0, 16);
}

function uniqueName(state: GameState, name: string): string {
  const taken = new Set(state.players.map((player) => player.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let suffix = 2; suffix < 20; suffix++) {
    const candidate = `${name.slice(0, 14)} ${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

/**
 * Libera los asientos del lobby que nadie está ocupando. Se llama justo cuando
 * el sitio hace falta —sala llena o reparto inminente— y nunca antes.
 */
export function purgeDisconnected(state: GameState): GameState {
  if (state.status !== "lobby") return state;
  const leaving = state.players.filter((player) => !player.connected);
  if (leaving.length === 0) return state;

  state.players = state.players.filter((player) => player.connected);
  for (const player of leaving) pushLog(state, { type: "left", playerId: player.id });
  return ensureHost(state);
}

/** El mando pasa a alguien que esté conectado para que la sala no se atasque. */
export function ensureHost(state: GameState): GameState {
  const host = state.players.find((player) => player.id === state.hostId);
  if (host?.connected) return state;
  state.hostId = state.players.find((player) => player.connected)?.id ?? state.hostId;
  return state;
}

export function setConnected(
  state: GameState,
  playerId: string,
  connected: boolean,
): GameState {
  state.players = state.players.map((player) =>
    player.id === playerId ? { ...player, connected } : player,
  );
  return state.status === "lobby" ? ensureHost(state) : state;
}

// --- Partida ---------------------------------------------------------------

export function startGame(
  state: GameState,
  actorId: string,
  seed: number,
  now: number,
): Transition {
  if (state.status === "playing") return fail("ALREADY_STARTED", "La partida ya ha empezado.");
  if (actorId !== state.hostId) {
    return fail("NOT_HOST", "Solo quien creó la sala puede empezar la partida.");
  }
  // Quien no esté en la mesa cuando se reparte, no juega esta ronda.
  purgeDisconnected(state);
  if (state.players.length < MIN_PLAYERS) {
    return fail("NOT_ENOUGH_PLAYERS", `Hacen falta al menos ${MIN_PLAYERS} jugadores.`);
  }

  const { hands, pool } = deal(state.players.length, seed, state.rules.handSize);
  state.players = state.players.map((player, index) => ({
    ...player,
    // Ordenada de salida: nadie debería empezar colocando catorce fichas.
    rack: sortRack(hands[index] ?? [], "runs"),
    hasMelded: false,
  }));
  state.pool = pool;
  state.board = [];
  state.lastPlayed = [];
  state.status = "playing";
  state.turnIndex = 0;
  state.passStreak = 0;
  state.winnerId = null;
  state.round += 1;
  state.turnEndsAt = turnDeadline(state, now);
  return succeed(state, { type: "started" });
}

export type CommitRequest = {
  readonly actorId: string;
  readonly board: Board;
  readonly rack: TileId[];
};

export function commitTurn(
  state: GameState,
  request: CommitRequest,
  now: number,
): Transition {
  const guard = guardTurn(state, request.actorId);
  if (guard) return guard;

  const player = currentPlayer(state)!;
  const outcome = commitMove({
    previousBoard: state.board,
    previousRack: player.rack,
    nextBoard: request.board,
    nextRack: request.rack,
    hasMelded: player.hasMelded,
    openingPoints: state.rules.openingPoints,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  state.board = outcome.board;
  state.lastPlayed = outcome.played.slice();
  state.players = state.players.map((entry) =>
    entry.id === player.id
      ? { ...entry, rack: outcome.rack, hasMelded: true }
      : entry,
  );
  state.passStreak = 0;

  const played: GameEvent = {
    type: "played",
    playerId: player.id,
    tiles: outcome.played.length,
    meldValue: outcome.meldValue,
  };

  if (outcome.rack.length === 0) {
    return succeed(state, played, ...finish(state, player.id));
  }
  return succeed(state, played, ...advanceTurn(state, now));
}

export function drawTile(state: GameState, actorId: string, now: number): Transition {
  const guard = guardTurn(state, actorId);
  if (guard) return guard;

  const player = currentPlayer(state)!;
  const drawn = state.pool.shift();
  if (drawn) {
    state.players = state.players.map((entry) =>
      entry.id === player.id ? { ...entry, rack: [...entry.rack, drawn] } : entry,
    );
    state.passStreak = 0;
    return succeed(
      state,
      { type: "drew", playerId: player.id },
      ...advanceTurn(state, now),
    );
  }

  // Pozo vacío: robar equivale a pasar. Cuando todos pasan seguidos, la partida
  // está bloqueada y gana quien menos puntos tenga en el atril.
  state.passStreak += 1;
  const passed: GameEvent = { type: "passed", playerId: player.id };
  if (state.passStreak >= state.players.length) {
    return succeed(state, passed, ...finish(state, null));
  }
  return succeed(state, passed, ...advanceTurn(state, now));
}

/**
 * Se acabó el tiempo del turno.
 *
 * Si lo que el jugador tenía montado en su pantalla es una jugada legal, se
 * baja. Perder una jugada válida por no llegar a pulsar Confirmar es la peor
 * forma de perder un turno: el trabajo estaba hecho y el juego lo tira.
 *
 * `propuesta` es la última mesa que mandó quien juega. No se le pide el atril:
 * se deduce quitándole las fichas que ha puesto en la mesa, que además es más
 * de fiar que creerse lo que diga el cliente. Si no vale --le falta una ficha a
 * una combinación, o no llega a los puntos de apertura-- se roba y se pasa
 * turno, como siempre.
 */
export function timeoutTurn(
  state: GameState,
  now: number,
  propuesta?: Board,
): Transition {
  if (state.status !== "playing") {
    return fail("NOT_PLAYING", "La partida no está en juego.");
  }
  const player = currentPlayer(state);
  if (!player) return fail("NOT_PLAYING", "No hay ningún turno activo.");

  const timedOut: GameEvent = { type: "timedOut", playerId: player.id };

  if (propuesta && propuesta.some((set) => set.length > 0)) {
    const enMesa = new Set(propuesta.flat());
    const rack = player.rack.filter((id) => !enMesa.has(id));
    const jugada = commitTurn(
      state,
      { actorId: player.id, board: propuesta, rack },
      now,
    );
    // Un rechazo no toca el estado, así que se puede seguir como si nada.
    if (jugada.ok) {
      return { ok: true, state: jugada.state, events: [timedOut, ...jugada.events] };
    }
  }

  const drawn = drawTile(state, player.id, now);
  if (!drawn.ok) return drawn;
  return { ok: true, state: drawn.state, events: [timedOut, ...drawn.events] };
}

function guardTurn(state: GameState, actorId: string): Failure | null {
  if (state.status !== "playing") {
    return fail("NOT_PLAYING", "La partida no está en juego.");
  }
  const player = currentPlayer(state);
  if (!player || player.id !== actorId) {
    return fail("NOT_YOUR_TURN", "No es tu turno.");
  }
  return null;
}

function advanceTurn(state: GameState, now: number): GameEvent[] {
  state.turnIndex = (state.turnIndex + 1) % state.players.length;
  state.turnEndsAt = turnDeadline(state, now);
  return [];
}

/** Cuándo vence el turno, o null si la mesa juega sin reloj. */
export function turnDeadline(state: GameState, now: number): number | null {
  const seconds = state.rules.turnSeconds;
  return seconds === null ? null : now + seconds * 1000;
}

function finish(state: GameState, winnerId: string | null): GameEvent[] {
  const scores = state.players.map((player) => rackPenalty(player.rack));
  const resolvedWinner = winnerId ?? lowestRackPlayerId(state, scores);
  const pot = state.players.reduce(
    (total, player, index) => (player.id === resolvedWinner ? total : total + scores[index]!),
    0,
  );

  state.players = state.players.map((player, index) => ({
    ...player,
    score:
      player.score + (player.id === resolvedWinner ? pot : -(scores[index] ?? 0)),
  }));
  state.status = "finished";
  state.winnerId = resolvedWinner;
  state.turnEndsAt = null;
  return [{ type: "finished", winnerId: resolvedWinner }];
}

function lowestRackPlayerId(state: GameState, scores: number[]): string | null {
  let bestIndex = -1;
  for (const [index, score] of scores.entries()) {
    if (bestIndex < 0 || score < scores[bestIndex]!) bestIndex = index;
  }
  return state.players[bestIndex]?.id ?? null;
}

/** Prepara otra ronda en la misma sala conservando jugadores y puntuación. */
export function prepareRematch(state: GameState, actorId: string): Transition {
  if (state.status !== "finished") {
    return fail("NOT_FINISHED", "La partida todavía no ha terminado.");
  }
  if (actorId !== state.hostId) {
    return fail("NOT_HOST", "Solo quien creó la sala puede pedir la revancha.");
  }
  state.status = "lobby";
  state.board = [];
  state.lastPlayed = [];
  state.pool = [];
  state.winnerId = null;
  state.turnEndsAt = null;
  state.passStreak = 0;
  state.players = state.players.map((player) => ({
    ...player,
    rack: [],
    hasMelded: false,
  }));
  return succeed(state);
}

export { HAND_SIZE, MAX_PLAYERS, MIN_PLAYERS };
