/**
 * Una partida de verdad, de punta a punta.
 *
 * Cada jugador usa su propio contexto de navegador —almacenamiento aparte,
 * como dos móviles distintos— contra la aplicación completa: Worker, Durable
 * Object y WebSockets.
 */

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { readSet, setValue } from "../src/engine/sets";
import { runAround } from "../src/client/play/arrange";
import type { TileId } from "../src/engine/types";

type Seat = { context: BrowserContext; page: Page };

async function seatPlayer(
  browser: Parameters<typeof test.step>[0] extends never ? never : import("@playwright/test").Browser,
  url: string,
  name: string,
): Promise<Seat> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  await page.getByPlaceholder("Tu nombre").fill(name);
  await page.getByRole("button", { name: "Sentarme a la mesa" }).click();
  return { context, page };
}

/**
 * Un toque en la mesa. El atril y el tapete tienen desplazamiento propio, así
 * que hay que traer el objetivo a la vista antes de tocarlo, igual que haría
 * un dedo.
 */
async function tap(target: import("@playwright/test").Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await target.click();
}

async function createRoom(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Crear mesa" }).click();
  await expect(page).toHaveURL(/\/g\/[A-Z0-9]{6}$/);
  return page.url().split("/g/")[1]!;
}

/** Lee el atril tal y como está pintado en la pantalla. */
async function rackOf(page: Page): Promise<TileId[]> {
  return page.locator(".rack__ledge .tile").evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset["tile"]!),
  );
}

test.describe("portada", () => {
  test("presenta el juego y la apertura de 30", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Monta la mesa");
    await expect(page.locator(".home__tiles .tile")).toHaveCount(3);
    await expect(page.getByText("Para abrir hace falta")).toBeVisible();
  });

  test("avisa si el código no existe", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("¿Te han pasado un código?").fill("ZZZZZZ");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toContainText("no existe");
  });

  test("avisa si el código está mal escrito", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("¿Te han pasado un código?").fill("ABC");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert")).toContainText("6 letras");
  });
});

test.describe("sala", () => {
  test("dos jugadores se ven al entrar y reparten", async ({ browser }) => {
    const host = await browser.newContext();
    const hostPage = await host.newPage();
    const code = await createRoom(hostPage);

    await hostPage.getByPlaceholder("Tu nombre").fill("Ana");
    await hostPage.getByRole("button", { name: "Sentarme a la mesa" }).click();
    await expect(hostPage.locator(".lobby__list")).toContainText("Ana (tú)");
    await expect(hostPage.locator(".lobby__code")).toHaveText(code);

    const guest = await seatPlayer(browser, `/g/${code}`, "Beto");

    const hostList = hostPage.locator(".lobby__list");
    const guestList = guest.page.locator(".lobby__list");
    await expect(hostList).toContainText("Beto");
    await expect(guestList).toContainText("Ana");
    await expect(guestList).toContainText("Beto (tú)");

    // Solo quien crea la mesa reparte.
    await expect(
      guest.page.getByRole("button", { name: /Repartir/ }),
    ).toHaveCount(0);

    await hostPage.getByRole("button", { name: "Repartir a 2" }).click();

    await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(14);
    await expect(guest.page.locator(".rack__ledge .tile")).toHaveCount(14);
    await expect(hostPage.locator(".bar__pool")).toContainText("78");

    await host.close();
    await guest.context.close();
  });

  test("recupera tu sitio y tus fichas al recargar", async ({ browser }) => {
    const host = await browser.newContext();
    const hostPage = await host.newPage();
    const code = await createRoom(hostPage);
    await hostPage.getByPlaceholder("Tu nombre").fill("Ana");
    await hostPage.getByRole("button", { name: "Sentarme a la mesa" }).click();

    const guest = await seatPlayer(browser, `/g/${code}`, "Beto");
    await hostPage.getByRole("button", { name: "Repartir a 2" }).click();
    await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(14);

    const before = await rackOf(hostPage);
    await hostPage.reload();

    await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(14);
    expect(await rackOf(hostPage)).toEqual(before);
    // Y sigue habiendo dos jugadores, no tres.
    await expect(hostPage.locator(".seat")).toHaveCount(2);

    await host.close();
    await guest.context.close();
  });
});

