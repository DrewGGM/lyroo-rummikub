/**
 * Partidas completas jugadas por robots contra la interfaz de verdad.
 *
 * Cada robot abre su propio navegador, lee su atril de la pantalla, decide una
 * jugada con el mismo motor de reglas que usa el servidor, y la ejecuta tocando
 * fichas como haría una persona. Después comprueba invariantes que ninguna
 * partida legítima puede romper: que las fichas se conservan, que todos ven el
 * mismo turno, que nunca se rechaza una jugada que el motor daba por buena y
 * que no salta ningún error en la consola.
 *
 * Es la prueba que encuentra lo que no se ve mirando una pantalla: desincronías
 * entre jugadores, estados imposibles y errores que solo aparecen en la partida
 * número siete.
 *
 *   npm run test:bots            una partida de tres
 *   PARTIDAS=5 npm run test:bots  cinco seguidas
 */

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { readSet, setValue } from "../src/engine/sets";
import { buildDeck } from "../src/engine/tiles";
import type { TileId } from "../src/engine/types";

const PARTIDAS = Number(process.env["PARTIDAS"] ?? 1);
const JUGADORES = ["Ada", "Blas", "Ciro", "Dora"].slice(
  0,
  Math.max(2, Number(process.env["JUGADORES"] ?? 3)),
);
/** Tope de turnos: una partida de verdad no llega ni de lejos. */
const TURNOS_MAXIMOS = 400;

type Robot = {
  readonly nombre: string;
  readonly contexto: BrowserContext;
  readonly pagina: Page;
};

type Mesa = {
  /** Cada combinación de la mesa, con los ids de sus fichas. */
  readonly board: TileId[][];
  readonly rack: TileId[];
  readonly esMiTurno: boolean;
  readonly heAbierto: boolean;
  readonly pozo: number;
  readonly fichasDeCadaUno: number[];
  readonly terminada: boolean;
  readonly turnoDe: string | null;
};

/** Lee de la pantalla todo lo que el robot necesita para decidir. */
async function mirar(pagina: Page): Promise<Mesa> {
  return pagina.evaluate(() => {
    const leerFichas = (raiz: Element | null): string[] =>
      raiz
        ? [...raiz.querySelectorAll<HTMLElement>(".tile[data-tile]")].map(
            (nodo) => nodo.dataset["tile"]!,
          )
        : [];

    const bandejas = [
      ...document.querySelectorAll(".felt__sets .tray:not(.tray--new)"),
    ];
    const asientos = [...document.querySelectorAll(".seat")];
    const miAsiento = asientos.find((s) => s.textContent?.includes("(tú)"));
    const turno = document.querySelector(".seat--turn");

    const numero = (texto: string | null | undefined) => {
      const encontrado = /(\d+)/.exec(texto ?? "");
      return encontrado ? Number(encontrado[1]) : 0;
    };

    return {
      board: bandejas.map((bandeja) => leerFichas(bandeja)),
      rack: leerFichas(document.querySelector(".rack__ledge")),
      esMiTurno: Boolean(miAsiento && turno && miAsiento === turno),
      heAbierto: !document.querySelector(".opening"),
      pozo: numero(document.querySelector(".bar__pool")?.textContent),
      fichasDeCadaUno: asientos.map((s) =>
        numero(s.querySelector(".seat__count")?.textContent),
      ),
      terminada: Boolean(document.querySelector(".score")),
      turnoDe: turno?.querySelector(".seat__name")?.textContent ?? null,
    };
  });
}

// --- Decidir la jugada ----------------------------------------------------

type Jugada =
  | { readonly tipo: "abrir"; readonly sets: TileId[][] }
  | { readonly tipo: "bajar"; readonly set: TileId[] }
  | { readonly tipo: "ampliar"; readonly bandeja: number; readonly ficha: TileId };

/**
 * Busca algo que jugar. No pretende jugar bien: pretende ejercitar el juego
 * —abrir, bajar combinaciones y añadir fichas a la mesa— sin hacer trampas.
 *
 * Nada de probar todas las combinaciones posibles: un atril de cuarenta fichas
 * tiene ochocientas mil de cinco, y el robot se quedaba pensando más que
 * jugando. Se agrupa por número y por color, que es como lo mira una persona.
 */
