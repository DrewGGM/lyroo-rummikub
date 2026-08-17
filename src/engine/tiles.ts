/** Composición de los mazos, barajado determinista y reparto. */

import {
  COLORS,
  JOKER_PENALTY,
  MAX_VALUE,
  MIN_VALUE,
  type Color,
  type Tile,
  type TileId,
} from "./types";

/**
 * El Rummikub estándar es de 2 a 4 jugadores con 106 fichas. La edición oficial
 * Six Player Edition sube a 160. Para 7-8 jugadores no existe edición oficial,
 * así que extendemos la misma progresión: una copia más de cada ficha y dos
 * comodines más, manteniendo el pozo en torno al doble de lo repartido.
 */
export type DeckSpec = {
  /** Cuántas copias hay de cada combinación color+número. */
  readonly copies: number;
  readonly jokers: number;
};

export function deckSpecFor(playerCount: number): DeckSpec {
  if (playerCount <= 4) return { copies: 2, jokers: 2 }; // 106 fichas
  if (playerCount <= 6) return { copies: 3, jokers: 4 }; // 160 fichas
  return { copies: 4, jokers: 6 }; // 214 fichas
}

/** Fichas que se reparten a cada jugador al empezar. */
export const HAND_SIZE = 14;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export function buildTileId(color: Color, value: number, copy: number): TileId {
  return `${color}${value}_${copy}`;
}

export function buildJokerId(copy: number): TileId {
  return `j_${copy}`;
}

/** Devuelve el mazo completo, sin barajar, para un número de jugadores. */
export function buildDeck(playerCount: number): TileId[] {
  const spec = deckSpecFor(playerCount);
  const deck: TileId[] = [];
  for (let copy = 0; copy < spec.copies; copy++) {
    for (const color of COLORS) {
      for (let value = MIN_VALUE; value <= MAX_VALUE; value++) {
        deck.push(buildTileId(color, value, copy));
      }
    }
  }
  for (let copy = 0; copy < spec.jokers; copy++) deck.push(buildJokerId(copy));
  return deck;
}

const TILE_ID_PATTERN = /^([rbko])(\d{1,2})_(\d+)$/;
const JOKER_ID_PATTERN = /^j_(\d+)$/;

/** Reconstruye la ficha a partir de su id. Devuelve null si el id no es válido. */
export function parseTile(id: TileId): Tile | null {
  const joker = JOKER_ID_PATTERN.exec(id);
  if (joker) return { id, kind: "joker" };

  const match = TILE_ID_PATTERN.exec(id);
  if (!match) return null;
  const value = Number(match[2]);
  if (value < MIN_VALUE || value > MAX_VALUE) return null;
  return { id, kind: "number", color: match[1] as Color, value };
}

/** Como `parseTile`, pero lanza en vez de devolver null. Para uso interno. */
export function requireTile(id: TileId): Tile {
  const tile = parseTile(id);
  if (!tile) throw new Error(`Id de ficha inválido: ${id}`);
  return tile;
}

export function isJoker(id: TileId): boolean {
  return JOKER_ID_PATTERN.test(id);
}

/** Puntos que suma una ficha en el atril al final de la partida. */
export function penaltyValue(id: TileId): number {
  const tile = requireTile(id);
  return tile.kind === "joker" ? JOKER_PENALTY : tile.value;
}

export function rackPenalty(rack: readonly TileId[]): number {
  return rack.reduce((total, id) => total + penaltyValue(id), 0);
}

/**
 * Generador congruente lineal sembrado. Barajar con una semilla explícita hace
 * que una partida sea reproducible: el mismo `seed` reparte exactamente el mismo
 * juego, lo que permite escribir tests de partidas completas.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Barajado Fisher-Yates. Devuelve una copia; no modifica la entrada. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

export type Deal = {
  /** Una mano por jugador, en el mismo orden que se pidió. */
  readonly hands: TileId[][];
  /** Lo que queda por robar, en el orden en que se robará. */
  readonly pool: TileId[];
};

export function deal(playerCount: number, seed: number): Deal {
  const pool = shuffle(buildDeck(playerCount), createRandom(seed));
  const hands: TileId[][] = [];
  for (let i = 0; i < playerCount; i++) hands.push(pool.splice(0, HAND_SIZE));
  return { hands, pool };
}