test.describe("turno", () => {
  test("mueve fichas a la mesa, deshace y no deja confirmar una jugada rota", async ({
    browser,
  }) => {
    const host = await browser.newContext();
    const hostPage = await host.newPage();
    const code = await createRoom(hostPage);
    await hostPage.getByPlaceholder("Tu nombre").fill("Ana");
    await hostPage.getByRole("button", { name: "Sentarme a la mesa" }).click();
    const guest = await seatPlayer(browser, `/g/${code}`, "Beto");
    await hostPage.getByRole("button", { name: "Repartir a 2" }).click();
    await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(14);

    // Quien no tiene el turno no puede tocar nada.
    await expect(
      guest.page.getByRole("button", { name: "Espera" }),
    ).toBeDisabled();

    // Cojo una ficha con un toque y la dejo en una combinación nueva.
    await tap(hostPage.locator(".rack__ledge .tile").first());
    await expect(hostPage.locator(".tile--picked")).toHaveCount(1);
    await tap(hostPage.locator(".tray--new"));

    await expect(hostPage.locator(".felt__sets .tray:not(.tray--new)")).toHaveCount(1);
    await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(13);
    // Una ficha suelta no es una combinación: la mesa lo dice y el botón no deja.
    await expect(hostPage.locator(".tray--broken")).toHaveCount(1);
    await expect(
      hostPage.getByRole("button", { name: "Cuadra la mesa" }),
    ).toBeDisabled();

    await hostPage.getByRole("button", { name: "Deshacer" }).click();
    await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(14);
    await expect(hostPage.locator(".felt__sets .tray:not(.tray--new)")).toHaveCount(0);

    // Lo que monto en mi pantalla no lo ve nadie hasta que confirmo.
    await expect(guest.page.locator(".felt__sets .tray")).toHaveCount(0);

    await host.close();
    await guest.context.close();
  });

  test("robar pasa el turno al siguiente", async ({ browser }) => {
    const host = await browser.newContext();
    const hostPage = await host.newPage();
    const code = await createRoom(hostPage);
    await hostPage.getByPlaceholder("Tu nombre").fill("Ana");
    await hostPage.getByRole("button", { name: "Sentarme a la mesa" }).click();
    const guest = await seatPlayer(browser, `/g/${code}`, "Beto");
    await hostPage.getByRole("button", { name: "Repartir a 2" }).click();
    await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(14);

    await expect(hostPage.locator(".seat--turn")).toContainText("Ana");
    await hostPage.getByRole("button", { name: "Robar" }).click();

    await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(15);
    await expect(hostPage.locator(".seat--turn")).toContainText("Beto");
    await expect(guest.page.locator(".seat--turn")).toContainText("Beto (tú)");
    await expect(guest.page.getByRole("button", { name: "Robar" })).toBeEnabled();
    await expect(hostPage.locator(".bar__pool")).toContainText("77");

    await host.close();
    await guest.context.close();
  });

  test("una apertura válida llega a la mesa del otro jugador", async ({ browser }) => {
    // El reparto es aleatorio, así que se abren mesas hasta dar con una mano
    // que pueda abrir con 30 puntos. Es lo que haría cualquiera en la vida real.
    for (let attempt = 0; attempt < 10; attempt++) {
      const host = await browser.newContext();
      const hostPage = await host.newPage();
      const code = await createRoom(hostPage);
      await hostPage.getByPlaceholder("Tu nombre").fill("Ana");
      await hostPage.getByRole("button", { name: "Sentarme a la mesa" }).click();
      const guest = await seatPlayer(browser, `/g/${code}`, "Beto");
      await hostPage.getByRole("button", { name: "Repartir a 2" }).click();
      await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(14);

      const opening = findOpening(await rackOf(hostPage));
      if (!opening) {
        await host.close();
        await guest.context.close();
        continue;
      }

      const laidSets = hostPage.locator(".felt__sets .tray:not(.tray--new)");
      for (const [setIndex, set] of opening.entries()) {
        for (const tile of set) {
          await tap(hostPage.locator(`.rack__ledge .tile[data-tile="${tile}"]`));
          const target =
            setIndex < (await laidSets.count())
              ? laidSets.nth(setIndex)
              : hostPage.locator(".tray--new");
          await tap(target);
        }
      }

      await expect(hostPage.locator(".tray--broken")).toHaveCount(0);
      await hostPage.getByRole("button", { name: "Confirmar" }).click();

      const played = opening.flat().length;
      // La mesa aparece en la pantalla del otro jugador, y el turno pasa.
      await expect(guest.page.locator(".felt__sets .tile")).toHaveCount(played);
      await expect(guest.page.locator(".seat--turn")).toContainText("Beto (tú)");
      await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(14 - played);

      await host.close();
      await guest.context.close();
      return;
    }
    throw new Error("no salió ninguna mano capaz de abrir en 10 repartos");
  });
});