function decidir(mesa: Mesa, puntosParaAbrir: number): Jugada | null {
  if (!mesa.heAbierto) {
    const apertura = buscarApertura(mesa.rack, puntosParaAbrir);
    return apertura ? { tipo: "abrir", sets: apertura } : null;
  }

  // Añadir una ficha a algo que ya está en la mesa es la jugada que más código
  // toca: recoloca la mesa y pasa por la regla del comodín.
  for (const [indice, bandeja] of mesa.board.entries()) {
    for (const ficha of mesa.rack) {
      if (readSet([...bandeja, ficha]).length > 0) {
        return { tipo: "ampliar", bandeja: indice, ficha };
      }
    }
  }

  const combinacion = buscarCombinaciones(mesa.rack)[0];
  return combinacion ? { tipo: "bajar", set: combinacion } : null;
}

type Ficha = { id: TileId; color: string; valor: number; comodin: boolean };

function leer(id: TileId): Ficha {
  if (id.startsWith("j_")) return { id, color: "j", valor: 0, comodin: true };
  const trozos = /^([rbko])(\d{1,2})_/.exec(id);
  return {
    id,
    color: trozos?.[1] ?? "?",
    valor: Number(trozos?.[2] ?? 0),
    comodin: false,
  };
}

/**
 * Todas las combinaciones que salen del atril, de la más valiosa a la menos.
 * Se buscan grupos (mismo número, colores distintos) y escaleras (mismo color,
 * números seguidos), usando comodines solo cuando hacen falta.
 */
function buscarCombinaciones(rack: readonly TileId[]): TileId[][] {
  const fichas = rack.map(leer);
  const comodines = fichas.filter((f) => f.comodin).map((f) => f.id);
  const numeradas = fichas.filter((f) => !f.comodin);
  const encontradas: TileId[][] = [];

  // Grupos: por número, un color de cada.
  const porValor = new Map<number, Ficha[]>();
  for (const ficha of numeradas) {
    const lista = porValor.get(ficha.valor) ?? [];
    if (!lista.some((otra) => otra.color === ficha.color)) lista.push(ficha);
    porValor.set(ficha.valor, lista);
  }
  for (const [, lista] of porValor) {
    if (lista.length >= 3) encontradas.push(lista.slice(0, 4).map((f) => f.id));
    else if (lista.length === 2 && comodines.length > 0) {
      encontradas.push([...lista.map((f) => f.id), comodines[0]!]);
    }
  }

  // Escaleras: por color, números seguidos sin repetir.
  const porColor = new Map<string, Ficha[]>();
  for (const ficha of numeradas) {
    const lista = porColor.get(ficha.color) ?? [];
    if (!lista.some((otra) => otra.valor === ficha.valor)) lista.push(ficha);
    porColor.set(ficha.color, lista);
  }
  for (const [, lista] of porColor) {
    lista.sort((a, b) => a.valor - b.valor);
    let tramo: Ficha[] = [];
    for (const ficha of lista) {
      const anterior = tramo[tramo.length - 1];
      if (anterior && ficha.valor === anterior.valor + 1) tramo.push(ficha);
      else {
        if (tramo.length >= 3) encontradas.push(tramo.map((f) => f.id));
        tramo = [ficha];
      }
    }
    if (tramo.length >= 3) encontradas.push(tramo.map((f) => f.id));
  }

  // Solo se devuelve lo que el motor da por bueno: el robot no se salta reglas.
  return encontradas
    .filter((conjunto) => readSet(conjunto).length > 0)
    .sort((a, b) => setValue(b) - setValue(a));
}

function buscarApertura(rack: TileId[], minimo: number): TileId[][] | null {
  const posibles = buscarCombinaciones(rack).map((tiles) => ({
    tiles,
    valor: setValue(tiles),
  }));

  const sola = posibles.find((p) => p.valor >= minimo);
  if (sola) return [sola.tiles];

  for (const primera of posibles) {
    for (const segunda of posibles) {
      if (primera === segunda) continue;
      if (primera.valor + segunda.valor < minimo) continue;
      if (primera.tiles.some((ficha) => segunda.tiles.includes(ficha))) continue;
      return [primera.tiles, segunda.tiles];
    }
  }
  return null;
}

