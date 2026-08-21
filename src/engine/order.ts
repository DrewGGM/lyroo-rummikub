/**
 * El orden en que se ven las fichas en el atril.
 *
 * Vive en el motor y no en el cliente porque el servidor también lo necesita:
 * al repartir, la mano llega ya ordenada. Que a nadie le toque empezar la
 * partida colocando catorce fichas a mano.
 */

import { canonicalOrder, readSet, setValue } from "./sets";
import { parseTile } from "./tiles";
import { COLORS, MAX_VALUE, MIN_SET_SIZE, MIN_VALUE, type TileId } from "./types";

export type SortMode = "runs" | "groups";

/**
 * Deja el atril ordenado, con lo que ya es jugada por delante.
 *
 * Ordenar por color y número a secas dejaba fuera lo que más importa: si tienes
 * el 1 naranja, dos 1 azules y el 1 rojo, ordenar por número los pone seguidos
 * y el segundo azul se mete en medio, así que el grupo no se ve. Ahora primero
 * se sacan las combinaciones que de verdad se pueden bajar, se ponen al
 * principio en el orden en que se jugarían, y lo suelto va detrás ordenado como
 * siempre. Con eso, el hueco entre bloques cae solo donde tiene que caer.
 *
 * El modo decide a qué se da preferencia cuando una ficha vale para dos sitios:
 * por escaleras se prefiere la escalera, por grupos el grupo.
 */
export function sortRack(rack: readonly TileId[], mode: SortMode): TileId[] {
  const { bloques, sueltas } = splitIntoSets(rack, mode);
  return [...bloques.flat(), ...sueltas.sort(byMode(mode))];
}

/** Las combinaciones que salen del atril, y lo que sobra. */
export function splitIntoSets(
  rack: readonly TileId[],
  mode: SortMode,
): { bloques: TileId[][]; sueltas: TileId[] } {
  const candidatas = candidateSets(rack);
  // La más valiosa primero, y a igualdad la del modo que se pidió: así una
  // ficha que vale para escalera y para grupo cae donde el jugador espera.
  candidatas.sort((a, b) => {
    const preferida = (c: Candidate) => (c.kind === mode ? 0 : 1);
    return (
      preferida(a) - preferida(b) ||
      setValue(b.ids) - setValue(a.ids) ||
      b.ids.length - a.ids.length
    );
  });

  const usadas = new Set<TileId>();
  const bloques: TileId[][] = [];
  for (const candidata of candidatas) {
    if (candidata.ids.some((id) => usadas.has(id))) continue;
    candidata.ids.forEach((id) => usadas.add(id));
    bloques.push(canonicalOrder(candidata.ids));
  }

  return { bloques, sueltas: rack.filter((id) => !usadas.has(id)) };
}

type Candidate = { kind: SortMode; ids: TileId[] };

/**
 * Todo lo que se podría bajar con estas fichas.
 *
 * No se prueban todos los subconjuntos --serían millones-- sino los únicos
 * sitios donde puede haber una combinación: los grupos que forma cada número y
 * los tramos seguidos de cada color. Cada candidata se valida con `readSet`,
 * que ya sabe de comodines, en vez de repetir aquí esas reglas.
 */
function candidateSets(rack: readonly TileId[]): Candidate[] {
  const salida: Candidate[] = [];
  const fichas = rack
    .map((id) => ({ id, tile: parseTile(id) }))
    .filter((f) => f.tile !== null);
  const comodines = rack.filter((id) => {
    const tile = parseTile(id);
    return tile !== null && tile.kind === "joker";
  });

  // Grupos: un mismo número en colores distintos.
  for (let value = MIN_VALUE; value <= MAX_VALUE; value++) {
    const porColor = new Map<string, TileId>();
    for (const { id, tile } of fichas) {
      if (tile!.kind === "number" && tile!.value === value && !porColor.has(tile!.color)) {
        porColor.set(tile!.color, id);
      }
    }
    const propios = [...porColor.values()];
    if (propios.length >= MIN_SET_SIZE) salida.push({ kind: "groups", ids: propios });
    // Con un comodín, dos del mismo número ya son grupo.
    for (const comodin of comodines) {
      if (propios.length === MIN_SET_SIZE - 1) {
        salida.push({ kind: "groups", ids: [...propios, comodin] });
      }
    }
  }

  // Escaleras: tramos seguidos de un mismo color, y todos sus trozos.
  for (const color of COLORS) {
    const porValor = new Map<number, TileId>();
    for (const { id, tile } of fichas) {
      if (tile!.kind === "number" && tile!.color === color && !porValor.has(tile!.value)) {
        porValor.set(tile!.value, id);
      }
    }
    const valores = [...porValor.keys()].sort((a, b) => a - b);
    for (let i = 0; i < valores.length; i++) {
      const tramo: TileId[] = [porValor.get(valores[i]!)!];
      for (let j = i + 1; j < valores.length && valores[j] === valores[j - 1]! + 1; j++) {
        tramo.push(porValor.get(valores[j]!)!);
        if (tramo.length >= MIN_SET_SIZE) salida.push({ kind: "runs", ids: [...tramo] });
      }
      // Un comodín tapa un hueco de uno: 5-6-_-8.
      for (const comodin of comodines) {
        for (let j = i + 1; j < valores.length; j++) {
          if (valores[j] !== valores[i]! + j - i + 1) break;
        }
        const conHueco = conComodin(porValor, valores, i, comodin);
        if (conHueco) salida.push({ kind: "runs", ids: conHueco });
      }
    }
  }

  return salida.filter((c) => readSet(c.ids).length > 0);
}

/** Un tramo que empieza en `desde` y salta un solo hueco con el comodín. */
function conComodin(
  porValor: Map<number, TileId>,
  valores: readonly number[],
  desde: number,
  comodin: TileId,
): TileId[] | null {
  const inicio = valores[desde]!;
  const ids: TileId[] = [];
  let usado = false;
  for (let value = inicio; value <= MAX_VALUE; value++) {
    const ficha = porValor.get(value);
    if (ficha) {
      ids.push(ficha);
      continue;
    }
    if (usado) break;
    usado = true;
    ids.push(comodin);
  }
  // Sin hueco tapado no aporta nada, y una escalera que acaba en comodín
  // tampoco: sobra al final.
  while (ids.length > 0 && ids[ids.length - 1] === comodin) ids.pop();
  if (!usado || !ids.includes(comodin) || ids.length < MIN_SET_SIZE) return null;
  return ids;
}

/** El orden de toda la vida, para las fichas que no forman nada. */
function byMode(mode: SortMode): (a: TileId, b: TileId) => number {
  const rank = (id: TileId): [number, number, number] => {
    const tile = parseTile(id);
    // Los comodines al final: valen para todo, así que no pertenecen a ningún
    // sitio concreto.
    if (!tile || tile.kind === "joker") return [1, 99, 99];
    const color = COLORS.indexOf(tile.color);
    return mode === "runs" ? [0, color, tile.value] : [0, tile.value, color];
  };

  return (a, b) => {
    const left = rank(a);
    const right = rank(b);
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return left[i]! - right[i]!;
    }
    return a.localeCompare(b);
  };
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
