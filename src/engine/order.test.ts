import { describe, expect, it } from "vitest";

import { rackBlocks, sortRack } from "./order";

const R = (v: number, c = 0) => `r${v}_${c}`;
const B = (v: number, c = 0) => `b${v}_${c}`;
const K = (v: number, c = 0) => `k${v}_${c}`;
const O = (v: number, c = 0) => `o${v}_${c}`;

describe("ordenar el atril", () => {
  it("por escaleras junta cada color y lo pone en orden", () => {
    const revuelto = [B(3), R(7), B(1), R(5), B(2)];
    expect(sortRack(revuelto, "runs")).toEqual([R(5), R(7), B(1), B(2), B(3)]);
  });

  it("por grupos junta cada número", () => {
    const revuelto = [B(3), R(7), K(3), O(7)];
    expect(sortRack(revuelto, "groups")).toEqual([B(3), K(3), R(7), O(7)]);
  });

  it("no pierde ni repite fichas", () => {
    const mano = [B(3), R(7), K(3), O(7), R(5)];
    for (const modo of ["runs", "groups"] as const) {
      expect(sortRack(mano, modo).slice().sort()).toEqual(mano.slice().sort());
    }
  });
});
describe("separaciones del atril", () => {
  it("no separa nada cuando no hay ninguna combinación hecha", () => {
    expect(rackBlocks([R(1), B(5), K(9), O(12)])).toEqual([]);
  });

  it("aparta la escalera de lo suelto", () => {
    // 5-6-7 rojos hechos, y detrás dos fichas sueltas.
    expect(rackBlocks([R(5), R(6), R(7), B(2), K(11)])).toEqual([3]);
  });

  it("deja hueco por delante y por detrás si el bloque va en medio", () => {
    expect(rackBlocks([B(2), R(5), R(6), R(7), K(11)])).toEqual([1, 4]);
  });

  it("separa dos combinaciones seguidas", () => {
    expect(rackBlocks([R(5), R(6), R(7), B(9), K(9), O(9)])).toEqual([3]);
  });

  it("se queda con el tramo más largo, no con el primero que valga", () => {
    // 5-6-7-8: si cortara en el 7, el 8 quedaría suelto sin motivo.
    expect(rackBlocks([R(5), R(6), R(7), R(8), B(2)])).toEqual([4]);
  });

  it("el atril recién ordenado por escaleras se separa solo", () => {
    const mano = [R(5), R(6), R(7), B(1), B(2), B(3), K(13)];
    expect(rackBlocks(mano)).toEqual([3, 6]);
  });

  it("no se inventa separaciones en un atril vacío", () => {
    expect(rackBlocks([])).toEqual([]);
  });
});