// --- Ejecutar la jugada tocando la pantalla -------------------------------

async function tocar(pagina: Page, selector: string): Promise<boolean> {
  const objetivo = pagina.locator(selector).first();
  if ((await objetivo.count()) === 0) return false;
  try {
    await objetivo.scrollIntoViewIfNeeded({ timeout: 800 });
    await objetivo.click({ timeout: 1200 });
    return true;
  } catch {
    return false;
  }
}

const enAtril = (ficha: TileId) => `.rack__ledge .tile[data-tile="${ficha}"]`;
const bandeja = (indice: number) =>
  `.felt__sets .tray:not(.tray--new) >> nth=${indice}`;

async function ejecutar(pagina: Page, jugada: Jugada): Promise<boolean> {
  if (jugada.tipo === "ampliar") {
    if (!(await tocar(pagina, enAtril(jugada.ficha)))) return false;
    return tocar(pagina, bandeja(jugada.bandeja));
  }

  const sets = jugada.tipo === "abrir" ? jugada.sets : [jugada.set];
  for (const conjunto of sets) {
    const yaHabia = await pagina
      .locator(".felt__sets .tray:not(.tray--new)")
      .count();
    for (const [posicion, ficha] of conjunto.entries()) {
      if (!(await tocar(pagina, enAtril(ficha)))) return false;
      const destino = posicion === 0 ? ".tray--new" : bandeja(yaHabia);
      if (!(await tocar(pagina, destino))) return false;
    }
  }
  return true;
}

// --- Invariantes ----------------------------------------------------------

/**
 * Las fichas no se crean ni se destruyen: las de la mesa, más las de todos los
 * atriles, más las del pozo, tienen que sumar siempre el mazo entero.
 */
function comprobarConservacion(mesa: Mesa, mazo: number, contexto: string): void {
  const enMesa = mesa.board.reduce((total, b) => total + b.length, 0);
  const enAtriles = mesa.fichasDeCadaUno.reduce((total, n) => total + n, 0);
  expect(
    enMesa + enAtriles + mesa.pozo,
    `${contexto}: mesa ${enMesa} + atriles ${enAtriles} + pozo ${mesa.pozo}`,
  ).toBe(mazo);
}

/**
 * La mesa cabe siempre en su hueco.
 *
 * Las fichas encogen conforme se llena el tapete, y si el cálculo se queda
 * corto las últimas combinaciones quedan cortadas por abajo, donde nadie las
 * ve. Con una partida avanzada es el fallo más fácil de colar.
 */
async function comprobarQueCabe(pagina: Page, contexto: string): Promise<void> {
  const mirar = () => pagina.evaluate(() => {
    const felt = document.querySelector(".felt");
    const ficha = document.querySelector<HTMLElement>(".felt__sets .tile");
    if (!felt) return null;
    const caja = ficha?.getBoundingClientRect();
    return {
      alto: felt.scrollHeight,
      visible: felt.clientHeight,
      ancho: felt.scrollWidth,
      visibleAncho: felt.clientWidth,
      alcanzable: getComputedStyle(felt).overflowY !== "hidden",
      proporcion: caja && caja.width > 0 ? caja.height / caja.width : null,
    };
  });

  let medidas = await mirar();
  if (!medidas) return;
  // La mesa tarda un instante en recolocarse tras cada jugada; solo cuenta
  // como fallo si sigue sin caber cuando se ha asentado.
  if (medidas.alto > medidas.visible + 1) {
    await pagina.waitForTimeout(400);
    medidas = (await mirar()) ?? medidas;
  }

  // Que no quepa es tolerable si se puede desplazar; lo que no vale es que
  // quede cortada y no haya forma de llegar a ella.
  if (medidas.alto > medidas.visible + 1) {
    expect(
      medidas.alcanzable,
      `${contexto}: la mesa queda cortada y no se puede desplazar`,
    ).toBe(true);
  }
  expect(
    medidas.ancho,
    `${contexto}: la mesa se sale por un lado`,
  ).toBeLessThanOrEqual(medidas.visibleAncho + 1);

  if (medidas.proporcion !== null) {
    // Las fichas encogen enteras: si solo encogiera el ancho, dejarían de
    // caber a lo alto aunque la cuenta dijera que sí.
    expect(
      medidas.proporcion,
      `${contexto}: la ficha ha perdido su proporción`,
    ).toBeCloseTo(1.38, 1);
  }
}

