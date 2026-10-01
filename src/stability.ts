import { Fraction, sumFractions } from "./rational.js";
import { Game, coalitionKey, membersOf, properCoalitions, valueOf } from "./coalition.js";
import { rationalReconstruct, solveLP } from "./lpsolver.js";

export interface CoalitionObjection {
  coalition: string[];
  coalitionValue: string;
  allocated: string;
  slack: string; // 分配和 - 联盟价值；负数代表反对
  slackDecimal: string;
}

export interface VerifyResult {
  totalAllocated: string;
  grandCoalitionValue: string;
  totalGap: string;
  inCore: boolean;
  maxViolation: string;
  worstCoalition: CoalitionObjection | null;
  objections: CoalitionObjection[];
  allocation: Record<string, string>;
}

export type AllocationInput = Record<string, string | number> | (string | number)[];

export function parseAllocation(game: Game, input: AllocationInput): Map<number, Fraction> {
  const result = new Map<number, Fraction>();
  const seen = new Set<string>();
  const assign = (player: string, raw: string | number) => {
    const idx = game.index.get(player);
    if (idx === undefined) throw new Error(`分配向量包含未知参与者 "${player}"`);
    if (seen.has(player)) throw new Error(`参与者 "${player}" 重复出现`);
    seen.add(player);
    result.set(idx, Fraction.from(raw));
  };
  if (Array.isArray(input)) {
    if (input.length !== game.players.length) {
      throw new Error(`分配向量长度 ${input.length} 与参与者数 ${game.players.length} 不一致`);
    }
    game.players.forEach((p, i) => assign(p, input[i]));
  } else {
    for (const p of game.players) {
      if (!(p in input)) throw new Error(`分配向量缺少参与者 "${p}"`);
    }
    for (const [p, v] of Object.entries(input)) {
      if (!game.index.has(p)) throw new Error(`分配向量包含未知参与者 "${p}"`);
      assign(p, v);
    }
  }
  return result;
}

export function verifyAllocation(game: Game, allocation: Map<number, Fraction>, decimals = 12): VerifyResult {
  const n = game.players.length;
  const grand = (1 << n) - 1;
  const vec = game.players.map((_, i) => allocation.get(i) ?? Fraction.ZERO);
  const total = sumFractions(vec);
  const grandValue = valueOf(game, grand);
  const gap = total.sub(grandValue);

  const objections: CoalitionObjection[] = [];
  for (const mask of properCoalitions(n)) {
    const allocated = sumMask(vec, mask);
    const v = valueOf(game, mask);
    const slack = allocated.sub(v);
    objections.push({
      coalition: membersOf(mask, game.players),
      coalitionValue: v.toString(),
      allocated: allocated.toString(),
      slack: slack.toString(),
      slackDecimal: slack.toDecimal(decimals),
    });
  }

  let worst: CoalitionObjection | null = null;
  for (const o of objections) {
    if (!worst || Fraction.from(o.slack).compareTo(Fraction.from(worst.slack)) < 0) worst = o;
  }
  const maxViolation = worst ? Fraction.from(worst.slack) : Fraction.ZERO;

  const allocationRecord: Record<string, string> = {};
  game.players.forEach((p, i) => (allocationRecord[p] = vec[i].toString()));

  return {
    totalAllocated: total.toString(),
    grandCoalitionValue: grandValue.toString(),
    totalGap: gap.toString(),
    inCore: gap.isZero() && (maxViolation.isZero() || !maxViolation.isNegative()),
    maxViolation: maxViolation.toString(),
    worstCoalition: worst && maxViolation.isNegative() ? worst : worst && !maxViolation.isNegative() ? null : worst,
    objections: objections.filter((o) => Fraction.from(o.slack).isNegative()),
    allocation: allocationRecord,
  };
}

function sumMask(vec: Fraction[], mask: number): Fraction {
  let acc = Fraction.ZERO;
  for (let i = 0; i < vec.length; i++) if (mask & (1 << i)) acc = acc.add(vec[i]);
  return acc;
}

export interface EpsilonOptions {
  tolerance?: number;
  reconstructionBound?: bigint;
  decimals?: number;
}

export interface EpsilonResult {
  status: "core-feasible" | "least-core" | "infeasible" | "undetermined";
  epsilon: string | null;
  epsilonDecimal: string | null;
  allocation: Record<string, string> | null;
  allocationDecimal: Record<string, string> | null;
  coreFeasible: boolean;
  residualCheck: {
    totalGap: string;
    minSlack: string; // min(分配和 + epsilon - v(S))，非负才合格
    worstCoalition: string[] | null;
    exactVerified: boolean;
  };
  numericTolerance: number;
  lpIterations: number;
  tieBreakRule: string;
  reason?: string;
}

