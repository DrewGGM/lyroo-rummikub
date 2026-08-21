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

/**
 * El comodín: una cara guiñando con la boca abierta.
 *
 * Se probó con gorro de bufón, dos puntas y cascabeles, y a tamaño de juego
 * --dieciséis píxeles con la mesa llena-- las dos puntas se leían como cuernos.
 * A ese tamaño no cabe un sombrero: cabe una cara. El carácter se lo da el
 * guiño, que se distingue aunque el resto sea un borrón, y la boca abierta, que
 * la separa del emoticono de siempre.
 *
 * Dibujada a trazo y con `currentColor`, como los números: así se ve impresa en
 * la pasta y no pegada encima.
 */
function JokerFace() {
  return (
    <svg className="tile__joker" viewBox="0 0 24 24" aria-hidden="true">
      <g className="joker-face">
        {/* La cara, grande y de trazo grueso: es lo único que sobrevive a
            los dieciséis píxeles que mide esto con la mesa llena. */}
        <circle cx="12" cy="12" r="9.2" />
        {/* Un ojo abierto y el otro guiñando. Es lo que le da carácter sin
            añadir una sola línea más: el guiño se lee incluso borroso. */}
        <circle className="joker-face__eye" cx="8.6" cy="9.9" r="1.5" />
        <path d="M13.3 9.9c.5-.9 1.3-1.4 2.3-1.4" />
        {/* La sonrisa, ancha y abierta, con la lengua asomando. */}
        <path d="M7.1 13.6c1.3 2.6 2.9 3.9 4.9 3.9s3.6-1.3 4.9-3.9" />
        <path d="M7.1 13.6h9.8" />
      </g>
    </svg>
  );
}
