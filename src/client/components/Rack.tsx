import { Fragment, useMemo, type PointerEvent, type ReactNode } from "react";
import { ArrowUpDown, RotateCcw, Undo2 } from "lucide-react";

import { rackBlocks } from "../../engine/order";
import type { TileId } from "../../engine/types";
import type { Slot, SortMode } from "../play/arrange";
import { fitRackTile } from "../play/fit";
import { tileSizeStyle, useMeasuredBox } from "../play/useAutoFit";
import type { Grab } from "../play/useGrab";
import { Tile } from "./Tile";

type RackProps = {
  rack: readonly TileId[];
  grab: Grab;
  canArrange: boolean;
  /** Escalona la animación del reparto al empezar la ronda. */
  dealing: boolean;
  /** La última robada, que se marca para no tener que buscarla. */
  drawn: TileId | null;
  onSort: (mode: SortMode) => void;
  sortMode: SortMode;
  onUndo: () => void;
  canUndo: boolean;
  onReset: () => void;
  canReset: boolean;
  children: ReactNode;
};

/** Lo que ocupa un hueco de separación, medido en fichas. */
const GAP_TILES = 0.55;

export function Rack({
  rack,
  grab,
  canArrange,
  dealing,
  drawn,
  onSort,
  sortMode,
  onUndo,
  canUndo,
  onReset,
  canReset,
  children,
}: RackProps) {
  const [ref, box] = useMeasuredBox<HTMLDivElement>();

  /**
   * Los huecos entre lo que ya cumple regla y lo suelto, como en el atril de
   * madera.
   *
   * Solo dependen de qué fichas hay y en qué orden, así que no se mueven
   * mientras arrastras: la ficha levantada sigue contando. Ocultarlos al
   * levantarla parecía más limpio y era peor —el atril se recolocaba a media
   * pulsación y el clic siguiente caía un dedo más abajo del que querías.
   */
  const cortes = useMemo(() => rackBlocks(rack), [rack]);
  const corte = useMemo(() => new Set(cortes), [cortes]);

  // El atril tampoco se desplaza: con veinte fichas encogen hasta caber. Los
  // huecos ocupan sitio, así que cuentan como algo más de media ficha.
  const tile = useMemo(
    () => fitRackTile(rack.length + cortes.length * GAP_TILES, box),
    [rack.length, cortes.length, box],
  );

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
          <Undo2 size={15} aria-hidden />
          Deshacer
        </button>
        {/* Recoger toda la jugada de una vez, para volver a empezar el turno. */}
        <button
          type="button"
          className="press press--ghost rack__undo"
          onClick={onReset}
          disabled={!canReset}
          title="Recoger todo lo que has bajado este turno"
        >
          <RotateCcw size={15} aria-hidden />
          Reiniciar
        </button>
        <div className="segmented" role="group" aria-label="Ordenar el atril">
          <ArrowUpDown size={14} className="segmented__icon" aria-hidden />
          <button
            type="button"
            className="segmented__choice"
            aria-pressed={sortMode === "runs"}
            onClick={() => onSort("runs")}
          >
            Escaleras
          </button>
          <button
            type="button"
            className="segmented__choice"
            aria-pressed={sortMode === "groups"}
            onClick={() => onSort("groups")}
          >
            Grupos
          </button>
        </div>
      </div>

      <div
        className={`rack__ledge${targeted ? " rack__ledge--target" : ""}`}
        ref={ref}
        style={tileSizeStyle(tile)}
        data-drop="rack"
        onClick={() => {
          if (canArrange && grab.holding) {
            grab.dropOn({ kind: "rack", index: rack.length });
          }
        }}
      >
        {rack.map((id, index) => {
          const slot: Slot = { kind: "rack", index };
          const held = grab.isHeld(id);
          const ficha = (
            <Tile
              key={id}
              id={id}
              drop={{ kind: "rack", index }}
              fresh={id === drawn}
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
          if (!corte.has(index)) return ficha;
          // El hueco va pegado a la ficha que abre el bloque, para que se
          // mueva con ella y no quede un espacio suelto al reordenar.
          return (
            <Fragment key={`hueco-${id}`}>
              <span className="rack__gap" aria-hidden />
              {ficha}
            </Fragment>
          );
        })}
      </div>

      <div className="rack__actions">{children}</div>
    </div>
  );
}
