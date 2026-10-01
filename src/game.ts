import { Fraction, frac, fromString, toString } from "./rational.js";

// 联盟用规范化（排序、去重校验后）的成员编号集合表示。
// 成员书写顺序不改变联盟身份；成员重复直接拒绝。

export interface GameInput {
  players: string[];
  values: Record<string, string | number>; // 键: 逗号分隔成员；值: 整数或分数字符串
  name?: string;
}

export interface Game {
  name?: string;
  players: string[]; // 保留用户给定的唯一编号顺序
  index: Map<string, number>;
  n: number;
  // 以位掩码为键的特征函数；空联盟固定为 0
  v: Map<number, Fraction>;
}

export function coalitionKey(mask: number, players: string[]): string {
  const members: string[] = [];
  for (let i = 0; i < players.length; i++) {
    if (mask & (1 << i)) members.push(players[i]);
  }
  return members.join(",");
}

function parseMembers(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// 把任意书写顺序的成员列表规范化为位掩码；重复成员抛错
function membersToMask(members: string[], index: Map<string, number>, n: number): number {
  let mask = 0;
  for (const m of members) {
    const idx = index.get(m);
    if (idx === undefined) {
      throw new Error(`联盟包含未登记的参与者: "${m}"`);
    }
    const bit = 1 << idx;
    if (mask & bit) {
      throw new Error(`联盟内成员重复: "${m}"`);
    }
    mask |= bit;
  }
  return mask;
}

export function allCoalitionMasks(n: number): number[] {
  const total = 1 << n;
  const out: number[] = [];
  for (let m = 0; m < total; m++) out.push(m);
  return out;
}

export function nonemptyProperMasks(n: number): number[] {
  const grand = (1 << n) - 1;
  const out: number[] = [];
  for (let m = 1; m < grand; m++) out.push(m);
  return out;
}

export function buildGame(input: GameInput): Game {
  const players = input.players?.map((p) => String(p).trim()) ?? [];
  if (players.length < 2 || players.length > 8) {
    throw new Error(`参与者数量必须在 2 到 8 之间，当前为 ${players.length}`);
  }
  if (new Set(players).size !== players.length) {
    throw new Error("参与者编号必须唯一");
  }
  if (players.some((p) => p.includes(","))) {
    throw new Error('参与者编号不能包含逗号 ","');
  }
  const index = new Map<string, number>();
  players.forEach((p, i) => index.set(p, i));
  const n = players.length;
  const total = 1 << n;
  const grand = total - 1;
  const v = new Map<number, Fraction>();
  v.set(0, frac(0n)); // 空联盟价值固定为零，忽略任何外部提供

  const seen = new Map<number, string>();
  for (const [rawKey, rawVal] of Object.entries(input.values ?? {})) {
    const members = parseMembers(rawKey);
    if (members.length === 0) continue; // 空联盟固定为零
    const mask = membersToMask(members, index, n);
    const canonKey = coalitionKey(mask, players);
    if (seen.has(mask)) {
      throw new Error(
        `同一联盟被重复给出（成员顺序不改变身份）: "${rawKey}" 与 "${seen.get(mask)}"`
      );
    }
    seen.set(mask, rawKey);
    let value: Fraction;
    try {
      value = typeof rawVal === "number" ? fromString(String(rawVal)) : fromString(rawVal);
    } catch (e) {
      throw new Error(`联盟 "${canonKey}" 的价值无效: ${(e as Error).message}`);
    }
    v.set(mask, value);
  }

  // 必须给出全部联盟（不含空联盟）
  const missing: string[] = [];
  for (let m = 1; m <= grand; m++) {
    if (!v.has(m)) missing.push(coalitionKey(m, players));
  }
  if (missing.length > 0) {
    throw new Error(`缺少 ${missing.length} 个联盟的价值，例如: ${missing.slice(0, 5).join("; ")}`);
  }

  return { name: input.name, players, index, n, v };
}

export function valueOf(game: Game, mask: number): Fraction {
  const x = game.v.get(mask);
  if (!x) throw new Error(`内部错误: 联盟 ${mask} 无价值`);
  return x;
}

// 序列化为可持久化 JSON（精确分数字符串）
export function serializeGame(game: Game): GameInput & { name?: string } {
  const values: Record<string, string> = {};
  for (const m of allCoalitionMasks(game.n)) {
    if (m === 0) continue;
    values[coalitionKey(m, game.players)] = toString(valueOf(game, m));
  }
  return { name: game.name, players: [...game.players], values };
}

// 排列重排：按新的编号顺序重映射（用于编号重排不变性测试/比较）
export function relabelGame(game: Game, newOrder: string[]): Game {
  if (
    newOrder.length !== game.n ||
    new Set(newOrder).size !== game.n ||
    newOrder.some((p) => !game.index.has(p))
  ) {
    throw new Error("重排编号必须是原参与者集合的一个排列");
  }
  const values: Record<string, string> = {};
  for (const m of allCoalitionMasks(game.n)) {
    if (m === 0) continue;
    const members: string[] = [];
    for (let i = 0; i < game.n; i++) if (m & (1 << i)) members.push(game.players[i]);
    values[members.sort().join(",")] = toString(valueOf(game, m));
  }
  return buildGame({ name: game.name, players: newOrder, values });
}
