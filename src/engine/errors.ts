/** Vocabulario de rechazos del motor. El cliente traduce el código a una reacción. */

export type RejectionCode =
  // Validación de la jugada
  | "TILES_DO_NOT_MATCH"
  | "TILES_TAKEN_FROM_BOARD"
  | "NOTHING_PLAYED"
  | "INVALID_SET"
  | "MELD_TOUCHES_BOARD"
  | "MELD_TOO_LOW"
  // Turnos y sala
  | "NOT_PLAYING"
  | "NOT_YOUR_TURN"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  | "ALREADY_STARTED"
  | "NOT_FINISHED";

export type Rejection = {
  readonly code: RejectionCode;
  readonly message: string;
  /** Índices de las combinaciones de la mesa propuesta que fallan, si aplica. */
  readonly setIndexes?: readonly number[];
};

export function rejection(
  code: RejectionCode,
  message: string,
  setIndexes?: readonly number[],
): Rejection {
  return setIndexes ? { code, message, setIndexes } : { code, message };
}
