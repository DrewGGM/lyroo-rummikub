/**
 * Validación autoritativa de una jugada completa.
 *
 * El cliente monta la jugada en local y manda la mesa que propone y el atril
 * que le queda. El servidor no se fía de nada de eso: comprueba que las fichas
 * se conservan exactamente, que solo han salido fichas del atril de quien juega,
 * que toda combinación sobre la mesa es legal, y que se respetan la jugada
 * inicial de 30 puntos.
 *
 * Esto es lo que hace imposible hacer trampas editando el JavaScript del
 * navegador: no existe ningún mensaje capaz de meter una ficha que no se tenía.
 */

import { rejection, type Rejection, type RejectionCode } from "./errors";
import { DEFAULT_RULES } from "./rules";
import { canonicalOrder, readSet, setValue } from "./sets";
import type { Board, TileId, TileSet } from "./types";

export type CommitInput = {
  readonly previousBoard: Board;
  readonly previousRack: readonly TileId[];
  readonly nextBoard: Board;
  readonly nextRack: readonly TileId[];
  /** Si el jugador ya hizo su jugada inicial en un turno anterior. */
  readonly hasMelded: boolean;
  /** Puntos que exige la mesa para abrir. */
  readonly openingPoints?: number;
};

export type CommitOutcome =
  | {
      readonly ok: true;
      /** La mesa aceptada, ya ordenada para mostrarse. */
      readonly board: Board;
      readonly rack: TileId[];
      /** Fichas que han salido del atril en esta jugada. */
      readonly played: TileId[];
      /** Puntos de la jugada inicial, o 0 si el jugador ya había abierto. */
      readonly meldValue: number;
    }
  | { readonly ok: false; readonly error: Rejection };

function flatten(board: Board): TileId[] {
  return board.flat();
}

