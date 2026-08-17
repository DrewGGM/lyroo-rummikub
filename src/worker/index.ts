/**
 * Enrutador de la aplicación.
 *
 * Hace tres cosas: crear salas con un código libre, decir si una sala existe, y
 * pasarle la conexión WebSocket al Durable Object que arbitra esa partida. Todo
 * lo demás lo sirve el binding de assets estáticos, que no factura peticiones.
 */

import {
  isRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../protocol";
import { clampTurnSeconds, DEFAULT_TURN_SECONDS } from "../engine/game";

export { GameRoom } from "./GameRoom";

/** Intentos de encontrar un código libre antes de rendirse. */
const CODE_ATTEMPTS = 8;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/rooms" && request.method === "POST") {
      return createRoom(request, env);
    }

    const roomMatch = /^\/api\/rooms\/([^/]+)$/.exec(path);
    if (roomMatch && request.method === "GET") {
      return describeRoom(roomMatch[1]!, env);
    }

    const socketMatch = /^\/ws\/room\/([^/]+)$/.exec(path);
    if (socketMatch) {
      return openSocket(request, socketMatch[1]!, env);
    }

    return json({ error: "No existe esa ruta." }, 404);
  },
} satisfies ExportedHandler<Env>;

async function createRoom(request: Request, env: Env): Promise<Response> {
  if (!(await withinRoomQuota(request, env))) {
    return json(
      { error: "Estás creando mesas muy deprisa. Espera un momento." },
      429,
    );
  }

  const turnSeconds = clampTurnSeconds(await readTurnSeconds(request));

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const room = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
    if (await room.claim(code, turnSeconds)) {
      return json({ code, turnSeconds }, 201);
    }
  }
  return json({ error: "No hemos podido crear la sala. Inténtalo otra vez." }, 503);
}

async function describeRoom(rawCode: string, env: Env): Promise<Response> {
  const code = normalizeRoomCode(rawCode);
  if (!isRoomCode(code)) return json({ exists: false }, 404);

  const room = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
  const summary = await room.summary();
  return json(summary, summary.exists ? 200 : 404);
}

function openSocket(request: Request, rawCode: string, env: Env): Promise<Response> {
  const code = normalizeRoomCode(rawCode);
  if (!isRoomCode(code)) {
    return Promise.resolve(new Response("Código de sala inválido.", { status: 400 }));
  }
  if (request.headers.get("Upgrade") !== "websocket") {
    return Promise.resolve(new Response("Se esperaba una conexión WebSocket.", { status: 426 }));
  }

  const room = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
  return room.fetch(request);
}

/**
 * Crear salas es lo único que cuesta dinero sin que nadie juegue: cada una
 * arranca un Durable Object. Se limita por dirección de origen para que un
 * script no agote el presupuesto diario de todos.
 */
async function withinRoomQuota(request: Request, env: Env): Promise<boolean> {
  const limiter = env.ROOM_LIMIT;
  if (!limiter) return true;
  const origin = request.headers.get("CF-Connecting-IP") ?? "desconocido";
  const { success } = await limiter.limit({ key: origin });
  return success;
}

async function readTurnSeconds(request: Request): Promise<number> {
  try {
    const body = (await request.json()) as { turnSeconds?: unknown };
    return typeof body.turnSeconds === "number" ? body.turnSeconds : DEFAULT_TURN_SECONDS;
  } catch {
    return DEFAULT_TURN_SECONDS;
  }
}

function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  let code = "";
  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
