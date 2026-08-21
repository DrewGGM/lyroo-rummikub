import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeft, Check, Copy, Hand, Layers, Share2, Users } from "lucide-react";

import type { GameView } from "../../protocol";
import type { Board, TileId } from "../../engine/types";
import { MAX_PLAYERS, MIN_PLAYERS } from "../../engine/game";
import {
  HAND_SIZE_CHOICES,
  OPENING_CHOICES,
  TURN_SECONDS_CHOICES,
  type RoomRules,
} from "../../engine/rules";
import { Feed } from "../components/Feed";
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
        className="card__form"
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
        <button type="submit" className="press press--lamp" disabled={!name.trim()}>
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

/** Cada cuánto se cuenta a los demás lo que estás moviendo. */
/** Cuándo empieza a avisar el borde de la pantalla. */
const AVISO_SEGUNDOS = 5;

const PREVIEW_EVERY_MS = 350;

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
  useTurnBuzz(isMyTurn, view.status === "playing");
  const yaAbrio = Boolean(
    view.players.find((player) => player.id === view.you)?.hasMelded,
  );
  const table = useTable(view.board, view.rack as string[], yaAbrio, isMyTurn);
  // El atril es tuyo: puedes irlo colocando aunque juegue otro.
  const puedoOrdenar = view.status === "playing";
  const grab = useGrab(
    table.place,
    table.placeMany,
    table.allows,
    table.runAt,
    table.sendHome,
    // No es "si te toca", es "si estás jugando": el atril se coloca cuando
    // quieras y la mesa la protege `allows`, no el gesto.
    puedoOrdenar,
  );

  const secondsLeft = useTurnClock(view, link.clockSkew);
  const rejectedSets = useRejection(link);
  const dealing = useDealAnimation(view);
  const [sortMode, setSortMode] = useState<SortMode>("runs");

  // Mientras el servidor no conteste, los botones no admiten otro toque. Si el
  // mensaje ni siquiera salió, no se bloquea nada: quedarse con el botón muerto
  // es peor que dejar reintentar.
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    setWaiting(false);
  }, [view, link.refusal]);
  const attempt = useCallback((send: () => boolean) => {
    if (send()) setWaiting(true);
  }, []);

  useLivePreview(view, isMyTurn, table.board, link);

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

  /**
   * Los últimos segundos, avisando por el borde de la pantalla.
   *
   * El número del asiento es pequeño y está arriba, y la vista está en las
   * fichas: se llegaba a cero sin enterarse. El borde entero se ve sin mirarlo.
   */
  const apremia =
    isMyTurn && secondsLeft !== null && secondsLeft <= AVISO_SEGUNDOS;

  // Mientras otro monta su jugada se ve su mesa en vivo; la tuya solo la tocas tú.
  const showing = !isMyTurn && link.preview ? link.preview.board : table.board;

  /**
   * Las fichas que se ven marcadas sobre el tapete.
   *
   * En tu turno son las que llevas bajadas y aún puedes recoger. Cuando juega
   * otro son las que está poniendo ahora mismo —lo que su mesa tiene de más
   * respecto a la confirmada—, y entre jugada y jugada, las de la última
   * confirmada. Así todos ven qué acaba de aparecer, no solo quien lo puso.
   */
  const marcadas = quéSeAcabaDePoner(isMyTurn, table.played, view, showing);
  const moverName = link.preview
    ? (view.players.find((player) => player.id === link.preview?.playerId)?.name ?? null)
    : null;

  const needsOpening = !yaAbrio;
  const openingShort =
    needsOpening && table.touched && table.opening < view.rules.openingPoints;
  const canConfirm =
    isMyTurn && !waiting && table.touched && table.broken.length === 0 && !openingShort;

  return (
    <div
      className={`room${apremia ? " room--apremia" : ""}`}
      // El aviso solo tiene sentido si te toca a ti: ver la pantalla encenderse
      // mientras piensa otro sería una alarma por algo que no puedes evitar.
    >
      <div className="bar">
        <button
          type="button"
          className="press press--ghost"
          onClick={onLeave}
          aria-label="Salir de la mesa"
        >
          <ArrowLeft size={17} aria-hidden />
        </button>
        <CodeChip code={view.code} />
        <span className="bar__spacer" />
        <span className="bar__pool" title="Fichas en el pozo">
          <Layers size={13} aria-hidden />
          {view.poolCount}
        </span>
      </div>

      <Seats
        view={view}
        secondsLeft={secondsLeft}
        movingId={link.preview?.playerId ?? null}
      />

      <Felt
        board={showing}
        grab={grab}
        played={marcadas}
        broken={isMyTurn ? table.broken : []}
        rejected={rejectedSets}
        canArrange={isMyTurn}
        movedBy={isMyTurn ? null : moverName}
        opening={isMyTurn && needsOpening ? view.rules.openingPoints : null}
      />

      <Rack
        rack={table.rack}
        grab={grab}
        canArrange={puedoOrdenar}
        dealing={dealing}
        drawn={table.drawn}
        sortMode={sortMode}
        onSort={(mode) => {
          setSortMode(mode);
          table.sort(mode);
        }}
        onUndo={table.undo}
        canUndo={table.canUndo}
        onReset={table.reset}
        canReset={table.touched}
      >
        {needsOpening ? (
          <span
            className={`opening${
              table.opening >= view.rules.openingPoints ? " opening--done" : ""
            }`}
          >
            Apertura
            <strong>
              {table.opening}/{view.rules.openingPoints}
            </strong>
          </span>
        ) : null}
        <button
          type="button"
          className="press press--quiet"
          disabled={!isMyTurn || waiting}
          onClick={() => {
            table.reset();
            attempt(() => link.send({ type: "draw" }));
          }}
        >
          <Hand size={16} aria-hidden />
          Robar
        </button>
        <button
          type="button"
          className="press press--lamp"
          disabled={!canConfirm}
          onClick={() =>
            attempt(() =>
              link.send({
                type: "commit",
                board: table.board.map((set) => set.slice()),
                rack: table.rack.slice(),
              }),
            )
          }
        >
          <Check size={17} aria-hidden />
          {confirmLabel(isMyTurn, table.touched, table.broken.length, openingShort)}
        </button>
      </Rack>

      <Feed view={view} events={link.events} />

      {link.refusal ? (
        <p className="notice" role="alert">
          <span className="notice__dot" />
          {link.refusal.message}
        </p>
      ) : null}

      {grab.dragging && grab.holding ? (
        <div className="flying" ref={grab.flyingRef}>
          {grab.holding.tiles.map((id) => (
            <Tile key={id} id={id} lifted />
          ))}
        </div>
      ) : null}

      <LinkNote link={link} />
    </div>
  );
}

