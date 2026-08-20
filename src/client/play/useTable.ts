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
  keepOrder,
  moveTile,
  moveTiles,
  tidyAround,
  runAround,
  sameLayout,
  sortRack,
  whereItFits,
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
  /** La última ficha que has robado, para que se vea de un vistazo. */
  readonly drawn: TileId | null;
  place(from: Slot, to: Slot): void;
  placeMany(tiles: readonly TileId[], to: Slot): void;
  /** ¿Puede esta ficha acabar en ese sitio? */
  allows(from: Slot, to: Slot): boolean;
  /** Lo que se coge junto al dejar pulsado: la escalera del atril o la
   * combinación entera si la ficha ya está en la mesa. */
  runAt(slot: Slot): TileId[];
  /** Manda la ficha a la combinación donde encaje. Dice si encontró sitio. */
  sendHome(tile: TileId): boolean;
  undo(): void;
  reset(): void;
  sort(mode: SortMode): void;
};

export function useTable(
  serverBoard: Board,
  serverRack: readonly TileId[],
  /** Si ya hiciste tu jugada inicial. Antes de eso la mesa es intocable. */
  yaAbrio: boolean,
  /** Fuera de turno la mesa no se toca, pero tu atril sí es tuyo. */
  esMiTurno: boolean,
): Table {
  const baseline = useMemo<Layout>(
    () => ({ board: serverBoard, rack: serverRack }),
    [serverBoard, serverRack],
  );

  const [layout, setLayout] = useState<Layout>(baseline);
  const [history, setHistory] = useState<Layout[]>([]);
  const lastBaseline = useRef<string>("");
  /**
   * El orden en que tú has dejado tu atril.
   *
   * El servidor manda el atril entero cada vez que alguien mueve algo, y no
   * sabe —ni tiene por qué— cómo lo tienes colocado. Sin guardarlo aquí,
   * ordenarte la mano mientras esperas turno no duraría ni un segundo.
   */
  const ordenPropio = useRef<readonly TileId[]>(serverRack);
  /** El atril que mandó el servidor la vez anterior, para ver qué ha llegado. */
  const atrilDeAntes = useRef<readonly TileId[]>(serverRack);
  const [drawn, setDrawn] = useState<TileId | null>(null);

  // La mesa autoritativa manda: cuando cambia de verdad (alguien jugó, robó, o
  // te rechazaron la jugada), lo que estabas montando deja de tener sentido.
  const baselineKey = useMemo(
    () => JSON.stringify([serverBoard, serverRack]),
    [serverBoard, serverRack],
  );

  useEffect(() => {
    if (lastBaseline.current === baselineKey) return;
    lastBaseline.current = baselineKey;
    setLayout({
      board: baseline.board,
      rack: keepOrder(baseline.rack, ordenPropio.current),
    });
    setHistory([]);
  }, [baselineKey, baseline]);

  /**
   * Qué ficha acaba de llegar al atril.
   *
   * Robas, la ficha aparece entre otras trece y hay que buscarla. Se marca la
   * que ha aparecido desde la última vez, y se queda marcada hasta que llegue
   * otra o la juegues. En el reparto inicial llegan catorce de golpe y no se
   * marca ninguna: señalarlas todas sería no señalar nada.
   */
  useEffect(() => {
    const antes = new Set(atrilDeAntes.current);
    const llegadas = serverRack.filter((id) => !antes.has(id));
    atrilDeAntes.current = serverRack;
    if (llegadas.length === 1) setDrawn(llegadas[0]!);
    else if (llegadas.length > 1) setDrawn(null);
  }, [serverRack]);

  // Todo cambio del atril se apunta, venga de arrastrar o de los botones de
  // ordenar, para poder devolverlo tal cual tras la siguiente novedad.
  useEffect(() => {
    ordenPropio.current = layout.rack;
  }, [layout.rack]);

  /** Las fichas que ya estaban en la mesa antes de tu turno no vuelven atrás. */
  const onBoardBefore = useMemo(
    () => new Set(baseline.board.flat()),
    [baseline.board],
  );

  /** Filas que ya estaban en la mesa antes de tu turno. */
  const filasDeAntes = useMemo(() => {
    const filas = new Set<number>();
    layout.board.forEach((set, indice) => {
      if (set.some((id) => onBoardBefore.has(id))) filas.add(indice);
    });
    return filas;
  }, [layout.board, onBoardBefore]);

  const allows = useCallback(
    (from: Slot, to: Slot) => {
      // Fuera de turno puedes colocarte el atril cuanto quieras —es tuyo y no
      // lo ve nadie—, pero la mesa es de todos y solo la toca quien juega.
      if (!esMiTurno) return from.kind === "rack" && to.kind === "rack";

      // Mientras no hayas abierto, la mesa no se toca: la jugada inicial se
      // hace solo con tus fichas. Dejar montarlo para que el servidor lo
      // rechace después no ayuda a nadie.
      if (!yaAbrio && to.kind === "set" && filasDeAntes.has(to.set)) return false;

      if (to.kind !== "rack") return true;
      if (from.kind !== "set") return true;
      const tile = layout.board[from.set]?.[from.index];
      // Puedes recoger lo que tú acabas de bajar, no lo que ya estaba jugado.
      return tile !== undefined && !onBoardBefore.has(tile);
    },
    [layout.board, onBoardBefore, filasDeAntes, yaAbrio, esMiTurno],
  );

  const remember = useCallback((previous: Layout) => {
    setHistory((past) => [...past.slice(-40), previous]);
  }, []);

  const place = useCallback(
    (from: Slot, to: Slot) => {
      if (!allows(from, to)) return;
      setLayout((current) => {
        if (to.kind === "rack" && from.kind === "set") {
          const tile = current.board[from.set]?.[from.index];
          if (tile === undefined || onBoardBefore.has(tile)) return current;
        }
        const movida =
          from.kind === "set"
            ? current.board[from.set]?.[from.index]
            : from.kind === "rack"
              ? current.rack[from.index]
              : undefined;
        const next = moveTile(current, from, to);
        if (sameLayout(next, current)) return current;
        remember(current);
        // Al caer en la mesa, la combinación se recoloca sola: la escalera se
        // ordena y, si el número repetido la parte en dos, se parte.
        return to.kind === "rack" || movida === undefined
          ? next
          : tidyAround(next, movida);
      });
    },
    [onBoardBefore, remember, allows],
  );

  const placeMany = useCallback(
    (tiles: readonly TileId[], to: Slot) => {
      if (!esMiTurno && to.kind !== "rack") return;
      if (!yaAbrio && to.kind === "set" && filasDeAntes.has(to.set)) return;
      setLayout((current) => {
        if (to.kind === "rack" && tiles.some((id) => onBoardBefore.has(id))) {
          return current;
        }
        const next = moveTiles(current, tiles, to);
        if (sameLayout(next, current)) return current;
        remember(current);
        return to.kind === "rack" || tiles[0] === undefined
          ? next
          : tidyAround(next, tiles[0]);
      });
    },
    [onBoardBefore, remember, filasDeAntes, yaAbrio, esMiTurno],
  );

  const runAt = useCallback(
    (slot: Slot): TileId[] => {
      // En el atril, la escalera o el grupo que forman las fichas contiguas.
      if (slot.kind === "rack") return runAround(layout.rack, slot.index);
      // En la mesa, la combinación entera: moverla de sitio es un gesto solo,
      // no una ficha detrás de otra.
      if (slot.kind === "set") return (layout.board[slot.set] ?? []).slice();
      return [];
    },
    [layout.rack, layout.board],
  );

  const sendHome = useCallback(
    (tile: TileId) => {
      const destino = whereItFits(layout.board, tile);
      if (!destino) return false;
      const desde = layout.rack.indexOf(tile);
      if (desde < 0) return false;
      place({ kind: "rack", index: desde }, destino);
      return true;
    },
    [layout.board, layout.rack, place],
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
    // Recoger la jugada no deshace cómo tienes puesto el atril.
    setLayout({
      board: baseline.board,
      rack: keepOrder(baseline.rack, ordenPropio.current),
    });
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
    drawn,
    canUndo: history.length > 0,
    opening,
    place,
    placeMany,
    allows,
    runAt,
    sendHome,
    undo,
    reset,
    sort,
  };
}
