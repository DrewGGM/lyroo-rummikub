import { describe, expect, it } from "vitest";
import {
  addPlayer,
  commitTurn,
  createGame,
  currentPlayer,
  drawTile,
  prepareRematch,
  removePlayer,
  sanitizeName,
  setConnected,
  startGame,
  timeoutTurn,
  type GameState,
} from "./game";
import { HAND_SIZE } from "./tiles";

const NOW = 1_700_000_000_000;

function lobbyWith(names: string[]): GameState {
  const state = createGame("ABC7K2");
  names.forEach((name, index) => addPlayer(state, `p${index}`, name));
  return state;
}

function playing(names: string[], seed = 42): GameState {
  const state = lobbyWith(names);
  const started = startGame(state, "p0", seed, NOW);
  if (!started.ok) throw new Error("no arrancó la partida");
  return started.state;
}

/** Deja al jugador de turno con un grupo de 30 puntos servido en el atril. */
function stackRack(state: GameState, tiles: string[]): void {
  const player = currentPlayer(state)!;
  const rest = player.rack.filter((id) => !tiles.includes(id));
  state.players = state.players.map((entry) =>
    entry.id === player.id
      ? { ...entry, rack: [...tiles, ...rest.slice(tiles.length)] }
      : entry,
  );
  // Las fichas que hemos forzado salen del pozo para que todo siga cuadrando.
  state.pool = state.pool.filter((id) => !tiles.includes(id));
}

describe("sala", () => {
  it("nombra anfitrión a quien entra primero", () => {
    const state = lobbyWith(["Ana", "Beto"]);
    expect(state.hostId).toBe("p0");
    expect(state.players).toHaveLength(2);
  });

  it("no admite más de ocho jugadores", () => {
    const state = lobbyWith(["a", "b", "c", "d", "e", "f", "g", "h"]);
    const ninth = addPlayer(state, "p8", "Extra");
    expect(ninth.ok).toBe(false);
    if (!ninth.ok) expect(ninth.reason).toBe("full");
  });

  it("desambigua nombres repetidos", () => {
    const state = lobbyWith(["Ana", "Ana"]);
    expect(state.players[1]!.name).toBe("Ana 2");
  });

  it("rechaza un nombre vacío", () => {
    const state = createGame("ABC7K2");
    expect(addPlayer(state, "p0", "   ").ok).toBe(false);
  });

  it("recorta nombres largos y quita caracteres invisibles", () => {
    expect(sanitizeName("  Ana  ")).toBe("Ana");
    expect(sanitizeName("An​a")).toBe("Ana");
    // Un nombre hecho solo de caracteres invisibles se queda en nada.
    expect(sanitizeName("​​")).toBe("");
    expect(sanitizeName("x".repeat(40))).toHaveLength(16);
  });
  it("no deja entrar con la partida empezada", () => {
    const state = playing(["Ana", "Beto"]);
    const late = addPlayer(state, "p9", "Tarde");
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toBe("started");
  });

  it("traspasa el mando si el anfitrión se va del lobby", () => {
    const state = lobbyWith(["Ana", "Beto"]);
    removePlayer(state, "p0");
    expect(state.hostId).toBe("p1");
  });

  it("conserva el asiento de quien se desconecta en plena partida", () => {
    const state = playing(["Ana", "Beto"]);
    setConnected(state, "p1", false);
    removePlayer(state, "p1");
    expect(state.players).toHaveLength(2);
    expect(state.players[1]!.connected).toBe(false);
  });
});

