/**
 * Coger y soltar fichas.
 *
 * Tres gestos sobre el mismo dedo:
 *
 * - **Arrastrar**: coges la ficha y la sueltas donde quieras.
 * - **Tocar**: la ficha se queda elegida y el siguiente toque la coloca. En un
 *   móvil, arrastrar de un extremo a otro de la mesa falla más de lo que
 *   acierta, y con teclado sería imposible.
 * - **Dejar pulsado**: si las fichas de al lado forman una combinación con
 *   ella, se cogen todas juntas. Bajar una escalera de cinco ficha a ficha es
 *   el trabajo más aburrido de la partida.
 *
 * Todo se resuelve al levantar el dedo. Decidirlo al pulsar hacía que un toque
 * cogiera y soltara la ficha en el mismo movimiento.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { TileId } from "../../engine/types";
import type { Slot } from "./arrange";

/**
 * Distancia a partir de la cual el gesto deja de ser un toque.
 *
 * Un dedo apoyado en el cristal nunca está quieto: se mueve varios píxeles sin
 * que su dueño lo note. Con el umbral del ratón, aguantar pulsado se convertía
 * en arrastre antes de que diera tiempo a coger la combinación entera, así que
 * el dedo necesita más margen que el puntero.
 */
const DRAG_THRESHOLD_PX = { mouse: 6, touch: 14 };

/** Cuánto hay que aguantar para coger la combinación entera. */
const LONG_PRESS_MS = 350;

/** Margen entre dos toques para que cuenten como uno doble. */
const DOUBLE_TAP_MS = 320;

export type Held = {
  /** Una ficha, o la combinación entera si mantuviste pulsado. */
  readonly tiles: readonly TileId[];
  readonly from: Slot;
};

export type Grab = {
  readonly holding: Held | null;
  /** Si la estás arrastrando ahora mismo, y no solo la tienes elegida. */
  readonly dragging: boolean;
  readonly target: Slot | null;
  readonly flyingRef: React.RefObject<HTMLDivElement | null>;
  /** ¿Está esta ficha en la mano? */
  isHeld(tile: TileId): boolean;
  grip(event: React.PointerEvent, from: Slot, tile: TileId): void;
  /** Deja lo que llevas en la mano en este sitio. */
  dropOn(to: Slot): boolean;
  release(): void;
};

type Gesture = {
  tile: TileId;
  from: Slot;
  pointerId: number;
  /** Un dedo y un ratón no tienen la misma puntería. */
  conDedo: boolean;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
};

