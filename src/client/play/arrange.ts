/**
 * Colocar fichas mientras montas la jugada.
 *
 * Todo esto pasa solo en tu pantalla. Puedes deshacer, probar, recolocar la
 * mesa entera y arrepentirte: nadie ve nada hasta que pulsas confirmar, y el
 * servidor tiene la última palabra sobre si la jugada vale.
 */

import { canonicalOrder, readSet } from "../../engine/sets";
import { buildJokerId, buildTileId, parseTile } from "../../engine/tiles";
import {
  COLORS,
  MAX_VALUE,
  MIN_SET_SIZE,
  type Board,
  type TileId,
} from "../../engine/types";

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
  const destino = to.kind === "set" ? layout.board[to.set] : null;
  if (to.kind === "set" && !destino) return layout;

  // La ficha ante la que hay que insertar, si la hay. Se apunta a la ficha y
  // no al número: al sacar el grupo, los índices se corren.
  const anclaje = to.kind === "set" ? (destino?.[to.index] ?? null) : null;
  if (anclaje !== null && moving.has(anclaje)) return layout;

  const board = layout.board
    .map((set) => set.filter((id) => !moving.has(id)))
    .filter((set) => set.length > 0);
  const rack = layout.rack.filter((id) => !moving.has(id));

  if (to.kind === "new") return { board: [...board, tiles.slice()], rack };

  if (to.kind === "rack") {
    const anclaRack = layout.rack[to.index] ?? null;
    const donde =
      anclaRack !== null && !moving.has(anclaRack)
        ? rack.indexOf(anclaRack)
        : rack.length;
    const siguiente = rack.slice();
    siguiente.splice(donde < 0 ? rack.length : donde, 0, ...tiles);
    return { board, rack: siguiente };
  }

  // La fila de destino se reconoce por las fichas que le quedan, no por su
  // posición: si el grupo salía de otra fila que se ha quedado vacía, esa fila
  // desaparece y todas las de después se corren un puesto.
  const quedan = (destino ?? []).filter((id) => !moving.has(id));
  const fila = board.findIndex((set) => quedan.some((id) => set.includes(id)));
  if (fila < 0) {
    // La fila de destino se ha ido entera con el grupo: pasa a ser una nueva.
    return { board: [...board, tiles.slice()], rack };
  }

  const siguiente = board.map((set) => set.slice());
  const objetivo = siguiente[fila]!;
  const donde = anclaje !== null ? objetivo.indexOf(anclaje) : objetivo.length;
  objetivo.splice(donde < 0 ? objetivo.length : donde, 0, ...tiles);
  return { board: siguiente, rack };
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

/**
 * Una ficha de cada clase, para probar si a un par le falta poco.
 *
 * La copia 99 no sale en ningún mazo --el más grande tiene cuatro-- así que
 * ninguna de estas puede coincidir con una ficha de verdad de la partida.
 */
const COPIA_IMPOSIBLE = 99;
const ALFABETO: TileId[] = [
  ...COLORS.flatMap((color) =>
    Array.from(
      { length: MAX_VALUE },
      (_, i) => buildTileId(color, i + 1, COPIA_IMPOSIBLE),
    ),
  ),
  buildJokerId(COPIA_IMPOSIBLE),
];

/**
 * Si a estas fichas les basta una más para ser grupo o escalera.
 *
 * Se prueba a añadir una de cada clase en vez de razonar sobre colores y
 * valores: `readSet` ya sabe de escaleras, grupos y comodines, y repetir esa
 * lógica aquí sería tener dos sitios donde equivocarse.
 */
function leFaltaUna(tiles: readonly TileId[]): boolean {
  return ALFABETO.some((extra) => readSet([...tiles, extra]).length > 0);
}

/**
 * La combinación más larga que se puede formar con las fichas que rodean a la
 * que has dejado pulsada, sin saltarse ninguna. Es el atajo para bajar una
 * escalera entera de una vez en lugar de ficha a ficha.
 *
 * Con dos basta. Una pareja no es combinación todavía, pero si le falta una
 * sola ficha para serlo, moverla junta es justo lo que uno quiere: se lleva el
 * 5-6 a la mesa donde está el 7, o el par de sietes al grupo que los espera.
 */
