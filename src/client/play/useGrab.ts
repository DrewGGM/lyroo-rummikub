/**
 * Coger y soltar fichas.
 *
 * Dos formas de mover, con el mismo gesto de entrada: arrastras la ficha con el
 * dedo, o la tocas para cogerla y tocas dónde dejarla. Lo segundo importa más
 * de lo que parece: en un móvil, arrastrar hasta el otro extremo de la mesa es
 * incómodo, y con un teclado es imposible.
 *
 * Todo el gesto se resuelve en `pointerup`. Decidirlo antes —al pulsar— hacía
 * que un simple toque cogiera y soltara la ficha en el mismo movimiento.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { TileId } from "../../engine/types";
import type { Slot } from "./arrange";

/** Distancia a partir de la cual el gesto deja de ser un toque. */
const DRAG_THRESHOLD_PX = 7;

export type Held = { readonly tile: TileId; readonly from: Slot };

export type Grab = {
  /** La ficha que llevas en la mano, elegida o en el aire. */
  readonly holding: Held | null;
  /** Si la estás arrastrando ahora mismo, y no solo la tienes elegida. */
  readonly dragging: boolean;
  readonly target: Slot | null;
  readonly flyingRef: React.RefObject<HTMLDivElement | null>;
  grip(event: React.PointerEvent, from: Slot, tile: TileId): void;
  /** Deja la ficha elegida en este sitio. Devuelve si ha movido algo. */
  dropOn(to: Slot): boolean;
  release(): void;
};

type Gesture = {
  tile: TileId;
  from: Slot;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
};

export function useGrab(
  place: (from: Slot, to: Slot) => void,
  allows: (from: Slot, to: Slot) => boolean,
  enabled: boolean,
): Grab {
  const [holding, setHolding] = useState<Held | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [dragging, setDragging] = useState(false);
  const [target, setTarget] = useState<Slot | null>(null);
  const flyingRef = useRef<HTMLDivElement | null>(null);

  // El manejador del documento se monta una vez por gesto, así que necesita
  // leer la ficha en mano sin volver a montarse cada vez que cambia.
  const holdingRef = useRef<Held | null>(null);
  holdingRef.current = holding;

  const paint = useCallback((x: number, y: number, from: Gesture) => {
    const node = flyingRef.current;
    if (!node) return;
    node.style.transform = `translate(${x - from.offsetX}px, ${y - from.offsetY}px)`;
  }, []);

  const grip = useCallback(
    (event: React.PointerEvent, from: Slot, tile: TileId) => {
      if (!enabled || event.button !== 0) return;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setGesture({
        tile,
        from,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      });
    },
    [enabled],
  );

  const dropOn = useCallback(
    (to: Slot) => {
      const held = holdingRef.current;
      if (!held) return false;
      setHolding(null);
      setTarget(null);
      if (!allows(held.from, to)) return false;
      place(held.from, to);
      return true;
    },
    [allows, place],
  );

  const release = useCallback(() => {
    setHolding(null);
    setTarget(null);
  }, []);

  useEffect(() => {
    if (!gesture) return;
    let moved = false;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== gesture.pointerId) return;

      if (!moved) {
        const travelled = Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
        );
        if (travelled < DRAG_THRESHOLD_PX) return;
        moved = true;
        // Arrastrar coge esta ficha, sustituyendo a la que tuvieras elegida.
        setHolding({ tile: gesture.tile, from: gesture.from });
        setDragging(true);
      }

      event.preventDefault();
      paint(event.clientX, event.clientY, gesture);
      setTarget(resolveDrop(event.clientX, event.clientY));
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== gesture.pointerId) return;

      if (moved) {
        const landing = resolveDrop(event.clientX, event.clientY);
        if (landing && allows(gesture.from, landing)) place(gesture.from, landing);
        setHolding(null);
      } else {
        // Un toque: coge la ficha, la suelta si ya la tenías, o deja aquí la
        // que llevabas en la mano.
        const held = holdingRef.current;
        if (!held) {
          setHolding({ tile: gesture.tile, from: gesture.from });
        } else if (held.tile === gesture.tile) {
          setHolding(null);
        } else {
          setHolding(null);
          if (allows(held.from, gesture.from)) place(held.from, gesture.from);
        }
      }

      setGesture(null);
      setDragging(false);
      setTarget(null);
    };

    const onCancel = () => {
      setGesture(null);
      setDragging(false);
      setTarget(null);
      if (moved) setHolding(null);
    };

    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
    };
  }, [gesture, allows, place, paint]);

  // Coloca la ficha voladora bajo el dedo en el primer fotograma.
  useEffect(() => {
    if (dragging && gesture) paint(gesture.startX, gesture.startY, gesture);
  }, [dragging, gesture, paint]);

  useEffect(() => {
    if (!enabled) {
      setHolding(null);
      setGesture(null);
      setDragging(false);
      setTarget(null);
    }
  }, [enabled]);

  return { holding, dragging, target, flyingRef, grip, dropOn, release };
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
