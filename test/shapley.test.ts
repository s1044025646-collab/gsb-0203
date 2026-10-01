import test from "node:test";
import assert from "node:assert/strict";
import { buildGame, GameInput, relabelGame } from "../src/game.js";
import { shapley } from "../src/shapley.js";
import { Fraction, add, frac, fromString, toString } from "../src/rational.js";

function game(players: string[], values: Record<string, string>, name?: string) {
  return buildGame({ players, values, name } as GameInput);
}

test("可加博弈：Shapley 值等于各参与者单人价值", () => {
  const g = game(["1", "2", "3"], {
    "1": "2", "2": "5", "3": "-1",
    "1,2": "7", "1,3": "1", "2,3": "4", "1,2,3": "6",
  });
  const r = shapley(g);
  assert.equal(r.allocation["1"], "2");
  assert.equal(r.allocation["2"], "5");
  assert.equal(r.allocation["3"], "-1");
  assert.equal(r.total, "6");
});

test("虚拟参与者得到零", () => {
  // v(S∪dummy)=v(S)：dummy 单人价值 0 且不改变任何联盟
  const g = game(["A", "B", "D"], {
    A: "10", B: "0", D: "0",
    "A,B": "10", "A,D": "10", "B,D": "0",
    "A,B,D": "10",
  });
  const r = shapley(g);
  assert.equal(r.allocation.D, "0");
  assert.equal(r.allocation.A, "10");
  assert.equal(r.allocation.B, "0");
});

test("对称参与者平分（手套博弈/三人对等）", () => {
  const g = game(["A", "B", "C"], {
    A: "0", B: "0", C: "0",
    "A,B": "8", "A,C": "8", "B,C": "8",
    "A,B,C": "8",
  });
  const r = shapley(g);
  assert.equal(r.allocation.A, "8/3");
  assert.equal(r.allocation.B, "8/3");
  assert.equal(r.allocation.C, "8/3");
});

test("负价值博弈：效率性与精确分数", () => {
  const g = game(["A", "B"], {
    A: "-1/2", B: "-1/4", "A,B": "-1",
  });
  const r = shapley(g);
  // φ_A = 1/2(v(A)-v(∅)) + 1/2(v(AB)-v(B)) = -1/4 + (-3/8) = -5/8
  assert.equal(r.allocation.A, "-5/8");
  assert.equal(r.allocation.B, "-3/8");
  assert.equal(r.total, "-1");
});

test("三人多数博弈：Shapley 值各 1/3，枚举 6 个排列核对", () => {
  const g = game(["A", "B", "C"], {
    A: "0", B: "0", C: "0",
    "A,B": "1", "A,C": "1", "B,C": "1",
    "A,B,C": "1",
  });
  const r = shapley(g);
  assert.equal(r.permutations, 6);
  for (const p of ["A", "B", "C"]) assert.equal(r.allocation[p], "1/3");
  assert.equal(r.total, "1");
});

test("线性性：两个博弈之和的 Shapley 等于 Shapley 之和", () => {
  const v1 = { A: "1", B: "2", C: "0", "A,B": "4", "A,C": "2", "B,C": "3", "A,B,C": "7" };
  const v2 = { A: "0", B: "-1", C: "3", "A,B": "1", "A,C": "5", "B,C": "2", "A,B,C": "6" };
  const g1 = game(["A", "B", "C"], v1);
  const g2 = game(["A", "B", "C"], v2);
  const sum: Record<string, string> = {};
  for (const k of Object.keys(v1)) sum[k] = toString(add(fromString(v1[k]), fromString(v2[k])));
  const g3 = game(["A", "B", "C"], sum);
  const r1 = shapley(g1), r2 = shapley(g2), r3 = shapley(g3);
  for (const p of ["A", "B", "C"]) {
    assert.equal(r3.allocation[p], toString(add(fromString(r1.allocation[p]), fromString(r2.allocation[p]))));
  }
});

test("编号重排不变性：重排后按名字取值相同", () => {
  const g = game(["A", "B", "C"], {
    A: "1", B: "2", C: "4",
    "A,B": "5", "A,C": "9", "B,C": "8",
    "A,B,C": "12",
  });
  const before = shapley(g);
  const relabeled = relabelGame(g, ["C", "A", "B"]);
  const after = shapley(relabeled);
  for (const p of ["A", "B", "C"]) assert.equal(after.allocation[p], before.allocation[p]);
});

test("独立枚举全部排列（4 人，24 排列）核对效率性", () => {
  const masks = ["A","B","C","D","A,B","A,C","A,D","B,C","B,D","C,D",
    "A,B,C","A,B,D","A,C,D","B,C,D","A,B,C,D"];
  const values: Record<string, string> = {};
  let k = 0;
  for (const m of masks) values[m] = String(((k++ * 7) % 13) - 6);
  const g = game(["A","B","C","D"], values);
  const r = shapley(g);
  assert.equal(r.permutations, 24);
  let total = frac(0n);
  for (const p of g.players) total = add(total, fromString(r.allocation[p]));
  assert.equal(toString(total), values["A,B,C,D"]); // 效率性：和精确等于大联盟价值
  assert.equal(values["A,B,C,D"], "1");
});
