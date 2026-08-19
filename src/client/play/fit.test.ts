import { describe, expect, it } from "vitest";
import {
  BOARD_LIMITS,
  NEW_TRAY_TILES,
  fitBoardTile,
  fitRackTile,
  RACK_LIMITS,
  TILE_RATIO,
  traySpan,
  trayRows,
} from "./fit";

/** Un móvil en horizontal: mucho ancho y muy poco alto. */
const HORIZONTAL = { width: 780, height: 250 };
/** Un móvil en vertical. */
const VERTICAL = { width: 390, height: 470 };

const sets = (howMany: number, size = 3) => Array.from({ length: howMany }, () => size);

describe("acomodar la mesa", () => {
  it("usa el tamaño máximo cuando la mesa está vacía", () => {
    expect(fitBoardTile([], HORIZONTAL)).toBe(BOARD_LIMITS.max);
  });

  it("no encoge las fichas si hay sitio de sobra", () => {
    expect(fitBoardTile(sets(2), HORIZONTAL)).toBe(BOARD_LIMITS.max);
  });

  it("encoge las fichas conforme se llena la mesa", () => {
    const pocas = fitBoardTile(sets(4), VERTICAL);
    const muchas = fitBoardTile(sets(16), VERTICAL);
    expect(muchas).toBeLessThan(pocas);
  });

  it("nunca baja del mínimo legible", () => {
    expect(fitBoardTile(sets(60), VERTICAL)).toBeGreaterThanOrEqual(BOARD_LIMITS.min);
  });

  it("nunca pasa del máximo", () => {
    expect(fitBoardTile(sets(1), { width: 4000, height: 3000 })).toBe(BOARD_LIMITS.max);
  });

  it("todo cabe de verdad con el tamaño que devuelve", () => {
    for (const cuantas of [1, 3, 6, 10, 14, 20, 28]) {
      for (const caja of [HORIZONTAL, VERTICAL, { width: 620, height: 300 }]) {
        const composicion = sets(cuantas, 4);
        const tile = fitBoardTile(composicion, caja);
        if (tile === BOARD_LIMITS.min) continue; // ya no se puede encoger más

        const alto = tile * TILE_RATIO + tile * 0.14 * 2 + tile * 0.26;
        expect(trayRows(composicion, tile, caja.width) * alto).toBeLessThanOrEqual(
          caja.height + 0.5,
        );
      }
    }
  });

  it("tiene en cuenta una escalera muy larga, no solo cuántas hay", () => {
    const corta = fitBoardTile([3, 3, 3], VERTICAL);
    const larga = fitBoardTile([13, 3, 3], VERTICAL);
    expect(larga).toBeLessThan(corta);
  });

  it("mete la escalera más larga posible dentro del ancho", () => {
    const tile = fitBoardTile([13], VERTICAL);
    expect(traySpan(13, tile)).toBeLessThanOrEqual(VERTICAL.width);
  });
});

describe("acomodar el atril", () => {
  it("usa el máximo con pocas fichas", () => {
    expect(fitRackTile(3, { width: 780, height: 120 })).toBe(RACK_LIMITS.max);
  });

  it("encoge cuando hay muchas fichas", () => {
    const catorce = fitRackTile(14, { width: 390, height: 110 });
    const treinta = fitRackTile(30, { width: 390, height: 110 });
    expect(treinta).toBeLessThan(catorce);
  });

  it("las fichas caben en el alto disponible", () => {
    for (const cuantas of [14, 20, 26, 34]) {
      const caja = { width: 390, height: 120 };
      const tile = fitRackTile(cuantas, caja);
      if (tile === RACK_LIMITS.min) continue;
      const porFila = Math.floor((caja.width + tile * 0.06) / (tile + tile * 0.06));
      const filas = Math.ceil(cuantas / porFila);
      expect(filas * (tile * TILE_RATIO + tile * 0.06)).toBeLessThanOrEqual(
        caja.height + 0.5,
      );
    }
  });

  it("no se rompe con una caja de tamaño cero", () => {
    expect(fitRackTile(14, { width: 0, height: 0 })).toBe(RACK_LIMITS.max);
    expect(fitBoardTile(sets(3), { width: 0, height: 0 })).toBe(BOARD_LIMITS.max);
  });
});

describe("el hueco de combinación nueva", () => {
  it("cuenta como sitio ocupado", () => {
    const composicion = sets(9, 4);
    const sinHueco = fitBoardTile(composicion, VERTICAL);
    const conHueco = fitBoardTile([...composicion, NEW_TRAY_TILES], VERTICAL);
    expect(conHueco).toBeLessThanOrEqual(sinHueco);
  });

  it("todo sigue cabiendo con el hueco puesto", () => {
    for (const cuantas of [4, 8, 12, 18]) {
      const composicion = [...sets(cuantas, 4), NEW_TRAY_TILES];
      const tile = fitBoardTile(composicion, VERTICAL);
      if (tile === BOARD_LIMITS.min) continue;
      const alto = tile * TILE_RATIO + tile * 0.14 * 2 + tile * 0.26;
      expect(trayRows(composicion, tile, VERTICAL.width) * alto).toBeLessThanOrEqual(
        VERTICAL.height + 0.5,
      );
    }
  });
});
