import { describe, expect, it } from "vitest";
import {
  canonicalOrder,
  isValidSet,
  jokerCandidates,
  readSet,
  setValue,
} from "./sets";

// Ids legibles para los tests: `r7_0` es el primer 7 rojo, `j_0` el primer comodín.
const R = (v: number, copy = 0) => `r${v}_${copy}`;
const B = (v: number, copy = 0) => `b${v}_${copy}`;
const K = (v: number, copy = 0) => `k${v}_${copy}`;
const O = (v: number, copy = 0) => `o${v}_${copy}`;
const J = (copy = 0) => `j_${copy}`;

describe("grupos", () => {
  it("acepta tres fichas del mismo número y distinto color", () => {
    expect(isValidSet([R(7), B(7), K(7)])).toBe(true);
  });

  it("acepta un grupo de cuatro colores", () => {
    expect(isValidSet([R(7), B(7), K(7), O(7)])).toBe(true);
  });

  it("rechaza colores repetidos", () => {
    expect(isValidSet([R(7), R(7, 1), K(7)])).toBe(false);
  });

  it("rechaza números distintos", () => {
    expect(isValidSet([R(3), B(4), K(5)])).toBe(false);
  });

  it("rechaza cinco fichas porque solo hay cuatro colores", () => {
    expect(isValidSet([R(7), B(7), K(7), O(7), J()])).toBe(false);
  });

  it("suma el valor del número por cada ficha", () => {
    expect(setValue([R(7), B(7), K(7)])).toBe(21);
  });
});

describe("escaleras", () => {
  it("acepta tres consecutivas del mismo color", () => {
    expect(isValidSet([R(3), R(4), R(5)])).toBe(true);
  });

  it("acepta una escalera larga", () => {
    const run = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((v) => R(v));
    expect(isValidSet(run)).toBe(true);
  });

  it("rechaza colores mezclados", () => {
    expect(isValidSet([R(3), B(4), R(5)])).toBe(false);
  });

  it("rechaza huecos", () => {
    expect(isValidSet([R(3), R(4), R(6)])).toBe(false);
  });

  it("rechaza que el 1 vaya detrás del 13", () => {
    expect(isValidSet([R(12), R(13), R(1)])).toBe(false);
  });

  it("rechaza fichas repetidas", () => {
    expect(isValidSet([R(3), R(3, 1), R(4)])).toBe(false);
  });

  it("rechaza dos fichas", () => {
    expect(isValidSet([R(3), R(4)])).toBe(false);
  });
});

describe("comodines", () => {
  it("completa un grupo", () => {
    expect(isValidSet([R(7), B(7), J()])).toBe(true);
  });

  it("completa el hueco de una escalera", () => {
    expect(isValidSet([R(3), J(), R(5)])).toBe(true);
  });

  it("extiende una escalera por un extremo", () => {
    expect(isValidSet([R(3), R(4), J()])).toBe(true);
  });

  it("no forma combinación solo con comodines", () => {
    expect(isValidSet([J(0), J(1), J(2)])).toBe(false);
  });

  it("vale lo que la ficha que representa", () => {
    // El comodín solo puede ser el 4 rojo.
    expect(setValue([R(3), J(), R(5)])).toBe(12);
  });

  it("elige la lectura más alta cuando hay varias", () => {
    // [r7, J, J] se puede leer como grupo de sietes (21) o como escalera
    // r7-r8-r9 (24). Quien juega elige, así que cuenta la mejor.
    expect(setValue([R(7), J(0), J(1)])).toBe(24);
  });

  it("enumera todas las fichas que puede representar en un grupo", () => {
    const candidates = jokerCandidates([R(7), B(7), J()], J());
    expect(candidates).toEqual(
      expect.arrayContaining([
        { color: "k", value: 7 },
        { color: "o", value: 7 },
      ]),
    );
    expect(candidates).toHaveLength(2);
  });

  it("enumera las dos lecturas de una escalera abierta por los extremos", () => {
    // [r3, r4, J] puede ser r2-r3-r4 o r3-r4-r5.
    const candidates = jokerCandidates([R(3), R(4), J()], J());
    expect(candidates).toEqual(
      expect.arrayContaining([
        { color: "r", value: 2 },
        { color: "r", value: 5 },
      ]),
    );
  });

  it("no permite que un comodín tape un hueco imposible", () => {
    expect(isValidSet([R(3), J(), R(7)])).toBe(false);
  });
});

describe("orden en la mesa", () => {
  it("ordena una escalera de forma ascendente", () => {
    expect(canonicalOrder([R(5), R(3), R(4)])).toEqual([R(3), R(4), R(5)]);
  });

  it("coloca el comodín en el hueco que ocupa", () => {
    expect(canonicalOrder([J(), R(3), R(5)])).toEqual([R(3), J(), R(5)]);
  });

  it("respeta el orden del jugador cuando ya es válido", () => {
    const asPlayed = [K(7), B(7), R(7)];
    // Este orden no es el canónico por color, pero no hay una lectura que lo
    // reproduzca, así que se normaliza.
    expect(canonicalOrder(asPlayed)).toEqual([R(7), B(7), K(7)]);
  });

  it("deja intacta una combinación inválida", () => {
    const broken = [R(3), B(4), K(5)];
    expect(canonicalOrder(broken)).toEqual(broken);
  });
});

describe("lecturas", () => {
  it("devuelve las dos formas de leer una combinación ambigua", () => {
    const readings = readSet([R(7), J(0), J(1)]);
    expect(readings.some((r) => r.kind === "group")).toBe(true);
    expect(readings.some((r) => r.kind === "run")).toBe(true);
  });

  it("no devuelve ninguna lectura de una combinación inválida", () => {
    expect(readSet([R(3), B(4), K(5)])).toEqual([]);
  });

  it("ignora ids inventados", () => {
    expect(readSet(["z9_0", R(3), R(4)])).toEqual([]);
  });
});
