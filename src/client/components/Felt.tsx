import { useMemo, type MouseEvent, type PointerEvent } from "react";
import { Plus } from "lucide-react";

import { readSet } from "../../engine/sets";
import type { Board, TileId } from "../../engine/types";
import type { Slot } from "../play/arrange";
import { fitBoardTile, NEW_TRAY_TILES } from "../play/fit";
import { tileSizeStyle, useMeasuredBox } from "../play/useAutoFit";
import type { Grab } from "../play/useGrab";
import { Tile } from "./Tile";

type FeltProps = {
  board: Board;
  grab: Grab;
  /** Fichas bajadas en este turno, todavía recuperables. */
  played: ReadonlySet<TileId>;
  broken: readonly number[];
  /** Combinaciones que el servidor acaba de rechazar. */
  rejected: readonly number[];
  canArrange: boolean;
  /** Quién está moviendo fichas ahora mismo, si no eres tú. */
  movedBy: string | null;
  /** Puntos que te faltan para abrir, o null si ya abriste. */
  opening: number | null;
};

export function Felt({
  board,
  grab,
  played,
  broken,
  rejected,
  canArrange,
  movedBy,
  opening,
}: FeltProps) {
  /**
   * Se mide el hueco de las filas, no el tapete entero.
   *
   * Dentro del tapete hay más cosas: el aviso de cuánto te falta para abrir
   * ocupa dos o tres líneas, y midiendo el tapete el cálculo creía tener ese
   * alto disponible. Resultado: quien aún no había abierto veía la mesa
   * cortada justo cuando más fichas hay que mirar.
   */
  const [ref, box] = useMeasuredBox<HTMLDivElement>();

  // Las fichas encogen conforme se llena la mesa para que nunca haga falta
  // desplazar el tapete: en horizontal el alto es lo único que escasea.
  const tile = useMemo(() => {
    const anchos = board.map((set) => set.length);
    // El hueco de "nueva" ocupa sitio en la misma fila: contarlo evita que
    // empuje una fila de más y deje la última cortada.
    if (canArrange) anchos.push(NEW_TRAY_TILES);
    return fitBoardTile(anchos, box);
  }, [board, box, canArrange]);

  const empty = board.length === 0;

  return (
    <div
      className="felt"
      style={tileSizeStyle(tile)}
      // Todo el tapete acepta fichas: soltar en el hueco vacío empieza una
      // combinación nueva, que es lo que uno espera al ver tanto sitio libre.
      data-drop={canArrange ? "new" : undefined}
      onClick={() => {
        if (canArrange && grab.holding) grab.dropOn({ kind: "new" });
      }}
    >
      {movedBy ? (
        <p className="felt__live">
          <span className="felt__live-dot" />
          {movedBy} está moviendo fichas
        </p>
      ) : null}

      {empty ? (
        <p className="felt__hint">
          {canArrange
            ? "Suelta fichas aquí para montar tu jugada. Mantén pulsada una ficha del atril para coger la escalera entera."
            : "La mesa está vacía."}
        </p>
      ) : opening !== null ? (
        <p className="felt__hint">
          Tu primera jugada tiene que sumar {opening} puntos con tus fichas
          solas. Hasta que abras no puedes añadir nada a lo que ya hay en la
          mesa, ni siquiera un comodín.
        </p>
      ) : null}

      <div className="felt__sets" ref={ref}>
        {board.map((set, setIndex) => (
          <Tray
            key={keyOf(set, setIndex)}
            set={set}
            setIndex={setIndex}
            grab={grab}
            played={played}
            broken={broken.includes(setIndex)}
            rejected={rejected.includes(setIndex)}
            canArrange={canArrange}
            locked={canArrange && opening !== null && !set.some((id) => played.has(id))}
          />
        ))}

        {canArrange ? (
          <button
            type="button"
            className={`tray tray--new${
              grab.target?.kind === "new" ? " tray--target" : ""
            }`}
            data-drop="new"
            aria-label="Empezar una combinación nueva"
            onClick={(event) => {
              event.stopPropagation();
              grab.dropOn({ kind: "new" });
            }}
          >
            <Plus size={16} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

type TrayProps = {
  set: TileId[];
  setIndex: number;
  grab: Grab;
  played: ReadonlySet<TileId>;
  broken: boolean;
  rejected: boolean;
  canArrange: boolean;
  /** Intocable: todavía no has hecho tu jugada inicial. */
  locked: boolean;
};

function Tray({
  set,
  setIndex,
  grab,
  played,
  broken,
  rejected,
  canArrange,
  locked,
}: TrayProps) {
  const valid = !broken && readSet(set).length > 0;
  const targeted = grab.target?.kind === "set" && grab.target.set === setIndex;

  const classes = ["tray"];
  if (valid) classes.push("tray--valid");
  if (broken) classes.push("tray--broken");
  if (rejected) classes.push("tray--rejected");
  if (targeted) classes.push("tray--target");
  if (locked) classes.push("tray--locked");

  return (
    <div
      className={classes.join(" ")}
      data-drop="set"
      data-set={setIndex}
      onClick={(event) => {
        event.stopPropagation();
        if (canArrange && !locked && grab.holding) {
          grab.dropOn({ kind: "set", set: setIndex, index: set.length });
        }
      }}
    >
      {set.map((id, index) => {
        const slot: Slot = { kind: "set", set: setIndex, index };
        const held = grab.isHeld(id);
        return (
          <Tile
            key={id}
            id={id}
            drop={{ kind: "set", set: setIndex, index }}
            fresh={played.has(id)}
            hollow={held && grab.dragging}
            picked={held && !grab.dragging}
            onPointerDown={
              canArrange
                ? (event: PointerEvent) => {
                    event.stopPropagation();
                    grab.grip(event, slot, id);
                  }
                : undefined
            }
            // El toque ya lo resuelve el gesto; aquí solo se evita que el clic
            // llegue a la bandeja y mueva la ficha dos veces.
            onClick={stop}
          />
        );
      })}
    </div>
  );
}

function stop(event: MouseEvent): void {
  event.stopPropagation();
}

/**
 * La clave de una combinación son sus fichas: si se recoloca la mesa, React
 * mantiene los elementos que siguen juntos en vez de recrear la fila entera.
 */
function keyOf(set: TileId[], index: number): string {
  return set.length > 0 ? set.join("+") : `hueco-${index}`;
}
