/**
 * El aviso sonoro de que te toca.
 *
 * El tono se sintetiza en vez de traer un fichero: son dos notas, pesan cero y
 * se pueden afinar aquí mismo sin volver a exportar nada. Además evita el
 * segundo de espera del primer sonido, que llegaría tarde justo la primera vez,
 * que es cuando más falta hace.
 *
 * El navegador no deja sonar nada hasta que el usuario ha tocado la página. No
 * es problema aquí: para llegar a la mesa hay que pulsar "Sentarme", así que
 * cuando suena el primer aviso el permiso ya está dado.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const GUARDADO = "mesa.sonido";

/** Dos notas cortas, suaves y ascendentes. Ni fanfarria ni pitido de horno. */
const NOTAS = [
  { hz: 660, empieza: 0, dura: 0.13 },
  { hz: 880, empieza: 0.1, dura: 0.22 },
];
/** Bajo a propósito: esto suena al lado de otras personas. */
const VOLUMEN = 0.07;

export type Chime = {
  readonly on: boolean;
  toggle(): void;
  /** Suena, si el sonido está puesto. */
  play(): void;
};

export function useChime(): Chime {
  const [on, setOn] = useState<boolean>(() => leerPreferencia());
  const contexto = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      void contexto.current?.close();
      contexto.current = null;
    };
  }, []);

  const play = useCallback(() => {
    if (!on) return;
    const audio = abrir(contexto);
    if (!audio) return;
    // Si el navegador lo dejó dormido al cambiar de pestaña, se despierta.
    if (audio.state === "suspended") void audio.resume();

    const ahora = audio.currentTime;
    for (const nota of NOTAS) {
      const oscilador = audio.createOscillator();
      const ganancia = audio.createGain();
      oscilador.type = "sine";
      oscilador.frequency.value = nota.hz;

      // Una envolvente suave: sin ella, empezar y cortar de golpe suena a
      // chasquido, que es exactamente lo que no se quiere de fondo.
      const desde = ahora + nota.empieza;
      ganancia.gain.setValueAtTime(0, desde);
      ganancia.gain.linearRampToValueAtTime(VOLUMEN, desde + 0.012);
      ganancia.gain.exponentialRampToValueAtTime(0.0001, desde + nota.dura);

      oscilador.connect(ganancia).connect(audio.destination);
      oscilador.start(desde);
      oscilador.stop(desde + nota.dura + 0.02);
    }
  }, [on]);

  const toggle = useCallback(() => {
    setOn((antes) => {
      const ahora = !antes;
      try {
        localStorage.setItem(GUARDADO, ahora ? "1" : "0");
      } catch {
        // Sin almacenamiento --modo privado— se queda solo para esta partida.
      }
      return ahora;
    });
  }, []);

  return { on, toggle, play };
}

function leerPreferencia(): boolean {
  try {
    // Puesto salvo que lo hayas quitado tú: un aviso que hay que descubrir para
    // activarlo no avisa a nadie.
    return localStorage.getItem(GUARDADO) !== "0";
  } catch {
    return true;
  }
}

function abrir(ref: React.RefObject<AudioContext | null>): AudioContext | null {
  if (ref.current) return ref.current;
  const Constructor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Constructor) return null;
  ref.current = new Constructor();
  return ref.current;
}