/**
 * Busca una apertura legal de 30 puntos o más en la mano: primero una sola
 * combinación que ya llegue, y si no, dos que sumen entre las dos.
 */
function findOpening(rack: TileId[]): TileId[][] | null {
  const candidates: { tiles: TileId[]; value: number }[] = [];
  for (let size = 3; size <= 5; size++) {
    for (const combo of combinations(rack, size)) {
      if (readSet(combo).length === 0) continue;
      candidates.push({ tiles: combo, value: setValue(combo) });
    }
  }
  candidates.sort((a, b) => b.value - a.value);

  const enough = candidates.find((candidate) => candidate.value >= 30);
  if (enough) return [enough.tiles];

  for (const first of candidates) {
    for (const second of candidates) {
      if (first === second) continue;
      if (first.value + second.value < 30) continue;
      if (first.tiles.some((tile) => second.tiles.includes(tile))) continue;
      return [first.tiles, second.tiles];
    }
  }
  return null;
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [
    ...combinations(rest, size - 1).map((combo) => [head, ...combo]),
    ...combinations(rest, size),
  ];
}

test.describe("final de partida", () => {
  test("se agota el pozo, todos pasan y gana quien menos puntos tiene", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const host = await browser.newContext();
    const hostPage = await host.newPage();
    const code = await createRoom(hostPage);
    await hostPage.getByPlaceholder("Tu nombre").fill("Ana");
    await hostPage.getByRole("button", { name: "Sentarme a la mesa" }).click();
    const guest = await seatPlayer(browser, `/g/${code}`, "Beto");
    await hostPage.getByRole("button", { name: "Repartir a 2" }).click();
    await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(14);

    // Nadie juega nada: se roba hasta vaciar el pozo y después se pasa. Son
    // 78 robos y dos pases con dos jugadores.
    // Entre una jugada y la siguiente hay un instante en que ningún botón está
    // activo, mientras la respuesta del servidor está en camino. El bucle se
    // mide por tiempo, no por vueltas.
    const pages = [hostPage, guest.page];
    const deadline = Date.now() + 120_000;
    let draws = 0;
    while (Date.now() < deadline) {
      if (await hostPage.locator(".score").count()) break;
      const playing = await Promise.all(
        pages.map((page) => page.getByRole("button", { name: "Robar" }).isEnabled()),
      );
      const index = playing.indexOf(true);
      if (index < 0) {
        await hostPage.waitForTimeout(50);
        continue;
      }
      await pages[index]!.getByRole("button", { name: "Robar" }).click();
      draws += 1;
    }
    // 78 robos para vaciar el pozo y dos pases para cerrar la partida.
    expect(draws).toBe(80);

    await expect(hostPage.locator(".score__row")).toHaveCount(2);
    await expect(hostPage.getByText("Se acabó el pozo")).toBeVisible();

    // La puntuación es simétrica: lo que gana uno lo pierde el otro.
    const points = await hostPage
      .locator(".score__points")
      .evaluateAll((nodes) => nodes.map((node) => Number(node.textContent!.replace("+", ""))));
    expect(points[0]! + points[1]!).toBe(0);
    expect(points[0]!).toBeGreaterThan(0);

    // Y la revancha devuelve a la sala con la puntuación intacta.
    await hostPage.getByRole("button", { name: "Otra ronda" }).click();
    await expect(hostPage.locator(".lobby__code")).toHaveText(code);
    await expect(hostPage.locator(".lobby__list li")).toHaveCount(2);

    await host.close();
    await guest.context.close();
  });
});


