/**
 * Recorta el estado autoritativo a lo que puede ver un jugador concreto.
 *
 * Es la única puerta por la que el estado sale hacia la red, así que es aquí
 * donde se garantiza que nadie recibe las fichas de otro.
 */

import type { GameState } from "../engine/game";
import type { GameView, PlayerView } from "./index";

export function buildView(
  state: GameState,
  playerId: string,
  now: number,
): GameView {
  const players: PlayerView[] = state.players.map((player) => ({
    id: player.id,
    name: player.name,
    connected: player.connected,
    tileCount: player.rack.length,
    hasMelded: player.hasMelded,
    score: player.score,
  }));

  const you = state.players.find((player) => player.id === playerId);

  return {
    code: state.code,
    status: state.status,
    round: state.round,
    players,
    hostId: state.hostId,
    turnPlayerId: state.status === "playing"
      ? (state.players[state.turnIndex]?.id ?? null)
      : null,
    turnEndsAt: state.turnEndsAt,
    turnSeconds: state.turnSeconds,
    board: state.board.map((set) => set.slice()),
    poolCount: state.pool.length,
    winnerId: state.winnerId,
    you: playerId,
    rack: you ? you.rack.slice() : [],
    serverTime: now,
    log: state.log.slice(-12),
  };
}
