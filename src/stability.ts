import {
  Fraction,
  add,
  cmp,
  frac,
  fromNumberExact,
  fromString,
  neg,
  sub,
  toDecimal,
  toString,
} from "./rational.js";
import { Game, coalitionKey, nonemptyProperMasks, valueOf } from "./game.js";
import { Constraint, LPSolveOptions, solveLP } from "./lp.js";

export interface AllocationInput {
  allocation: Record<string, string | number>;
}

export interface CoalitionCheck {
  coalition: string;
  allocatedToCoalition: string;
  coalitionValue: string;
  slack: string; // 分配和 - v(S)；负即被反对
  decimalSlack: string;
}

export interface VerifyResult {
  totalAllocated: string;
  grandCoalitionValue: string;
  totalSlack: string;
  totalMatches: boolean;
  core: boolean;
  maxViolationCoalition: string | null;
  maxViolation: string; // 最负松弛量（0 表示无违约）
  coalitionChecks: CoalitionCheck[];
}

export const DEFAULT_TOLERANCE = 1e-9;

function parseAllocation(game: Game, allocation: Record<string, string | number>): Fraction[] {
  const x: Fraction[] = [];
  for (const p of game.players) {
    if (!(p in allocation)) throw new Error(`分配向量缺少参与者: "${p}"`);
    const raw = allocation[p];
    x.push(typeof raw === "number" ? fromString(String(raw)) : fromString(raw));
  }
  for (const key of Object.keys(allocation)) {
    if (!game.index.has(key)) throw new Error(`分配向量包含未登记参与者: "${key}"`);
  }
  return x;
}

function coalitionSum(game: Game, x: Fraction[], mask: number): Fraction {
  let s = frac(0n);
  for (let i = 0; i < game.n; i++) if (mask & (1 << i)) s = add(s, x[i]);
  return s;
}

// 核验外部分配向量：总额 + 每个非空真联盟
export function verifyAllocation(game: Game, allocation: Record<string, string | number>): VerifyResult {
  const x = parseAllocation(game, allocation);
  const grand = (1 << game.n) - 1;
  const checks: CoalitionCheck[] = [];
  let worst: { coalition: string; slack: Fraction } | null = null;

  for (const mask of nonemptyProperMasks(game.n)) {
    const got = coalitionSum(game, x, mask);
    const v = valueOf(game, mask);
    const slack = sub(got, v);
    checks.push({
      coalition: coalitionKey(mask, game.players),
      allocatedToCoalition: toString(got),
      coalitionValue: toString(v),
      slack: toString(slack),
      decimalSlack: toDecimal(slack),
    });
    if (!worst || cmp(slack, worst.slack) < 0) {
      worst = { coalition: coalitionKey(mask, game.players), slack };
    }
  }
  checks.sort((a, b) => a.coalition.localeCompare(b.coalition));

  const total = coalitionSum(game, x, grand);
  const gv = valueOf(game, grand);
  const totalSlack = sub(total, gv);
  const totalMatches = cmp(total, gv) === 0;
  const core = totalMatches && !!worst && cmp(worst.slack, frac(0n)) >= 0;
  const maxViolation =
    worst && cmp(worst.slack, frac(0n)) < 0 ? worst.slack : frac(0n);
  return {
    totalAllocated: toString(total),
    grandCoalitionValue: toString(gv),
    totalSlack: toString(totalSlack),
    totalMatches,
    core,
    maxViolationCoalition: maxViolation.num < 0n ? worst!.coalition : null,
    maxViolation: toString(maxViolation),
    coalitionChecks: checks,
  };
}

export interface LeastCoreOptions {
  tolerance?: number;
}

export interface LeastCoreResult {
  status: "optimal_confirmed" | "undetermined";
  inCore: boolean;
  epsilon: string | null; // 精确分数（连分数重构）
  epsilonDecimal: string | null;
  allocation: Record<string, string> | null;
  allocationDecimals: Record<string, string> | null;
  totalAllocated: string | null;
  tolerance: number;
  iterations: number;
  reason?: string;
  residualChecks: CoalitionCheck[] | null;
  worstResidualSlack: string | null;
}

