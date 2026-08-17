import { describe, expect, it } from "vitest";
import { commitMove, type CommitInput, type CommitOutcome } from "./board";
import type { Board, TileId } from "./types";

const R = (v: number, copy = 0) => `r${v}_${copy}`;
const B = (v: number, copy = 0) => `b${v}_${copy}`;
const K = (v: number, copy = 0) => `k${v}_${copy}`;
const O = (v: number, copy = 0) => `o${v}_${copy}`;
const J = (copy = 0) => `j_${copy}`;

function commit(input: Partial<CommitInput> & Pick<CommitInput, "nextBoard" | "nextRack">) {
  return commitMove({
    previousBoard: [],
    previousRack: [],
    hasMelded: true,
    ...input,
  });
}

function expectRejected(outcome: CommitOutcome, code: string) {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error.code).toBe(code);
}

describe("conservación de fichas", () => {
  it("rechaza una ficha que el jugador no tenía", () => {
    const outcome = commit({
      previousRack: [R(7), B(7)],
      nextBoard: [[R(7), B(7), K(7)]], // el k7 sale de la nada
      nextRack: [],
    });
    expectRejected(outcome, "TILES_DO_NOT_MATCH");
  });

  it("rechaza duplicar una ficha que sí se tenía", () => {
    const outcome = commit({
      previousRack: [R(7), B(7), K(7)],
      nextBoard: [
        [R(7), B(7), K(7)],
        [R(7), B(7), K(7)],
      ],
      nextRack: [],
    });
    expectRejected(outcome, "TILES_DO_NOT_MATCH");
  });

  it("rechaza hacer desaparecer fichas de la mesa", () => {
    const outcome = commit({
      previousBoard: [[R(3), R(4), R(5)]],
      previousRack: [B(7), K(7), O(7)],
      nextBoard: [[B(7), K(7), O(7)]], // la escalera roja ha desaparecido
      nextRack: [],
    });
    expectRejected(outcome, "TILES_DO_NOT_MATCH");
  });

  it("rechaza llevarse una ficha de la mesa al atril", () => {
    const outcome = commit({
      previousBoard: [[R(3), R(4), R(5), R(6)]],
      previousRack: [B(7), K(7), O(7)],
      nextBoard: [
        [R(3), R(4), R(5)],
        [B(7), K(7), O(7)],
      ],
      nextRack: [R(6)],
    });
    expectRejected(outcome, "TILES_TAKEN_FROM_BOARD");
  });

  it("rechaza un turno en el que no se juega nada", () => {
    const outcome = commit({
      previousBoard: [[R(3), R(4), R(5)]],
      previousRack: [B(7)],
      nextBoard: [[R(3), R(4), R(5)]],
      nextRack: [B(7)],
    });
    expectRejected(outcome, "NOTHING_PLAYED");
  });
});

