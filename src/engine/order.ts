/**
 * El orden en que se ven las fichas en el atril.
 *
 * Vive en el motor y no en el cliente porque el servidor también lo necesita:
 * al repartir, la mano llega ya ordenada. Que a nadie le toque empezar la
 * partida colocando catorce fichas a mano.
 */

import { parseTile } from "./tiles";
import { COLORS, type TileId } from "./types";

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
