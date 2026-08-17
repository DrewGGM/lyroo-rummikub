/**
 * Quién eres en esta mesa, guardado en el navegador.
 *
 * No hay cuentas. El nombre lo eliges tú y se recuerda para la próxima; la
 * credencial del asiento la emite el servidor al entrar y es lo único que
 * demuestra que ese sitio en la mesa es tuyo, así que se guarda por sala.
 */

const NAME_KEY = "mesa.nombre";
const SEAT_KEY = (code: string) => `mesa.asiento.${code}`;

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Navegación privada con almacenamiento bloqueado: se juega igual, solo se
    // pierde la reconexión automática.
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento no hay nada que guardar */
  }
}

export function rememberedName(): string {
  return readStore(NAME_KEY) ?? "";
}

export function rememberName(name: string): void {
  writeStore(NAME_KEY, name);
}

export function seatToken(code: string): string | null {
  return readStore(SEAT_KEY(code));
}

export function rememberSeat(code: string, token: string): void {
  writeStore(SEAT_KEY(code), token);
}
