/**
 * El estado de tu turno: qué has movido, qué puedes deshacer y cuánto suma la
 * jugada que llevas montada.
 *
 * Mantiene dos cosas separadas: la mesa que dice el servidor y la que estás
 * montando tú. Mientras no confirmes, solo cambia la tuya.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { openingValue } from "../../engine/board";
import type { Board, TileId } from "../../engine/types";
import {
  brokenSets,
  moveTile,
  moveTiles,
  runAround,
  sameLayout,
  sortRack,
  type Layout,
  type Slot,
  type SortMode,
} from "./arrange";

export type Table = {
  readonly board: Board;
  readonly rack: readonly TileId[];
  /** Fichas que has bajado a la mesa en este turno y aún puedes recuperar. */
  readonly played: ReadonlySet<TileId>;
  /** Combinaciones que ahora mismo no son ni grupo ni escalera. */
  readonly broken: readonly number[];
  readonly touched: boolean;
  readonly canUndo: boolean;
  /** Puntos que suma lo que has bajado, para la apertura. */
  readonly opening: number;
  place(from: Slot, to: Slot): void;
  placeMany(tiles: readonly TileId[], to: Slot): void;
  /** ¿Puede esta ficha acabar en ese sitio? */
  allows(from: Slot, to: Slot): boolean;
  /** La combinación contigua del atril alrededor de esa posición. */
  runAt(index: number): TileId[];
  undo(): void;
  reset(): void;
  sort(mode: SortMode): void;
};

export function useTable(
  serverBoard: Board,
  serverRack: readonly TileId[],
): Table {
  const baseline = useMemo<Layout>(
    () => ({ board: serverBoard, rack: serverRack }),
    [serverBoard, serverRack],
  );

  const [layout, setLayout] = useState<Layout>(baseline);
  const [history, setHistory] = useState<Layout[]>([]);
  const lastBaseline = useRef<string>("");

  // La mesa autoritativa manda: cuando cambia de verdad (alguien jugó, robó, o
  // te rechazaron la jugada), lo que estabas montando deja de tener sentido.
  const baselineKey = useMemo(
    () => JSON.stringify([serverBoard, serverRack]),
    [serverBoard, serverRack],
  );

  useEffect(() => {
    if (lastBaseline.current === baselineKey) return;
    lastBaseline.current = baselineKey;
    setLayout(baseline);
    setHistory([]);
  }, [baselineKey, baseline]);

  /** Las fichas que ya estaban en la mesa antes de tu turno no vuelven atrás. */
  const onBoardBefore = useMemo(
    () => new Set(baseline.board.flat()),
    [baseline.board],
  );

  const allows = useCallback(
    (from: Slot, to: Slot) => {
      if (to.kind !== "rack") return true;
      if (from.kind !== "set") return true;
      const tile = layout.board[from.set]?.[from.index];
      // Puedes recoger lo que tú acabas de bajar, no lo que ya estaba jugado.
      return tile !== undefined && !onBoardBefore.has(tile);
    },
    [layout.board, onBoardBefore],
  );

  const remember = useCallback((previous: Layout) => {
    setHistory((past) => [...past.slice(-40), previous]);
  }, []);

  const place = useCallback(
    (from: Slot, to: Slot) => {
      setLayout((current) => {
        if (to.kind === "rack" && from.kind === "set") {
          const tile = current.board[from.set]?.[from.index];
          if (tile === undefined || onBoardBefore.has(tile)) return current;
        }
        const next = moveTile(current, from, to);
        if (sameLayout(next, current)) return current;
        remember(current);
        return next;
      });
    },
    [onBoardBefore, remember],
  );

  const placeMany = useCallback(
    (tiles: readonly TileId[], to: Slot) => {
      setLayout((current) => {
        if (to.kind === "rack" && tiles.some((id) => onBoardBefore.has(id))) {
          return current;
        }
        const next = moveTiles(current, tiles, to);
        if (sameLayout(next, current)) return current;
        remember(current);
        return next;
      });
    },
    [onBoardBefore, remember],
  );

  const runAt = useCallback(
    (index: number) => runAround(layout.rack, index),
    [layout.rack],
  );

  const undo = useCallback(() => {
    setHistory((past) => {
      const previous = past[past.length - 1];
      if (!previous) return past;
      setLayout(previous);
      return past.slice(0, -1);
    });
  }, []);

  const reset = useCallback(() => {
    setLayout(baseline);
    setHistory([]);
  }, [baseline]);

  const sort = useCallback(
    (mode: SortMode) => {
      setLayout((current) => {
        const sorted = sortRack(current.rack, mode);
        if (sorted.every((id, index) => id === current.rack[index])) return current;
        remember(current);
        return { board: current.board, rack: sorted };
      });
    },
    [remember],
  );

  const played = useMemo(() => {
    const set = new Set<TileId>();
    for (const id of layout.board.flat()) {
      if (!onBoardBefore.has(id)) set.add(id);
    }
    return set;
  }, [layout.board, onBoardBefore]);

  const broken = useMemo(() => brokenSets(layout.board), [layout.board]);
  // Reordenar tu atril no es jugar: lo que cuenta es haber tocado la mesa.
  const touched = useMemo(
    () =>
      !sameLayout(
        { board: layout.board, rack: [] },
        { board: baseline.board, rack: [] },
      ),
    [layout.board, baseline.board],
  );
  const opening = useMemo(
    () => openingValue(baseline.board, layout.board),
    [baseline.board, layout.board],
  );

  return {
    board: layout.board,
    rack: layout.rack,
    played,
    broken,
    touched,
    canUndo: history.length > 0,
    opening,
    place,
    placeMany,
    allows,
    runAt,
    undo,
    reset,
    sort,
  };
}
