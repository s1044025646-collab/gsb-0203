import test from "node:test";
import assert from "node:assert/strict";
import { buildGame, GameInput } from "../src/game.js";
import { leastCore, verifyAllocation } from "../src/stability.js";

const majority = {
  name: "majority3",
  players: ["A", "B", "C"],
  values: {
    A: "0", B: "0", C: "0",
    "A,B": "1", "A,C": "1", "B,C": "1",
    "A,B,C": "1",
  },
} as GameInput;

test("三人多数博弈：核心为空，最小违约额精确为 1/3", () => {
  const g = buildGame(majority);
  const r = leastCore(g);
  assert.equal(r.status, "optimal_confirmed");
  assert.equal(r.inCore, false);
  assert.equal(r.epsilon, "1/3");
  assert.equal(r.totalAllocated, "1");
});

test("公平的 Shapley 分配（1/3 各）仍被每个二人联盟反对", () => {
  const g = buildGame(majority);
  const v = verifyAllocation(g, { A: "1/3", B: "1/3", C: "1/3" });
  assert.equal(v.core, false);
  assert.equal(v.totalMatches, true);
  assert.equal(v.maxViolation, "-1/3"); // 二人联盟拿到 2/3 < 1
  assert.ok(v.maxViolationCoalition !== null);
  // 检查全部三个二人联盟，而非只看单人
  const pairs = v.coalitionChecks.filter((c) => c.coalition.split(",").length === 2);
  assert.equal(pairs.length, 3);
  for (const p of pairs) assert.equal(p.slack, "-1/3");
});

test("凸博弈（均分大蛋糕）核心非空，epsilon 为 0", () => {
  const g = buildGame({
    players: ["A", "B", "C"],
    values: {
      A: "0", B: "0", C: "0",
      "A,B": "0", "A,C": "0", "B,C": "0",
      "A,B,C": "6",
    },
  });
  const r = leastCore(g);
  assert.equal(r.status, "optimal_confirmed");
  assert.equal(r.inCore, true);
  assert.equal(r.epsilon, "0");
  const v = verifyAllocation(g, r.allocation!);
  assert.equal(v.core, true);
});

test("错误方案：总额不匹配 + 联盟反对都给出证据", () => {
  const g = buildGame(majority);
  const v = verifyAllocation(g, { A: "1", B: "1", C: "1" });
  assert.equal(v.totalMatches, false);
  assert.equal(v.totalAllocated, "3");
  assert.equal(v.core, false);
});

test("负价值分配变量可为负：不擅自加非负约束", () => {
  // v(AB)=-10，单人 0；x_A+x_B=-10，单人约束 x_i+e>=0 => e>=5，
  // 最优解 x_A=x_B=-5（变量确实为负），e=5
  const g = buildGame({
    players: ["A", "B"],
    values: { A: "0", B: "0", "A,B": "-10" },
  });
  const r = leastCore(g);
  assert.equal(r.status, "optimal_confirmed");
  assert.equal(r.epsilon, "5");
  assert.equal(r.allocation!.A, "-5");
  assert.equal(r.allocation!.B, "-5");
  const vals = Object.values(r.allocation!).map((s) => Number(s.split("/")[0]));
  assert.ok(vals.some((x) => x < 0));
});

test("确定性选解：两次运行结果完全一致", () => {
  const g = buildGame(majority);
  const a = leastCore(g);
  const b = leastCore(g);
  assert.deepEqual(a.allocation, b.allocation);
  assert.equal(a.epsilon, b.epsilon);
});
