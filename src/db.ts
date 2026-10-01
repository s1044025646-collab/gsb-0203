import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Game, GameInput, serializeGame } from "./game.js";

export interface SolveConfigSnapshot {
  action: string; // shapley | verify | leastcore | revise
  tolerance?: number;
  tieBreakRule?: string;
  extra?: unknown;
}

export interface RunRow {
  id: number;
  created_at: string;
  name: string | null;
  n: number;
  game_json: string;
  config_json: string;
  result_json: string;
}

export class Store {
  readonly dbPath: string;
  private db: DatabaseSync;

  constructor(dataDir: string) {
    const dir = resolve(dataDir);
    mkdirSync(dir, { recursive: true });
    this.dbPath = resolve(dir, "tugame.db");
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        name TEXT,
        n INTEGER NOT NULL,
        game_json TEXT NOT NULL,
        config_json TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
    `);
  }

  saveRun(game: Game, config: SolveConfigSnapshot, result: unknown): number {
    const gameJson = JSON.stringify(serializeGame(game));
    const stmt = this.db.prepare(
      `INSERT INTO runs (name, n, game_json, config_json, result_json)
       VALUES (?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      game.name ?? null,
      game.n,
      gameJson,
      JSON.stringify(config),
      JSON.stringify(result)
    );
    return Number(info.lastInsertRowid);
  }

  getRun(id: number): RunRow | null {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as
      | RunRow
      | undefined;
    return row ?? null;
  }

  listRuns(limit = 50): RunRow[] {
    return this.db
      .prepare(`SELECT id, created_at, name, n, config_json FROM runs ORDER BY id DESC LIMIT ?`)
      .all(limit) as unknown as RunRow[];
  }

  close(): void {
    this.db.close();
  }
}