// 最小非负统一违约额：
//   min  epsilon
//   s.t. sum_{i in S} x_i + epsilon >= v(S)   对每个非空真联盟
//        sum_{i in N} x_i       =  v(N)
//        epsilon >= 0；x_i 为自由变量（允许为负，拆成 p_i - q_i）
export function minimalEpsilon(game: Game, opts: EpsilonOptions = {}): EpsilonResult {
  const n = game.players.length;
  const tol = opts.tolerance ?? 1e-9;
  const bound = opts.reconstructionBound ?? 1_000_000n;
  const decimals = opts.decimals ?? 12;

  // 列：p_0..p_{n-1}, q_0..q_{n-1}, epsilon
  const col = (kind: "p" | "q" | "e", i = 0) =>
    kind === "p" ? i : kind === "q" ? n + i : 2 * n;
  const constraints = [];
  for (const mask of properCoalitions(n)) {
    const coeffs = new Array(2 * n + 1).fill(0);
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        coeffs[col("p", i)] = 1;
        coeffs[col("q", i)] = -1;
      }
    }
    coeffs[col("e")] = 1;
    constraints.push({ coeffs, sense: ">=" as const, rhs: valueOf(game, mask).toNumber() });
  }
  const grand = (1 << n) - 1;
  const eq = new Array(2 * n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    eq[col("p", i)] = 1;
    eq[col("q", i)] = -1;
  }
  constraints.push({ coeffs: eq, sense: "=" as const, rhs: valueOf(game, grand).toNumber() });
  const objective = new Array(2 * n + 1).fill(0);
  objective[col("e")] = 1;

  const lp = solveLP(2 * n + 1, constraints, objective, { tolerance: tol });
  if (lp.status !== "optimal") {
    return {
      status: lp.status === "infeasible" ? "infeasible" : "undetermined",
      epsilon: null,
      epsilonDecimal: null,
      allocation: null,
      allocationDecimal: null,
      coreFeasible: false,
      residualCheck: { totalGap: "", minSlack: "", worstCoalition: null, exactVerified: false },
      numericTolerance: tol,
      lpIterations: lp.iterations,
      tieBreakRule: TIE_RULE,
      reason: lp.reason ?? `线性规划求解状态: ${lp.status}`,
    };
  }

  // 由浮点基可行解有理重建，然后全部用 BigInt 复核残差。
  const alloc = new Map<number, Fraction>();
  const allocRecord: Record<string, string> = {};
  const allocDecimal: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const xf = lp.x[col("p", i)] - lp.x[col("q", i)];
    const r = rationalReconstruct(xf, bound);
    const f = Fraction.make(r.num, r.den);
    alloc.set(i, f);
    allocRecord[game.players[i]] = f.toString();
    allocDecimal[game.players[i]] = f.toDecimal(decimals);
  }
  const rec = rationalReconstruct(Math.max(0, lp.x[col("e")]), bound);
  let epsilon = Fraction.make(rec.num, rec.den);

  const vec = game.players.map((_, i) => alloc.get(i) ?? Fraction.ZERO);
  const totalGap = sumFractions(vec).sub(valueOf(game, grand));

  // 精确残差核验；若重建的 epsilon 偏小，则用该固定分配的真实所需值替换，
  // 但只要该值与 LP 浮点最优值差距超出容差，结论仍标为未判定。
  let minSlack: Fraction | null = null;
  let worstMask = -1;
  for (const mask of properCoalitions(n)) {
    const slack = sumMask(vec, mask).add(epsilon).sub(valueOf(game, mask));
    if (minSlack === null || slack.compareTo(minSlack) < 0) {
      minSlack = slack;
      worstMask = mask;
    }
  }
  let exactEpsilon = epsilon;
  if (minSlack !== null && minSlack.isNegative()) {
    exactEpsilon = epsilon.sub(minSlack);
  }

  const recomputeMinSlack = (eps: Fraction): { slack: Fraction; mask: number } => {
    let slack: Fraction | null = null;
    let mask = -1;
    for (const m of properCoalitions(n)) {
      const s = sumMask(vec, m).add(eps).sub(valueOf(game, m));
      if (slack === null || s.compareTo(slack) < 0) { slack = s; mask = m; }
    }
    return { slack: slack as Fraction, mask };
  };
  const check = recomputeMinSlack(exactEpsilon);
  const epsilonFloatGap = Math.abs(exactEpsilon.toNumber() - lp.objective);
  const exactVerified = totalGap.isZero() && !check.slack.isNegative() && epsilonFloatGap <= Math.max(tol, 1e-7) * Math.max(1, Math.abs(lp.objective));

  if (!exactVerified) {
    return {
      status: "undetermined",
      epsilon: exactEpsilon.toString(),
      epsilonDecimal: exactEpsilon.toDecimal(decimals),
      allocation: allocRecord,
      allocationDecimal: allocDecimal,
      coreFeasible: false,
      residualCheck: {
        totalGap: totalGap.toString(),
        minSlack: check.slack.toString(),
        worstCoalition: check.mask >= 0 ? membersOf(check.mask, game.players) : null,
        exactVerified: false,
      },
      numericTolerance: tol,
      lpIterations: lp.iterations,
      tieBreakRule: TIE_RULE,
      reason: `有理重建后残差核验未通过（总额差=${totalGap}, epsilon浮点差=${epsilonFloatGap}）`,
    };
  }

  const coreFeasible = exactEpsilon.isZero();
  return {
    status: coreFeasible ? "core-feasible" : "least-core",
    epsilon: exactEpsilon.toString(),
    epsilonDecimal: exactEpsilon.toDecimal(decimals),
    allocation: allocRecord,
    allocationDecimal: allocDecimal,
    coreFeasible,
    residualCheck: {
      totalGap: totalGap.toString(),
      minSlack: check.slack.toString(),
      worstCoalition: check.mask >= 0 ? membersOf(check.mask, game.players) : null,
      exactVerified: true,
    },
    numericTolerance: tol,
    lpIterations: lp.iterations,
    tieBreakRule: TIE_RULE,
  };
}

export const TIE_RULE =
  "线性规划使用两阶段单纯形与 Bland 最小下标规则；变量顺序为 p_0,q_0,...,p_{n-1},q_{n-1},epsilon；浮点解经连分数有理重建（分母上限 10^6）后用 BigInt 复核全部约束";
