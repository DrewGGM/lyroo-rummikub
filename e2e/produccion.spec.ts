/**
 * Batería contra el despliegue real.
 *
 * Las pruebas del motor y de la sala corren en local contra el runtime de
 * Workers; esto comprueba que lo publicado se comporta igual. Además intenta
 * hacer trampas de verdad por el WebSocket: si el servidor es el árbitro,
 * ninguna debe colar.
 *
 *   MESA_URL=https://rummikub.andrewgarcia.dev npx playwright test e2e/produccion.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

type Vista = {
  status: string;
  rack: string[];
  board: string[][];
  poolCount: number;
  players: { id: string; tileCount: number }[];
  rules: Record<string, unknown>;
  turnPlayerId: string | null;
  turnEndsAt: number | null;
  you: string;
  hostId: string;
};

/**
 * Monta una mesa entera con WebSockets crudos dentro de una pestaña. Manejar
 * ocho jugadores así cuesta una fracción de lo que costaría abrir ocho
 * navegadores, y prueba exactamente el mismo servidor.
 */
async function abrirMesa(
  page: Page,
  jugadores: string[],
  reglas?: unknown,
): Promise<{ code: string }> {
  await page.goto("/");

  return page.evaluate(
    async ([nombres, reglasMesa]) => {
      // La batería abre una mesa por prueba y el servidor limita cuántas se
      // pueden crear por minuto. Chocar con ese límite es señal de que la
      // protección funciona, no de que la aplicación falle: se espera y se
      // reintenta, como haría cualquiera.
      let cuerpo = "";
      let estado = 0;
      for (let intento = 0; intento < 7; intento++) {
        const respuesta = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reglasMesa ? { rules: reglasMesa } : {}),
        });
        estado = respuesta.status;
        cuerpo = await respuesta.text();
        if (respuesta.ok) break;
        if (estado !== 429) break;
        // La ventana del limitador es de un minuto: no sirve reintentar antes.
        await new Promise((r) => setTimeout(r, 11_000));
      }
      if (estado !== 201) {
        // Sin esto, un fallo al crear dejaba `code` en undefined y la prueba se
        // quedaba esperando un WebSocket que nunca iba a abrir.
        throw new Error(`no se pudo crear la sala (${estado}): ${cuerpo}`);
      }
      const { code } = JSON.parse(cuerpo) as { code: string };

      const asientos = await Promise.all(
        (nombres as string[]).map(
          (nombre) =>
            new Promise<unknown>((listo, fallo) => {
              const protocolo = location.protocol === "https:" ? "wss:" : "ws:";
              const ws = new WebSocket(
                protocolo + "//" + location.host + "/ws/room/" + code,
              );
              const recibidos: Record<string, unknown>[] = [];
              // Toda espera lleva plazo: una prueba que se cuelga no dice nada,
              // y tarda horas en decirlo.
              const plazo = setTimeout(
                () => fallo(new Error(`${nombre} no llegó a conectar`)),
                10_000,
              );
              ws.addEventListener("message", (e) =>
                recibidos.push(JSON.parse(String(e.data))),
              );
              ws.addEventListener("error", () => {
                clearTimeout(plazo);
                fallo(new Error(`${nombre} no pudo abrir el WebSocket`));
              });
              ws.addEventListener("open", () => {
                clearTimeout(plazo);
                ws.send(JSON.stringify({ type: "join", name: nombre }));
                listo({ nombre, ws, recibidos });
              });
            }),
        ),
      );

      Object.assign(window, { mesa: { code, asientos } });
      return { code };
    },
    [jugadores, reglas] as const,
  );
}

/** Manda un mensaje por un asiento y devuelve lo que llegue después. */
async function actuar(
  page: Page,
  asiento: number,
  mensaje: unknown,
  espera = 700,
): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    async ([indice, msg, ms]) => {
      const mesa = (window as unknown as { mesa: { asientos: unknown[] } }).mesa;
      const yo = mesa.asientos[indice as number] as {
        ws: WebSocket;
        recibidos: Record<string, unknown>[];
      };
      const desde = yo.recibidos.length;
      yo.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
      await new Promise((r) => setTimeout(r, ms as number));
      return yo.recibidos.slice(desde);
    },
    [asiento, mensaje, espera] as const,
  );
}

