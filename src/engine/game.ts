/**
 * Estado autoritativo de una partida y las transiciones que lo hacen avanzar.
 *
 * Todo aquí es puro: recibe estado, devuelve estado nuevo. No hay red, ni
 * almacenamiento, ni relojes. El servidor le pasa el tiempo y la semilla del
 * barajado, así que una partida entera se puede reproducir en un test.
 */

import { commitMove } from "./board";
import { rejection, type Rejection, type RejectionCode } from "./errors";
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
  pool: TileId[];
  turnSeconds: number;
  /** Momento en que expira el turno actual, en epoch ms. */
  turnEndsAt: number | null;
  /** Pasadas seguidas con el pozo vacío; sirve para detectar el bloqueo. */
  passStreak: number;
  winnerId: string | null;
  round: number;
  log: GameEvent[];
};

export type Failure = { readonly ok: false; readonly error: Rejection };
export type Success = {
  readonly ok: true;
  readonly state: GameState;
  readonly events: GameEvent[];
};
export type Transition = Success | Failure;

export const DEFAULT_TURN_SECONDS = 60;
export const MIN_TURN_SECONDS = 20;
export const MAX_TURN_SECONDS = 180;

export function createGame(code: string, turnSeconds = DEFAULT_TURN_SECONDS): GameState {
  return {
    code,
    status: "lobby",
    hostId: "",
    players: [],
    turnIndex: 0,
    board: [],
    pool: [],
    turnSeconds: clampTurnSeconds(turnSeconds),
    turnEndsAt: null,
    passStreak: 0,
    winnerId: null,
    round: 0,
    log: [],
  };
}

export function clampTurnSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_TURN_SECONDS;
  return Math.min(MAX_TURN_SECONDS, Math.max(MIN_TURN_SECONDS, Math.round(seconds)));
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
  state.log = [...state.log, ...events].slice(-60);
  return { ok: true, state, events };
}

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
  state.log = [...state.log, { type: "joined", playerId }].slice(-60);
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

/** Saca a un jugador de la sala. Solo tiene efecto antes de empezar la partida. */
export function removePlayer(state: GameState, playerId: string): GameState {
  if (state.status !== "lobby") return state;
  state.players = state.players.filter((player) => player.id !== playerId);
  if (state.hostId === playerId) state.hostId = state.players[0]?.id ?? "";
  state.log = [...state.log, { type: "left", playerId }].slice(-60);
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
  return state;
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
  if (state.players.length < MIN_PLAYERS) {
    return fail("NOT_ENOUGH_PLAYERS", `Hacen falta al menos ${MIN_PLAYERS} jugadores.`);
  }

  const { hands, pool } = deal(state.players.length, seed);
  state.players = state.players.map((player, index) => ({
    ...player,
    rack: hands[index] ?? [],
    hasMelded: false,
  }));
  state.pool = pool;
  state.board = [];
  state.status = "playing";
  state.turnIndex = 0;
  state.passStreak = 0;
  state.winnerId = null;
  state.round += 1;
  state.turnEndsAt = now + state.turnSeconds * 1000;
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
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  state.board = outcome.board;
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
 * Se acabó el tiempo del turno. El servidor roba por el jugador y pasa turno;
 * lo que estuviera montando en su pantalla nunca llegó aquí, así que la mesa no
 * se toca.
 */
export function timeoutTurn(state: GameState, now: number): Transition {
  if (state.status !== "playing") {
    return fail("NOT_PLAYING", "La partida no está en juego.");
  }
  const player = currentPlayer(state);
  if (!player) return fail("NOT_PLAYING", "No hay ningún turno activo.");

  const timedOut: GameEvent = { type: "timedOut", playerId: player.id };
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
  state.turnEndsAt = now + state.turnSeconds * 1000;
  return [];
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
