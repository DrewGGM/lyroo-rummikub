import { WifiOff } from "lucide-react";

import type { GameView } from "../../protocol";

type SeatsProps = {
  view: GameView;
  /** Segundos que quedan del turno, o null si la mesa juega sin reloj. */
  secondsLeft: number | null;
  /** Quién está moviendo fichas ahora mismo. */
  movingId: string | null;
};

export function Seats({ view, secondsLeft, movingId }: SeatsProps) {
  const total = view.rules.turnSeconds;

  return (
    <div className="seats" role="list" aria-label="Jugadores">
      {view.players.map((player) => {
        const isTurn = player.id === view.turnPlayerId;
        const classes = ["seat"];
        if (isTurn) classes.push("seat--turn");
        if (!player.connected) classes.push("seat--away");
        if (player.id === movingId) classes.push("seat--moving");

        return (
          <div className={classes.join(" ")} key={player.id} role="listitem">
            <span className="seat__clock">
              {isTurn && secondsLeft !== null && total !== null ? (
                <TurnRing secondsLeft={secondsLeft} total={total} />
              ) : null}
              <span className="seat__initial">
                {player.name.slice(0, 1).toUpperCase()}
              </span>
            </span>
            <span className="seat__name">
              {player.name}
              {player.id === view.you ? " (tú)" : ""}
            </span>
            {player.connected ? (
              <span className="seat__count">
                {view.status === "playing" ? player.tileCount : ""}
              </span>
            ) : (
              <WifiOff size={13} className="seat__away" aria-label="sin conexión" />
            )}

            {/* El reloj va además de las fichas, no en su lugar: saber cuántas
                le quedan a quien juega importa tanto como el tiempo. */}
            {isTurn && secondsLeft !== null ? (
              <span
                className={`seat__seconds${
                  secondsLeft <= 10 ? " seat__seconds--urgent" : ""
                }`}
                aria-label={`${secondsLeft} segundos`}
              >
                {secondsLeft}s
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const RADIUS = 13;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** El tiempo del turno se vacía alrededor de la inicial de quien juega. */
function TurnRing({ secondsLeft, total }: { secondsLeft: number; total: number }) {
  const share = Math.max(0, Math.min(1, secondsLeft / total));
  const urgent = secondsLeft <= 10;

  return (
    <svg
      className={`seat__ring${urgent ? " seat__ring--urgent" : ""}`}
      viewBox="0 0 30 30"
      aria-hidden="true"
    >
      <circle className="seat__ring-track" cx="15" cy="15" r={RADIUS} />
      <circle
        className="seat__ring-left"
        cx="15"
        cy="15"
        r={RADIUS}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - share)}
      />
    </svg>
  );
}
