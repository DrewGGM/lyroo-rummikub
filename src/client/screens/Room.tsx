import { useEffect, useRef, useState } from "react";

import type { GameView } from "../../protocol";
import { MAX_PLAYERS, MIN_PLAYERS } from "../../engine/game";
import { Felt } from "../components/Felt";
import { Rack } from "../components/Rack";
import { Seats } from "../components/Seats";
import { Tile } from "../components/Tile";
import { rememberName, rememberedName, seatToken } from "../net/identity";
import { useRoom, type Room as Link } from "../net/useRoom";
import type { SortMode } from "../play/arrange";
import { useGrab } from "../play/useGrab";
import { useTable } from "../play/useTable";

type RoomProps = {
  code: string;
  onLeave: () => void;
};

export function Room({ code, onLeave }: RoomProps) {
  const [name, setName] = useState(rememberedName);
  const [seated, setSeated] = useState(
    () => seatToken(code) !== null && rememberedName() !== "",
  );

  const link = useRoom(seated ? code : null, seated ? name : null);

  if (!seated) {
    return (
      <NameCard
        code={code}
        name={name}
        onName={setName}
        onSit={() => {
          rememberName(name.trim());
          setSeated(true);
        }}
        onLeave={onLeave}
      />
    );
  }

  if (link.denial) {
    return (
      <main className="card">
        <p className="eyebrow">Mesa {code}</p>
        <h1 className="card__title">No has podido entrar</h1>
        <p className="card__body">{link.denial.message}</p>
        <button type="button" className="press press--lamp" onClick={onLeave}>
          Volver al principio
        </button>
      </main>
    );
  }

  if (!link.view) {
    return (
      <main className="card">
        <p className="eyebrow">Mesa {code}</p>
        <h1 className="card__title">Entrando…</h1>
        <p className="card__body">Estamos sentándote a la mesa.</p>
      </main>
    );
  }

  return <Seated view={link.view} link={link} onLeave={onLeave} />;
}

// --- Nombre ---------------------------------------------------------------

function NameCard({
  code,
  name,
  onName,
  onSit,
  onLeave,
}: {
  code: string;
  name: string;
  onName: (value: string) => void;
  onSit: () => void;
  onLeave: () => void;
}) {
  return (
    <main className="card">
      <p className="eyebrow">Mesa {code}</p>
      <h1 className="card__title">¿Cómo te llamamos?</h1>
      <p className="card__body">
        Es lo único que verán los demás. No hace falta ninguna cuenta.
      </p>
      <form
        style={{ display: "grid", gap: "0.75rem", width: "100%" }}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSit();
        }}
      >
        <input
          className="field"
          value={name}
          onChange={(event) => onName(event.target.value)}
          maxLength={16}
          placeholder="Tu nombre"
          autoComplete="nickname"
          autoFocus
        />
        <button
          type="submit"
          className="press press--lamp"
          disabled={!name.trim()}
        >
          Sentarme a la mesa
        </button>
        <button type="button" className="press press--ghost" onClick={onLeave}>
          Mejor no
        </button>
      </form>
    </main>
  );
}

// --- Ya sentado -----------------------------------------------------------

