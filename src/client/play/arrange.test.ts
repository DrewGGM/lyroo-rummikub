import { describe, expect, it } from "vitest";
import {
  keepOrder,
  locate,
  moveTile,
  moveTiles,
  runAround,
  sortRack,
  tidyAround,
  tidySet,
  type Layout,
  whereItFits,
} from "./arrange";
import { readSet } from "../../engine/sets";

const R = (v: number, c = 0) => `r${v}_${c}`;
const B = (v: number, c = 0) => `b${v}_${c}`;
const K = (v: number, c = 0) => `k${v}_${c}`;
const O = (v: number, c = 0) => `o${v}_${c}`;
const J = (c = 0) => `j_${c}`;

const layout = (board: string[][], rack: string[]): Layout => ({ board, rack });

describe("mover una ficha", () => {
  it("la lleva del atril a una combinación nueva", () => {
    const next = moveTile(layout([], [R(3), R(4)]), { kind: "rack", index: 0 }, { kind: "new" });
    expect(next.board).toEqual([[R(3)]]);
    expect(next.rack).toEqual([R(4)]);
  });

  it("la coloca en el sitio exacto de una combinación", () => {
    const next = moveTile(
      layout([[R(4), R(5)]], [R(3)]),
      { kind: "rack", index: 0 },
      { kind: "set", set: 0, index: 0 },
    );
    expect(next.board).toEqual([[R(3), R(4), R(5)]]);
  });

  it("reordena dentro del atril sin perder nada", () => {
    const next = moveTile(
      layout([], [R(1), R(2), R(3)]),
      { kind: "rack", index: 0 },
      { kind: "rack", index: 3 },
    );
    expect(next.rack).toEqual([R(2), R(3), R(1)]);
  });

  it("borra la combinación que se queda vacía", () => {
    const next = moveTile(
      layout([[R(3)]], []),
      { kind: "set", set: 0, index: 0 },
      { kind: "rack", index: 0 },
    );
    expect(next.board).toEqual([]);
    expect(next.rack).toEqual([R(3)]);
  });
});

describe("mover un grupo de fichas", () => {
  it("baja una escalera entera a la mesa en orden", () => {
    const base = layout([], [R(2), R(3), R(4), R(5), B(9)]);
    const next = moveTiles(base, [R(3), R(4), R(5)], { kind: "new" });
    expect(next.board).toEqual([[R(3), R(4), R(5)]]);
    expect(next.rack).toEqual([R(2), B(9)]);
  });

  it("conserva todas las fichas al moverlas", () => {
    const base = layout([[K(7), O(7)]], [R(7), B(7), R(1)]);
    const next = moveTiles(base, [R(7), B(7)], { kind: "set", set: 0, index: 0 });
    const antes = [...base.board.flat(), ...base.rack].sort();
    const despues = [...next.board.flat(), ...next.rack].sort();
    expect(despues).toEqual(antes);
  });

  it("las inserta delante de la ficha señalada, no en un índice viejo", () => {
    // Al sacar r3 y r4 del atril los índices se corren; el grupo tiene que
    // acabar igualmente delante del r6.
    const base = layout([[R(5), R(6), R(7)]], [R(3), R(4)]);
    const next = moveTiles(base, [R(3), R(4)], { kind: "set", set: 0, index: 1 });
    expect(next.board).toEqual([[R(5), R(3), R(4), R(6), R(7)]]);
  });

  it("no hace nada al soltar el grupo sobre sí mismo", () => {
    const base = layout([[R(3), R(4), R(5)]], []);
    const next = moveTiles(base, [R(3), R(4)], { kind: "set", set: 0, index: 0 });
    expect(next).toEqual(base);
  });

  it("recupera un grupo de la mesa al atril", () => {
    const base = layout([[R(3), R(4), R(5)]], [B(1)]);
    const next = moveTiles(base, [R(3), R(4), R(5)], { kind: "rack", index: 1 });
    expect(next.board).toEqual([]);
    expect(next.rack).toEqual([B(1), R(3), R(4), R(5)]);
  });

  it("lleva un grupo de una fila a otra", () => {
    const base = layout([[R(3), R(4), R(5), R(6)], [B(9), K(9), R(9)]], []);
    const next = moveTiles(base, [R(5), R(6)], { kind: "set", set: 1, index: 3 });
    expect(next.board[0]).toEqual([R(3), R(4)]);
    expect(next.board[1]).toEqual([B(9), K(9), R(9), R(5), R(6)]);
  });

  it("mueve una fila entera a otra aunque la de origen desaparezca", () => {
    // Al vaciarse, la fila de origen se va y las siguientes se corren un
    // puesto: seguir el número de fila dejaba el grupo en el limbo.
    const base = layout([[R(3), R(4), R(5)], [B(9), K(9), R(9)]], []);
    const next = moveTiles(base, [R(3), R(4), R(5)], { kind: "set", set: 1, index: 3 });
    expect(next.board).toHaveLength(1);
    expect(next.board[0]).toEqual([B(9), K(9), R(9), R(3), R(4), R(5)]);
  });

  it("inserta delante de la ficha señalada aunque se corran las filas", () => {
    const base = layout([[R(3), R(4), R(5)], [B(9), K(9), R(9)]], []);
    const next = moveTiles(base, [R(3), R(4), R(5)], { kind: "set", set: 1, index: 1 });
    expect(next.board[0]).toEqual([B(9), R(3), R(4), R(5), K(9), R(9)]);
  });

  it("ignora una lista vacía", () => {
    const base = layout([[R(3), R(4), R(5)]], []);
    expect(moveTiles(base, [], { kind: "new" })).toEqual(base);
  });
});