export function runAround(rack: readonly TileId[], index: number): TileId[] {
  if (index < 0 || index >= rack.length) return [];
  let best: TileId[] = [];

  for (let start = 0; start <= index; start++) {
    for (let end = rack.length - 1; end >= index; end--) {
      const span = end - start + 1;
      if (span < 2 || span <= best.length) break;
      const candidate = rack.slice(start, end + 1);
      // La combinación entera manda; la pareja solo se acepta a falta de algo
      // mejor, y el bucle ya prueba primero los tramos más largos.
      const vale =
        readSet(candidate).length > 0 ||
        (span === 2 && leFaltaUna(candidate));
      if (vale) {
        best = candidate;
        break;
      }
    }
  }
  return best;
}

/**
 * Devuelve el atril del servidor puesto en el orden que tú le habías dado.
 *
 * Hace falta porque el servidor no guarda tu orden —ni debe: es cosa tuya— y
 * manda el atril cada vez que alguien mueve una ficha. Sin esto, colocarte la
 * mano mientras esperas turno no serviría de nada: al segundo siguiente se
 * volvería a ordenar sola.
 *
 * Lo que llega nuevo —lo que acabas de robar— va al final, que es donde uno
 * deja la ficha recién cogida antes de decidir dónde ponerla.
 */
export function keepOrder(
  rack: readonly TileId[],
  preferred: readonly TileId[],
): TileId[] {
  const quedan = new Set(rack);
  const puestas = new Set<TileId>();
  const ordenado: TileId[] = [];

  for (const id of preferred) {
    if (quedan.has(id) && !puestas.has(id)) {
      ordenado.push(id);
      puestas.add(id);
    }
  }
  for (const id of rack) {
    if (!puestas.has(id)) ordenado.push(id);
  }
  return ordenado;
}

/**
 * Recoloca una combinación después de meterle una ficha.
 *
 * Dos cosas que uno espera de una mesa de verdad:
 *
 * - Si metes el 1 en el 2-3-4-5, la escalera queda 1-2-3-4-5. Da igual por
 *   dónde la hayas soltado: nadie quiere ver un 2-3-1-4-5 y tener que ir
 *   colocándolo a mano.
 * - Si metes un 5 en el 1-2-3-4-5-6-7-8, lo que quieres es partirla en dos
 *   escaleras, 1-2-3-4-5 y 5-6-7-8, no que se rompa.
 *
 * Si no hay forma de arreglarla se deja tal cual: que se vea rota es mejor que
 * inventarse una recolocación que el jugador no pidió.
 */
export function tidySet(tiles: readonly TileId[]): TileId[][] {
  if (tiles.length === 0) return [];
  if (readSet(tiles).length > 0) return [canonicalOrder(tiles)];

  const ordenadas = [...tiles].sort(porValor);
  for (
    let corte = MIN_SET_SIZE;
    corte <= ordenadas.length - MIN_SET_SIZE;
    corte++
  ) {
    const izquierda = ordenadas.slice(0, corte);
    const derecha = ordenadas.slice(corte);
    if (readSet(izquierda).length > 0 && readSet(derecha).length > 0) {
      return [canonicalOrder(izquierda), canonicalOrder(derecha)];
    }
  }
  return [tiles.slice()];
}

function porValor(a: TileId, b: TileId): number {
  const uno = parseTile(a);
  const otro = parseTile(b);
  // Los comodines al final: valen para cualquier hueco.
  const valor = (t: typeof uno) => (t && t.kind === "number" ? t.value : 99);
  return valor(uno) - valor(otro) || a.localeCompare(b);
}

/** Recoloca la fila donde acaba de caer una ficha, y deja el resto igual. */
export function tidyAround(layout: Layout, tile: TileId): Layout {
  const fila = layout.board.findIndex((set) => set.includes(tile));
  if (fila < 0) return layout;

  const arreglada = tidySet(layout.board[fila]!);
  if (
    arreglada.length === 1 &&
    arreglada[0]!.every((id, i) => id === layout.board[fila]![i])
  ) {
    return layout;
  }
  return {
    board: [
      ...layout.board.slice(0, fila),
      ...arreglada,
      ...layout.board.slice(fila + 1),
    ],
    rack: layout.rack,
  };
}

/**
 * Dónde encaja una ficha sin pensarlo.
 *
 * Buscar a mano la combinación a la que va un 7 es el trabajo aburrido de cada
 * turno. Se prueba a añadirla a lo que ya hay en la mesa y se elige la
 * combinación que la admita; si no la admite ninguna, no se inventa nada.
 */
export function whereItFits(board: Board, tile: TileId): Slot | null {
  for (const [set, fichas] of board.entries()) {
    if (fichas.includes(tile)) continue;
    if (readSet([...fichas, tile]).length > 0) {
      return { kind: "set", set, index: fichas.length };
    }
  }
  return null;
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
