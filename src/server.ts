import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { buildGame, GameInput, serializeGame } from "./game.js";
import { shapley } from "./shapley.js";
import { leastCore, verifyAllocation } from "./stability.js";
import { compareRevisions, buildExport, fairnessReport } from "./report.js";
import { Store } from "./db.js";

const PORT = Number(process.env.PORT ?? process.env.TUGAME_PORT ?? 8080);
const DATA_DIR = process.env.TUGAME_DATA_DIR ?? resolve(process.cwd(), "data");

const store = new Store(DATA_DIR);

interface JsonRequest {
  body: any;
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return res({});
      try {
        res(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        rej(new Error(`请求体不是合法 JSON: ${(e as Error).message}`));
      }
    });
    req.on("error", rej);
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const json = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

function ok(res: ServerResponse, payload: unknown) {
  send(res, 200, { ok: true, ...(payload as object) });
}
function fail(res: ServerResponse, status: number, error: string, details?: unknown) {
  send(res, status, { ok: false, error, details });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (req.method === "GET" && path === "/health") {
      return ok(res, { service: "tu-game-backend", dataDir: DATA_DIR, sqlite: store.dbPath });
    }
    if (req.method === "GET" && path === "/api/runs") {
      const limit = Number(url.searchParams.get("limit") ?? "50");
      return ok(res, { runs: store.listRuns(limit) });
    }
    const runMatch = /^\/api\/runs\/(\d+)$/.exec(path);
    if (req.method === "GET" && runMatch) {
      const row = store.getRun(Number(runMatch[1]));
      if (!row) return fail(res, 404, "未找到该历史记录");
      return ok(res, {
        run: {
          ...row,
          game_json: JSON.parse(row.game_json),
          config_json: JSON.parse(row.config_json),
          result_json: JSON.parse(row.result_json),
        },
      });
    }
    if (req.method !== "POST") return fail(res, 405, "仅支持 POST（/health 为 GET）");

    const body = await readJson(req);

    if (path === "/api/games/validate") {
      const game = buildGame(body as GameInput);
      return ok(res, { game: serializeGame(game), coalitions: 1 << game.n });
    }
    if (path === "/api/shapley") {
      const game = buildGame(body as GameInput);
      const result = shapley(game);
      const id = store.saveRun(game, { action: "shapley" }, result);
      return ok(res, { id, result });
    }
    if (path === "/api/shapley/details") {
      // body: { game, player? }
      const game = buildGame(body.game as GameInput);
      const result = shapley(game);
      const details = body.player
        ? result.details.filter((d) => d.player === body.player)
        : result.details;
      const id = store.saveRun(game, { action: "shapley", extra: { detailsOnly: true } }, result);
      return ok(res, { id, result: { ...result, details } });
    }
    if (path === "/api/verify") {
      const game = buildGame(body.game as GameInput);
      const result = verifyAllocation(game, body.allocation ?? {});
      const id = store.saveRun(game, { action: "verify" }, result);
      return ok(res, { id, result });
    }
    if (path === "/api/least-core") {
      const game = buildGame((body.game ?? body) as GameInput);
      const result = leastCore(game, { tolerance: body.tolerance });
      const id = store.saveRun(
        game,
        {
          action: "leastcore",
          tolerance: result.tolerance,
          tieBreakRule: "epsilon 最优下按参与者编号顺序字典序最小化 x_i",
        },
        result
      );
      return ok(res, { id, result });
    }
    if (path === "/api/report") {
      const game = buildGame(body as GameInput);
      const s = shapley(game);
      const lc = leastCore(game, { tolerance: body?.tolerance });
      const report = fairnessReport(game, s, lc);
      const id = store.saveRun(game, { action: "report", tolerance: lc.tolerance }, report);
      return ok(res, { id, result: report });
    }
    if (path === "/api/revise") {
      const oldGame = buildGame(body.oldGame as GameInput);
      const newGame = buildGame(body.newGame as GameInput);
      const os = shapley(oldGame);
      const ns = shapley(newGame);
      const oc = leastCore(oldGame, { tolerance: body.tolerance });
      const nc2 = leastCore(newGame, { tolerance: body.tolerance });
      const result = compareRevisions(oldGame, newGame, os, ns, oc, nc2);
      const id = store.saveRun(newGame, { action: "revise" }, result);
      return ok(res, { id, result });
    }
    if (path === "/api/export") {
      const game = buildGame((body.game ?? body) as GameInput);
      const parts: { shapley?: any; verification?: any; leastCore?: any } = {};
      if (body.include?.includes("shapley")) parts.shapley = shapley(game);
      if (body.include?.includes("leastcore")) parts.leastCore = leastCore(game, { tolerance: body.tolerance });
      if (body.allocation) parts.verification = verifyAllocation(game, body.allocation);
      const bundle = buildExport(game, parts);
      const id = store.saveRun(game, { action: "export", extra: { include: body.include ?? [] } }, bundle);
      return ok(res, { id, export: bundle });
    }
    return fail(res, 404, `未知路径: ${path}`);
  } catch (e) {
    return fail(res, 400, (e as Error).message);
  }
});

server.listen(PORT, () => {
  console.log(`[tu-game] HTTP API 监听 http://localhost:${PORT}`);
  console.log(`[tu-game] 数据目录: ${DATA_DIR}`);
  console.log(`[tu-game] SQLite:   ${store.dbPath}`);
});

export { server, store };
