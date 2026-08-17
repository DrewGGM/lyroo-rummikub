/**
 * Contrato entre el navegador y la sala.
 *
 * Dos reglas gobiernan este protocolo:
 *
 * 1. El cliente manda intenciones, nunca hechos consumados. "Quiero dejar la
 *    mesa así" en vez de "la mesa ahora es así".
 * 2. Cada jugador recibe una vista recortada del estado: su atril completo, y
 *    de los demás solo cuántas fichas tienen. El servidor nunca manda por el
 *    cable las fichas de otro, así que abrir las herramientas de desarrollo no
 *    revela nada.
 */

import type { GameEvent, GameStatus } from "../engine/game";
import type { RejectionCode } from "../engine/errors";
import type { RoomRules } from "../engine/rules";
import type { Board, TileId } from "../engine/types";

export type PlayerView = {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
  /** Cuántas fichas tiene en el atril. Nunca cuáles. */
  readonly tileCount: number;
  readonly hasMelded: boolean;
  readonly score: number;
};

export type GameView = {
  readonly code: string;
  readonly status: GameStatus;
  readonly round: number;
  readonly players: readonly PlayerView[];
  readonly hostId: string;
  readonly turnPlayerId: string | null;
  /** Momento en que expira el turno, o null si la mesa juega sin reloj. */
  readonly turnEndsAt: number | null;
  readonly rules: RoomRules;
  readonly board: Board;
  readonly poolCount: number;
  readonly winnerId: string | null;
  /** El identificador de quien recibe esta vista. */
  readonly you: string;
  /** Solo el atril propio. */
  readonly rack: readonly TileId[];
  /**
   * Reloj del servidor al enviar. El cliente calcula el desfase con su propio
   * reloj para que el temporizador no dependa de la hora del dispositivo.
   */
  readonly serverTime: number;
  readonly log: readonly GameEvent[];
};

export type ClientMessage =
  | { readonly type: "join"; readonly name: string; readonly token?: string }
  | { readonly type: "start" }
  | { readonly type: "commit"; readonly board: Board; readonly rack: TileId[] }
  | { readonly type: "draw" }
  /** Guarda el orden en que el jugador tiene colocado su atril. */
  | { readonly type: "sort"; readonly rack: TileId[] }
  | { readonly type: "rematch" }
  | { readonly type: "settings"; readonly rules: unknown }
  /**
   * Lo que el jugador de turno está montando ahora mismo. El servidor lo
   * reenvía sin validarlo ni guardarlo: es solo para que los demás vean la
   * mesa moverse en vivo.
   */
  | { readonly type: "preview"; readonly board: Board };

export type ServerMessage =
  | {
      readonly type: "welcome";
      readonly playerId: string;
      /** Credencial del asiento. El cliente la guarda para poder reconectar. */
      readonly token: string;
      readonly view: GameView;
    }
  | {
      readonly type: "state";
      readonly view: GameView;
      readonly events: readonly GameEvent[];
    }
  | {
      readonly type: "rejected";
      readonly code: RejectionCode;
      readonly message: string;
      readonly setIndexes?: readonly number[];
    }
  | {
      /** Un jugador está moviendo fichas; todavía no ha confirmado nada. */
      readonly type: "preview";
      readonly playerId: string;
      readonly board: Board;
    }
  | {
      readonly type: "denied";
      readonly reason: "full" | "started" | "name" | "unknown-seat";
      readonly message: string;
    };

/** Alfabeto sin caracteres que se confunden al dictar un código por teléfono. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

export function isRoomCode(value: string): boolean {
  if (value.length !== ROOM_CODE_LENGTH) return false;
  for (const char of value) {
    if (!ROOM_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Comprueba que un mensaje recibido tiene la forma que dice tener. Todo lo que
 * llega por el WebSocket pasa por aquí antes de tocar el motor.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "string" || raw.length > 64_000) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;

  switch (message["type"]) {
    case "join":
      if (typeof message["name"] !== "string") return null;
      if (message["token"] !== undefined && typeof message["token"] !== "string") {
        return null;
      }
      return message["token"] === undefined
        ? { type: "join", name: message["name"] }
        : { type: "join", name: message["name"], token: message["token"] };
    case "start":
      return { type: "start" };
    case "draw":
      return { type: "draw" };
    case "rematch":
      return { type: "rematch" };
    case "commit": {
      const board = parseBoard(message["board"]);
      const rack = parseTileIds(message["rack"]);
      if (!board || !rack) return null;
      return { type: "commit", board, rack };
    }
    case "sort": {
      const rack = parseTileIds(message["rack"]);
      if (!rack) return null;
      return { type: "sort", rack };
    }
    case "settings":
      return { type: "settings", rules: message["rules"] };
    case "preview": {
      const board = parseBoard(message["board"]);
      if (!board) return null;
      return { type: "preview", board };
    }
    default:
      return null;
  }
}

/** Tope defensivo: ninguna partida legítima mueve más fichas que esto. */
const MAX_TILES_PER_MESSAGE = 400;
const MAX_SETS = 120;

function parseTileIds(value: unknown): TileId[] | null {
  if (!Array.isArray(value) || value.length > MAX_TILES_PER_MESSAGE) return null;
  const ids: TileId[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > 8) return null;
    ids.push(entry);
  }
  return ids;
}

function parseBoard(value: unknown): Board | null {
  if (!Array.isArray(value) || value.length > MAX_SETS) return null;
  const board: Board = [];
  let total = 0;
  for (const entry of value) {
    const set = parseTileIds(entry);
    if (!set) return null;
    total += set.length;
    if (total > MAX_TILES_PER_MESSAGE) return null;
    board.push(set);
  }
  return board;
}