/** El botón dice en una línea por qué no se puede confirmar todavía. */
function confirmLabel(
  isMyTurn: boolean,
  touched: boolean,
  broken: number,
  openingShort: boolean,
): string {
  if (!isMyTurn) return "Espera";
  if (broken > 0) return "Cuadra la mesa";
  if (openingShort) return "Falta para abrir";
  if (!touched) return "Baja fichas";
  return "Confirmar";
}

// --- Sala de espera -------------------------------------------------------

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

  // Solo se manda lo que cambia. Mandar las reglas enteras leídas de la vista
  // hacía que dos clics seguidos revirtieran el primero, porque los dos partían
  // del mismo estado antiguo.
  const change = (patch: Partial<RoomRules>) => {
    link.send({ type: "settings", rules: patch });
  };

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

      <div className="rules">
        <p className="eyebrow">
          <Users size={13} aria-hidden /> Cómo se juega en esta mesa
        </p>

        <Setting label="Tiempo por turno">
          {TURN_SECONDS_CHOICES.map((seconds) => (
            <Choice
              key={String(seconds)}
              on={view.rules.turnSeconds === seconds}
              disabled={!isHost}
              onPick={() => change({ turnSeconds: seconds })}
            >
              {seconds === null ? "Sin reloj" : `${seconds}s`}
            </Choice>
          ))}
        </Setting>

        <Setting label="Puntos para abrir">
          {OPENING_CHOICES.map((points) => (
            <Choice
              key={points}
              on={view.rules.openingPoints === points}
              disabled={!isHost}
              onPick={() => change({ openingPoints: points })}
            >
              {points}
            </Choice>
          ))}
        </Setting>

        <Setting label="Fichas al repartir">
          {HAND_SIZE_CHOICES.map((size) => (
            <Choice
              key={size}
              on={view.rules.handSize === size}
              disabled={!isHost}
              onPick={() => change({ handSize: size })}
            >
              {size}
            </Choice>
          ))}
        </Setting>

      </div>

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
      ) : (
        <p className="card__body">
          {view.players.find((player) => player.id === view.hostId)?.name ??
            "Quien creó la mesa"}{" "}
          reparte cuando estéis todos.
        </p>
      )}

      <p className="home__foot">
        Caben hasta {MAX_PLAYERS}. A partir de cinco se juega con el mazo grande,
        igual que en la caja de seis jugadores.
      </p>

      <button type="button" className="press press--ghost" onClick={onLeave}>
        <ArrowLeft size={15} aria-hidden /> Salir de la mesa
      </button>
    </main>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rules__row">
      <span className="rules__label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function Choice({
  on,
  disabled,
  onPick,
  children,
}: {
  on: boolean;
  disabled: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="segmented__choice"
      aria-pressed={on}
      disabled={disabled}
      onClick={onPick}
    >
      {children}
    </button>
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
        {copied ? <Check size={16} aria-hidden /> : <Share2 size={16} aria-hidden />}
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
        <ArrowLeft size={15} aria-hidden /> Salir de la mesa
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
      title="Copiar el enlace de la mesa"
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
      {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
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

/**
 * Cuenta a los demás la mesa que estás montando, como mucho tres veces por
 * segundo. Sin ese freno cada ficha movida sería un mensaje, y una partida
 * pasaría de seiscientas peticiones a veinte mil.
 */
function useLivePreview(
  view: GameView,
  isMyTurn: boolean,
  board: readonly (readonly string[])[],
  link: Link,
): void {
  const lastSent = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!isMyTurn || view.status !== "playing") return;
    const shape = JSON.stringify(board);
    if (shape === lastSent.current) return;

    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lastSent.current = shape;
      link.send({ type: "preview", board: board.map((set) => [...set]) });
    }, PREVIEW_EVERY_MS);

    return () => clearTimeout(timer.current);
  }, [board, isMyTurn, view.status, link]);
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

