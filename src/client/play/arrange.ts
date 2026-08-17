/**
 * Colocar fichas mientras montas la jugada.
 *
 * Todo esto pasa solo en tu pantalla. Puedes deshacer, probar, recolocar la
 * mesa entera y arrepentirte: nadie ve nada hasta que pulsas confirmar, y el
 * servidor tiene la última palabra sobre si la jugada vale.
 */

import { readSet } from "../../engine/sets";
import { MIN_SET_SIZE, type Board, type TileId } from "../../engine/types";

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

/**
 * Mueve varias fichas de golpe conservando su orden.
 *
 * El destino se apunta a la ficha que hay en esa posición, no al número: al
 * sacar las fichas de en medio los índices se corren, y seguir un número
 * dejaría el grupo en otro sitio del que señalaste.
 */
export function moveTiles(
  layout: Layout,
  tiles: readonly TileId[],
  to: Slot,
): Layout {
  if (tiles.length === 0) return layout;
  if (tiles.length === 1) {
    const from = locate(layout, tiles[0]!);
    return from ? moveTile(layout, from, to) : layout;
  }

  const moving = new Set(tiles);
  const anchor = to.kind === "new" ? null : tileAt(layout, to);
  // Soltar el grupo sobre una de sus propias fichas no significa nada.
  if (anchor !== null && moving.has(anchor)) return layout;

  const board = layout.board
    .map((set) => set.filter((id) => !moving.has(id)))
    .filter((set) => set.length > 0);
  const rack = layout.rack.filter((id) => !moving.has(id));
  const trimmed: Layout = { board, rack };

  if (to.kind === "new") {
    return { board: [...board, tiles.slice()], rack };
  }

  const landing = anchor === null ? endOf(trimmed, to) : locate(trimmed, anchor);
  if (!landing || landing.kind === "new") return layout;

  if (landing.kind === "rack") {
    const next = rack.slice();
    next.splice(landing.index, 0, ...tiles);
    return { board, rack: next };
  }

  const next = board.map((set) => set.slice());
  const target = next[landing.set];
  if (!target) return layout;
  target.splice(landing.index, 0, ...tiles);
  return { board: next, rack };
}

/** Dónde está una ficha ahora mismo. */
export function locate(layout: Layout, tile: TileId): Slot | null {
  const inRack = layout.rack.indexOf(tile);
  if (inRack >= 0) return { kind: "rack", index: inRack };
  for (const [set, tiles] of layout.board.entries()) {
    const index = tiles.indexOf(tile);
    if (index >= 0) return { kind: "set", set, index };
  }
  return null;
}

/** El final de la fila a la que apunta el destino. */
function endOf(layout: Layout, to: Slot): Slot | null {
  if (to.kind === "rack") return { kind: "rack", index: layout.rack.length };
  if (to.kind === "set") {
    const set = layout.board[to.set];
    if (!set) return { kind: "new" };
    return { kind: "set", set: to.set, index: set.length };
  }
  return null;
}

/**
 * La combinación más larga que se puede formar con las fichas que rodean a la
 * que has dejado pulsada, sin saltarse ninguna. Es el atajo para bajar una
 * escalera entera de una vez en lugar de ficha a ficha.
 */
export function runAround(rack: readonly TileId[], index: number): TileId[] {
  if (index < 0 || index >= rack.length) return [];
  let best: TileId[] = [];

  for (let start = 0; start <= index; start++) {
    for (let end = rack.length - 1; end >= index; end--) {
      const span = end - start + 1;
      if (span < MIN_SET_SIZE || span <= best.length) break;
      const candidate = rack.slice(start, end + 1);
      if (readSet(candidate).length > 0) {
        best = candidate;
        break;
      }
    }
  }
  return best;
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

export { sortRack, type SortMode } from "../../engine/order";