test.describe("coger la combinación entera", () => {
  test("un dedo que tiembla sigue cogiendo la escalera", async ({ browser }) => {
    // Un dedo apoyado se mueve unos píxeles sin que su dueño lo note. Este
    // test lo imita a propósito: con el umbral del ratón, el gesto se convertía
    // en arrastre de una sola ficha y la pulsación larga no llegaba a saltar.
    for (let intento = 0; intento < 10; intento++) {
      const host = await browser.newContext({ hasTouch: true });
      const hostPage = await host.newPage();
      const code = await createRoom(hostPage);
      await hostPage.getByPlaceholder("Tu nombre").fill("Ana");
      await hostPage.getByRole("button", { name: "Sentarme a la mesa" }).click();
      const guest = await seatPlayer(browser, `/g/${code}`, "Beto");
      await hostPage.getByRole("button", { name: "Repartir a 2" }).click();
      await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(14);

      // Quien empieza sale por sorteo. Si no le toca a esta pantalla, la mesa
      // no admite nada y el gesto no probaria lo que pretende.
      if (!(await hostPage.getByRole("button", { name: "Robar" }).isEnabled())) {
        await host.close();
        await guest.context.close();
        continue;
      }

      const rack = await rackOf(hostPage);
      let cual = -1;
      for (let i = 0; i < rack.length; i++) {
        if (runAround(rack, i).length >= 3) {
          cual = i;
          break;
        }
      }
      if (cual < 0) {
        await host.close();
        await guest.context.close();
        continue;
      }

      const esperado = runAround(rack, cual);
      const ficha = hostPage.locator(`.rack__ledge .tile[data-tile="${rack[cual]}"]`);

      // `hover` espera a que la ficha esté quieta antes de colocar el puntero
      // encima. Calcular las coordenadas a mano fallaba: al repartir, las
      // fichas encogen para que la mesa quepa y se recolocan justo después de
      // medirlas, así que el gesto caía en el hueco entre dos.
      await ficha.hover();
      const caja = (await ficha.boundingBox())!;
      const x = caja.x + caja.width / 2;
      const y = caja.y + caja.height / 2;

      // Eventos táctiles de verdad, no de ratón: el margen que se le da al dedo
      // es distinto del que se le da al puntero, y con el ratón esta prueba no
      // comprobaría nada de lo que le pasa a una mano.
      const cdp = await hostPage.context().newCDPSession(hostPage);
      const dedo = (
        type: "touchStart" | "touchMove" | "touchEnd",
        px: number,
        py: number,
      ) =>
        cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints:
            type === "touchEnd" ? [] : [{ x: px, y: py, radiusX: 12, radiusY: 12 }],
        });

      await dedo("touchStart", x, y);
      // El temblor de una mano apoyada. Nueve o diez píxeles: más de lo que
      // tolera un ratón y menos de lo que debería tolerar un dedo.
      const temblor: [number, number][] = [[6, 5], [-4, 8], [9, -3], [-7, -6]];
      for (const [dx, dy] of temblor) {
        await dedo("touchMove", x + dx, y + dy);
        await hostPage.waitForTimeout(90);
      }
      await hostPage.waitForTimeout(250);

      const cogidas = await hostPage.locator(".tile--picked").count();
      await dedo("touchEnd", x, y);

      expect(cogidas, "fichas que se levantaron juntas").toBe(esperado.length);

      // Y se colocan todas de una vez.
      await hostPage.locator(".tray--new").click();
      await expect(hostPage.locator(".felt__sets .tray:not(.tray--new) .tile")).toHaveCount(
        esperado.length,
      );

      await host.close();
      await guest.context.close();
      return;
    }
    throw new Error("no salió ninguna mano con combinación contigua en 10 repartos");
  });
});

test("fuera de turno el atril es tuyo pero la mesa no se toca", async ({ browser }) => {
  const { esperando, jugando } = await sentarADos(browser);

  // La mesa no admite nada mientras juega otro: la ficha se queda en el atril.
  const cuantas = await esperando.locator(".rack__ledge .tile").count();
  await esperando.locator(".rack__ledge .tile").first().click();
  await esperando.locator(".felt").click({ position: { x: 400, y: 120 } });
  await expect(esperando.locator(".felt .tile")).toHaveCount(0);
  await expect(esperando.locator(".rack__ledge .tile")).toHaveCount(cuantas);

  // El atril sí: es tuyo y no lo ve nadie.
  const antes = await esperando.locator(".rack__ledge .tile").allInnerTexts();
  await esperando.getByRole("button", { name: "Grupos" }).click();
  const despues = await esperando.locator(".rack__ledge .tile").allInnerTexts();
  expect(despues).not.toEqual(antes);
  expect(despues.slice().sort()).toEqual(antes.slice().sort());

  // Y sigue puesto a tu manera cuando el otro juega y llega la novedad: si no,
  // colocarse la mano mientras esperas no serviría de nada.
  await jugando.getByRole("button", { name: "Robar" }).click();
  await expect
    .poll(() => esperando.locator(".rack__ledge .tile").allInnerTexts())
    .toEqual(despues);
});

