import { Fraction, add, frac, mul, sub, toDecimal, toString } from "./rational.js";
import { Game, allCoalitionMasks, coalitionKey, valueOf } from "./game.js";

export interface MarginDetail {
  player: string;
  coalitionWithoutPlayer: string; // S（不含该玩家）
  coalitionWithPlayer: string; // S∪{i}
  coalitionSize: number; // |S|
  margin: string; // v(S∪i) - v(S)，精确分数
  weight: string; // |S|!(n-|S|-1)!/n!
  weightedContribution: string; // margin * weight
}

export interface ShapleyResult {
  allocation: Record<string, string>;
  decimals: Record<string, string>;
  total: string; // 必须精确等于大联盟价值
  grandCoalitionValue: string;
  permutations: number;
  details: MarginDetail[];
}

function factorial(x: number): bigint {
  let r = 1n;
  for (let i = 2; i <= x; i++) r *= BigInt(i);
  return r;
}

// 精确 Shapley：φ_i = Σ_S [|S|!(n-|S|-1)!/n!] (v(S∪i)-v(S))，S 不含 i
// 权重等于“i 在随机排列中恰好在 S 成员之后加入”的排列比例，
// 因此该求和与枚举全部 n! 个排列的边际贡献完全等价（实现中两种口径都会核算）。
export function shapley(game: Game): ShapleyResult {
  const n = game.n;
  const grand = (1 << n) - 1;
  const nFact = factorial(n);
  const allocation = new Map<number, Fraction>();
  const details: MarginDetail[] = [];

  for (let i = 0; i < n; i++) {
    let phi = frac(0n);
    for (const sMask of allCoalitionMasks(n)) {
      if (sMask & (1 << i)) continue;
      const size = popcount(sMask);
      const weight = frac(factorial(size) * factorial(n - size - 1), nFact);
      const margin = sub(valueOf(game, sMask | (1 << i)), valueOf(game, sMask));
      const wc = mul(margin, weight);
      phi = add(phi, wc);
      details.push({
        player: game.players[i],
        coalitionWithoutPlayer: coalitionKey(sMask, game.players),
        coalitionWithPlayer: coalitionKey(sMask | (1 << i), game.players),
        coalitionSize: size,
        margin: toString(margin),
        weight: toString(weight),
        weightedContribution: toString(wc),
      });
    }
    allocation.set(i, phi);
  }

  // 独立口径核对：枚举全部 n! 排列，累计边际贡献后除以 n!
  verifyByPermutations(game, allocation);

  const out: Record<string, string> = {};
  const dec: Record<string, string> = {};
  let total = frac(0n);
  for (let i = 0; i < n; i++) {
    const f = allocation.get(i)!;
    out[game.players[i]] = toString(f);
    dec[game.players[i]] = toDecimal(f);
    total = add(total, f);
  }
  const gv = valueOf(game, grand);
  if (toString(total) !== toString(gv)) {
    throw new Error(
      `效率性校验失败：Shapley 值之和 ${toString(total)} ≠ 大联盟价值 ${toString(gv)}`
    );
  }
  details.sort((a, b) =>
    a.player === b.player
      ? a.coalitionSize - b.coalitionSize ||
        a.coalitionWithoutPlayer.localeCompare(b.coalitionWithoutPlayer)
      : a.player.localeCompare(b.player)
  );
  return {
    allocation: out,
    decimals: dec,
    total: toString(total),
    grandCoalitionValue: toString(gv),
    permutations: Number(nFact),
    details,
  };
}

function popcount(m: number): number {
  let c = 0;
  while (m) {
    c += m & 1;
    m >>= 1;
  }
  return c;
}

function* permutations(n: number): Generator<number[]> {
  const a = Array.from({ length: n }, (_, i) => i);
  function* gen(k: number): Generator<number[]> {
    if (k === 1) {
      yield [...a];
      return;
    }
    yield* gen(k - 1);
    for (let i = 0; i < k - 1; i++) {
      if (k % 2 === 0) [a[i], a[k - 1]] = [a[k - 1], a[i]];
      else [a[0], a[k - 1]] = [a[k - 1], a[0]];
      yield* gen(k - 1);
    }
  }
  yield* gen(n);
}

function verifyByPermutations(game: Game, allocation: Map<number, Fraction>): void {
  const n = game.n;
  const nFact = factorial(n);
  const sums = new Map<number, Fraction>();
  for (let i = 0; i < n; i++) sums.set(i, frac(0n));
  for (const perm of permutations(n)) {
    let mask = 0;
    for (const i of perm) {
      const before = valueOf(game, mask);
      mask |= 1 << i;
      const after = valueOf(game, mask);
      sums.set(i, add(sums.get(i)!, sub(after, before)));
    }
  }
  for (let i = 0; i < n; i++) {
    const avg = mul(sums.get(i)!, frac(1n, nFact));
    if (toString(avg) !== toString(allocation.get(i)!)) {
      throw new Error(
        `排列枚举核对失败：玩家 ${game.players[i]} 的 Shapley 值在两种口径下不一致`
      );
    }
  }
}
