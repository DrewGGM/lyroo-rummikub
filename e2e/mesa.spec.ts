/**
 * Una partida de verdad, de punta a punta.
 *
 * Cada jugador usa su propio contexto de navegador —almacenamiento aparte,
 * como dos móviles distintos— contra la aplicación completa: Worker, Durable
 * Object y WebSockets.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { readSet, setValue } from "../src/engine/sets";
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
    await expect(hostPage.locator(".bar__pool strong")).toHaveText("78");

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
      guest.page.getByRole("button", { name: "Espera tu turno" }),
    ).toBeDisabled();

    // Cojo una ficha con un toque y la dejo en una combinación nueva.
    await tap(hostPage.locator(".rack__ledge .tile").first());
    await expect(hostPage.locator(".tile--picked")).toHaveCount(1);
    await tap(hostPage.locator('[data-drop="new"]'));

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
    await hostPage.getByRole("button", { name: "Robar y pasar" }).click();

    await expect(hostPage.locator(".rack__ledge .tile")).toHaveCount(15);
    await expect(hostPage.locator(".seat--turn")).toContainText("Beto");
    await expect(guest.page.locator(".seat--turn")).toContainText("Beto (tú)");
    await expect(guest.page.getByRole("button", { name: "Robar y pasar" })).toBeEnabled();
    await expect(hostPage.locator(".bar__pool strong")).toHaveText("77");

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
              : hostPage.locator('[data-drop="new"]');
          await tap(target);
        }
      }

      await expect(hostPage.locator(".tray--broken")).toHaveCount(0);
      await hostPage.getByRole("button", { name: "Confirmar jugada" }).click();

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
        pages.map((page) => page.getByRole("button", { name: "Robar y pasar" }).isEnabled()),
      );
      const index = playing.indexOf(true);
      if (index < 0) {
        await hostPage.waitForTimeout(50);
        continue;
      }
      await pages[index]!.getByRole("button", { name: "Robar y pasar" }).click();
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
