import { Fraction } from "./rational.js";
import { Game, coalitionKey, membersOf, valueOf } from "./coalition.js";

export interface MarginalDetail {
  player: string;
  precedingCoalition: string[];
  marginalContribution: string;
  permutationWeight: string; // |S|!(n-|S|-1)! / n!
  weightedContribution: string;
}

export interface PlayerShapley {
  player: string;
  value: string;
  decimal: string;
}

export interface ShapleyResult {
  values: PlayerShapley[];
  total: string;
  totalDecimal: string;
  details: MarginalDetail[];
  method: string;
}

function factorial(k: number): bigint {
  let r = 1n;
  for (let i = 2; i <= k; i++) r *= BigInt(i);
  return r;
}

export function shapley(game: Game, decimals = 12): ShapleyResult {
  const n = game.players.length;
  const grand = (1 << n) - 1;
  const nFact = factorial(n);
  const phi: Fraction[] = new Array(n).fill(Fraction.ZERO);
  const details: MarginalDetail[] = [];

  for (let i = 0; i < n; i++) {
    const bit = 1 << i;
    for (let sMask = 0; sMask <= grand; sMask++) {
      if (sMask & bit) continue;
      const size = countBits(sMask);
      const marginal = valueOf(game, sMask | bit).sub(valueOf(game, sMask));
      // 有 |S|!(n-|S|-1)! 个排列中 i 恰好在集合 S 之后。
      const weight = Fraction.make(factorial(size) * factorial(n - size - 1), nFact);
      const weighted = marginal.mul(weight);
      phi[i] = phi[i].add(weighted);
      details.push({
        player: game.players[i],
        precedingCoalition: membersOf(sMask, game.players),
        marginalContribution: marginal.toString(),
        permutationWeight: weight.toString(),
        weightedContribution: weighted.toString(),
      });
    }
  }

  const total = phi.reduce((a, b) => a.add(b), Fraction.ZERO);
  const expected = valueOf(game, grand);
  if (!total.equals(expected)) {
    throw new Error(`内部错误：Shapley 之和 ${total} 不等于大联盟价值 ${expected}`);
  }

  return {
    values: phi.map((f, i) => ({
      player: game.players[i],
      value: f.toString(),
      decimal: f.toDecimal(decimals),
    })),
    total: total.toString(),
    totalDecimal: total.toDecimal(decimals),
    details,
    method: "exact-weighted-marginals (BigInt rational)",
  };
}

function countBits(mask: number): number {
  let c = 0;
  while (mask) {
    c += mask & 1;
    mask >>= 1;
  }
  return c;
}

// 独立核对实现：枚举 n! 个排列，按每个排列的边际贡献取平均。
// 与主实现不共享权重公式，用于测试中交叉验证。
export function shapleyByPermutations(game: Game): Fraction[] {
  const n = game.players.length;
  const acc: Fraction[] = new Array(n).fill(Fraction.ZERO);
  let count = 0n;
  for (const perm of permutations([...game.players.keys()])) {
    let present = 0;
    for (const i of perm) {
      const before = valueOf(game, present);
      present |= 1 << i;
      const after = valueOf(game, present);
      acc[i] = acc[i].add(after.sub(before));
    }
    count++;
  }
  return acc.map((f) => f.div(Fraction.from(count)));
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) yield [items[i], ...tail];
  }
}

export function queryDetails(result: ShapleyResult, player?: string): MarginalDetail[] {
  return player ? result.details.filter((d) => d.player === player) : result.details;
}

export function formatDetailsCsv(result: ShapleyResult): string {
  const lines = ["player,precedingCoalition,marginalContribution,permutationWeight,weightedContribution"];
  for (const d of result.details) {
    lines.push(
      [d.player, `"${d.precedingCoalition.join("&")}"`, d.marginalContribution, d.permutationWeight, d.weightedContribution].join(",")
    );
  }
  return lines.join("\n");
}
