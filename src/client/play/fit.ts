/**
 * Cuánto puede medir una ficha para que todo quepa sin desplazar.
 *
 * En una mesa real las fichas no cambian de tamaño, pero una pantalla de móvil
 * en horizontal tiene 350 píxeles de alto y una partida avanzada llega a veinte
 * combinaciones. O encogen las fichas o hay que ir haciendo scroll para ver la
 * mesa, y hacer scroll mientras juegas es insoportable.
 *
 * El cálculo es puro y determinista: se simula cómo caen las filas con un ancho
 * de ficha dado y se busca el mayor que entre. Así se puede comprobar en un
 * test en vez de a ojo.
 */

/** Proporción de una ficha de Rummikub: algo más alta que ancha. */
export const TILE_RATIO = 1.38;

export type Box = { readonly width: number; readonly height: number };

export type FitLimits = {
  /** Por debajo de esto los números dejan de leerse. */
  readonly min: number;
  /** Por encima de esto la mesa se ve desangelada en pantallas grandes. */
  readonly max: number;
};

export const BOARD_LIMITS: FitLimits = { min: 17, max: 46 };

/**
 * Lo que ocupa el hueco de "combinación nueva", medido en fichas.
 *
 * Es un elemento más en la misma fila que las combinaciones, así que si no se
 * cuenta puede empujar a una fila de más y dejar la última cortada por abajo.
 * El número sale del `min-width` que tiene en la hoja de estilos.
 */
export const NEW_TRAY_TILES = 1.5;
export const RACK_LIMITS: FitLimits = { min: 20, max: 52 };

/** Separaciones del tapete, todas proporcionales a la ficha. */
function metrics(tile: number) {
  return {
    height: tile * TILE_RATIO,
    betweenTiles: Math.max(1, tile * 0.06),
    trayPadding: Math.max(3, tile * 0.14),
    betweenTrays: Math.max(5, tile * 0.26),
  };
}

/** Ancho que ocupa una combinación de `size` fichas. */
export function traySpan(size: number, tile: number): number {
  const m = metrics(tile);
  return size * tile + Math.max(0, size - 1) * m.betweenTiles + m.trayPadding * 2;
}

/** Filas que ocupan las combinaciones al acomodarse en un ancho dado. */
export function trayRows(
  setSizes: readonly number[],
  tile: number,
  width: number,
): number {
  if (setSizes.length === 0) return 0;
  const m = metrics(tile);
  let used = 0;
  let rows = 1;

  for (const size of setSizes) {
    const span = traySpan(size, tile);
    if (used === 0) {
      used = span;
      continue;
    }
    if (used + m.betweenTrays + span <= width) {
      used += m.betweenTrays + span;
    } else {
      rows += 1;
      used = span;
    }
  }
  return rows;
}

function boardFits(
  setSizes: readonly number[],
  tile: number,
  box: Box,
): boolean {
  const m = metrics(tile);
  // Una combinación más ancha que el tapete no cabe por mucho que se acomode.
  const widest = Math.max(0, ...setSizes.map((size) => traySpan(size, tile)));
  if (widest > box.width) return false;

  const rowHeight = m.height + m.trayPadding * 2 + m.betweenTrays;
  return trayRows(setSizes, tile, box.width) * rowHeight <= box.height;
}

/** El mayor ancho de ficha con el que la mesa entera se ve de un vistazo. */
export function fitBoardTile(
  setSizes: readonly number[],
  box: Box,
  limits: FitLimits = BOARD_LIMITS,
): number {
  if (box.width <= 0 || box.height <= 0) return limits.max;
  if (setSizes.length === 0) return limits.max;
  return search((tile) => boardFits(setSizes, tile, box), limits);
}

function rackFits(count: number, tile: number, box: Box): boolean {
  const m = metrics(tile);
  const step = tile + m.betweenTiles;
  const perRow = Math.floor((box.width + m.betweenTiles) / step);
  if (perRow < 1) return false;
  const rows = Math.ceil(count / perRow);
  return rows * (m.height + m.betweenTiles) <= box.height;
}

/** Lo mismo para el atril, que se acomoda ficha a ficha en vez de por grupos. */
export function fitRackTile(
  count: number,
  box: Box,
  limits: FitLimits = RACK_LIMITS,
): number {
  if (box.width <= 0 || box.height <= 0 || count === 0) return limits.max;
  return search((tile) => rackFits(count, tile, box), limits);
}

/**
 * Busca el mayor tamaño que cumple la condición. La condición es monótona —si
 * una ficha cabe, una más pequeña también—, así que basta con partir por la
 * mitad hasta afinar al medio píxel.
 */
function search(fits: (tile: number) => boolean, limits: FitLimits): number {
  if (fits(limits.max)) return limits.max;

  let low = limits.min;
  let high = limits.max;
  for (let step = 0; step < 18 && high - low > 0.5; step++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  // Si ni el mínimo cabe, se devuelve el mínimo: mejor recortar por abajo que
  // dejar las fichas ilegibles.
  return Math.max(limits.min, Math.floor(low));
}
