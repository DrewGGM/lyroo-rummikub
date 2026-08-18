/**
 * Las reglas que se pueden ajustar antes de repartir.
 *
 * Todas tienen un valor oficial por defecto. Las alternativas existen porque
 * cada casa juega a lo suyo: hay quien abre con 50, quien reparte 16 fichas y
 * quien deja mover el comodín a su antojo. Cambiarlas no cambia el juego, solo
 * la variante que se juega esa noche.
 */

export type JokerRule = "strict" | "free";

export type RoomRules = {
  /** Segundos por turno. `null` es sin reloj: se juega sin prisa. */
  readonly turnSeconds: number | null;
  /** Puntos mínimos de la jugada inicial de cada jugador. */
  readonly openingPoints: number;
  /** Fichas que se reparten a cada jugador. */
  readonly handSize: number;
  /**
   * `strict` es la regla oficial: una combinación con comodín no se rompe ni
   * se reordena, y para recuperarlo hay que sustituirlo por la ficha exacta.
   * `free` deja mover el comodín como cualquier otra ficha.
   */
  readonly jokers: JokerRule;
};

export const DEFAULT_RULES: RoomRules = {
  turnSeconds: 60,
  openingPoints: 30,
  handSize: 14,
  jokers: "strict",
};

/** Las opciones que se ofrecen en la sala, en el orden en que se muestran. */
export const TURN_SECONDS_CHOICES: readonly (number | null)[] = [30, 60, 90, 120, null];
export const OPENING_CHOICES: readonly number[] = [25, 30, 50];
export const HAND_SIZE_CHOICES: readonly number[] = [14, 16];
export const JOKER_CHOICES: readonly JokerRule[] = ["strict", "free"];

/**
 * Devuelve unas reglas válidas a partir de lo que llegue por la red.
 *
 * Lo que falte o no encaje se toma de `base`, así que sirve tanto para crear
 * una sala —partiendo de las oficiales— como para cambiar una sola regla sin
 * tocar las demás. Y cualquier valor fuera de las opciones ofrecidas se
 * descarta: el cliente no puede inventarse una variante repartiendo cuarenta
 * fichas.
 */
export function sanitizeRules(raw: unknown, base: RoomRules = DEFAULT_RULES): RoomRules {
  if (typeof raw !== "object" || raw === null) return base;
  const value = raw as Record<string, unknown>;

  return {
    turnSeconds: pick(
      value["turnSeconds"] === null ? null : Number(value["turnSeconds"]),
      TURN_SECONDS_CHOICES,
      base.turnSeconds,
    ),
    openingPoints: pick(
      Number(value["openingPoints"]),
      OPENING_CHOICES,
      base.openingPoints,
    ),
    handSize: pick(Number(value["handSize"]), HAND_SIZE_CHOICES, base.handSize),
    jokers: pick(value["jokers"], JOKER_CHOICES, base.jokers),
  };
}

function pick<T>(candidate: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(candidate as T) ? (candidate as T) : fallback;
}

/** Cómo se describe cada regla en la sala. */
export function describeRules(rules: RoomRules): string[] {
  return [
    rules.turnSeconds === null ? "sin reloj" : `${rules.turnSeconds}s por turno`,
    `abrir con ${rules.openingPoints}`,
    `${rules.handSize} fichas`,
    rules.jokers === "strict" ? "comodín protegido" : "comodín libre",
  ];
}