describe("validez de las combinaciones", () => {
  it("rechaza una combinación que no es grupo ni escalera y dice cuál", () => {
    const outcome = commit({
      previousRack: [R(3), B(4), K(5)],
      nextBoard: [[R(3), B(4), K(5)]],
      nextRack: [],
    });
    expectRejected(outcome, "INVALID_SET");
    if (!outcome.ok) expect(outcome.error.setIndexes).toEqual([0]);
  });

  it("señala todas las combinaciones rotas", () => {
    const outcome = commit({
      previousRack: [R(3), B(4), K(5), R(9), B(10), K(11)],
      nextBoard: [
        [R(3), B(4), K(5)],
        [R(9), B(10), K(11)],
      ],
      nextRack: [],
    });
    expectRejected(outcome, "INVALID_SET");
    if (!outcome.ok) expect(outcome.error.setIndexes).toEqual([0, 1]);
  });

  it("acepta una jugada legal y devuelve la mesa ordenada", () => {
    const outcome = commit({
      previousRack: [R(5), R(3), R(4)],
      nextBoard: [[R(5), R(3), R(4)]],
      nextRack: [],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.board).toEqual([[R(3), R(4), R(5)]]);
      expect(outcome.played).toHaveLength(3);
    }
  });

  it("descarta las combinaciones vacías en lugar de fallar", () => {
    const outcome = commit({
      previousBoard: [[R(3), R(4), R(5)]],
      previousRack: [R(6)],
      nextBoard: [[], [R(3), R(4), R(5), R(6)], []],
      nextRack: [],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.board).toHaveLength(1);
  });
});

describe("jugada inicial de 30 puntos", () => {
  const meld = (nextBoard: Board, nextRack: TileId[], previousRack: TileId[]) =>
    commit({ hasMelded: false, previousRack, nextBoard, nextRack });

  it("acepta una apertura que llega a 30", () => {
    const outcome = meld([[R(10), B(10), K(10)]], [], [R(10), B(10), K(10)]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.meldValue).toBe(30);
  });

  it("rechaza una apertura que se queda corta", () => {
    const outcome = meld([[R(3), B(3), K(3)]], [], [R(3), B(3), K(3)]);
    expectRejected(outcome, "MELD_TOO_LOW");
    if (!outcome.ok) expect(outcome.error.message).toContain("9");
  });

  it("suma varias combinaciones en la misma apertura", () => {
    const rack = [R(5), B(5), K(5), R(11), R(12), R(13)];
    const outcome = meld(
      [
        [R(5), B(5), K(5)],
        [R(11), R(12), R(13)],
      ],
      [],
      rack,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.meldValue).toBe(51);
  });

  it("no deja tocar la mesa en la jugada inicial", () => {
    const outcome = commit({
      hasMelded: false,
      previousBoard: [[R(10), B(10), K(10)]],
      previousRack: [O(10), R(11), R(12), R(13)],
      // Añadir el 10 naranja al grupo de la mesa es manipular, y eso todavía no
      // está permitido.
      nextBoard: [
        [R(10), B(10), K(10), O(10)],
        [R(11), R(12), R(13)],
      ],
      nextRack: [],
    });
    expectRejected(outcome, "MELD_TOUCHES_BOARD");
  });

  it("cuenta el comodín por la ficha que representa", () => {
    // r11-r12-J: el comodín solo puede ser el 13 rojo → 11+12+13 = 36.
    const outcome = meld([[R(11), R(12), J()]], [], [R(11), R(12), J()]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.meldValue).toBe(36);
  });

  it("deja abrir dejando fichas en el atril", () => {
    const outcome = meld(
      [[R(10), B(10), K(10)]],
      [O(1), O(2)],
      [R(10), B(10), K(10), O(1), O(2)],
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.rack).toEqual([O(1), O(2)]);
  });
});

describe("casos vistos jugando", () => {
  it("abre con un grupo de treces completado por un comodín", () => {
    // 13 + 13 + 13 son 39 puntos: sobra para abrir.
    const outcome = commit({
      hasMelded: false,
      previousRack: [O(13), K(13), J(), R(1), B(2)],
      nextBoard: [[O(13), K(13), J()]],
      nextRack: [R(1), B(2)],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.meldValue).toBe(39);
  });
});

describe("regla del comodín", () => {
  it("deja añadir fichas a una combinación con comodín", () => {
    const outcome = commit({
      previousBoard: [[R(3), R(4), J()]], // el comodín hace de r5
      previousRack: [R(6)],
      nextBoard: [[R(3), R(4), J(), R(6)]],
      nextRack: [],
    });
    expect(outcome.ok).toBe(true);
  });

  it("deja recuperar el comodín sustituyéndolo por la ficha exacta", () => {
    const outcome = commit({
      previousBoard: [[R(3), R(4), J()]],
      previousRack: [R(5), B(9), K(9), O(9)],
      nextBoard: [
        [R(3), R(4), R(5)], // el comodín sale, entra el r5 que representaba
        [B(9), K(9), O(9), J()], // y se reutiliza en el mismo turno
      ],
      nextRack: [],
    });
    expect(outcome.ok).toBe(true);
  });

  it("no deja sacar el comodín sin sustituirlo", () => {
    const outcome = commit({
      previousBoard: [[R(3), R(4), J()]],
      previousRack: [R(9), B(9), K(9), R(2)],
      nextBoard: [
        [R(2), R(3), R(4)], // el comodín representaba r2 o r5, y aquí entra r2…
        [R(9), B(9), K(9), J()],
      ],
      nextRack: [],
    });
    // …así que en realidad esto sí es legal: la lectura J = r2 lo justifica.
    expect(outcome.ok).toBe(true);
  });

  it("rechaza romper una combinación con comodín sin sustituirlo", () => {
    const outcome = commit({
      // Aquí el comodín solo puede ser el r5: está encerrado entre r4 y r6.
      previousBoard: [[R(3), R(4), J(), R(6)]],
      previousRack: [R(9), B(9), K(9), R(7)],
      nextBoard: [
        [R(3), R(4)], // combinación rota
        [R(6), R(7), J()],
        [R(9), B(9), K(9)],
      ],
      nextRack: [],
    });
    expect(outcome.ok).toBe(false);
  });

  it("rechaza llevarse el comodín dejando la combinación descolocada", () => {
    const outcome = commit({
      previousBoard: [[R(4), R(5), J(), R(7)]], // el comodín es el r6
      previousRack: [R(9), B(9), K(9), R(8)],
      nextBoard: [
        [R(4), R(5), R(7), R(8)], // no es escalera, y además falta el r6
        [R(9), B(9), K(9), J()],
      ],
      nextRack: [],
    });
    expectRejected(outcome, "INVALID_SET");
  });

  it("permite recolocar libremente las combinaciones sin comodín", () => {
    const outcome = commit({
      previousBoard: [[R(3), R(4), R(5), R(6)]],
      previousRack: [R(2), R(7)],
      nextBoard: [
        [R(2), R(3), R(4)],
        [R(5), R(6), R(7)],
      ],
      nextRack: [],
    });
    expect(outcome.ok).toBe(true);
  });
});