describe("arranque", () => {
  it("solo lo puede hacer el anfitrión", () => {
    const state = lobbyWith(["Ana", "Beto"]);
    const attempt = startGame(state, "p1", 1, NOW);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error.code).toBe("NOT_HOST");
  });

  it("necesita al menos dos jugadores", () => {
    const state = lobbyWith(["Ana"]);
    const attempt = startGame(state, "p0", 1, NOW);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error.code).toBe("NOT_ENOUGH_PLAYERS");
  });

  it("reparte 14 fichas a cada uno y arranca el reloj", () => {
    const state = playing(["Ana", "Beto", "Cris"]);
    expect(state.status).toBe("playing");
    expect(state.players.every((p) => p.rack.length === HAND_SIZE)).toBe(true);
    expect(state.turnEndsAt).toBe(NOW + state.turnSeconds * 1000);
  });

  it("no reparte dos veces la misma ficha", () => {
    const state = playing(["Ana", "Beto", "Cris", "Dani"]);
    const all = [...state.players.flatMap((p) => p.rack), ...state.pool];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("turnos", () => {
  it("no deja jugar a quien no le toca", () => {
    const state = playing(["Ana", "Beto"]);
    const attempt = commitTurn(state, { actorId: "p1", board: [], rack: [] }, NOW);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error.code).toBe("NOT_YOUR_TURN");
  });

  it("pasa el turno al robar y reinicia el reloj", () => {
    const state = playing(["Ana", "Beto"]);
    const poolBefore = state.pool.length;
    const result = drawTile(state, "p0", NOW + 5000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.turnIndex).toBe(1);
    expect(result.state.pool).toHaveLength(poolBefore - 1);
    expect(result.state.players[0]!.rack).toHaveLength(HAND_SIZE + 1);
    expect(result.state.turnEndsAt).toBe(NOW + 5000 + state.turnSeconds * 1000);
  });

  it("da la vuelta a la mesa", () => {
    let state = playing(["Ana", "Beto", "Cris"]);
    for (const expected of [1, 2, 0]) {
      const result = drawTile(state, state.players[state.turnIndex]!.id, NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
      expect(state.turnIndex).toBe(expected);
    }
  });

  it("al agotarse el tiempo roba y pasa, sin tocar la mesa", () => {
    const state = playing(["Ana", "Beto"]);
    const boardBefore = state.board;
    const result = timeoutTurn(state, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]).toEqual({ type: "timedOut", playerId: "p0" });
    expect(result.state.board).toEqual(boardBefore);
    expect(result.state.turnIndex).toBe(1);
  });

  it("acepta una jugada válida y anota la apertura", () => {
    const state = playing(["Ana", "Beto"]);
    stackRack(state, ["r10_0", "b10_0", "k10_0"]);
    const player = currentPlayer(state)!;
    const result = commitTurn(
      state,
      {
        actorId: player.id,
        board: [["r10_0", "b10_0", "k10_0"]],
        rack: player.rack.slice(3),
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[0]!.hasMelded).toBe(true);
    expect(result.events[0]).toMatchObject({ type: "played", meldValue: 30 });
    expect(result.state.turnIndex).toBe(1);
  });

  it("deja la mesa intacta cuando la jugada se rechaza", () => {
    const state = playing(["Ana", "Beto"]);
    const player = currentPlayer(state)!;
    const result = commitTurn(
      state,
      { actorId: player.id, board: [["r1_0", "b2_0", "k3_0"]], rack: [] },
      NOW,
    );
    expect(result.ok).toBe(false);
    expect(state.board).toEqual([]);
    expect(state.turnIndex).toBe(0);
    expect(state.players[0]!.rack).toHaveLength(HAND_SIZE);
  });
});

describe("final de partida", () => {
  it("gana quien se queda sin fichas y se lleva los puntos de los demás", () => {
    const state = playing(["Ana", "Beto"]);
    const player = currentPlayer(state)!;
    const meld = ["r10_0", "b10_0", "k10_0"];
    stackRack(state, meld);
    // Dejamos a Ana solo con la jugada ganadora en la mano.
    state.players = state.players.map((entry) =>
      entry.id === player.id ? { ...entry, rack: meld } : entry,
    );
    state.players = state.players.map((entry, index) =>
      index === 1 ? { ...entry, rack: ["r5_0", "b3_0"] } : entry,
    );

    const result = commitTurn(
      state,
      { actorId: player.id, board: [meld], rack: [] },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe("finished");
    expect(result.state.winnerId).toBe("p0");
    expect(result.state.players[0]!.score).toBe(8);
    expect(result.state.players[1]!.score).toBe(-8);
  });

  it("termina bloqueada cuando el pozo se agota y todos pasan", () => {
    let state = playing(["Ana", "Beto"]);
    state.pool = [];
    state.players = state.players.map((entry, index) => ({
      ...entry,
      rack: index === 0 ? ["r5_0"] : ["k9_0", "o9_0"],
    }));

    for (const id of ["p0", "p1"]) {
      const result = drawTile(state, id, NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }

    expect(state.status).toBe("finished");
    expect(state.winnerId).toBe("p0"); // 5 puntos frente a 18
    expect(state.players[0]!.score).toBe(18);
    expect(state.players[1]!.score).toBe(-18);
  });

  it("no deja jugar con la partida terminada", () => {
    const state = playing(["Ana", "Beto"]);
    state.status = "finished";
    const attempt = drawTile(state, "p0", NOW);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error.code).toBe("NOT_PLAYING");
  });
});

describe("revancha", () => {
  it("vuelve al lobby conservando jugadores y puntuación", () => {
    const state = playing(["Ana", "Beto"]);
    state.status = "finished";
    state.players = state.players.map((p) => ({ ...p, score: 12 }));
    const result = prepareRematch(state, "p0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe("lobby");
    expect(result.state.players).toHaveLength(2);
    expect(result.state.players[0]!.score).toBe(12);
    expect(result.state.players[0]!.rack).toEqual([]);
    expect(result.state.board).toEqual([]);
  });

  it("solo la pide el anfitrión", () => {
    const state = playing(["Ana", "Beto"]);
    state.status = "finished";
    const attempt = prepareRematch(state, "p1");
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error.code).toBe("NOT_HOST");
  });

  it("reparte de nuevo al empezar la siguiente ronda", () => {
    const state = playing(["Ana", "Beto"]);
    state.status = "finished";
    const back = prepareRematch(state, "p0");
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const again = startGame(back.state, "p0", 99, NOW);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.state.round).toBe(2);
    expect(again.state.players.every((p) => p.rack.length === HAND_SIZE)).toBe(true);
  });
});
