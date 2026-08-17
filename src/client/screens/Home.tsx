import { useState } from "react";

import { isRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from "../../protocol";
import { Tile } from "../components/Tile";

type HomeProps = {
  onEnter: (code: string) => void;
};

/** El grupo de dieces: la apertura mínima, 30 puntos exactos. */
const OPENING = ["r10_0", "b10_0", "k10_0"];

export function Home({ onEnter }: HomeProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("no se pudo crear");
      const room = (await response.json()) as { code: string };
      onEnter(room.code);
    } catch {
      setProblem("No hemos podido crear la mesa. Vuelve a intentarlo.");
      setBusy(false);
    }
  };

  const join = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = normalizeRoomCode(code);
    if (!isRoomCode(clean)) {
      setProblem(`El código tiene ${ROOM_CODE_LENGTH} letras y números.`);
      return;
    }
    setBusy(true);
    setProblem(null);
    const response = await fetch(`/api/rooms/${clean}`);
    if (response.ok) {
      onEnter(clean);
      return;
    }
    setProblem("Esa mesa no existe. Comprueba el código.");
    setBusy(false);
  };

  return (
    <main className="home">
      <p className="eyebrow">Rummikub · de 2 a 8 jugadores</p>

      <h1 className="home__title">
        Monta la mesa
        <em>y pasa el enlace.</em>
      </h1>

      <div className="home__meld">
        <div className="home__tiles" aria-hidden="true">
          {OPENING.map((id, index) => (
            <Tile key={id} id={id} dealIndex={index} />
          ))}
        </div>
        <p className="home__caption">
          Para abrir hace falta<b>30</b>
        </p>
      </div>

      <p className="home__lead">
        Sin cuentas y sin instalar nada. Creas la mesa, compartes el enlace y
        empezáis. Si se te va la conexión, vuelves a tu sitio con tus fichas.
      </p>

      <div className="home__actions">
        <button
          type="button"
          className="press press--lamp"
          onClick={create}
          disabled={busy}
        >
          {busy ? "Preparando la mesa…" : "Crear mesa"}
        </button>
      </div>

      <form className="home__join" onSubmit={join}>
        <label className="eyebrow" htmlFor="codigo">
          ¿Te han pasado un código?
        </label>
        <div className="home__join-row">
          <input
            id="codigo"
            className="field home__code"
            value={code}
            onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="ABC7K2"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
          />
          <button type="submit" className="press press--quiet" disabled={busy}>
            Entrar
          </button>
        </div>
        {problem ? (
          <p className="home__error" role="alert">
            <span className="notice__dot" />
            {problem}
          </p>
        ) : null}
      </form>

      <p className="home__foot">
        Las reglas las decide el servidor, no el navegador: nadie puede jugar una
        ficha que no tiene.
      </p>
    </main>
  );
}
