/**
 * Mide un contenedor y decide de qué tamaño caben las fichas dentro.
 *
 * El cálculo vive en `fit.ts` y es puro; aquí solo se observa el elemento y se
 * escribe el resultado en una variable CSS. Se mide con `ResizeObserver` porque
 * girar el móvil, abrir el teclado o cambiar de ventana cambian la caja sin que
 * haya ningún evento de React de por medio.
 */

import { useEffect, useRef, useState } from "react";

import type { Box } from "./fit";

export function useMeasuredBox<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  Box,
] {
  const ref = useRef<T | null>(null);
  const [box, setBox] = useState<Box>({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setBox((current) =>
        // Redondear evita repintar por diferencias de medio píxel.
        Math.round(current.width) === Math.round(width) &&
        Math.round(current.height) === Math.round(height)
          ? current
          : { width, height },
      );
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, box];
}

/** La variable CSS que fija el tamaño de ficha dentro de un contenedor. */
export function tileSizeStyle(tile: number): React.CSSProperties {
  return { "--tile-w": `${tile}px` } as React.CSSProperties;
}
