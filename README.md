# Mesa de Rummikub

**[rummikub.andrewgarcia.dev](https://rummikub.andrewgarcia.dev)**

Rummikub multijugador en el navegador, de 2 a 8 jugadores. Creas una mesa,
compartes el enlace y jugáis. Sin cuentas, sin instalar nada.

Todo corre sobre Cloudflare y cabe entero en el plan gratuito.

## Cómo se juega

1. Alguien pulsa **Crear mesa** y comparte el enlace `…/g/ABC7K2`.
2. Cada persona escribe su nombre y entra.
3. Quien creó la mesa reparte cuando estén todos.
4. En tu turno montas la jugada en tu pantalla —arrastrando fichas o tocando
   origen y destino— y pulsas **Confirmar jugada**. Hasta ese momento nadie ve
   lo que estás probando.
5. Gana quien se queda sin fichas. Si el pozo se agota y todos pasan, gana quien
   menos puntos tenga en el atril.

Tu primera jugada tiene que sumar **30 puntos** usando solo tus fichas, sin tocar
lo que ya hay en la mesa. Después ya puedes recolocar la mesa entera.

## Reglas de mesa

Se juega con las reglas oficiales (versión Sabra), con dos decisiones tomadas
explícitamente:

- **El comodín está protegido.** Mientras un comodín esté en una combinación, esa
  combinación solo admite fichas nuevas: no se puede romper ni reordenar. Para
  recuperarlo hay que sustituirlo por la ficha exacta que representa. Como una
  combinación con comodines admite varias lecturas, el servidor acepta la jugada
  si alguna de ellas la justifica.
- **Al acabarse el tiempo se roba y se pasa.** El servidor no sabe qué estabas
  montando —eso vive solo en tu pantalla—, así que la mesa no se toca.

### Fichas según cuántos seáis

El Rummikub estándar es de 2 a 4 jugadores. La edición oficial *Six Player*
sube a 160 fichas. Para 7 u 8 no existe caja oficial, así que se extiende la
misma progresión:

| Jugadores | Copias de cada ficha | Comodines | Total | Pozo tras repartir |
| --------- | -------------------- | --------- | ----- | ------------------ |
| 2–4       | 2                    | 2         | 106   | 78 a 50            |
| 5–6       | 3                    | 4         | 160   | 90 a 76            |
| 7–8       | 4                    | 6         | 214   | 116 a 102          |

Se reparten 14 fichas a cada persona, como siempre.

> Con ocho jugadores y turnos de 60 segundos puedes esperar siete minutos entre
> jugada y jugada. Por eso el temporizador se puede bajar a 30 segundos, y por
> eso las mesas de cuatro siguen siendo las que mejor funcionan.

## Cómo está montado

```
Navegador ──HTTPS/WebSocket──► Worker ──► Durable Object (una sala = un objeto)
   React                       rutas       estado, reglas, turnos, SQLite
```

- **Un Durable Object por partida.** Cada sala tiene su propio objeto con su
  estado y su base de datos. Miles de partidas no se rozan entre ellas.
- **El servidor es el árbitro.** El cliente manda intenciones («quiero dejar la
  mesa así»), nunca hechos. El servidor comprueba que las fichas cuadran
  exactamente, que solo han salido fichas de tu atril, que toda combinación es
  legal y que se respetan la apertura de 30 y el comodín. No existe ningún
  mensaje capaz de meter en juego una ficha que no tienes.
- **Cada quien ve lo suyo.** El servidor manda a cada jugador su atril completo
  y, de los demás, solo cuántas fichas tienen. Abrir las herramientas de
  desarrollo no revela nada.
- **La sala hiberna entre jugada y jugada.** Los WebSockets siguen abiertos en la
  red de Cloudflare mientras el objeto duerme; despierta con el siguiente
  mensaje. Es lo que hace que la factura sea cero.

El motor de reglas (`src/engine/`) es código puro: sin React, sin Cloudflare, sin
relojes. Recibe estado y devuelve estado. Por eso se puede probar una partida
entera en milisegundos.

## Lo que cuesta

Todo dentro del plan gratuito de Cloudflare:

| Recurso                                  | Límite gratis    |
| ---------------------------------------- | ---------------- |
| Peticiones al Worker                     | 100.000 / día    |
| Ficheros estáticos                       | gratis, sin tope |
| Peticiones al Durable Object             | 100.000 / día    |
| Tiempo de cómputo del objeto             | 13.000 GB-s/día  |
| SQLite                                   | 5 GB             |

Una partida de seis jugadores consume del orden de 600 peticiones entre
conexiones, jugadas y avisos del temporizador. Es decir, unas **150 partidas al
día** sin pagar nada. El cuello de botella son las peticiones al objeto, no el
cómputo ni el almacenamiento.

Crear salas está limitado a 30 por minuto y dirección de origen, porque es lo
único que consume presupuesto sin que nadie llegue a jugar.

## Desarrollo

```bash
npm install
npm run dev          # aplicación completa en http://localhost:5173
```

`npm run dev` levanta el Worker y el Durable Object en el runtime real de
Cloudflare, no en una imitación, así que lo que ves en local es lo que se
despliega.

```bash
npm test             # motor de reglas
npm run test:worker  # sala, WebSockets, alarmas e hibernación
npm run test:all     # ambos
npm run test:e2e     # partida real entre dos navegadores
npm run typecheck
```

## Desplegar

```bash
npx wrangler login
npm run deploy
```

El dominio propio está declarado en `wrangler.jsonc` como custom domain, así que
el despliegue crea el registro DNS y el certificado por su cuenta. El subdominio
de `workers.dev` se mantiene activo como respaldo.

Para comprobar que lo publicado funciona, las mismas pruebas de navegador se
pueden lanzar contra el despliegue:

```bash
MESA_URL=https://rummikub.andrewgarcia.dev npm run test:e2e
```

## Mapa del código

```
src/
├── engine/      Reglas del Rummikub. Puro, sin dependencias.
│   ├── tiles.ts     Mazos, barajado sembrado, reparto
│   ├── sets.ts      Grupos, escaleras y lecturas del comodín
│   ├── board.ts     Validación de una jugada completa
│   └── game.ts      Estado de la partida y sus transiciones
├── protocol/    Mensajes y la vista recortada que ve cada jugador
├── worker/      Rutas y el Durable Object de la sala
└── client/      React: pantallas, fichas, arrastre y conexión
```
