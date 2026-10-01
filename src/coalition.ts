import { Fraction } from "./rational.js";

export type CoalitionValue = string | number;

export interface GameInput {
  // 参与者唯一编号，2-8 个；顺序只用于规范化，成员集合本身与输入顺序无关。
  players: string[];
 // key 为规范化成员集合，如 "a"、"a,b"；必须给出除空联盟外全部联盟。
  values: Record<string, CoalitionValue>;
  name?: string;
}

export interface Game {
  players: string[];
  index: Map<string, number>;
  // 位掩码（第 0 位为 players[0]）-> 特征函数值，0 位掩码固定为 0。
  values: Map<number, Fraction>;
  name?: string;
}

export function subsets(n: number): number[] {
  const out: number[] = [];
  const total = 1 << n;
  for (let mask = 0; mask < total; mask++) out.push(mask);
  return out;
}

export function nonemptySubsets(n: number): number[] {
  return subsets(n).filter((m) => m !== 0);
}

// 真联盟：非空且不等于大联盟
export function properCoalitions(n: number): number[] {
  const grand = (1 << n) - 1;
  return nonemptySubsets(n).filter((m) => m !== grand);
}

export function membersOf(mask: number, players: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < players.length; i++) if (mask & (1 << i)) out.push(players[i]);
  return out;
}

export function coalitionKey(mask: number, players: string[]): string {
  return membersOf(mask, players).join(",");
}

function parseKey(key: string, index: Map<string, number>): number {
  const parts = key
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) throw new Error(`非法联盟键: "${key}"`);
  let mask = 0;
  const seen = new Set<string>();
  for (const p of parts) {
    const idx = index.get(p);
    if (idx === undefined) throw new Error(`联盟 "${key}" 包含未知参与者 "${p}"`);
    if (seen.has(p)) throw new Error(`联盟 "${key}" 中参与者 "${p}" 重复`);
    seen.add(p);
    mask |= 1 << idx;
  }
  return mask;
}

export function buildGame(input: GameInput): Game {
  if (!Array.isArray(input.players)) throw new Error("players 必须为数组");
  const players = input.players.map((p) => String(p));
  if (players.length < 2 || players.length > 8) {
    throw new Error("参与者数量必须在 2 到 8 之间");
  }
  if (new Set(players).size !== players.length) {
    throw new Error("参与者编号必须唯一");
  }
  if (players.some((p) => p.includes(","))) {
    throw new Error('参与者编号不能包含逗号 ","');
  }
  const index = new Map<string, number>();
  players.forEach((p, i) => index.set(p, i));

  const values = new Map<number, Fraction>();
  values.set(0, Fraction.ZERO);
  for (const [rawKey, rawValue] of Object.entries(input.values ?? {})) {
    const mask = parseKey(rawKey, index);
    const v = Fraction.from(rawValue);
    const old = values.get(mask);
    if (old !== undefined && !old.equals(v)) {
      throw new Error(`联盟 "${rawKey}" 存在冲突价值: ${old} 与 ${v}`);
    }
    values.set(mask, v);
  }

  const n = players.length;
  const missing: string[] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    if (!values.has(mask)) missing.push(coalitionKey(mask, players));
  }
  if (missing.length) {
    throw new Error(`缺少 ${missing.length} 个联盟价值，例如: ${missing.slice(0, 5).join("; ")}`);
  }
  return { players, index, values, name: input.name };
}

export function valueOf(game: Game, mask: number): Fraction {
  const v = game.values.get(mask);
  if (v === undefined) throw new Error(`缺少联盟价值: mask=${mask}`);
  return v;
}

export function serializeGame(game: Game): GameInput {
  const values: Record<string, string> = {};
  for (const mask of nonemptySubsets(game.players.length)) {
    values[coalitionKey(mask, game.players)] = valueOf(game, mask).toString();
  }
  return { players: [...game.players], values, name: game.name };
}
