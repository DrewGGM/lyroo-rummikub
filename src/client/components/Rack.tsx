import type { PointerEvent } from "react";

import type { TileId } from "../../engine/types";
import type { Slot, SortMode } from "../play/arrange";
import type { Grab } from "../play/useGrab";
import { Tile } from "./Tile";

type RackProps = {
  rack: readonly TileId[];
  grab: Grab;
  canArrange: boolean;
  /** Índice de reparto para escalonar la animación al empezar la partida. */
  dealing: boolean;
  onSort: (mode: SortMode) => void;
  sortMode: SortMode;
  onUndo: () => void;
  canUndo: boolean;
  children: React.ReactNode;
};

export function Rack({
  rack,
  grab,
  canArrange,
  dealing,
  onSort,
  sortMode,
  onUndo,
  canUndo,
  children,
}: RackProps) {
  const targeted = grab.target?.kind === "rack";

  return (
    <div className="rack">
      <div className="rack__tools">
        <span className="eyebrow">Tu atril · {rack.length}</span>
        <span className="bar__spacer" />
        <button
          type="button"
          className="press press--ghost rack__undo"
          onClick={onUndo}
          disabled={!canUndo}
        >
          Deshacer
        </button>
        <div className="lobby__choices" role="group" aria-label="Ordenar el atril">
          <button
            type="button"
            className="lobby__choice"
            aria-pressed={sortMode === "runs"}
            onClick={() => onSort("runs")}
          >
            Escaleras
          </button>
          <button
            type="button"
            className="lobby__choice"
            aria-pressed={sortMode === "groups"}
            onClick={() => onSort("groups")}
          >
            Grupos
          </button>
        </div>
      </div>

      <div
        className={`rack__ledge${targeted ? " rack__ledge--target" : ""}`}
        data-drop="rack"
        onClick={() => {
          if (canArrange && grab.holding) {
            grab.dropOn({ kind: "rack", index: rack.length });
          }
        }}
      >
        {rack.map((id, index) => {
          const slot: Slot = { kind: "rack", index };
          const held = grab.holding?.tile === id;
          return (
            <Tile
              key={id}
              id={id}
              drop={{ kind: "rack", index }}
              hollow={held && grab.dragging}
              picked={held && !grab.dragging}
              dealIndex={dealing ? index : undefined}
              onPointerDown={
                canArrange
                  ? (event: PointerEvent) => {
                      event.stopPropagation();
                      grab.grip(event, slot, id);
                    }
                  : undefined
              }
              onClick={(event) => event.stopPropagation()}
            />
          );
        })}
      </div>

      <div className="rack__actions">{children}</div>
    </div>
  );
}