/**
 * Las fichas que se ven marcadas sobre el tapete.
 *
 * En tu turno son las que llevas bajadas y aún puedes recoger. Cuando juega
 * otro, las que está poniendo ahora mismo --lo que su mesa tiene de más
 * respecto a la confirmada-- y, entre jugada y jugada, las de la última
 * confirmada. Así todos ven qué acaba de aparecer, no solo quien lo puso.
 *
 * Sin `useMemo` a propósito: esto se calcula después de un `return` anticipado
 * y un hook ahí dentro rompe el orden de los hooks. Son cuarenta fichas.
 */
function quéSeAcabaDePoner(
  isMyTurn: boolean,
  played: ReadonlySet<TileId>,
  view: GameView,
  showing: Board,
): ReadonlySet<TileId> {
  if (isMyTurn) return played;
  const firmes = new Set(view.board.flat());
  const enVivo = showing.flat().filter((id) => !firmes.has(id));
  return new Set(enVivo.length > 0 ? enVivo : view.lastPlayed);
}

/**
 * Un aviso en la mano cuando te toca.
 *
 * Mirando la mesa de otro es fácil despistarse, y con turnos de medio minuto
 * eso es medio turno perdido. Dos toques cortos, que se distinguen de una
 * notificación cualquiera sin llegar a molestar.
 *
 * Dos límites que conviene conocer y que no se pueden sortear: en iPhone no
 * existe --Safari no expone vibración a la web, ni siquiera instalada como
 * aplicación-- y no suena con la pantalla apagada o en otra aplicación, porque
 * el navegador ignora la vibración cuando la página no está a la vista. Es un
 * aviso para quien está mirando la partida, no para traerte de vuelta a ella.
 */
function useTurnBuzz(isMyTurn: boolean, playing: boolean): void {
  const antes = useRef(isMyTurn);

  useEffect(() => {
    const empieza = playing && isMyTurn && !antes.current;
    antes.current = isMyTurn;
    if (!empieza) return;
    // El navegador que no la tenga simplemente no hace nada.
    navigator.vibrate?.(TURN_BUZZ);
  }, [isMyTurn, playing]);
}

/** Dos toques cortos: vibra, calla, vibra. */
const TURN_BUZZ = [45, 70, 45];
