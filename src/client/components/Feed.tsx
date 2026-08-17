import { useEffect, useState } from "react";

import type { GameEvent } from "../../engine/game";
import type { GameView } from "../../protocol";

/**
 * Lo último que ha pasado en la mesa, en una línea.
 *
 * En una mesa de verdad oyes a quien roba y ves a quien baja fichas. Por el
 * navegador no se oye nada, así que hay que contarlo.
 */
export function Feed({ view, events }: { view: GameView; events: readonly GameEvent[] }) {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    const last = [...events].reverse().find((event) => describe(event, view) !== null);
    if (!last) return;
    setLine(describe(last, view));
    const timer = setTimeout(() => setLine(null), 4000);
    return () => clearTimeout(timer);
  }, [events, view]);

  if (!line) return null;
  return (
    <p className="feed" role="status">
      {line}
    </p>
  );
}

function describe(event: GameEvent, view: GameView): string | null {
  const nameOf = (id: string) =>
    id === view.you
      ? "Tú"
      : (view.players.find((player) => player.id === id)?.name ?? "Alguien");

  switch (event.type) {
    case "played":
      return event.meldValue > 0
        ? `${nameOf(event.playerId)} abrió con ${event.meldValue} puntos`
        : `${nameOf(event.playerId)} bajó ${event.tiles} ${
            event.tiles === 1 ? "ficha" : "fichas"
          }`;
    case "drew":
      return `${nameOf(event.playerId)} robó`;
    case "passed":
      return `${nameOf(event.playerId)} pasó`;
    case "timedOut":
      return `${nameOf(event.playerId)} se quedó sin tiempo`;
    case "joined":
      return `${nameOf(event.playerId)} entró en la mesa`;
    case "left":
      return `${nameOf(event.playerId)} salió`;
    default:
      return null;
  }
}
