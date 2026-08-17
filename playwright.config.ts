import { defineConfig, devices } from "@playwright/test";

/**
 * Las pruebas de extremo a extremo levantan la aplicación entera —Worker,
 * Durable Object y navegador— y juegan una partida real entre dos pestañas.
 */
/**
 * Con `MESA_URL` apuntando a un despliegue, las mismas pruebas sirven de
 * comprobación en producción: se saltan el servidor local y juegan contra lo
 * que hay publicado.
 */
const desplegada = process.env["MESA_URL"];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "list" : [["list"], ["html", { open: "never" }]],
  timeout: desplegada ? 120_000 : 45_000,
  expect: { timeout: desplegada ? 20_000 : 10_000 },
  use: {
    baseURL: desplegada ?? "http://localhost:5173",
    trace: "retain-on-failure",
    ...devices["Pixel 7"],
  },
  ...(desplegada
    ? {}
    : {
        webServer: {
          command: "npm run dev -- --port 5173 --strictPort",
          url: "http://localhost:5173",
          reuseExistingServer: !process.env["CI"],
          timeout: 120_000,
        },
      }),
});