/** La última vista que ha recibido un asiento. */
async function vistaDe(page: Page, asiento: number): Promise<Vista> {
  return page.evaluate(([indice]) => {
    const mesa = (window as unknown as { mesa: { asientos: unknown[] } }).mesa;
    const suyos = (mesa.asientos[indice as number] as {
      recibidos: Record<string, unknown>[];
    }).recibidos;
    for (let i = suyos.length - 1; i >= 0; i--) {
      const m = suyos[i]!;
      if (m["type"] === "state" || m["type"] === "welcome") return m["view"];
    }
    return null;
  }, [asiento] as const) as Promise<Vista>;
}

/**
 * Reparte y espera a que la partida esté de verdad en marcha.
 *
 * Esperar un número fijo de milisegundos es lo que hacía que la batería fallara
 * a ratos: contra un servidor real la latencia varía, y un sleep que hoy llega
 * mañana se queda corto.
 */
/**
 * Qué asiento manda en la mesa.
 *
 * Los jugadores se conectan a la vez, así que quien llega primero al servidor
 * —y por tanto reparte— no tiene por qué ser el primero de la lista. Suponerlo
 * hacía fallar la batería a ratos con un `NOT_HOST` desconcertante.
 */
async function asientoAnfitrion(page: Page): Promise<number> {
  const vista = await vistaDe(page, 0);
  const mando = vista?.hostId;
  const cuantos = vista?.players?.length ?? 0;
  for (let asiento = 0; asiento < cuantos; asiento++) {
    if ((await vistaDe(page, asiento))?.you === mando) return asiento;
  }
  return 0;
}

async function repartir(page: Page): Promise<void> {
  const anfitrion = await asientoAnfitrion(page);
  const respuesta = await actuar(page, anfitrion, { type: "start" }, 300);
  const negativa = respuesta.find((m) => m["type"] === "rejected");

  try {
    await expect
      .poll(async () => (await vistaDe(page, 0))?.status, { timeout: 15_000 })
      .toBe("playing");
  } catch (fallo) {
    // Que la prueba diga qué contestó el servidor; si no, cada fallo obliga a
    // volver a investigar desde cero.
    const vista = await vistaDe(page, 0);
    throw new Error(
      `no llegó a repartir. Servidor: ${JSON.stringify(negativa ?? "sin respuesta")}. ` +
        `Estado: ${vista?.status}, jugadores: ${vista?.players?.length}. ` +
        `(${String(fallo).slice(0, 120)})`,
    );
  }
}

/** Espera a que todos los asientos tengan su vista. */
async function esperarMesa(page: Page, cuantos: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const vista = await vistaDe(page, 0);
        return vista?.players?.length ?? 0;
      },
      { timeout: 15_000 },
    )
    .toBe(cuantos);
}

test.describe("mazos según cuántos sean", () => {
  for (const [cuantos, mazo] of [
    [2, 106],
    [5, 160],
    [8, 214],
  ] as const) {
    test(`${cuantos} jugadores juegan con ${mazo} fichas`, async ({ page }) => {
      const nombres = Array.from({ length: cuantos }, (_, i) => `J${i + 1}`);
      await abrirMesa(page, nombres);
      await esperarMesa(page, cuantos);
      await repartir(page);

      const vista = await vistaDe(page, 0);
      expect(vista.status).toBe("playing");
      expect(vista.rack).toHaveLength(14);
      expect(vista.poolCount).toBe(mazo - cuantos * 14);
      expect(vista.players).toHaveLength(cuantos);
    });
  }
});

test.describe("variantes de la mesa", () => {
  test("respeta abrir con 50, dieciséis fichas y sin reloj", async ({ page }) => {
    await abrirMesa(page, ["Ana", "Beto"], {
      openingPoints: 50,
      handSize: 16,
      turnSeconds: null,
    });
    await esperarMesa(page, 2);
    await repartir(page);

    const vista = await vistaDe(page, 0);
    expect(vista.rules).toMatchObject({
      openingPoints: 50,
      handSize: 16,
      turnSeconds: null,
    });
    expect(vista.rack).toHaveLength(16);
    expect(vista.poolCount).toBe(106 - 32);
    expect(vista.turnEndsAt).toBeNull();
  });

  test("descarta una variante inventada y deja las oficiales", async ({ page }) => {
    await abrirMesa(page, ["Ana", "Beto"], {
      openingPoints: 1,
      handSize: 60,
      turnSeconds: 99999,
      jokers: "ninguno",
    });
    await esperarMesa(page, 2);
    const vista = await vistaDe(page, 0);
    expect(vista.rules).toEqual({
      turnSeconds: 60,
      openingPoints: 30,
      handSize: 14,
      jokers: "strict",
    });
  });
});