function Seated({
  view,
  link,
  onLeave,
}: {
  view: GameView;
  link: Link;
  onLeave: () => void;
}) {
  const isMyTurn = view.turnPlayerId === view.you;
  const table = useTable(view.board, view.rack as string[]);
  const grab = useGrab(table.place, table.allows, isMyTurn);

  const secondsLeft = useTurnClock(view, link.clockSkew);
  const rejectedSets = useRejection(link);
  const dealing = useDealAnimation(view);

  const [sortMode, setSortMode] = useState<SortMode>("runs");

  // Mientras el servidor no conteste, los botones no admiten otro toque: pulsar
  // dos veces «robar» mandaba dos jugadas, y la segunda volvía como un error
  // que no había cometido nadie.
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    setWaiting(false);
  }, [view, link.refusal]);

  if (view.status === "lobby") {
    return (
      <>
        <Lobby view={view} link={link} onLeave={onLeave} />
        <LinkNote link={link} />
      </>
    );
  }

  if (view.status === "finished") {
    return (
      <>
        <Result view={view} link={link} onLeave={onLeave} />
        <LinkNote link={link} />
      </>
    );
  }

  const canConfirm =
    isMyTurn && !waiting && table.touched && table.broken.length === 0;

  return (
    <div className="room">
      <div className="bar">
        <button type="button" className="press press--ghost" onClick={onLeave}>
          ← Salir
        </button>
        <CodeChip code={view.code} />
        <span className="bar__spacer" />
        <span className="bar__pool">
          <strong>{view.poolCount}</strong>
          en el pozo
        </span>
      </div>

      <Seats view={view} secondsLeft={secondsLeft} />

      <Felt
        board={table.board}
        grab={grab}
        played={table.played}
        broken={table.broken}
        rejected={rejectedSets}
        canArrange={isMyTurn}
      />

      <Rack
        rack={table.rack}
        grab={grab}
        canArrange={isMyTurn}
        dealing={dealing}
        sortMode={sortMode}
        onSort={(mode) => {
          setSortMode(mode);
          table.sort(mode);
        }}
        onUndo={table.undo}
        canUndo={table.canUndo}
      >
        <button
          type="button"
          className="press press--quiet"
          disabled={!isMyTurn || waiting}
          onClick={() => {
            setWaiting(true);
            table.reset();
            link.send({ type: "draw" });
          }}
        >
          Robar y pasar
        </button>
        <button
          type="button"
          className="press press--lamp"
          disabled={!canConfirm}
          onClick={() => {
            setWaiting(true);
            link.send({
              type: "commit",
              board: table.board.map((set) => set.slice()),
              rack: table.rack.slice(),
            });
          }}
        >
          {confirmLabel(isMyTurn, table.touched, table.broken.length)}
        </button>
      </Rack>

      {link.refusal ? (
        <p className="notice" role="alert">
          <span className="notice__dot" />
          {link.refusal.message}
        </p>
      ) : null}

      {grab.dragging && grab.holding ? (
        <div className="flying" ref={grab.flyingRef}>
          <Tile id={grab.holding.tile} lifted />
        </div>
      ) : null}

      <LinkNote link={link} />
    </div>
  );
}

/** El botón dice en una línea por qué no se puede confirmar todavía. */
function confirmLabel(isMyTurn: boolean, touched: boolean, broken: number): string {
  if (!isMyTurn) return "Espera tu turno";
  if (broken > 0) return "Cuadra la mesa";
  if (!touched) return "Baja fichas";
  return "Confirmar jugada";
}

// --- Sala de espera -------------------------------------------------------

const TURN_CHOICES = [30, 60, 90, 120];

