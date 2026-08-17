/**
 * Mantener la aplicación al día.
 *
 * Instalada como PWA nadie cierra nunca la pestaña, así que una versión vieja
 * podría quedarse jugando meses. El service worker se actualiza solo, y aquí se
 * comprueba además cada vez que vuelves a la aplicación, que es cuando importa
 * y cuando no molesta.
 */

import { registerSW } from "virtual:pwa-register";

const CHECK_EVERY_MS = 60 * 60 * 1000;

export function keepFresh(): void {
  if (!("serviceWorker" in navigator)) return;

  const update = registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;

      const look = () => {
        // No tiene sentido buscar versiones nuevas sin conexión.
        if (navigator.onLine) void registration.update();
      };

      setInterval(look, CHECK_EVERY_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") look();
      });
    },
    onNeedRefresh() {
      // Recargar en mitad de una jugada sería una faena. La versión nueva entra
      // sola la próxima vez que se abra la aplicación.
    },
  });

  void update;
}
