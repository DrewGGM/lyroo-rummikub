import type { GameView } from "../../protocol";

type SeatsProps = {
  view: GameView;
  /** Segundos que quedan del turno, ya corregidos con el reloj del servidor. */
  secondsLeft: number | null;
};

export function Seats({ view, secondsLeft }: SeatsProps) {
  return (
    <div className="seats" role="list" aria-label="Jugadores">
      {view.players.map((player) => {
        const isTurn = player.id === view.turnPlayerId;
        const classes = ["seat"];
        if (isTurn) classes.push("seat--turn");
        if (!player.connected) classes.push("seat--away");

        return (
          <div className={classes.join(" ")} key={player.id} role="listitem">
            <span className="seat__clock">
              {isTurn && secondsLeft !== null ? (
                <TurnRing
                  secondsLeft={secondsLeft}
                  total={view.turnSeconds}
                />
              ) : null}
              <span className="seat__initial">
                {player.name.slice(0, 1).toUpperCase()}
              </span>
            </span>
            <span className="seat__name">
              {player.name}
              {player.id === view.you ? " (tú)" : ""}
            </span>
            <span className="seat__count">
              {view.status === "playing" ? player.tileCount : ""}
              {!player.connected ? " sin conexión" : ""}
            </span>
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