test.describe("intentos de trampa", () => {
  test("rechaza todas las trampas y deja la mesa intacta", async ({ page }) => {
    await abrirMesa(page, ["Ana", "Beto"]);
    await esperarMesa(page, 2);
    await repartir(page);

    const ana = await vistaDe(page, 0);
    const beto = await vistaDe(page, 1);
    const colaron: string[] = [];

    const intentar = async (
      nombre: string,
      asiento: number,
      mensaje: unknown,
      aceptable: string[],
    ) => {
      const respuesta = await actuar(page, asiento, mensaje);
      const negativa = respuesta.find(
        (m) => m["type"] === "rejected" || m["type"] === "denied",
      );
      const motivo = String(negativa?.["code"] ?? negativa?.["reason"] ?? "ACEPTADA");
      if (!aceptable.includes(motivo)) colaron.push(`${nombre} → ${motivo}`);
    };

    await intentar(
      "fichas inventadas",
      0,
      { type: "commit", board: [["r10_0", "b10_0", "k10_0"]], rack: ana.rack },
      ["TILES_DO_NOT_MATCH"],
    );

    await intentar(
      "jugar en turno ajeno",
      1,
      { type: "commit", board: [beto.rack.slice(0, 3)], rack: beto.rack.slice(3) },
      ["NOT_YOUR_TURN"],
    );

    await intentar(
      "duplicar una ficha propia",
      0,
      {
        type: "commit",
        board: [ana.rack.slice(0, 3), ana.rack.slice(0, 3)],
        rack: ana.rack.slice(3),
      },
      ["TILES_DO_NOT_MATCH"],
    );

    await intentar(
      "confirmar sin jugar nada",
      0,
      { type: "commit", board: [], rack: ana.rack },
      ["NOTHING_PLAYED"],
    );

    const noManda = (await asientoAnfitrion(page)) === 0 ? 1 : 0;
    await intentar(
      "repartir sin ser anfitrión",
      noManda,
      { type: "start" },
      ["ALREADY_STARTED", "NOT_HOST"],
    );

    await intentar(
      "cambiar reglas en caliente",
      0,
      { type: "settings", rules: { openingPoints: 25 } },
      ["ALREADY_STARTED"],
    );

    await intentar(
      "revancha antes de tiempo",
      0,
      { type: "rematch" },
      ["NOT_FINISHED"],
    );

    // Colar un comodín disfrazado de reordenar el atril: no debe cambiar nada.
    await actuar(page, 0, { type: "sort", rack: [...ana.rack.slice(1), "j_0"] });
    const trasElComodin = await vistaDe(page, 0);
    if (trasElComodin.rack.length !== ana.rack.length) {
      colaron.push("comodín colado al reordenar");
    }

    expect(colaron, "trampas que el servidor dejó pasar").toEqual([]);

    // Después de todo el ataque, la partida sigue exactamente como estaba.
    const final = await vistaDe(page, 0);
    expect(final.board).toEqual([]);
    expect(final.rack).toHaveLength(14);
    expect(final.turnPlayerId).toBe(final.you);
  });

  test("no filtra las fichas de los demás", async ({ page }) => {
    await abrirMesa(page, ["Ana", "Beto"]);
    await esperarMesa(page, 2);
    await repartir(page);

    const ana = await vistaDe(page, 0);
    const beto = await vistaDe(page, 1);

    // En lo que recibe Ana no aparece ni una sola ficha concreta de nadie más.
    expect(JSON.stringify(ana.players)).not.toMatch(/[rbko]\d{1,2}_\d|j_\d/);
    expect(ana.rack).not.toEqual(beto.rack);
    expect(ana.players.every((j) => typeof j.tileCount === "number")).toBe(true);
  });

  test("aguanta basura por el cable sin caerse", async ({ page }) => {
    await abrirMesa(page, ["Ana", "Beto"]);

    const basura = [
      "no soy json",
      "[]",
      "null",
      '{"type":"commit"}',
      '{"type":"desconocido"}',
      '{"type":"commit","board":"no es una lista","rack":[]}',
      '{"type":"sort","rack":[1,2,3]}',
    ];
    for (const cadena of basura) await actuar(page, 0, cadena, 100);

    // La conexión sigue viva y atiende una acción legítima. Se reparte por el
    // asiento que manda, que con conexiones en paralelo no tiene por qué ser
    // el primero de la lista.
    await esperarMesa(page, 2);
    await repartir(page);
    expect((await vistaDe(page, 0)).status).toBe("playing");
  });
});

