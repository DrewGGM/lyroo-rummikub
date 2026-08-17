import { memo, type MouseEvent, type PointerEvent } from "react";

import { parseTile } from "../../engine/tiles";
import { COLOR_NAMES, type TileId } from "../../engine/types";

type TileProps = {
  id: TileId;
  /** Atributos de destino para saber dónde se suelta lo que se arrastra. */
  drop?: { kind: "rack" | "set"; set?: number; index?: number };
  lifted?: boolean;
  hollow?: boolean;
  picked?: boolean;
  fresh?: boolean;
  dealIndex?: number;
  onPointerDown?: (event: PointerEvent) => void;
  onClick?: (event: MouseEvent) => void;
};

export const Tile = memo(function Tile({
  id,
  drop,
  lifted,
  hollow,
  picked,
  fresh,
  dealIndex,
  onPointerDown,
  onClick,
}: TileProps) {
  const tile = parseTile(id);
  const joker = !tile || tile.kind === "joker";
  const color = joker ? "j" : tile.color;

  const classes = ["tile"];
  if (lifted) classes.push("tile--lifted");
  if (hollow) classes.push("tile--hollow");
  if (picked) classes.push("tile--picked");
  if (fresh) classes.push("tile--fresh");
  if (dealIndex !== undefined) classes.push("tile--dealing");

  const interactive = Boolean(onPointerDown || onClick);

  return (
    <div
      className={classes.join(" ")}
      data-color={color}
      data-tile={id}
      data-drop={drop?.kind}
      data-set={drop?.set}
      data-index={drop?.index}
      style={dealIndex !== undefined ? { "--deal-index": dealIndex } as never : undefined}
      onPointerDown={onPointerDown}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={joker ? "Comodín" : `${tile.value} ${COLOR_NAMES[tile.color]}`}
    >
      {joker ? (
        <JokerFace />
      ) : (
        <>
          <span className="tile__value">{tile.value}</span>
          <span className="tile__mark" />
        </>
      )}
    </div>
  );
});

/** El comodín del Rummikub es una cara sonriente impresa en la pasta. */
function JokerFace() {
  return (
    <svg className="tile__joker" viewBox="0 0 24 24" aria-hidden="true">
      <g className="joker-face">
        <circle cx="12" cy="12" r="9.5" />
        <circle className="joker-face__eye" cx="8.8" cy="9.6" r="1.4" />
        <circle className="joker-face__eye" cx="15.2" cy="9.6" r="1.4" />
        <path d="M7.6 14.2c1.2 2 2.6 3 4.4 3s3.2-1 4.4-3" />
      </g>
    </svg>
  );
}
