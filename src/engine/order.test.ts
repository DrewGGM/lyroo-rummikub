import { describe, expect, it } from "vitest";

import { rackBlocks, sortRack } from "./order";
import { readSet } from "./sets";

const R = (v: number, c = 0) => `r${v}_${c}`;
const B = (v: number, c = 0) => `b${v}_${c}`;
const K = (v: number, c = 0) => `k${v}_${c}`;
const O = (v: number, c = 0) => `o${v}_${c}`;
const J = (c = 0) => `j_${c}`;

describe("ordenar el atril", () => {
  it("pone delante lo que ya es jugada", () => {
    // El b1-b2-b3 se puede bajar; el resto va detrás ordenado.
    const revuelto = [B(3), R(7), B(1), R(5), B(2)];
    expect(sortRack(revuelto, "runs")).toEqual([B(1), B(2), B(3), R(5), R(7)]);
  });

  it("saca el grupo aunque haya un color repetido en medio", () => {
    // Cuatro unos: naranja, azul, azul, rojo. El segundo azul se interponía y
    // el grupo no llegaba a verse.
    const revuelto = [O(1), B(1), B(1, 1), R(1)];
    const ordenado = sortRack(revuelto, "groups");
    expect(readSet(ordenado.slice(0, 3)).length).toBeGreaterThan(0);
    expect(ordenado).toHaveLength(4);
    expect(ordenado.slice().sort()).toEqual(revuelto.slice().sort());
    // Y el bloque queda separado de la que sobra.
    expect(rackBlocks(ordenado)).toEqual([3]);
  });

  it("saca varias jugadas a la vez, todas al principio", () => {
    const mano = [K(9), R(5), B(9), R(7), O(9), R(6), K(2)];
    const ordenado = sortRack(mano, "runs");
    // 5-6-7 rojo y el grupo de nueves; detrás, el 2 negro suelto.
    expect(rackBlocks(ordenado)).toEqual([3, 6]);
    expect(ordenado[6]).toBe(K(2));
  });

  it("por grupos prefiere el grupo cuando la ficha vale para las dos", () => {
    // El 6 rojo puede ir en el 5-6-7 rojo o en el grupo de seises.
    const mano = [R(5), R(6), R(7), B(6), K(6)];
    const ordenado = sortRack(mano, "groups");
    expect(readSet(ordenado.slice(0, 3)).length).toBeGreaterThan(0);
    expect(ordenado.slice(0, 3).map((id) => id[0]).sort()).toEqual(["b", "k", "r"]);
  });

  it("por escaleras prefiere la escalera en ese mismo caso", () => {
    const mano = [R(5), R(6), R(7), B(6), K(6)];
    const ordenado = sortRack(mano, "runs");
    expect(ordenado.slice(0, 3)).toEqual([R(5), R(6), R(7)]);
  });

  it("aprovecha el comodín para armar una jugada", () => {
    const mano = [R(9), B(9), J(), K(2)];
    const ordenado = sortRack(mano, "groups");
    expect(readSet(ordenado.slice(0, 3)).length).toBeGreaterThan(0);
    expect(ordenado[3]).toBe(K(2));
  });

  it("sin ninguna jugada, ordena como toda la vida", () => {
    const revuelto = [B(3), R(7), K(11), O(1)];
    expect(sortRack(revuelto, "runs")).toEqual([R(7), B(3), K(11), O(1)]);
    expect(sortRack(revuelto, "groups")).toEqual([O(1), B(3), R(7), K(11)]);
  });

  it("deja los comodines al final si no sirven para nada", () => {
    const ordenado = sortRack([J(), R(7), K(11)], "runs");
    expect(ordenado[2]).toBe(J());
  });

  it("no pierde ni repite fichas", () => {
    const mano = [B(3), R(7), K(3), O(7), R(5), J(), B(1), B(2)];
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