test.describe("sala", () => {
  test("no admite un noveno jugador", async ({ page }) => {
    const nombres = Array.from({ length: 8 }, (_, i) => `J${i + 1}`);
    const { code } = await abrirMesa(page, nombres);

    const respuesta = await page.evaluate(async ([sala]) => {
      const protocolo = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(protocolo + "//" + location.host + "/ws/room/" + sala);
      return new Promise<string>((listo) => {
        ws.addEventListener("message", (e) => listo(String(e.data)));
        ws.addEventListener("open", () =>
          ws.send(JSON.stringify({ type: "join", name: "Nueve" })),
        );
        setTimeout(() => listo("(sin respuesta)"), 4000);
      });
    }, [code] as const);

    expect(respuesta).toContain("full");
  });

  test("devuelve el asiento y las fichas al reconectar", async ({ page }) => {
    await abrirMesa(page, ["Ana", "Beto"]);
    await esperarMesa(page, 2);
    await repartir(page);
    const antes = await vistaDe(page, 0);

    const vuelta = await page.evaluate(async () => {
      const mesa = (window as unknown as {
        mesa: { code: string; asientos: unknown[] };
      }).mesa;
      const ana = mesa.asientos[0] as {
        ws: WebSocket;
        recibidos: Record<string, unknown>[];
      };
      const bienvenida = ana.recibidos.find((m) => m["type"] === "welcome");
      const credencial = bienvenida?.["token"];
      ana.ws.close();
      await new Promise((r) => setTimeout(r, 500));

      const protocolo = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        protocolo + "//" + location.host + "/ws/room/" + mesa.code,
      );
      return new Promise<Record<string, unknown> | null>((listo) => {
        ws.addEventListener("message", (e) => {
          const m = JSON.parse(String(e.data));
          if (m.type === "welcome") listo(m);
        });
        ws.addEventListener("open", () =>
          ws.send(
            JSON.stringify({ type: "join", name: "Ana", token: credencial }),
          ),
        );
        setTimeout(() => listo(null), 5000);
      });
    });

    expect(vuelta).not.toBeNull();
    expect(vuelta!["playerId"]).toBe(antes.you);
    const vista = vuelta!["view"] as Vista;
    expect(vista.rack).toEqual(antes.rack);
    expect(vista.players).toHaveLength(2);
  });

  test("se le acaba el tiempo a quien no juega", async ({ page }) => {
    test.setTimeout(120_000);
    await abrirMesa(page, ["Ana", "Beto"], { turnSeconds: 30 });
    await esperarMesa(page, 2);
    await repartir(page);

    // El turno empieza por quien se sentó primero, y con las conexiones en
    // paralelo eso no tiene por qué ser el asiento 0.
    const primera = await vistaDe(page, 0);
    let deQuien = 0;
    for (let asiento = 0; asiento < primera.players.length; asiento++) {
      if ((await vistaDe(page, asiento)).you === primera.turnPlayerId) {
        deQuien = asiento;
        break;
      }
    }

    const antes = await vistaDe(page, deQuien);
    expect(antes.turnPlayerId).toBe(antes.you);
    expect(antes.rack).toHaveLength(14);

    // Se deja correr el reloj de verdad: quien tiene que saltar es la alarma
    // del servidor, y eso no se puede simular desde fuera.
    await page.waitForTimeout(36_000);

    const despues = await vistaDe(page, deQuien);
    expect(despues.turnPlayerId).not.toBe(despues.you);
    expect(despues.rack).toHaveLength(15);
    expect(despues.board).toEqual([]);
  });
});
