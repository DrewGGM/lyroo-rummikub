import { describe, expect, it } from "vitest";
import {
  buildDeck,
  createRandom,
  deal,
  deckSpecFor,
  HAND_SIZE,
  isJoker,
  parseTile,
  rackPenalty,
  shuffle,
} from "./tiles";
import { MAX_VALUE } from "./types";

describe("composición del mazo", () => {
  it("usa 106 fichas de 2 a 4 jugadores, como la caja estándar", () => {
    for (const players of [2, 3, 4]) {
      expect(buildDeck(players)).toHaveLength(106);
    }
  });

  it("usa 160 fichas con 5 o 6, como la Six Player Edition oficial", () => {
    for (const players of [5, 6]) {
      expect(buildDeck(players)).toHaveLength(160);
    }
  });

  it("usa 214 fichas con 7 u 8, extendiendo la misma progresión", () => {
    for (const players of [7, 8]) {
      expect(buildDeck(players)).toHaveLength(214);
    }
  });

  it("nunca deja el pozo por debajo del de la caja oficial a cuatro", () => {
    // Con 4 jugadores y 106 fichas quedan 50 en el pozo: ese es el suelo que
    // marca el juego original, y ninguna configuración debe empeorarlo.
    const OFFICIAL_FLOOR = 106 - 4 * HAND_SIZE;
    for (let players = 2; players <= 8; players++) {
      const pool = buildDeck(players).length - players * HAND_SIZE;
      expect(pool).toBeGreaterThanOrEqual(OFFICIAL_FLOOR);
    }
  });

  it("tiene el número de comodines que le toca", () => {
    for (let players = 2; players <= 8; players++) {
      const jokers = buildDeck(players).filter(isJoker);
      expect(jokers).toHaveLength(deckSpecFor(players).jokers);
    }
  });

  it("no repite ningún id", () => {
    const deck = buildDeck(8);
    expect(new Set(deck).size).toBe(deck.length);
  });

  it("tiene el mismo número de fichas de cada color y valor", () => {
    const deck = buildDeck(6).filter((id) => !isJoker(id));
    const counts = new Map<string, number>();
    for (const id of deck) {
      const tile = parseTile(id)!;
      if (tile.kind !== "number") continue;
      const key = `${tile.color}${tile.value}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(4 * MAX_VALUE);
    expect([...counts.values()].every((count) => count === 3)).toBe(true);
  });
});

describe("lectura de ids", () => {
  it("reconstruye una ficha numerada", () => {
    expect(parseTile("r7_0")).toEqual({
      id: "r7_0",
      kind: "number",
      color: "r",
      value: 7,
    });
  });

  it("reconstruye un comodín", () => {
    expect(parseTile("j_1")).toEqual({ id: "j_1", kind: "joker" });
  });

  it("rechaza ids inventados", () => {
    for (const id of ["", "z7_0", "r0_0", "r14_0", "r7", "7r_0", "j", "../x"]) {
      expect(parseTile(id)).toBeNull();
    }
  });
});

describe("puntuación del atril", () => {
  it("suma el valor impreso de cada ficha", () => {
    expect(rackPenalty(["r7_0", "b3_0", "k13_0"])).toBe(23);
  });

  it("cuenta 30 por cada comodín que se quede en la mano", () => {
    expect(rackPenalty(["j_0", "r1_0"])).toBe(31);
  });

  it("vale 0 con el atril vacío", () => {
    expect(rackPenalty([])).toBe(0);
  });
});

describe("barajado", () => {
  it("conserva exactamente las mismas fichas", () => {
    const deck = buildDeck(4);
    const shuffled = shuffle(deck, createRandom(42));
    expect(shuffled.slice().sort()).toEqual(deck.slice().sort());
  });

  it("reparte la misma partida con la misma semilla", () => {
    expect(deal(4, 1234)).toEqual(deal(4, 1234));
  });

  it("reparte partidas distintas con semillas distintas", () => {
    expect(deal(4, 1234).hands[0]).not.toEqual(deal(4, 9999).hands[0]);
  });

  it("no deja el mazo en su orden original", () => {
    const deck = buildDeck(4);
    expect(shuffle(deck, createRandom(7))).not.toEqual(deck);
  });
});

describe("reparto", () => {
  it("da 14 fichas a cada jugador", () => {
    const { hands } = deal(6, 5);
    expect(hands).toHaveLength(6);
    expect(hands.every((hand) => hand.length === HAND_SIZE)).toBe(true);
  });

  it("no reparte la misma ficha dos veces", () => {
    const { hands, pool } = deal(8, 5);
    const all = [...hands.flat(), ...pool];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(buildDeck(8).length);
  });
});
