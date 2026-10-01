#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildGame, GameInput, serializeGame } from "./game.js";
import { shapley } from "./shapley.js";
import { leastCore, verifyAllocation } from "./stability.js";
import { buildExport, compareRevisions, fairnessReport } from "./report.js";
import { Store } from "./db.js";

const DATA_DIR = process.env.TUGAME_DATA_DIR ?? resolve(process.cwd(), "data");

function usage(): never {
  console.error(`用法: tugame <命令> [参数]

命令:
  validate  <game.json>                     校验博弈输入并规范化输出
  shapley   <game.json>                     精确 Shapley 值（含贡献明细）
  verify    <game.json> <allocation.json>   核验外部分配向量（核心判定）
  leastcore <game.json>                     最小统一违约额 epsilon 与实现分配
  report    <game.json>                     公平性 + 稳定性综合报告
  revise    <oldGame.json> <newGame.json>   价值修订前后对比
  export    <game.json> [allocation.json]   导出 JSON（分配存在时附核验）
  history  [id]                             列出历史 / 查看某次快照

环境变量:
  TUGAME_DATA_DIR   SQLite 数据目录（默认 ./data）

博弈 JSON: { "players": ["A","B","C"], "values": { "A": "0", "A,B": "1/3", ... } }
价值接受整数或分数字符串（如 "2"、"-1/4"），空联盟价值固定为 0。`);
  process.exit(1);
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, (_k, v) => v, 2));
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help") usage();
  const store = new Store(DATA_DIR);
  try {
    switch (cmd) {
      case "validate": {
        if (!args[0]) usage();
        const game = buildGame(readJson(args[0]) as GameInput);
        print({ game: serializeGame(game), coalitions: 1 << game.n });
        break;
      }
      case "shapley": {
        const game = buildGame(readJson(args[0]) as GameInput);
        const result = shapley(game);
        const id = store.saveRun(game, { action: "shapley" }, result);
        print({ id, result });
        break;
      }
      case "verify": {
        const game = buildGame(readJson(args[0]) as GameInput);
        const alloc = readJson(args[1]).allocation ?? readJson(args[1]);
        const result = verifyAllocation(game, alloc);
        const id = store.saveRun(game, { action: "verify" }, result);
        print({ id, result });
        break;
      }
      case "leastcore": {
        const game = buildGame(readJson(args[0]) as GameInput);
        const result = leastCore(game);
        const id = store.saveRun(game, {
          action: "leastcore",
          tolerance: result.tolerance,
          tieBreakRule: "epsilon 最优下按参与者编号顺序字典序最小化 x_i",
        }, result);
        print({ id, result });
        break;
      }
      case "report": {
        const game = buildGame(readJson(args[0]) as GameInput);
        const report = fairnessReport(game, shapley(game), leastCore(game));
        const id = store.saveRun(game, { action: "report" }, report);
        print({ id, result: report });
        break;
      }
      case "revise": {
        const oldGame = buildGame(readJson(args[0]) as GameInput);
        const newGame = buildGame(readJson(args[1]) as GameInput);
        const result = compareRevisions(
          oldGame,
          newGame,
          shapley(oldGame),
          shapley(newGame),
          leastCore(oldGame),
          leastCore(newGame)
        );
        const id = store.saveRun(newGame, { action: "revise" }, result);
        print({ id, result });
        break;
      }
      case "export": {
        const game = buildGame(readJson(args[0]) as GameInput);
        const bundle = buildExport(
          game,
          args[1]
            ? {
                shapley: shapley(game),
                leastCore: leastCore(game),
                verification: verifyAllocation(
                  game,
                  readJson(args[1]).allocation ?? readJson(args[1])
                ),
              }
            : { shapley: shapley(game), leastCore: leastCore(game) }
        );
        const id = store.saveRun(game, { action: "export" }, bundle);
        print({ id, export: bundle });
        break;
      }
      case "history": {
        if (args[0]) {
          const row = store.getRun(Number(args[0]));
          if (!row) throw new Error("未找到该历史记录");
          print({
            ...row,
            game_json: JSON.parse(row.game_json),
            config_json: JSON.parse(row.config_json),
            result_json: JSON.parse(row.result_json),
          });
        } else {
          print(store.listRuns());
        }
        break;
      }
      default:
        usage();
    }
  } finally {
    store.close();
  }
}

main().catch((e) => {
  console.error(`错误: ${(e as Error).message}`);
  process.exit(1);
});