/** Nadie puede tener una ficha repetida ni compartirla con la mesa. */
function comprobarSinDuplicados(mesa: Mesa, contexto: string): void {
  const todas = [...mesa.board.flat(), ...mesa.rack];
  expect(new Set(todas).size, `${contexto}: fichas repetidas`).toBe(todas.length);
}

// --- La partida -----------------------------------------------------------

async function sentar(
  navegador: Browser,
  nombre: string,
  url: string,
  errores: string[],
): Promise<Robot> {
  const contexto = await navegador.newContext({
    viewport: { width: 900, height: 420 },
  });
  const pagina = await contexto.newPage();
  pagina.on("pageerror", (error) =>
    errores.push(`${nombre}: ${String(error).slice(0, 200)}`),
  );
  pagina.on("console", (mensaje) => {
    if (mensaje.type() === "error") {
      const texto = mensaje.text();
      // El navegador avisa de recursos que no cargan en local; no es del juego.
      if (!texto.includes("Failed to load resource")) {
        errores.push(`${nombre}: ${texto.slice(0, 200)}`);
      }
    }
  });
  await pagina.goto(url);
  await pagina.getByPlaceholder("Tu nombre").fill(nombre);
  await pagina.getByRole("button", { name: "Sentarme a la mesa" }).click();
  return { nombre, contexto, pagina };
}