describe("encontrar la combinación alrededor de una ficha", () => {
  it("coge la escalera contigua completa", () => {
    const rack = [B(1), R(3), R(4), R(5), K(9)];
    expect(runAround(rack, 2)).toEqual([R(3), R(4), R(5)]);
  });

  it("coge el grupo contiguo completo", () => {
    const rack = [B(1), R(7), B(7), K(7), O(7), K(9)];
    expect(runAround(rack, 2)).toEqual([R(7), B(7), K(7), O(7)]);
  });

  it("prefiere la combinación más larga que la contenga", () => {
    const rack = [R(2), R(3), R(4), R(5), R(6)];
    expect(runAround(rack, 3)).toHaveLength(5);
  });

  it("aprovecha el comodín si está al lado", () => {
    const rack = [R(3), J(), R(5), K(1)];
    expect(runAround(rack, 0)).toEqual([R(3), J(), R(5)]);
  });

  it("no devuelve nada si las vecinas no forman combinación", () => {
    const rack = [R(3), B(8), K(11), O(2)];
    expect(runAround(rack, 1)).toEqual([]);
  });

  it("no se sale del atril por los extremos", () => {
    const rack = [R(3), R(4), R(5)];
    expect(runAround(rack, 0)).toEqual(rack);
    expect(runAround(rack, 2)).toEqual(rack);
    expect(runAround(rack, 9)).toEqual([]);
  });
});

describe("localizar y ordenar", () => {
  it("dice dónde está cada ficha", () => {
    const base = layout([[R(3), R(4), R(5)]], [B(1)]);
    expect(locate(base, R(4))).toEqual({ kind: "set", set: 0, index: 1 });
    expect(locate(base, B(1))).toEqual({ kind: "rack", index: 0 });
    expect(locate(base, O(13))).toBeNull();
  });

  it("ordena por escaleras agrupando colores", () => {
    const ordenado = sortRack([B(5), R(3), R(1), B(2)], "runs");
    expect(ordenado).toEqual([R(1), R(3), B(2), B(5)]);
  });

  it("ordena por grupos agrupando números", () => {
    const ordenado = sortRack([B(5), R(3), R(5), B(3)], "groups");
    expect(ordenado).toEqual([R(3), B(3), R(5), B(5)]);
  });

  it("deja los comodines al final", () => {
    const ordenado = sortRack([J(), R(3), B(2)], "runs");
    expect(ordenado[ordenado.length - 1]).toBe(J());
  });
});

describe("colocar una ficha sola", () => {
  it("la manda a la escalera que la admite", () => {
    const board = [
      [R(7), B(7), K(7)],
      [R(3), R(4), R(5)],
    ];
    expect(whereItFits(board, R(6))).toEqual({ kind: "set", set: 1, index: 3 });
  });

  it("la manda al grupo que le falta ese color", () => {
    const board = [[R(9), B(9), K(9)]];
    expect(whereItFits(board, O(9))).toEqual({ kind: "set", set: 0, index: 3 });
  });

  it("no se inventa un sitio cuando no encaja en nada", () => {
    const board = [[R(3), R(4), R(5)]];
    expect(whereItFits(board, K(11))).toBeNull();
  });

  it("no sugiere nada con la mesa vacía", () => {
    expect(whereItFits([], R(7))).toBeNull();
  });

  it("aprovecha el comodín que ya está en la mesa", () => {
    // r3-J-r5 admite el r6 por el extremo.
    const board = [[R(3), J(), R(5)]];
    expect(whereItFits(board, R(6))).toEqual({ kind: "set", set: 0, index: 3 });
  });

  it("elige la primera combinación que la admite", () => {
    const board = [
      [R(3), R(4), R(5)],
      [B(3), B(4), B(5)],
    ];
    expect(whereItFits(board, R(6))).toEqual({ kind: "set", set: 0, index: 3 });
  });
});

