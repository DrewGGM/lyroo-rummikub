/**
 * Vocabulario del dominio Rummikub.
 *
 * Una ficha se identifica por una cadena corta que ES la ficha: `r7_0` es el
 * primer 7 rojo, `j_1` es el segundo comodín. No hace falta transmitir objetos
 * por la red ni mantener un catálogo compartido: `parseTile(id)` reconstruye la
 * ficha completa desde el id, de forma determinista en cliente y servidor.
 */

export type Color = "r" | "b" | "k" | "o";

export const COLORS: readonly Color[] = ["r", "b", "k", "o"];

export const COLOR_NAMES: Record<Color, string> = {
  r: "rojo",
  b: "azul",
  k: "negro",
  o: "naranja",
};

/** Valor mínimo y máximo impresos en una ficha numerada. */
export const MIN_VALUE = 1;
export const MAX_VALUE = 13;

/** Puntos que penaliza un comodín que se queda en el atril al terminar. */
export const JOKER_PENALTY = 30;

/** Longitud mínima de un grupo o una escalera. */
export const MIN_SET_SIZE = 3;

export type TileId = string;

export type NumberTile = {
  readonly id: TileId;
  readonly kind: "number";
  readonly color: Color;
  readonly value: number;
};

export type JokerTile = {
  readonly id: TileId;
  readonly kind: "joker";
};

export type Tile = NumberTile | JokerTile;

/** Una ficha concreta sin identidad: "un 7 rojo", sin decir cuál de los dos. */
export type TileSpec = { readonly color: Color; readonly value: number };

/** Un grupo o escalera sobre la mesa, en el orden en que se muestra. */
export type TileSet = TileId[];

/** La mesa completa: una lista de combinaciones. */
export type Board = TileSet[];

export type SetKind = "group" | "run";

/**
 * Una lectura válida de una combinación: qué es, y qué ficha concreta
 * representa cada comodín. Una combinación con comodines puede tener varias
 * lecturas ([r7, b7, comodín] es un grupo de sietes con el comodín haciendo de
 * negro o de naranja), y las reglas del comodín necesitan considerarlas todas.
 */
export type SetReading = {
  readonly kind: SetKind;
  /** Ficha concreta que representa cada comodín, en el orden en que aparecen. */
  readonly jokerAs: readonly TileSpec[];
  /** Los ids de la combinación ordenados como deben mostrarse. */
  readonly ordered: readonly TileId[];
};
