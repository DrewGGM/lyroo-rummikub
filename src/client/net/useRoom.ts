/**
 * La conexión con la sala.
 *
 * Mantiene un WebSocket vivo, vuelve a conectarse sola cuando se cae, y expone
 * la última vista recibida. Perder la cobertura un momento no debe costarte la
 * partida: al volver, la credencial del asiento recupera tu sitio y tus fichas.
 *
 * Cada conexión lleva su propio temporizador y solo la vigente puede pedir una
 * reconexión o cambiar el estado. Sin eso, un socket que ya no vale seguía
 * pidiendo reconectar —y el servidor cerrando el anterior— en un bucle que
 * acababa entregando estados atrasados y descuadrando la mesa.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ClientMessage, GameView, ServerMessage } from "../../protocol";
import type { GameEvent } from "../../engine/game";
import type { RejectionCode } from "../../engine/errors";
import { rememberSeat, seatToken } from "./identity";

export type Link = "connecting" | "open" | "retrying" | "closed";

export type Refusal = {
  readonly code: RejectionCode;
  readonly message: string;
  readonly setIndexes?: readonly number[];
  /** Cambia en cada rechazo, para que la mesa vuelva a reaccionar. */
  readonly at: number;
};

export type Denial = {
  readonly reason: "full" | "started" | "name" | "unknown-seat";
  readonly message: string;
};

export type Room = {
  link: Link;
  view: GameView | null;
  refusal: Refusal | null;
  denial: Denial | null;
  events: readonly GameEvent[];
  /** Desfase entre el reloj del servidor y el de este dispositivo, en ms. */
  clockSkew: number;
  send(message: ClientMessage): void;
  clearRefusal(): void;
};

const RETRY_STEPS_MS = [400, 900, 2000, 4000, 8000];
const PING_EVERY_MS = 25_000;
const PING = JSON.stringify({ type: "ping" });

export function useRoom(code: string | null, name: string | null): Room {
  const [link, setLink] = useState<Link>("connecting");
  const [view, setView] = useState<GameView | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [denial, setDenial] = useState<Denial | null>(null);
  const [events, setEvents] = useState<readonly GameEvent[]>([]);
  const [clockSkew, setClockSkew] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!code || !name) return;

    // Estado propio de esta sesión. Nada de refs compartidas: en desarrollo el
    // efecto se monta dos veces, y una ref compartida hace que la primera
    // conexión crea seguir viva.
    let live: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let finished = false;

    const stop = () => {
      finished = true;
      if (retryTimer) clearTimeout(retryTimer);
    };

    const open = () => {
      if (finished) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(
        `${protocol}//${window.location.host}/ws/room/${code}`,
      );
      live = socket;
      socketRef.current = socket;
      setLink(attempt === 0 ? "connecting" : "retrying");

      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const isCurrent = () => !finished && live === socket;

      socket.addEventListener("open", () => {
        if (!isCurrent()) {
          socket.close();
          return;
        }
        attempt = 0;
        setLink("open");
        const token = seatToken(code);
        socket.send(
          JSON.stringify(
            token
              ? ({ type: "join", name, token } satisfies ClientMessage)
              : ({ type: "join", name } satisfies ClientMessage),
          ),
        );
        heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(PING);
        }, PING_EVERY_MS);
      });

      socket.addEventListener("message", (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        // Un socket que ya no es el vigente puede entregar mensajes tardíos:
        // aceptarlos retrasaría la mesa a un estado anterior.
        if (!isCurrent()) return;

        switch (message.type) {
          case "welcome":
            rememberSeat(code, message.token);
            setDenial(null);
            setView(message.view);
            setClockSkew(message.view.serverTime - Date.now());
            break;
          case "state":
            setView(message.view);
            setClockSkew(message.view.serverTime - Date.now());
            if (message.events.length > 0) setEvents(message.events);
            break;
          case "rejected":
            setRefusal({
              code: message.code,
              message: message.message,
              ...(message.setIndexes ? { setIndexes: message.setIndexes } : {}),
              at: Date.now(),
            });
            break;
          case "denied":
            setDenial({ reason: message.reason, message: message.message });
            stop();
            socket.close();
            setLink("closed");
            break;
        }
      });

      socket.addEventListener("close", () => {
        if (heartbeat) clearInterval(heartbeat);
        if (!isCurrent()) return;
        socketRef.current = null;
        setLink("retrying");
        const wait = RETRY_STEPS_MS[Math.min(attempt, RETRY_STEPS_MS.length - 1)]!;
        attempt += 1;
        retryTimer = setTimeout(open, wait);
      });
    };

    open();

    return () => {
      stop();
      const closing = live;
      live = null;
      socketRef.current = null;
      closing?.close();
    };
  }, [code, name]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const clearRefusal = useCallback(() => setRefusal(null), []);

  return { link, view, refusal, denial, events, clockSkew, send, clearRefusal };
}
