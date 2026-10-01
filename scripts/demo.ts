// 端到端演示：公平分配被联盟反对、价值修订变化、错误方案证据、重启后历史复核。
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildGame, GameInput } from "../src/game.js";
import { shapley } from "../src/shapley.js";
import { leastCore, verifyAllocation } from "../src/stability.js";
import { compareRevisions, fairnessReport } from "../src/report.js";
import { Store } from "../src/db.js";

const dataDir = resolve(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

function line(t: string): void {
  console.log("\n" + "=".repeat(72));
  console.log(t);
  console.log("=".repeat(72));
}

function main(): void {
  const store = new Store(dataDir);

  line("场景 1：三人多数博弈 —— 公平的 Shapley 分配仍被联盟反对");
  const majority: GameInput = {
    name: "多数表决",
    players: ["A", "B", "C"],
    values: {
      A: "0", B: "0", C: "0",
      "A,B": "1", "A,C": "1", "B,C": "1",
      "A,B,C": "1",
    },
  };
  const g1 = buildGame(majority);
  const s1 = shapley(g1);
  console.log("Shapley 精确分配:", s1.allocation, "（枚举排列数:", s1.permutations, "）");
  const v1 = verifyAllocation(g1, s1.allocation);
  console.log("总额匹配:", v1.totalMatches, "| 位于核心:", v1.core);
  console.log("最大违约联盟:", v1.maxViolationCoalition, "松弛量:", v1.maxViolation);
  const lc1 = leastCore(g1);
  console.log("最小统一违约额 ε =", lc1.epsilon, "=> 核心为空:", !lc1.inCore);
  const id1 = store.saveRun(g1, { action: "report", tolerance: lc1.tolerance }, fairnessReport(g1, s1, lc1));

  line("场景 2：修订一个联盟价值后，分配与稳定性如何变化");
  const revised: GameInput = {
    ...majority,
    name: "多数表决（提高 A,C 联盟价值）",
    values: { ...majority.values, "A,C": "3/2" },
  };
  const g2 = buildGame(revised);
  const cmpResult = compareRevisions(g1, g2, s1, shapley(g2), lc1, leastCore(g2));
  for (const ch of cmpResult.changedCoalitions) {
    console.log(`联盟 ${ch.coalition}: ${ch.oldValue} -> ${ch.newValue}（Δ=${ch.delta}）`);
  }
  console.log("Shapley 变化:", cmpResult.shapleyDelta);
  console.log("旧 ε =", cmpResult.oldCore.epsilon, " 新 ε =", cmpResult.newCore.epsilon);
  const id2 = store.saveRun(g2, { action: "revise" }, cmpResult);

  line("场景 3：错误外部分配方案的证据");
  const bad = { A: "1", B: "1", C: "1/2" };
  const vb = verifyAllocation(g1, bad);
  console.log("方案:", bad);
  console.log("分配总额:", vb.totalAllocated, "大联盟价值:", vb.grandCoalitionValue, "总额匹配:", vb.totalMatches);
  console.log("位于核心:", vb.core, "| 最大违约联盟:", vb.maxViolationCoalition, "松弛:", vb.maxViolation);
  const id3 = store.saveRun(g1, { action: "verify" }, vb);

  line("场景 4：负价值博弈（分配变量可以为负）");
  const neg = buildGame({
    name: "分摊清理成本",
    players: ["X", "Y"],
    values: { X: "0", Y: "0", "X,Y": "-10" },
  });
  const lcNeg = leastCore(neg);
  console.log("ε =", lcNeg.epsilon, " 分配:", lcNeg.allocation, " 总额:", lcNeg.totalAllocated);
  const id4 = store.saveRun(neg, { action: "leastcore", tolerance: lcNeg.tolerance }, lcNeg);

  const ids = { id1, id2, id3, id4 };
  writeFileSync(resolve(dataDir, "demo-ids.json"), JSON.stringify(ids, null, 2));
  console.log("\n已写入历史记录 id:", ids);
  store.close();

  line("场景 5：模拟重启 —— 重新打开数据库并复核历史快照");
  const reopened = new Store(dataDir);
  for (const [label, id] of Object.entries(ids)) {
    const row = reopened.getRun(id)!;
    const game = JSON.parse(row.game_json);
    const config = JSON.parse(row.config_json);
    console.log(`[${label}] id=${row.id} action=${config.action} 参与者=${game.players.join("/")} 时间=${row.created_at}`);
  }
  const row1 = reopened.getRun(ids.id1)!;
  const result1 = JSON.parse(row1.result_json);
  console.log("复核场景1 ε =", result1.core.epsilon, " Shapley =", JSON.stringify(result1.shapley.allocation));
  reopened.close();
  console.log("\n演示完成。");
}

main();