// 最小非负统一违约额：
//   min e  s.t. sum x = v(N);  sum_{i in S} x_i >= v(S) - e 对所有非空真联盟 S；e >= 0
// 分配变量 x 为自由变量（可为负；求解器内部以 x=u-v 拆分，不增加非负约束）。
// 最优解不唯一时的公开确定性选取规则：在所有 e 最优解中，按参与者编号顺序
//   依次最小化 x_1, x_2, ...（分层 LP，等式固定前序取值）；为消除自由变量沿
//   无代价方向漂移造成的无界，次级目标对拆分变量 u+v 加 1e-8 的极小正则项
//   （远低于容差核验标准，不改变主目标最优性）。
export function leastCore(game: Game, opts: LeastCoreOptions = {}): LeastCoreResult {
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE;
  const n = game.n;
  const masks = nonemptyProperMasks(n);
  const grand = (1 << n) - 1;
  // 变量顺序：x_0..x_{n-1}（自由），e（非负）
  const nv = n + 1;
  const nonnegative = Array.from({ length: nv }, (_, j) => j === n);
  const constraints: Constraint[] = [];
  constraints.push({
    a: [...Array.from({ length: n }, () => 1), 0],
    op: "==",
    b: Number(valueOf(game, grand).num) / Number(valueOf(game, grand).den),
  });
  for (const mask of masks) {
    const vf = valueOf(game, mask);
    constraints.push({
      a: [
        ...Array.from({ length: n }, (_, i) => (mask & (1 << i) ? 1 : 0)),
        1,
      ],
      op: ">=",
      b: Number(vf.num) / Number(vf.den),
    });
  }
  const c = [...Array.from({ length: n }, () => 0), 1];
  const first = solveLP(c, constraints, { nonnegative, tolerance: tol });
  if (first.status !== "optimal") {
    return {
      status: "undetermined",
      inCore: false,
      epsilon: null,
      epsilonDecimal: null,
      allocation: null,
      allocationDecimals: null,
      totalAllocated: null,
      tolerance: tol,
      iterations: first.iterations,
      reason: `初始 LP 求解状态为 ${first.status}${first.reason ? `：${first.reason}` : ""}`,
      residualChecks: null,
      worstResidualSlack: null,
    };
  }

  let eNum = first.objective;
  if (eNum < 0 && eNum > -1e-8) eNum = 0;
  let xNum = first.x.slice(0, n);
  let totalIter = first.iterations;

  // 字典序确定性选解：固定 e，再按编号顺序依次最小化 x_j
  const eFixed = [
    { a: [...Array.from({ length: n }, () => 0), 1], b: eNum },
  ];
  const prior: { a: number[]; b: number }[] = [];
  for (let j = 0; j < n; j++) {
    const cj = Array.from({ length: nv }, () => 0);
    cj[j] = 1;
    const rj = solveLP(cj, constraints, {
      nonnegative,
      tolerance: tol,
      extraEqualities: [...eFixed, ...prior],
      freeRegularization: 1e-8,
    });
    if (rj.status !== "optimal") {
      return {
        status: "undetermined",
        inCore: false,
        epsilon: null,
        epsilonDecimal: null,
        allocation: null,
        allocationDecimals: null,
        totalAllocated: null,
        tolerance: tol,
        iterations: totalIter + rj.iterations,
        reason: `字典序选解第 ${j + 1} 步 LP 状态为 ${rj.status}`,
        residualChecks: null,
        worstResidualSlack: null,
      };
    }
    xNum = rj.x.slice(0, n);
    eNum = rj.x[n];
    totalIter += rj.iterations;
    prior.push({
      a: Array.from({ length: nv }, (_, k) => (k === j ? 1 : 0)),
      b: xNum[j], // 固定该参与者在原空间的选取值（不含正则扰动）
    });
  }

  // 精确重构 + 残差核验（BigInt 精确）
  const epsFrac = fromNumberExact(eNum);
  const xFrac = xNum.map((v) => fromNumberExact(v));
  const checks: CoalitionCheck[] = [];
  let worstSlack: Fraction | null = null;
  for (const mask of masks) {
    let got = frac(0n);
    for (let i = 0; i < n; i++) if (mask & (1 << i)) got = add(got, xFrac[i]);
    const slack = add(sub(got, valueOf(game, mask)), epsFrac); // got - v(S) + e >= 0
    checks.push({
      coalition: coalitionKey(mask, game.players),
      allocatedToCoalition: toString(got),
      coalitionValue: toString(valueOf(game, mask)),
      slack: toString(sub(got, valueOf(game, mask))),
      decimalSlack: toDecimal(sub(got, valueOf(game, mask))),
    });
    if (!worstSlack || cmp(slack, worstSlack) < 0) worstSlack = slack;
  }
  let total = frac(0n);
  for (const f of xFrac) total = add(total, f);
  const totalErr = Math.abs(Number(sub(total, valueOf(game, grand)).num) / Number(sub(total, valueOf(game, grand)).den));

  const residualOk = !!worstSlack && cmp(worstSlack, frac(0n)) >= 0;
  const epsNonNeg = cmp(epsFrac, frac(0n)) >= 0;
  const confirmed = residualOk && totalErr <= tol && epsNonNeg;
  if (!confirmed) {
    return {
      status: "undetermined",
      inCore: false,
      epsilon: toString(epsFrac),
      epsilonDecimal: toDecimal(epsFrac),
      allocation: Object.fromEntries(game.players.map((p, i) => [p, toString(xFrac[i])])),
      allocationDecimals: Object.fromEntries(game.players.map((p, i) => [p, toDecimal(xFrac[i])])),
      totalAllocated: toString(total),
      tolerance: tol,
      iterations: totalIter,
      reason: `精确残差核验未通过（总额误差 ${totalErr.toExponential(2)}，最差调整后松弛 ${toString(
        worstSlack ?? frac(0n)
      )}），无法确认最优`,
      residualChecks: checks.sort((a, b) => a.coalition.localeCompare(b.coalition)),
      worstResidualSlack: worstSlack ? toString(worstSlack) : null,
    };
  }

  const inCore = cmp(epsFrac, frac(0n)) === 0;
  return {
    status: "optimal_confirmed",
    inCore,
    epsilon: toString(epsFrac),
    epsilonDecimal: toDecimal(epsFrac),
    allocation: Object.fromEntries(game.players.map((p, i) => [p, toString(xFrac[i])])),
    allocationDecimals: Object.fromEntries(game.players.map((p, i) => [p, toDecimal(xFrac[i])])),
    totalAllocated: toString(total),
    tolerance: tol,
    iterations: totalIter,
    residualChecks: checks.sort((a, b) => a.coalition.localeCompare(b.coalition)),
    worstResidualSlack: toString(worstSlack ?? frac(0n)),
  };
}
