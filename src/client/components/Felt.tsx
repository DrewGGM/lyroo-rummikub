import type { MouseEvent, PointerEvent } from "react";

import { readSet } from "../../engine/sets";
import type { Board, TileId } from "../../engine/types";
import type { Slot } from "../play/arrange";
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
};

export function Felt({
  board,
  grab,
  played,
  broken,
  rejected,
  canArrange,
}: FeltProps) {
  const empty = board.length === 0;

  return (
    <div className="felt">
      {empty ? (
        <p className="felt__hint">
          {canArrange
            ? "Arrastra fichas al hueco para montar tu primera jugada. Tiene que sumar 30."
            : "La mesa está vacía. La primera jugada de cada uno suma 30 puntos como mínimo."}
        </p>
      ) : null}

      {empty && !canArrange ? null : (
        <div className="felt__sets">
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
            />
          ))}

          {canArrange ? (
            <button
              type="button"
              className={`tray tray--new${
                grab.target?.kind === "new" ? " tray--target" : ""
              }`}
              data-drop="new"
              onClick={() => grab.dropOn({ kind: "new" })}
            >
              Nueva
            </button>
          ) : null}
        </div>
      )}
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
};

function Tray({
  set,
  setIndex,
  grab,
  played,
  broken,
  rejected,
  canArrange,
}: TrayProps) {
  const valid = !broken && readSet(set).length > 0;
  const targeted = grab.target?.kind === "set" && grab.target.set === setIndex;

  const classes = ["tray"];
  if (valid) classes.push("tray--valid");
  if (broken) classes.push("tray--broken");
  if (rejected) classes.push("tray--rejected");
  if (targeted) classes.push("tray--target");

  return (
    <div
      className={classes.join(" ")}
      data-drop="set"
      data-set={setIndex}
      onClick={() => {
        if (canArrange && grab.holding) grab.dropOn({ kind: "set", set: setIndex, index: set.length });
      }}
    >
      {set.map((id, index) => {
        const slot: Slot = { kind: "set", set: setIndex, index };
        const held = grab.holding?.tile === id;
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
            // El toque ya lo resuelve el gesto; aquí solo se evita que el
            // clic llegue a la bandeja y mueva la ficha dos veces.
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