export function useGrab(
  place: (from: Slot, to: Slot) => void,
  placeMany: (tiles: readonly TileId[], to: Slot) => void,
  allows: (from: Slot, to: Slot) => boolean,
  /** Lo que se coge junto al dejar pulsado en ese sitio. */
  runAt: (slot: Slot) => TileId[],
  /** Manda una ficha a la combinación donde encaje. Dice si encontró sitio. */
  sendHome: (tile: TileId) => boolean,
  enabled: boolean,
): Grab {
  const [holding, setHolding] = useState<Held | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [dragging, setDragging] = useState(false);
  const [target, setTarget] = useState<Slot | null>(null);
  const flyingRef = useRef<HTMLDivElement | null>(null);

  // El manejador del documento se monta una vez por gesto, así que necesita
  // leer lo que hay en mano sin volver a montarse cada vez que cambia.
  const holdingRef = useRef<Held | null>(null);
  holdingRef.current = holding;

  /** El último toque, para reconocer el doble. */
  const ultimoToque = useRef<{ tile: TileId; cuando: number }>({
    tile: "",
    cuando: 0,
  });

  /**
   * La cuenta atrás de la pulsación larga, y qué se acabó cogiendo.
   *
   * Viven en refs y no dentro del efecto del gesto a propósito: el efecto se
   * vuelve a montar en cuanto cambia cualquiera de sus dependencias, y eso
   * reiniciaba la cuenta una y otra vez. Aguantar pulsado no llegaba a
   * levantar la combinación nunca.
   */
  const cuentaAtras = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cogido = useRef<Held | null>(null);
  const seMovio = useRef(false);

  // La cuenta atrás arranca al pulsar, antes de que exista el efecto del
  // gesto, así que lee la función por referencia y nunca una versión vieja.
  const runAtRef = useRef(runAt);
  runAtRef.current = runAt;

  const paint = useCallback((x: number, y: number, from: Gesture) => {
    const node = flyingRef.current;
    if (!node) return;
    node.style.transform = `translate(${x - from.offsetX}px, ${y - from.offsetY}px)`;
  }, []);

  const grip = useCallback(
    (event: React.PointerEvent, from: Slot, tile: TileId) => {
      if (!enabled || event.button !== 0) return;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

      seMovio.current = false;
      cogido.current = null;
      clearTimeout(cuentaAtras.current);
      // Aguantar sin mover coge la combinación entera y la deja lista para
      // colocarla de una vez.
      cuentaAtras.current = setTimeout(() => {
        if (seMovio.current) return;
        const junto = runAtRef.current(from);
        if (junto.length < 2) return;
        cogido.current = { tiles: junto, from };
        setHolding(cogido.current);
        navigator.vibrate?.(12);
      }, LONG_PRESS_MS);

      setGesture({
        tile,
        from,
        pointerId: event.pointerId,
        conDedo: event.pointerType !== "mouse",
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      });
    },
    [enabled],
  );

  const settle = useCallback(() => {
    setGesture(null);
    setDragging(false);
    setTarget(null);
  }, []);

  const drop = useCallback(
    (held: Held, to: Slot) => {
      if (held.tiles.length > 1) placeMany(held.tiles, to);
      else if (allows(held.from, to)) place(held.from, to);
    },
    [allows, place, placeMany],
  );

  const dropOn = useCallback(
    (to: Slot) => {
      const held = holdingRef.current;
      if (!held) return false;
      setHolding(null);
      setTarget(null);
      drop(held, to);
      return true;
    },
    [drop],
  );

  const release = useCallback(() => {
    setHolding(null);
    setTarget(null);
  }, []);

  const isHeld = useCallback(
    (tile: TileId) => holding?.tiles.includes(tile) ?? false,
    [holding],
  );

  useEffect(() => {
    if (!gesture) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== gesture.pointerId) return;

      if (!seMovio.current) {
        const travelled = Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
        );
        const margen = gesture.conDedo
          ? DRAG_THRESHOLD_PX.touch
          : DRAG_THRESHOLD_PX.mouse;
        if (travelled < margen) return;
        seMovio.current = true;
        clearTimeout(cuentaAtras.current);
        // Si ya habías cogido la combinación entera, se arrastra entera.
        cogido.current = cogido.current ?? {
          tiles: [gesture.tile],
          from: gesture.from,
        };
        setHolding(cogido.current);
        setDragging(true);
      }

      event.preventDefault();
      paint(event.clientX, event.clientY, gesture);
      setTarget(resolveDrop(event.clientX, event.clientY));
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== gesture.pointerId) return;
      clearTimeout(cuentaAtras.current);

      if (seMovio.current && cogido.current) {
        const landing = resolveDrop(event.clientX, event.clientY);
        if (landing) drop(cogido.current, landing);
        setHolding(null);
      } else if (cogido.current) {
        // Aguantaste pulsado: la combinación se queda elegida esperando sitio.
      } else {
        const held = holdingRef.current;
        const ahora = Date.now();
        const doble =
          ultimoToque.current.tile === gesture.tile &&
          ahora - ultimoToque.current.cuando < DOUBLE_TAP_MS;
        ultimoToque.current = { tile: gesture.tile, cuando: ahora };

        if (doble && gesture.from.kind === "rack") {
          // Dos toques: la ficha se va sola a la combinación que la admita.
          setHolding(null);
          if (sendHome(gesture.tile)) navigator.vibrate?.(8);
        } else if (!held) {
          setHolding({ tiles: [gesture.tile], from: gesture.from });
        } else if (held.tiles.includes(gesture.tile)) {
          setHolding(null);
        } else {
          setHolding(null);
          drop(held, gesture.from);
        }
      }

      settle();
    };

    const onCancel = () => {
      clearTimeout(cuentaAtras.current);
      if (seMovio.current) setHolding(null);
      settle();
    };

    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
    };
  }, [gesture, drop, paint, runAt, sendHome, settle]);

  // Ninguna cuenta atrás sobrevive al desmontaje.
  useEffect(() => () => clearTimeout(cuentaAtras.current), []);

  // Coloca la ficha voladora bajo el dedo en el primer fotograma.
  useEffect(() => {
    if (dragging && gesture) paint(gesture.startX, gesture.startY, gesture);
  }, [dragging, gesture, paint]);

  useEffect(() => {
    if (!enabled) {
      setHolding(null);
      settle();
    }
  }, [enabled, settle]);

  return { holding, dragging, target, flyingRef, isHeld, grip, dropOn, release };
}

/**
 * Traduce un punto de la pantalla a un sitio de la mesa. Se pregunta al
 * documento qué hay debajo del dedo en vez de guardar rectángulos, porque la
 * mesa se recoloca mientras arrastras.
 */
export function resolveDrop(x: number, y: number): Slot | null {
  const element = document.elementFromPoint(x, y);
  const zone = element?.closest<HTMLElement>("[data-drop]");
  if (!zone) return null;

  const kind = zone.dataset["drop"];
  const rawIndex = zone.dataset["index"];

  if (kind === "new") return { kind: "new" };

  if (kind === "rack") {
    if (rawIndex === undefined) return { kind: "rack", index: Number.MAX_SAFE_INTEGER };
    return { kind: "rack", index: Number(rawIndex) + sideOf(zone, x) };
  }

  if (kind === "set") {
    const set = Number(zone.dataset["set"]);
    if (Number.isNaN(set)) return null;
    if (rawIndex === undefined) return { kind: "set", set, index: Number.MAX_SAFE_INTEGER };
    return { kind: "set", set, index: Number(rawIndex) + sideOf(zone, x) };
  }

  return null;
}

/** 0 si el punto cae en la mitad izquierda de la ficha, 1 si en la derecha. */
function sideOf(element: HTMLElement, x: number): 0 | 1 {
  const rect = element.getBoundingClientRect();
  return x > rect.left + rect.width / 2 ? 1 : 0;
}