test("el atril se arrastra fuera de turno", async ({ browser }) => {
  const { esperando } = await sentarADos(browser);

  const fichas = esperando.locator(".rack__ledge .tile");
  const antes = await fichas.allInnerTexts();
  // Arrastrar la última al principio: el gesto, no el botón de ordenar.
  await fichas.last().hover();
  await esperando.mouse.down();
  const destino = (await fichas.first().boundingBox())!;
  await esperando.mouse.move(destino.x + 2, destino.y + destino.height / 2, { steps: 12 });
  await esperando.mouse.up();

  const despues = await fichas.allInnerTexts();
  expect(despues).not.toEqual(antes);
  expect(despues.slice().sort()).toEqual(antes.slice().sort());
});

test("quien mira ve marcado lo que el otro va poniendo", async ({ browser }) => {
  const { jugando, esperando } = await sentarADos(browser);

  // Quien juega baja lo que pueda; basta con que aparezca algo en la mesa.
  const rack = await rackOf(jugando);
  const cual = rack.findIndex((_, i) => runAround(rack, i).length >= 3);
  test.skip(cual < 0, "esta mano no traía ninguna combinación hecha");

  await jugando.locator(`.rack__ledge .tile[data-tile="${rack[cual]}"]`).click({ delay: 500 });
  await jugando.locator(".tray--new").click();
  const bajadas = runAround(rack, cual).length;

  // Quien mira lo ve aparecer, y lo ve marcado: es lo que acaba de ponerse.
  await expect(esperando.locator(".felt__sets .tile")).toHaveCount(bajadas);
  await expect(esperando.locator(".felt__sets .tile--fresh")).toHaveCount(bajadas);
});

test("los últimos segundos se avisan por el borde, y solo a quien juega", async ({
  browser,
}) => {
  // Turno de 30s: se espera a que queden cinco.
  const { jugando, esperando } = await sentarADos(browser);

  await expect(jugando.locator(".room--apremia")).toHaveCount(0);
  await expect(jugando.locator(".room--apremia")).toHaveCount(1, {
    timeout: 30_000,
  });
  // A quien espera no le parpadea nada: no puede hacer nada al respecto.
  await expect(esperando.locator(".room--apremia")).toHaveCount(0);
});

test("la ficha recién robada se ve marcada", async ({ browser }) => {
  const { jugando } = await sentarADos(browser);

  // El reparto trae catorce de golpe: ahí no se marca ninguna.
  await expect(jugando.locator(".rack__ledge .tile--fresh")).toHaveCount(0);

  const antes = await jugando.locator(".rack__ledge .tile").evaluateAll((n) =>
    n.map((e) => e.getAttribute("data-tile")!),
  );
  await jugando.getByRole("button", { name: "Robar" }).click();

  const marcada = jugando.locator(".rack__ledge .tile--fresh");
  await expect(marcada).toHaveCount(1);
  // Y la marcada es justo la que no estaba antes.
  const cual = await marcada.getAttribute("data-tile");
  expect(antes).not.toContain(cual);
});

test("el brillo de la robada se apaga solo", async ({ browser }) => {
  const { jugando } = await sentarADos(browser);
  await jugando.getByRole("button", { name: "Robar" }).click();
  await expect(jugando.locator(".rack__ledge .tile--fresh")).toHaveCount(1);
  // A los pocos segundos deja de avisar: ya sabes cuál es.
  await expect(jugando.locator(".rack__ledge .tile--fresh")).toHaveCount(0, {
    timeout: 8000,
  });
});

test("ordenar deja las jugadas armadas y separadas al principio", async ({
  browser,
}) => {
  const { jugando } = await sentarADos(browser);
  for (const modo of ["Grupos", "Escaleras"]) {
    await jugando.getByRole("button", { name: modo }).click();
    await jugando.waitForTimeout(250);

    const fichas = await jugando.locator(".rack__ledge .tile").evaluateAll((n) =>
      n.map((e) => e.getAttribute("data-tile")!),
    );
    const huecos = await jugando.locator(".rack__gap").count();
    if (huecos === 0) continue; // esta mano no traía ninguna jugada

    // El primer hueco marca dónde acaba lo jugable, y lo de delante vale.
    const corte = await jugando.locator(".rack__ledge > *").evaluateAll((n) =>
      n.findIndex((e) => e.classList.contains("rack__gap")),
    );
    expect(corte).toBeGreaterThanOrEqual(3);
    expect(readSet(fichas.slice(0, corte) as TileId[]).length).toBeGreaterThan(0);
  }
});