test.describe("robots jugando", () => {
  test(`juegan ${PARTIDAS} ${PARTIDAS === 1 ? "partida" : "partidas"} enteras`, async ({
    browser,
  }) => {
    test.setTimeout(60_000 + PARTIDAS * 240_000);

    for (let partida = 1; partida <= PARTIDAS; partida++) {
      const errores: string[] = [];
      const robots: Robot[] = [];

      const anfitrion = await browser.newContext({
        viewport: { width: 900, height: 420 },
      });
      const primera = await anfitrion.newPage();
      primera.on("pageerror", (error) =>
        errores.push(`${JUGADORES[0]}: ${String(error).slice(0, 200)}`),
      );
      await primera.goto("/");
      await primera.getByRole("button", { name: "Crear mesa" }).click();
      await primera.waitForURL(/\/g\/[A-Z0-9]{6}$/);
      const codigo = primera.url().split("/g/")[1]!;
      await primera.getByPlaceholder("Tu nombre").fill(JUGADORES[0]!);
      await primera.getByRole("button", { name: "Sentarme a la mesa" }).click();
      robots.push({ nombre: JUGADORES[0]!, contexto: anfitrion, pagina: primera });

      for (const nombre of JUGADORES.slice(1)) {
        robots.push(await sentar(browser, nombre, `/g/${codigo}`, errores));
      }

      // Repartir antes de que entren todos dejaría fuera a quien llegue tarde:
      // el anfitrión ve el número en el botón, y aquí se espera a la mesa llena.
      await expect(primera.locator(".lobby__list li")).toHaveCount(robots.length, {
        timeout: 20_000,
      });

      // Turnos cortos: si un robot se atasca, el reloj destraba la partida.
      await primera
        .getByRole("group", { name: "Tiempo por turno" })
        .getByRole("button", { name: "30s" })
        .click();
      await primera
        .getByRole("button", { name: `Repartir a ${robots.length}` })
        .click();

      for (const robot of robots) {
        await expect(robot.pagina.locator(".rack__ledge .tile")).toHaveCount(14, {
          timeout: 15_000,
        });
      }

      const mazo = buildDeck(robots.length).length;
      let turnos = 0;
      let jugadas = 0;
      let robos = 0;
      let rechazos = 0;
      const limite = Date.now() + 180_000;

      while (turnos < TURNOS_MAXIMOS && Date.now() < limite) {
        if (await robots[0]!.pagina.locator(".score").count()) break;

        // ¿A quién le toca? Se pregunta a cada uno por su propia pantalla.
        let deQuien: Robot | null = null;
        for (const robot of robots) {
          const puede = await robot.pagina
            .getByRole("button", { name: "Robar" })
            .isEnabled({ timeout: 400 })
            .catch(() => false);
          if (puede) {
            deQuien = robot;
            break;
          }
        }
        if (!deQuien) {
          await robots[0]!.pagina.waitForTimeout(60);
          continue;
        }


        const arranque = Date.now();
        const mesa = await mirar(deQuien.pagina);
        const trasMirar = Date.now();
        comprobarConservacion(mesa, mazo, `partida ${partida}, turno ${turnos}`);
        comprobarSinDuplicados(mesa, `partida ${partida}, turno ${turnos}`);
        await comprobarQueCabe(deQuien.pagina, `partida ${partida}, turno ${turnos}`);

        const jugada = decidir(mesa, 30);
        const trasDecidir = Date.now();
        let jugado = false;

        if (jugada) {
          jugado = await ejecutar(deQuien.pagina, jugada);
          if (jugado) {
            const confirmar = deQuien.pagina.getByRole("button", {
              name: "Confirmar",
            });
            if (await confirmar.isEnabled({ timeout: 400 }).catch(() => false)) {
              await confirmar.click();
              // El motor dijo que la jugada valía: el servidor no puede
              // llevarle la contraria.
              await deQuien.pagina.waitForTimeout(120);
              const rechazo = (await deQuien.pagina.locator(".notice").count())
                ? await deQuien.pagina.locator(".notice").textContent()
                : null;
              if (rechazo) {
                rechazos += 1;
                errores.push(
                  `jugada legal rechazada (${jugada.tipo}): ${rechazo.trim()}`,
                );
              }
              jugadas += 1;
            } else {
              jugado = false;
            }
          }
        }

        if (!jugado) {
          const robar = deQuien.pagina.getByRole("button", { name: "Robar" });
          if (await robar.isEnabled({ timeout: 400 }).catch(() => false)) {
            await robar.click();
            robos += 1;
          }
        }
        turnos += 1;
        if (turnos % 10 === 0) {
          console.log(
            `  turno ${turnos}: ${deQuien.nombre} pozo ${mesa.pozo} mesa ${mesa.board.length} ` +
              `atril ${mesa.rack.length} | mirar ${trasMirar - arranque}ms ` +
              `decidir ${trasDecidir - trasMirar}ms actuar ${Date.now() - trasDecidir}ms ` +
              `(${jugado ? jugada?.tipo : "robar"})`,
          );
        }
      }

      console.log(
        `partida ${partida}: fin del bucle tras ${turnos} turnos ` +
          `(${jugadas} jugadas, ${robos} robos)`,
      );

      // Al acabar, todos tienen que contar la misma historia.
      await robots[0]!.pagina.waitForTimeout(1200);
      const finales = await Promise.all(robots.map((r) => mirar(r.pagina)));
      const pozos = new Set(finales.map((m) => m.pozo));
      expect(pozos.size, `partida ${partida}: los jugadores ven pozos distintos`).toBe(1);

      const turnosVistos = new Set(finales.map((m) => m.turnoDe));
      expect(
        turnosVistos.size,
        `partida ${partida}: no coinciden en de quién es el turno`,
      ).toBe(1);

      expect(errores, `partida ${partida}`).toEqual([]);
      expect(rechazos, `partida ${partida}: jugadas legales rechazadas`).toBe(0);
      expect(
        jugadas,
        `partida ${partida}: los robots no llegaron a bajar ninguna ficha`,
      ).toBeGreaterThan(0);

      console.log(
        `partida ${partida}: ${turnos} turnos, ${jugadas} jugadas, ${robos} robos, ` +
          `${finales[0]!.terminada ? "terminada" : "sin terminar"}`,
      );

      for (const robot of robots) await robot.contexto.close();
    }
  });
});