function countBy(ids: readonly TileId[]): Map<TileId, number> {
  const counts = new Map<TileId, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

function sameMultiset(a: readonly TileId[], b: readonly TileId[]): boolean {
  if (a.length !== b.length) return false;
  const left = countBy(a);
  const right = countBy(b);
  if (left.size !== right.size) return false;
  for (const [id, count] of left) if (right.get(id) !== count) return false;
  return true;
}

/** ¿`subset` cabe entero dentro de `superset`, contando repeticiones? */
function containsAll(
  superset: readonly TileId[],
  subset: readonly TileId[],
): boolean {
  const available = countBy(superset);
  for (const id of subset) {
    const left = available.get(id) ?? 0;
    if (left === 0) return false;
    available.set(id, left - 1);
  }
  return true;
}

function difference(from: readonly TileId[], remove: readonly TileId[]): TileId[] {
  const available = countBy(remove);
  const result: TileId[] = [];
  for (const id of from) {
    const left = available.get(id) ?? 0;
    if (left > 0) available.set(id, left - 1);
    else result.push(id);
  }
  return result;
}

/** Clave estable de una combinación, independiente del orden de sus fichas. */
function setKey(set: TileSet): string {
  return set.slice().sort().join(",");
}

/**
 * Valida la jugada propuesta. Devuelve la mesa y el atril ya aceptados, o el
 * motivo del rechazo.
 */
export function commitMove(input: CommitInput): CommitOutcome {
  const nextBoard = input.nextBoard
    .map((set) => set.slice())
    .filter((set) => set.length > 0);

  const previousTiles = [...flatten(input.previousBoard), ...input.previousRack];
  const nextTiles = [...flatten(nextBoard), ...input.nextRack];

  if (!sameMultiset(previousTiles, nextTiles)) {
    return reject(
      "TILES_DO_NOT_MATCH",
      "Las fichas de la jugada no cuadran con las que hay en juego.",
    );
  }

  const previousBoardTiles = flatten(input.previousBoard);
  if (!containsAll(flatten(nextBoard), previousBoardTiles)) {
    return reject(
      "TILES_TAKEN_FROM_BOARD",
      "No puedes llevarte fichas de la mesa a tu atril.",
    );
  }

  const played = difference(input.previousRack, input.nextRack);
  if (played.length === 0) {
    return reject("NOTHING_PLAYED", "Tienes que jugar al menos una ficha.");
  }

  const invalidSetIndexes = nextBoard
    .map((set, index) => (readSet(set).length === 0 ? index : -1))
    .filter((index) => index >= 0);
  if (invalidSetIndexes.length > 0) {
    return reject(
      "INVALID_SET",
      invalidSetIndexes.length === 1
        ? "Hay una combinación que no es un grupo ni una escalera."
        : "Hay combinaciones que no son un grupo ni una escalera.",
      invalidSetIndexes,
    );
  }

  const openingPoints = input.openingPoints ?? DEFAULT_RULES.openingPoints;

  let meldValue = 0;
  if (!input.hasMelded) {
    const outcome = checkInitialMeld(
      input.previousBoard,
      nextBoard,
      played,
      openingPoints,
    );
    if (!outcome.ok) return outcome;
    meldValue = outcome.value;
  }

  return {
    ok: true,
    board: nextBoard.map(canonicalOrder),
    rack: input.nextRack.slice(),
    played,
    meldValue,
  };
}

/**
 * Separa lo que ya estaba en la mesa de lo que se acaba de bajar.
 *
 * `intact` es falso cuando alguna combinación anterior ha desaparecido o se ha
 * tocado, que es justo lo que no se permite en la jugada inicial.
 */
export function freshSets(
  previousBoard: Board,
  nextBoard: Board,
): { readonly fresh: Board; readonly intact: boolean } {
  const available = new Map<string, number[]>();
  nextBoard.forEach((set, index) => {
    const key = setKey(set);
    const bucket = available.get(key);
    if (bucket) bucket.push(index);
    else available.set(key, [index]);
  });

  const untouched = new Set<number>();
  let intact = true;
  for (const previousSet of previousBoard) {
    const index = available.get(setKey(previousSet))?.pop();
    if (index === undefined) intact = false;
    else untouched.add(index);
  }

  return {
    fresh: nextBoard.filter((_, index) => !untouched.has(index)),
    intact,
  };
}

/**
 * Puntos que vale la apertura tal y como está montada la mesa. El cliente lo
 * usa para enseñar el contador, así que tiene que salir de aquí y no de una
 * cuenta paralela: si se separaran, el contador diría una cosa y el servidor
 * otra.
 */
export function openingValue(previousBoard: Board, nextBoard: Board): number {
  const { fresh } = freshSets(previousBoard, nextBoard);
  return fresh.reduce((total, set) => total + setValue(set), 0);
}

function checkInitialMeld(
  previousBoard: Board,
  nextBoard: Board,
  played: readonly TileId[],
  openingPoints: number,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: Rejection } {
  // En la jugada inicial no se puede tocar la mesa: cada combinación que ya
  // estaba tiene que seguir ahí exactamente igual.
  const { fresh: freshSetList, intact } = freshSets(previousBoard, nextBoard);
  if (!intact) {
    return reject(
      "MELD_TOUCHES_BOARD",
      `Tu primera jugada tiene que sumar ${openingPoints} puntos solo con tus fichas, sin tocar la mesa.`,
    );
  }

  const playedPool = countBy(played);
  for (const set of freshSetList) {
    for (const id of set) {
      const left = playedPool.get(id) ?? 0;
      if (left === 0) {
        return reject(
          "MELD_TOUCHES_BOARD",
          `Tu primera jugada tiene que sumar ${openingPoints} puntos solo con tus fichas, sin tocar la mesa.`,
        );
      }
      playedPool.set(id, left - 1);
    }
  }

  const value = freshSetList.reduce((total, set) => total + setValue(set), 0);
  if (value < openingPoints) {
    return reject(
      "MELD_TOO_LOW",
      `Tu primera jugada suma ${value} puntos y necesita al menos ${openingPoints}.`,
    );
  }
  return { ok: true, value };
}

function reject(
  code: RejectionCode,
  message: string,
  setIndexes?: readonly number[],
): { readonly ok: false; readonly error: Rejection } {
  return { ok: false, error: rejection(code, message, setIndexes) };
}