function Lobby({
  view,
  link,
  onLeave,
}: {
  view: GameView;
  link: Link;
  onLeave: () => void;
}) {
  const isHost = view.you === view.hostId;
  const ready = view.players.filter((player) => player.connected).length;

  return (
    <main className="card">
      <p className="eyebrow">Sala abierta</p>
      <h1 className="card__title">
        {view.round > 0 ? "Otra ronda" : "Esperando a la gente"}
      </h1>

      <ShareBox code={view.code} />

      <ul className="lobby__list">
        {view.players.map((player) => (
          <li
            key={player.id}
            className={`lobby__player${player.connected ? "" : " lobby__player--away"}`}
          >
            <span className="lobby__pip" />
            <span>
              {player.name}
              {player.id === view.you ? " (tú)" : ""}
            </span>
            <span className="lobby__role">
              {player.id === view.hostId ? "reparte" : ""}
              {!player.connected ? "sin conexión" : ""}
            </span>
          </li>
        ))}
      </ul>

      {isHost ? (
        <div className="lobby__setting">
          <label id="tiempo-turno">Tiempo por turno</label>
          <div
            className="lobby__choices"
            role="group"
            aria-labelledby="tiempo-turno"
          >
            {TURN_CHOICES.map((seconds) => (
              <button
                key={seconds}
                type="button"
                className="lobby__choice"
                aria-pressed={view.turnSeconds === seconds}
                onClick={() => link.send({ type: "settings", turnSeconds: seconds })}
              >
                {seconds}s
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="card__body">
          {view.players.find((player) => player.id === view.hostId)?.name ??
            "Quien creó la mesa"}{" "}
          reparte cuando estéis todos. Turnos de {view.turnSeconds} segundos.
        </p>
      )}

      {isHost ? (
        <button
          type="button"
          className="press press--lamp"
          disabled={ready < MIN_PLAYERS}
          onClick={() => link.send({ type: "start" })}
        >
          {ready < MIN_PLAYERS
            ? `Faltan jugadores (${ready} de ${MIN_PLAYERS})`
            : `Repartir a ${ready}`}
        </button>
      ) : null}

      <p className="home__foot">
        Caben hasta {MAX_PLAYERS}. A partir de cinco se juega con el mazo grande,
        igual que en la caja de seis jugadores.
      </p>

      <button type="button" className="press press--ghost" onClick={onLeave}>
        ← Salir de la mesa
      </button>
    </main>
  );
}

function ShareBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/g/${code}`;

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Mesa de Rummikub", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Compartir cancelado o sin permiso: el código sigue a la vista.
    }
  };

  return (
    <div className="lobby__share">
      <p className="eyebrow">Código de la mesa</p>
      <p className="lobby__code">{code}</p>
      <button type="button" className="press press--quiet" onClick={share}>
        {copied ? "Enlace copiado" : "Compartir enlace"}
      </button>
    </div>
  );
}

// --- Resultado ------------------------------------------------------------

function Result({
  view,
  link,
  onLeave,
}: {
  view: GameView;
  link: Link;
  onLeave: () => void;
}) {
  const winner = view.players.find((player) => player.id === view.winnerId);
  const youWon = view.winnerId === view.you;
  const isHost = view.you === view.hostId;
  const ranking = [...view.players].sort((a, b) => b.score - a.score);

  return (
    <main className="card">
      <p className="eyebrow">Ronda {view.round}</p>
      <h1 className="card__title">
        {youWon ? "Has ganado" : `Gana ${winner?.name ?? "nadie"}`}
      </h1>
      <p className="card__body">{endingStory(winner, youWon)}</p>

      <ul className="score">
        {ranking.map((player) => (
          <li
            key={player.id}
            className={`score__row${player.id === view.winnerId ? " score__row--won" : ""}`}
          >
            <span>
              {player.name}
              {player.id === view.you ? " (tú)" : ""}
            </span>
            <span className="score__points">
              {player.score > 0 ? `+${player.score}` : player.score}
            </span>
          </li>
        ))}
      </ul>

      {isHost ? (
        <button
          type="button"
          className="press press--lamp"
          onClick={() => link.send({ type: "rematch" })}
        >
          Otra ronda
        </button>
      ) : (
        <p className="card__body">
          La revancha la pide quien reparte. Las puntuaciones se van sumando.
        </p>
      )}

      <button type="button" className="press press--ghost" onClick={onLeave}>
        ← Salir de la mesa
      </button>
    </main>
  );
}

/** Por qué se ha acabado la partida, contado como se contaría en una mesa. */
function endingStory(
  winner: GameView["players"][number] | undefined,
  youWon: boolean,
): string {
  if (!winner) return "La partida se ha quedado sin ganador.";
  if (winner.tileCount > 0) {
    return "Se acabó el pozo y ya nadie podía jugar, así que gana quien menos puntos tenía en el atril.";
  }
  return youWon
    ? "Te has quedado sin fichas. Los puntos que les sobran a los demás son tuyos."
    : `${winner.name} se ha quedado sin fichas. Lo que te sobraba en el atril te lo descuenta.`;
}

// --- Piezas sueltas -------------------------------------------------------

function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="bar__code"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/g/${code}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          /* sin portapapeles el código sigue visible */
        }
      }}
    >
      <small>{copied ? "copiado" : "mesa"}</small>
      {code}
    </button>
  );
}

function LinkNote({ link }: { link: Link }) {
  if (link.link === "open" || link.link === "closed") return null;
  return (
    <p className="link-note" role="status">
      <span className="link-note__pulse" />
      {link.link === "connecting" ? "Conectando…" : "Reconectando…"}
    </p>
  );
}

/** Segundos que quedan del turno, medidos con el reloj del servidor. */
function useTurnClock(view: GameView, skew: number): number | null {
  const [, tick] = useState(0);
  const running = view.status === "playing" && view.turnEndsAt !== null;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((value) => value + 1), 500);
    return () => clearInterval(timer);
  }, [running]);

  if (!running || view.turnEndsAt === null) return null;
  return Math.max(0, Math.ceil((view.turnEndsAt - (Date.now() + skew)) / 1000));
}

/** Marca las combinaciones que el servidor acaba de rechazar, y las olvida. */
function useRejection(link: Link): readonly number[] {
  const [marked, setMarked] = useState<readonly number[]>([]);
  const lastAt = useRef(0);

  useEffect(() => {
    if (!link.refusal || link.refusal.at === lastAt.current) return;
    lastAt.current = link.refusal.at;
    setMarked(link.refusal.setIndexes ?? []);
    const clearMarks = setTimeout(() => setMarked([]), 700);
    const clearNotice = setTimeout(link.clearRefusal, 4500);
    return () => {
      clearTimeout(clearMarks);
      clearTimeout(clearNotice);
    };
  }, [link.refusal, link.clearRefusal]);

  return marked;
}

/** El reparto solo se anima una vez, al empezar cada ronda. */
function useDealAnimation(view: GameView): boolean {
  const [dealing, setDealing] = useState(false);
  const lastRound = useRef(0);

  useEffect(() => {
    if (view.status !== "playing" || view.round === lastRound.current) return;
    lastRound.current = view.round;
    setDealing(true);
    const timer = setTimeout(() => setDealing(false), 1400);
    return () => clearTimeout(timer);
  }, [view.status, view.round]);

  return dealing;
}
