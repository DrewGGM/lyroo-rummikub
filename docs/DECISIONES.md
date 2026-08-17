# Decisiones de diseño

Las que costaron pensar, con lo que se descartó y por qué. Sirven para no
volver a discutirlas, y para saber qué habría que revisar si cambia el contexto.

---

## 1. El cliente manda la mesa entera, no ficha a ficha

**Contexto.** La propuesta inicial enviaba un mensaje `MOVE_TILE` por cada ficha
que se moviera. En un turno normal se mueven entre cinco y quince fichas, y en
uno de reorganización bastantes más.

**Decisión.** El cliente monta la jugada en local y envía **un solo mensaje** con
la mesa que propone y el atril que le queda. El servidor valida el resultado.

**Por qué.** Dos razones, y ninguna es la obvia:

1. Es la mecánica del juego real. Manoseas las fichas, pruebas, te arrepientes,
   y solo cuando lo tienes decidido dices «ya». Enviar cada movimiento
   convertiría las dudas de cada jugador en espectáculo.
2. Reduce los mensajes unas treinta veces. Como el plan gratuito cuenta cada
   mensaje entrante como una petición al Durable Object, esto es la diferencia
   entre ~150 partidas al día y ~10.

**Lo que hay que cuidar.** «Manda la mesa entera» suena a confiar en el cliente,
y no lo es: el servidor comprueba que el conjunto de fichas se conserva
exactamente y que las que han aparecido salieron del atril de quien juega. Ese
único invariante hace imposible inventar, duplicar o robar fichas.

**Alternativa descartada.** Retransmitir la jugada en curso con un límite de
frecuencia, para que los demás vean moverse las fichas. Se descartó porque
multiplica el coste por veinte y porque enseñar tus dudas empeora el juego.

---

## 2. Validar el tablero no es el problema difícil

**Contexto.** Repartir un conjunto de fichas en grupos y escaleras es un problema
NP-difícil, y es el que resuelven los solucionadores de Rummikub.

**Decisión.** El servidor nunca lo resuelve. El cliente manda la mesa **ya
repartida en combinaciones**, y el servidor solo comprueba que cada una es un
grupo o una escalera, más la conservación de fichas.

**Por qué.** El plan gratuito da 10 ms de CPU por invocación. Validar cuarenta
combinaciones sueltas cuesta menos de un milisegundo; resolver la partición
podría no acabar nunca. Y no hace falta: quien juega ya ha decidido cómo quedan
las combinaciones, esa información viene con la jugada.

**Consecuencia.** Las funciones que sí necesitarían el problema difícil
—autocolocar, dar pistas, jugar por ti— tendrían que vivir en el navegador,
donde la CPU es gratis e ilimitada. Hoy no existe ninguna.

---

## 3. La credencial del asiento la emite el servidor

**Contexto.** Sin cuentas, hay que poder demostrar «este sitio en la mesa es
mío» al reconectar.

**Decisión.** Al entrar, el servidor genera una credencial aleatoria, la guarda
asociada al asiento y se la manda solo a ese jugador, que la guarda en su
navegador.

**Por qué.** La alternativa era que el navegador se inventara su propio
identificador. Como el servidor no tendría forma de distinguir un identificador
legítimo de uno copiado, cualquiera que averiguara el de otro jugador podría
ocupar su asiento y ver su atril. Emitirla el servidor cierra esa puerta sin
añadir nada de complejidad.

---

## 4. El asiento se guarda; se libera solo cuando estorba

**Contexto.** ¿Qué pasa cuando alguien cierra la pestaña?

**Decisión.** Desconectarse nunca borra tu asiento. Los asientos vacíos se
liberan en dos momentos concretos: cuando llega alguien y la sala está llena, y
justo antes de repartir.

**Por qué.** Recargar la página y perder la cobertura son indistinguibles de
marcharse, y castigar el primer caso es mucho peor que tolerar el segundo. Los
dos momentos en que se limpia son exactamente aquellos en que un asiento vacío
molesta a alguien.

**Se descubrió probando.** La primera versión borraba al jugador al cerrarse el
WebSocket, y el test de reconexión falló: al volver te daban un asiento nuevo.

---

## 5. El reloj se para si no queda nadie

**Contexto.** Los turnos temporizados usan las alarmas del Durable Object.

**Decisión.** Cuando salta la alarma, si no hay ninguna conexión abierta el turno
no se consume: la alarma se reprograma y la partida espera. Al volver el jugador,
su turno vuelve a empezar de cero.

**Por qué.** Sin esto, un corte de red general haría que la partida siguiera sola
robando fichas por todos hasta agotar el pozo. Y de paso evita que una sala
abandonada esté despertándose cada minuto durante horas, gastando presupuesto.

---

## 6. Reordenar el atril es una permutación, no una entrega

**Contexto.** El orden de tus fichas es tuyo y se guarda para que sobreviva a
una recarga, así que el cliente puede pedir «déjalas en este orden».

**Decisión.** El servidor solo acepta ese mensaje si lo que recibe es una
permutación exacta del atril que ya tenías.

**Por qué.** Es un mensaje que escribe en tu mano. Sin la comprobación sería la
vía más fácil para colar un comodín: bastaría con mandar tu atril con una ficha
cambiada.

---

## 7. Un Worker con ficheros estáticos, no Cloudflare Pages

**Decisión.** Un único Worker sirve la aplicación y la API.

**Por qué.** Un solo despliegue, un solo dominio y ningún problema de CORS entre
el frontend y el WebSocket. Las peticiones a ficheros estáticos son gratis e
ilimitadas y ni siquiera despiertan al Worker, así que cargar la página no gasta
presupuesto. Pages ya no es el camino recomendado para proyectos nuevos.

---

## 8. Coger fichas con un toque, no solo arrastrando

**Contexto.** La app de referencia se juega arrastrando.

**Decisión.** Se puede arrastrar, y también tocar la ficha y luego tocar dónde
dejarla.

**Por qué.** En un móvil en vertical, arrastrar desde el atril hasta una
combinación del otro extremo del tapete es incómodo y falla a menudo. El toque
doble es más rápido para quien ya conoce el juego, y es la única forma de jugar
si no puedes arrastrar.

**Se descubrió probando.** La primera versión resolvía el gesto al pulsar, y un
toque cogía y soltaba la ficha en el mismo movimiento. Todo el gesto se decide
ahora al levantar el dedo.

---

## 9. Sin cuentas, sin salas públicas y sin bots

**Decisión.** El MVP solo tiene mesas por invitación.

**Por qué.** Las salas públicas necesitan un índice global, moderación de
nombres y defensa contra abuso; las cuentas traen datos personales y todo lo que
eso arrastra; los bots necesitan el problema difícil del punto 2. Nada de eso
hace falta para jugar con quien ya conoces, que es el juego que existe hoy.

**Cómo se añadiría.** Las salas públicas serían un Durable Object más haciendo de
índice. Los bots irían en el navegador de quien crea la mesa, y sus jugadas
pasarían por la misma validación que las de cualquiera.
