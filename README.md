# Mesa de Rummikub

**[rummikub.andrewgarcia.dev](https://rummikub.andrewgarcia.dev)**

Rummikub multijugador en el navegador, de 2 a 8 jugadores. Creas una mesa,
compartes el enlace y jugáis. Sin cuentas, sin instalar nada.

Todo corre sobre Cloudflare y cabe entero en el plan gratuito.

## Cómo se juega

1. Alguien pulsa **Crear mesa** y comparte el enlace `…/g/ABC7K2`.
2. Cada persona escribe su nombre y entra.
3. Quien creó la mesa reparte cuando estén todos.
4. En tu turno montas la jugada en tu pantalla y pulsas **Confirmar**. Puedes
   arrastrar, tocar origen y destino, o **dejar pulsada** una ficha para coger
   de una vez la escalera entera que tenga al lado.
5. Gana quien se queda sin fichas. Si el pozo se agota y todos pasan, gana quien
   menos puntos tenga en el atril.

Tu primera jugada tiene que sumar **30 puntos** usando solo tus fichas, sin tocar
lo que ya hay en la mesa. Después ya puedes recolocar la mesa entera.

## Reglas de mesa

Antes de repartir, quien crea la mesa elige la variante: **tiempo por turno**
(30, 60, 90, 120 segundos o sin reloj), **puntos para abrir** (25, 30 o 50),
**fichas al repartir** (14 o 16) y si el **comodín** va protegido o libre.

Los valores por defecto son los oficiales (versión Sabra), con dos decisiones
tomadas explícitamente:

- **El comodín está protegido.** Mientras un comodín esté en una combinación, esa
  combinación solo admite fichas nuevas: no se puede romper ni reordenar. Para
  recuperarlo hay que sustituirlo por la ficha exacta que representa. Como una
  combinación con comodines admite varias lecturas, el servidor acepta la jugada
  si alguna de ellas la justifica.
- **Al acabarse el tiempo se roba y se pasa.** El servidor no sabe qué estabas
  montando —eso vive solo en tu pantalla—, así que la mesa no se toca.

Mientras alguien recoloca la mesa, los demás lo ven moverse en vivo. Esa vista
previa no se valida ni se guarda: es un reflejo de su pantalla, y el estado
autoritativo la sustituye en cuanto confirma.

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

Medido contra el despliegue real: dos partidas completas de cuatro jugadores
más la batería de pruebas de navegador salen por **480 peticiones**, o sea unas
**200 por partida**. Con gente de verdad sube algo, porque mientras alguien
recoloca la mesa se manda la vista previa a los demás, así que cuenta con
**300-900 por partida** según lo que se manosee el tapete.

Eso deja en el entorno de **100 a 300 partidas al día** sin pagar nada. El
cuello de botella son las peticiones al objeto, no el cómputo ni el
almacenamiento.

Una mesa abandonada cuesta **una sola petición**: despierta a las dos horas,
para borrarse. Conviene que siga siendo así —un objeto que se despierta solo en
bucle vacía el cupo de un día en minutos—, y por eso hay tests que comprueban
que ninguna alarma se programa en el pasado.

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
npm test             # motor de reglas y colocación de fichas
npm run test:worker  # sala, WebSockets, alarmas e hibernación
npm run test:all     # ambos
npm run test:e2e     # partidas reales entre dos navegadores
npm run typecheck
```

### Robots jugando

```bash
npm run test:bots                          # una partida de tres
PARTIDAS=3 JUGADORES=4 npm run test:bots   # tres partidas de cuatro
```

Cada robot abre su propio navegador, lee su atril de la pantalla, decide con el
mismo motor que usa el servidor y juega tocando fichas. Después comprueba lo que
ninguna partida legítima puede romper: que las fichas se conservan, que nadie
tiene una repetida, que todos ven el mismo turno y el mismo pozo, que jamás se
rechaza una jugada que el motor daba por buena, y que no salta ningún error en
consola. Es la prueba que encuentra lo que no se ve mirando una pantalla.

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

## Detalles que cuestan de ver

- **La mesa nunca se desplaza.** Las fichas encogen conforme se llena, con un
  cálculo que simula cómo caen las filas y busca el mayor tamaño que entra
  (`src/client/play/fit.ts`). Hacer scroll mientras juegas es insoportable.
- **Está pensada para horizontal**, que es como se juega de verdad. Ahí los
  jugadores se meten en la barra superior y los botones se ponen al lado del
  atril: en un móvil tumbado el alto es lo único que escasea.
- **Es una PWA**: se instala en la pantalla de inicio, arranca sin conexión y se
  actualiza sola. La partida vive en el servidor, así que ni la API ni el
  WebSocket se cachean jamás.

## Licencia y marcas

El código es mío y se publica bajo la **[PolyForm Noncommercial
1.0.0](LICENSE)**: puedes leerlo, ejecutarlo, modificarlo y redistribuirlo
libremente **para cualquier fin que no sea comercial**. Si quieres usarlo para
ganar dinero, escríbeme y hablamos.

Conviene saber que esa licencia **no es «open source»** en el sentido estricto
de la OSI —ninguna licencia que prohíba el uso comercial lo es—, así que GitHub
la marcará como no estándar. Está elegida a propósito: dice exactamente lo que
quiero decir y está redactada para software, no para obras creativas como las
Creative Commons.

### Sobre el nombre

**Rummikub® es una marca registrada de terceros. Este proyecto no está
afiliado, patrocinado ni respaldado por quienes la poseen.** Los derechos
cambiaron de manos el 1 de abril de 2026: Longshore Limited compró los derechos
mundiales a Lemada Light Industries Ltd. —la empresa de la familia Hertzano,
que publica el juego desde 1975—, pero esa compra **excluye expresamente las
versiones digitales**, además de Israel, Estados Unidos y Canadá.

Lo que hay aquí es una implementación propia, escrita desde cero, de las reglas
del juego. Las reglas de un juego no son de nadie: la [Oficina de Copyright de
Estados Unidos](https://www.copyright.gov/circs/circ33.pdf) es explícita en que
el copyright no protege ni la idea de un juego, ni su nombre, ni el método de
jugarlo. Lo que sí protege es la expresión concreta —los dibujos, el texto del
reglamento, la caja— y nada de eso se ha copiado: el código, el diseño y hasta
la ficha dibujada en SVG son originales.

El nombre es harina de otro costal. Aquí se usa de forma descriptiva, para
decir de qué juego son estas reglas, que es el uso que el derecho de marcas
suele permitir. Aun así, si quien posee la marca pidiera que el proyecto se
llame de otra manera, se cambia y ya está.

## Mapa del código

```
src/
├── engine/      Reglas del Rummikub. Puro, sin dependencias.
│   ├── tiles.ts     Mazos, barajado sembrado, reparto
│   ├── sets.ts      Grupos, escaleras y lecturas del comodín
│   ├── board.ts     Validación de una jugada completa
│   └── game.ts      Estado de la partida y sus transiciones
│   ├── rules.ts     La variante que se juega en cada mesa
│   └── order.ts     Cómo se ordena el atril
├── protocol/    Mensajes y la vista recortada que ve cada jugador
├── worker/      Rutas y el Durable Object de la sala
└── client/      React: pantallas, fichas, gestos, ajuste y conexión
```
