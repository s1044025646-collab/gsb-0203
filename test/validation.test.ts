import test from "node:test";
import assert from "node:assert/strict";
import { buildGame } from "../src/game.js";

const base = {
  players: ["A", "B"],
  values: { A: "0", B: "0", "A,B": "1" },
};

test("参与者数量必须 2-8", () => {
  assert.throws(() => buildGame({ players: ["A"], values: {} }), /2 到 8/);
  assert.throws(
    () => buildGame({ players: ["1","2","3","4","5","6","7","8","9"], values: {} }),
    /2 到 8/
  );
});

test("编号必须唯一", () => {
  assert.throws(() => buildGame({ players: ["A", "A"], values: {} }), /唯一/);
});

test("联盟内重复成员被拒绝", () => {
  assert.throws(
    () => buildGame({ players: ["A", "B"], values: { A: "0", B: "0", "A,A": "1", "A,B": "1" } }),
    /重复/
  );
});

test("成员顺序不改变身份：同集合冲突重复提交被拒绝", () => {
  assert.throws(
    () =>
      buildGame({
        players: ["A", "B"],
        values: { A: "0", B: "0", "A,B": "1", "B,A": "2" },
      }),
    /成员顺序不改变身份/
  );
});

test("缺少联盟价值被拒绝", () => {
  assert.throws(
    () => buildGame({ players: ["A", "B"], values: { A: "0", B: "0" } }),
    /缺少/
  );
});

test("非法价值字符串被拒绝", () => {
  assert.throws(
    () => buildGame({ players: ["A", "B"], values: { A: "abc", B: "0", "A,B": "1" } }),
    /价值无效/
  );
});

test("空联盟价值固定为零，提供了也被忽略", () => {
  const g = buildGame({ ...base, values: { ...base.values, "": "999" } } as any);
  assert.equal(g.v.get(0)?.num, 0n);
});

test("合法分数字符串（含负数）被接受", () => {
  const g = buildGame({ players: ["A","B"], values: { A: "-1/3", B: "2/4", "A,B": "0" } });
  assert.equal(g.v.get(1)?.num, -1n);
  assert.equal(g.v.get(2)?.den, 2n);
});