describe("la mesa se recoloca sola", () => {
  it("ordena la escalera en cuanto encaja la ficha", () => {
    // Sueltas el 1 en medio del 2-3-4-5 y queda 2-3-1-4-5.
    expect(tidySet([R(2), R(3), R(1), R(4), R(5)])).toEqual([
      [R(1), R(2), R(3), R(4), R(5)],
    ]);
  });

  it("no toca una escalera que ya está en orden", () => {
    const escalera = [B(7), B(8), B(9)];
    expect(tidySet(escalera)).toEqual([escalera]);
  });

  it("parte la escalera en dos cuando repites un número", () => {
    // 1-2-3-4-5-6-7-8 con otro 5 dentro: sale 1-2-3-4-5 y 5-6-7-8.
    const larga = [K(1), K(2), K(3), K(4), K(5), K(6), K(7), K(8), K(5, 1)];
    const partida = tidySet(larga);
    expect(partida).toHaveLength(2);
    expect(partida[0]).toHaveLength(5);
    expect(partida[1]).toHaveLength(4);
    for (const trozo of partida) expect(readSet(trozo).length).toBeGreaterThan(0);
  });

  it("deja la combinación como está si no hay forma de arreglarla", () => {
    // Un grupo de cinco con color repetido no se parte en dos válidas.
    const rota = [R(7), B(7), K(7), O(7), R(7, 1)];
    expect(tidySet(rota)).toEqual([rota]);
  });

  it("solo recoloca la fila donde cayó la ficha", () => {
    const antes = layout([[B(9), B(7), B(8)], [R(4), R(3), R(5)]], []);
    const despues = tidyAround(antes, B(7));
    expect(despues.board[0]).toEqual([B(7), B(8), B(9)]);
    // La otra sigue desordenada: no se pidió tocarla.
    expect(despues.board[1]).toEqual([R(4), R(3), R(5)]);
  });

  it("la partida ocupa el sitio de la original, sin mover las demás", () => {
    const antes = layout(
      [
        [O(1), O(2), O(3)],
        [K(1), K(2), K(3), K(4), K(5), K(6), K(7), K(8), K(5, 1)],
        [R(5), B(5), K(5, 2)],
      ],
      [],
    );
    const despues = tidyAround(antes, K(5, 1));
    expect(despues.board).toHaveLength(4);
    expect(despues.board[0]).toEqual([O(1), O(2), O(3)]);
    expect(despues.board[3]).toEqual([R(5), B(5), K(5, 2)]);
  });

  it("no pierde ni inventa fichas al recolocar", () => {
    const antes = layout(
      [[K(1), K(2), K(3), K(4), K(5), K(6), K(7), K(8), K(5, 1)]],
      [],
    );
    const despues = tidyAround(antes, K(5, 1));
    expect(despues.board.flat().sort()).toEqual(antes.board.flat().sort());
  });
});

describe("tu orden del atril se respeta", () => {
  it("mantiene el orden que le diste aunque el servidor lo mande de otro modo", () => {
    const delServidor = [R(1), R(5), B(9)];
    const tuyo = [B(9), R(5), R(1)];
    expect(keepOrder(delServidor, tuyo)).toEqual([B(9), R(5), R(1)]);
  });

  it("la ficha robada aparece al final, no en medio de lo colocado", () => {
    const delServidor = [R(1), R(5), B(9), K(13)];
    const tuyo = [B(9), R(5), R(1)];
    expect(keepOrder(delServidor, tuyo)).toEqual([B(9), R(5), R(1), K(13)]);
  });

  it("olvida las fichas que ya bajaste a la mesa", () => {
    const delServidor = [R(1), B(9)];
    const tuyo = [B(9), R(5), R(1)];
    expect(keepOrder(delServidor, tuyo)).toEqual([B(9), R(1)]);
  });

  it("sin orden previo deja el atril como viene", () => {
    const delServidor = [R(1), R(5), B(9)];
    expect(keepOrder(delServidor, [])).toEqual(delServidor);
  });

  it("no pierde ni duplica fichas", () => {
    const delServidor = [R(1), R(5), B(9), K(13), J()];
    const tuyo = [K(13), R(1)];
    const salida = keepOrder(delServidor, tuyo);
    expect(salida.slice().sort()).toEqual(delServidor.slice().sort());
  });
});
