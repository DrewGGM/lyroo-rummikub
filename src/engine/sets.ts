/**
 * Lectura y validación de una combinación aislada (un grupo o una escalera).
 *
 * Una combinación con comodines puede leerse de varias maneras: `[r7, b7, J]`
 * es un grupo de sietes donde el comodín hace de 7 negro o de 7 naranja, y
 * `[r7, J, J]` es además una escalera roja que puede empezar en el 5, el 6 o el
 * 7. Las reglas oficiales del comodín dependen de qué ficha representa, así que
 * el motor enumera todas las lecturas válidas y deja que la regla decida.
 */

import { isJoker, parseTile } from "./tiles";
import {
  COLORS,
  MAX_VALUE,
  MIN_SET_SIZE,
  MIN_VALUE,
  type Color,
  type NumberTile,
  type SetReading,
  type TileId,
  type TileSpec,
} from "./types";

/** Todas las combinaciones de `size` elementos de `items`, en orden. */
function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const [head, ...rest] = items as [T, ...T[]];
  const withHead = combinations(rest, size - 1).map((combo) => [head, ...combo]);
  return [...withHead, ...combinations(rest, size)];
}

/**
 * Todas las lecturas válidas de una combinación. Lista vacía = no es válida.
 *
 * Una combinación necesita al menos una ficha numerada: tres comodines sueltos
 * no definen ni un número ni un color, así que no forman una combinación legal.
 */
export function readSet(ids: readonly TileId[]): SetReading[] {
  if (ids.length < MIN_SET_SIZE) return [];

  const numbers: NumberTile[] = [];
  const jokerIds: TileId[] = [];
  for (const id of ids) {
    const tile = parseTile(id);
    if (!tile) return [];
    if (tile.kind === "joker") jokerIds.push(id);
    else numbers.push(tile);
  }
  if (numbers.length === 0) return [];

  const readings: SetReading[] = [];
  readings.push(...readAsGroup(numbers, jokerIds, ids.length));
  readings.push(...readAsRun(numbers, jokerIds, ids.length));
  return readings;
}

function readAsGroup(
  numbers: readonly NumberTile[],
  jokerIds: readonly TileId[],
  size: number,
): SetReading[] {
  // Un grupo son fichas del mismo número y colores distintos, así que como
  // mucho hay tantas fichas como colores.
  if (size > COLORS.length) return [];
  const value = numbers[0]!.value;
  if (numbers.some((tile) => tile.value !== value)) return [];

  const usedColors = new Set(numbers.map((tile) => tile.color));
  if (usedColors.size !== numbers.length) return [];

  const freeColors = COLORS.filter((color) => !usedColors.has(color));
  return combinations(freeColors, jokerIds.length).map((jokerColors) => {
    const jokerAs: TileSpec[] = jokerColors.map((color) => ({ color, value }));
    const byColor = new Map<Color, TileId>();
    for (const tile of numbers) byColor.set(tile.color, tile.id);
    jokerColors.forEach((color, index) => byColor.set(color, jokerIds[index]!));
    const ordered = COLORS.filter((color) => byColor.has(color)).map(
      (color) => byColor.get(color)!,
    );
    return { kind: "group", jokerAs, ordered } satisfies SetReading;
  });
}

function readAsRun(
  numbers: readonly NumberTile[],
  jokerIds: readonly TileId[],
  size: number,
): SetReading[] {
  const color = numbers[0]!.color;
  if (numbers.some((tile) => tile.color !== color)) return [];

  const byValue = new Map<number, TileId>();
  for (const tile of numbers) {
    if (byValue.has(tile.value)) return []; // dos fichas iguales no encajan
    byValue.set(tile.value, tile.id);
  }

  const lowest = Math.min(...byValue.keys());
  const highest = Math.max(...byValue.keys());
  const readings: SetReading[] = [];

  for (let start = MIN_VALUE; start + size - 1 <= MAX_VALUE; start++) {
    const end = start + size - 1;
    if (lowest < start || highest > end) continue;

    const gaps: number[] = [];
    for (let value = start; value <= end; value++) {
      if (!byValue.has(value)) gaps.push(value);
    }
    if (gaps.length !== jokerIds.length) continue;

    const jokerAs: TileSpec[] = gaps.map((value) => ({ color, value }));
    let nextJoker = 0;
    const ordered: TileId[] = [];
    for (let value = start; value <= end; value++) {
      ordered.push(byValue.get(value) ?? jokerIds[nextJoker++]!);
    }
    readings.push({ kind: "run", jokerAs, ordered });
  }
  return readings;
}

export function isValidSet(ids: readonly TileId[]): boolean {
  return readSet(ids).length > 0;
}

/**
 * Puntos que vale la combinación. Cuando el comodín admite varias lecturas se
 * cuenta la más alta: la regla es que el comodín vale lo que la ficha que
 * representa, y quien juega elige qué representa.
 */
export function setValue(ids: readonly TileId[]): number {
  const readings = readSet(ids);
  if (readings.length === 0) return 0;

  let best = 0;
  for (const reading of readings) {
    let total = reading.jokerAs.reduce((sum, spec) => sum + spec.value, 0);
    for (const id of ids) {
      const tile = parseTile(id);
      if (tile && tile.kind === "number") total += tile.value;
    }
    if (total > best) best = total;
  }
  return best;
}

/**
 * Reordena la combinación como debe verse en la mesa: las escaleras
 * ascendentes y los grupos en orden de color fijo, con cada comodín en el hueco
 * que ocupa. Si el orden que mandó el jugador ya es una lectura válida se
 * respeta, para que la mesa se vea como él la dejó.
 */
export function canonicalOrder(ids: readonly TileId[]): TileId[] {
  const readings = readSet(ids);
  if (readings.length === 0) return ids.slice();
  const asSent = readings.find(
    (reading) =>
      reading.ordered.length === ids.length &&
      reading.ordered.every((id, index) => id === ids[index]),
  );
  return (asSent ?? readings[0]!).ordered.slice();
}

/** Fichas concretas que puede representar el comodín `jokerId` dentro de `ids`. */
export function jokerCandidates(
  ids: readonly TileId[],
  jokerId: TileId,
): TileSpec[] {
  if (!isJoker(jokerId)) return [];
  const jokerIndex = ids.filter(isJoker).indexOf(jokerId);
  if (jokerIndex < 0) return [];

  const seen = new Set<string>();
  const candidates: TileSpec[] = [];
  for (const reading of readSet(ids)) {
    const spec = reading.jokerAs[jokerIndex];
    if (!spec) continue;
    const key = `${spec.color}${spec.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(spec);
  }
  return candidates;
}
