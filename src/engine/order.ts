/**
 * El orden en que se ven las fichas en el atril.
 *
 * Vive en el motor y no en el cliente porque el servidor también lo necesita:
 * al repartir, la mano llega ya ordenada. Que a nadie le toque empezar la
 * partida colocando catorce fichas a mano.
 */

import { readSet } from "./sets";
import { parseTile } from "./tiles";
import { COLORS, MIN_SET_SIZE, type TileId } from "./types";

export type SortMode = "runs" | "groups";

/**
 * Por escaleras agrupa color y luego número; por grupos, número y luego color.
 * Son las dos maneras en que cualquiera coloca su atril antes de mirar la mesa.
 */
export function sortRack(rack: readonly TileId[], mode: SortMode): TileId[] {
  const rank = (id: TileId): [number, number, number] => {
    const tile = parseTile(id);
    // Los comodines al final: valen para todo, así que no pertenecen a ningún
    // sitio concreto.
    if (!tile || tile.kind === "joker") return [1, 99, 99];
    const color = COLORS.indexOf(tile.color);
    return mode === "runs" ? [0, color, tile.value] : [0, tile.value, color];
  };

  return rack.slice().sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return left[i]! - right[i]!;
    }
    return a.localeCompare(b);
  });
}

/**
 * Dónde poner una separación en el atril.
 *
 * En el juego de mesa uno deja un hueco entre lo que ya tiene resuelto y lo
 * suelto: se ve de un vistazo qué está listo para bajar. Aquí se calcula igual,
 * mirando el atril de izquierda a derecha y quedándose con el tramo más largo
 * que ya cumple regla.
 *
 * Devuelve los índices donde empieza un bloque nuevo, separación incluida.
 */
export function rackBlocks(rack: readonly TileId[]): number[] {
  // Un conjunto y no una lista: entre dos combinaciones seguidas, el final de
  // una y el principio de la otra son el mismo sitio y va un solo hueco.
  const cortes = new Set<number>();
  let i = 0;

  while (i < rack.length) {
    let largo = 0;
    // El tramo más largo primero: un 5-6-7-8 vale más que quedarse en el 5-6-7.
    for (let fin = rack.length; fin >= i + MIN_SET_SIZE; fin--) {
      if (readSet(rack.slice(i, fin)).length > 0) {
        largo = fin - i;
        break;
      }
    }
    if (largo === 0) {
      i += 1;
      continue;
    }
    if (i > 0) cortes.add(i);
    if (i + largo < rack.length) cortes.add(i + largo);
    i += largo;
  }
  return [...cortes].sort((a, b) => a - b);
}
