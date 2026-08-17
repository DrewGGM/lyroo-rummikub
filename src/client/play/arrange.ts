/**
 * Colocar fichas mientras montas la jugada.
 *
 * Todo esto pasa solo en tu pantalla. Puedes deshacer, probar, recolocar la
 * mesa entera y arrepentirte: nadie ve nada hasta que pulsas confirmar, y el
 * servidor tiene la última palabra sobre si la jugada vale.
 */

import { readSet } from "../../engine/sets";
import { parseTile } from "../../engine/tiles";
import { COLORS, type Board, type TileId } from "../../engine/types";

export type Slot =
  | { readonly kind: "rack"; readonly index: number }
  | { readonly kind: "set"; readonly set: number; readonly index: number }
  | { readonly kind: "new" };

export type Layout = {
  readonly board: Board;
  readonly rack: readonly TileId[];
};

export function sameLayout(a: Layout, b: Layout): boolean {
  return (
    a.rack.length === b.rack.length &&
    a.rack.every((id, index) => id === b.rack[index]) &&
    a.board.length === b.board.length &&
    a.board.every(
      (set, index) =>
        set.length === b.board[index]!.length &&
        set.every((id, position) => id === b.board[index]![position]),
    )
  );
}

/** Mueve una ficha de un sitio a otro y devuelve la disposición resultante. */
export function moveTile(layout: Layout, from: Slot, to: Slot): Layout {
  if (from.kind === "new") return layout;

  const board = layout.board.map((set) => set.slice());
  const rack = layout.rack.slice();

  const tile =
    from.kind === "rack" ? rack[from.index] : board[from.set]?.[from.index];
  if (!tile) return layout;

  if (from.kind === "rack") rack.splice(from.index, 1);
  else board[from.set]!.splice(from.index, 1);

  // Quitar la ficha corre las posiciones que había a su derecha en esa misma
  // fila, así que el destino se ajusta antes de insertar.
  let target = to;
  if (
    to.kind === "rack" &&
    from.kind === "rack" &&
    to.index > from.index
  ) {
    target = { kind: "rack", index: to.index - 1 };
  } else if (
    to.kind === "set" &&
    from.kind === "set" &&
    to.set === from.set &&
    to.index > from.index
  ) {
    target = { kind: "set", set: to.set, index: to.index - 1 };
  }

  if (target.kind === "rack") {
    rack.splice(clamp(target.index, rack.length), 0, tile);
  } else if (target.kind === "set") {
    const set = board[target.set];
    if (!set) return layout;
    set.splice(clamp(target.index, set.length), 0, tile);
  } else {
    board.push([tile]);
  }

  return { board: board.filter((set) => set.length > 0), rack };
}

function clamp(index: number, max: number): number {
  return Math.max(0, Math.min(index, max));
}

export function tileAt(layout: Layout, slot: Slot): TileId | null {
  if (slot.kind === "rack") return layout.rack[slot.index] ?? null;
  if (slot.kind === "set") return layout.board[slot.set]?.[slot.index] ?? null;
  return null;
}

/** Qué combinaciones de la mesa todavía no se sostienen. */
export function brokenSets(board: Board): number[] {
  return board
    .map((set, index) => (readSet(set).length === 0 ? index : -1))
    .filter((index) => index >= 0);
}

export type SortMode = "runs" | "groups";

/**
 * Ordena el atril como lo haría cualquiera antes de mirar la mesa: por
 * escaleras (color y luego número) o por grupos (número y luego color). Es la
 * misma pareja de vistas que ofrece la app de siempre.
 */
export function sortRack(rack: readonly TileId[], mode: SortMode): TileId[] {
  const rank = (id: TileId): [number, number, number] => {
    const tile = parseTile(id);
    if (!tile || tile.kind === "joker") return [1, 99, 99];
    const color = COLORS.indexOf(tile.color);
    return mode === "runs" ? [0, color, tile.value] : [0, tile.value, color];
  };

  return rack.slice().sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    for (let i = 0; i < left.length; i++) {
      if (left[i]! !== right[i]!) return left[i]! - right[i]!;
    }
    return a.localeCompare(b);
  });
}