/** Deja una mesa de dos empezada y dice a quién le toca. */
async function sentarADos(browser: Browser) {
  const uno = await (await browser.newContext({ viewport: HORIZONTAL })).newPage();
  await uno.goto("/");
  await uno.getByRole("button", { name: "Crear mesa" }).click();
  await uno.waitForURL(/\/g\/[A-Z0-9]{6}$/);
  const codigo = uno.url().split("/g/")[1]!;
  await uno.getByPlaceholder("Tu nombre").fill("Andrew");
  await uno.getByRole("button", { name: "Sentarme a la mesa" }).click();

  const dos = await (await browser.newContext({ viewport: HORIZONTAL })).newPage();
  await dos.goto(`/g/${codigo}`);
  await dos.getByPlaceholder("Tu nombre").fill("Beatriz");
  await dos.getByRole("button", { name: "Sentarme a la mesa" }).click();
  await uno.getByRole("button", { name: "Repartir a 2" }).click();

  // Antes de preguntar por el turno hay que esperar al reparto: preguntarle a
  // un botón que todavía no existe se queda esperando hasta que expira todo.
  for (const quien of [uno, dos]) {
    await expect(quien.locator(".rack__ledge .tile")).toHaveCount(14, {
      timeout: 20_000,
    });
  }

  const leToca = await uno.getByRole("button", { name: "Robar" }).isEnabled();
  return { jugando: leToca ? uno : dos, esperando: leToca ? dos : uno };
}

test("la combinación bajada se lleva entera a otra fila", async ({ browser }) => {
  // Mover un grupo de fila no hacia nada cuando la de origen se quedaba vacia:
  // al desaparecer, las de despues se corrian un puesto y el destino apuntaba
  // a la nada. Esto lo comprueba con el gesto de verdad, no con la funcion.
  for (let intento = 0; intento < 10; intento++) {
    const host = await browser.newContext({ hasTouch: true });
    const hostPage = await host.newPage();
    const code = await createRoom(hostPage);
    await hostPage.getByPlaceholder("Tu nombre").fill("Ana");
    await hostPage.getByRole("button", { name: "Sentarme a la mesa" }).click();
    const guest = await seatPlayer(browser, `/g/${code}`, "Beto");
    await hostPage.getByRole("button", { name: "Repartir a 2" }).click();
    await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(14);

    const rack = await rackOf(hostPage);
    const leToca = await hostPage.getByRole("button", { name: "Robar" }).isEnabled();
    const cual = leToca ? rack.findIndex((_, i) => runAround(rack, i).length >= 3) : -1;
    if (cual < 0) {
      await host.close();
      await guest.context.close();
      continue;
    }
    const esperado = runAround(rack, cual);

    // Una sola pulsación larga y se levantan todas las que cumplen regla.
    await hostPage
      .locator(`.rack__ledge .tile[data-tile="${rack[cual]}"]`)
      .click({ delay: 500 });
    await expect(hostPage.locator(".tile--picked")).toHaveCount(esperado.length);
    await hostPage.locator(".tray--new").click();
    await expect(hostPage.locator(".felt__sets .tray:not(.tray--new) .tile")).toHaveCount(
      esperado.length,
    );

    // Y ya en la mesa, la combinación entera se lleva a otra fila de un gesto.
    await hostPage
      .locator(`.felt__sets .tile[data-tile="${esperado[0]}"]`)
      .click({ delay: 500 });
    await expect(hostPage.locator(".tile--picked")).toHaveCount(esperado.length);
    await hostPage.locator(".tray--new").click();

    // La fila vieja desaparece al vaciarse y las fichas siguen siendo las
    // mismas: ni se pierden ni se quedan a medio camino.
    await expect(
      hostPage.locator(".felt__sets .tray:not(.tray--new)"),
    ).toHaveCount(1);
    await expect(hostPage.locator(".felt__sets .tray:not(.tray--new) .tile")).toHaveCount(
      esperado.length,
    );

    await host.close();
    await guest.context.close();
    return;
  }
  test.skip(true, "ninguna mano de diez repartos traía una combinación hecha");
});

const HORIZONTAL = { width: 900, height: 420 };
