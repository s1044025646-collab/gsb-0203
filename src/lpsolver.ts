// 自研两阶段单纯形求解器（浮点）。
// 支持 <= / = / >= 约束与非负变量；自由变量请在建模层拆为 x+ - x-。
// 使用 Bland 规则作为公开、确定性的反循环选基规则。

export type Sense = "<=" | "=" | ">=";

export interface LPConstraint {
  coeffs: number[]; // 每个变量一列
  sense: Sense;
  rhs: number;
}

export interface LPResult {
  status: "optimal" | "infeasible" | "unbounded" | "undetermined";
  x: number[]; // 原始变量（不含松弛/人工变量）
  objective: number;
  iterations: number;
  reason?: string;
}

export interface LPOptions {
  tolerance?: number;
  maxIterations?: number;
}

export function solveLP(
  nVars: number,
  constraints: LPConstraint[],
  objective: number[],
  opts: LPOptions = {}
): LPResult {
  const tol = opts.tolerance ?? 1e-9;
  const maxIter = opts.maxIterations ?? 10000;

  // 组装列：原始变量 + 每行一个松弛/剩余变量 + 必要时人工变量。
  const m = constraints.length;
  const slackStart = nVars;
  const artificialForRow: (number | null)[] = new Array(m).fill(null);
  let artCount = 0;
  const rows: number[][] = constraints.map((c, r) => {
    if (c.coeffs.length !== nVars) throw new Error(`第 ${r + 1} 行约束列数不匹配`);
    let rhs = c.rhs;
    const coeff = [...c.coeff];
    if (rhs < 0) {
      for (let j = 0; j < coeff.length; j++) coeff[j] = -coeff[j];
      rhs = -rhs;
    }
    coeff.push(...new Array(m).fill(0));
    if (c.sense === "<=") {
      coeff[slackStart + r] = 1;
    } else if (c.sense === ">=") {
      coeff[slackStart + r] = -1;
      const col = slackStart + m + artCount;
      coeff.push(0);
      coeff[col] = 1;
      artificialForRow[r] = col;
      artCount++;
    } else {
      const col = slackStart + m + artCount;
      coeff.push(0);
      coeff[col] = 1;
      artificialForRow[r] = col;
      artCount++;
    }
    coeff.push(rhs);
    return coeff;
  });

  const totalCols = slackStart + m + artCount;
  for (const row of rows) {
    while (row.length < totalCols + 1) row.splice(row.length - 1, 0, 0);
  }
  const basis = constraints.map((_, r) =>
    artificialForRow[r] === null ? slackStart + r : (artificialForRow[r] as number)
  );

  // ---- 第一阶段：最小化人工变量之和 ----
  if (artCount > 0) {
    const phaseOne = new Array(totalCols).fill(0);
    for (const col of artificialForRow) if (col !== null) phaseOne[col] = 1;
    const phase = pivotSimplex(rows, basis, phaseOne, { tol, maxIter, phase: 1 });
    if (phase.status !== "optimal") return { status: phase.status === "unbounded" ? "undetermined" : phase.status, x: [], objective: NaN, iterations: phase.iterations, reason: phase.reason };
    const artSum = phase.objective;
    if (artSum > 1e-7) {
      return { status: "infeasible", x: [], objective: NaN, iterations: phase.iterations, reason: `第一阶段人工变量和为 ${artSum}` };
    }
    // 人工变量仍在基中（退化）：选一个该位置非零的非人工列换入。
    for (let r = 0; r < m; r++) {
      if (basis[r] >= slackStart + m) {
        let pivot = -1;
        for (let j = 0; j < slackStart + m; j++) {
          if (Math.abs(rows[r][j]) > tol) { pivot = j; break; }
        }
        if (pivot === -1) {
          // 冗余行：移除
          rows.splice(r, 1);
          basis.splice(r, 1);
          r--;
        } else {
          gaussianIn(rows, r, pivot, basis, tol);
        }
      }
    }
  }

  // ---- 第二阶段：最小化真实目标 ----
  const phase2 = pivotSimplex(rows, basis, [...objective, ...new Array(totalCols - nVars).fill(0)], {
    tol,
    maxIter,
    phase: 2,
  });
  if (phase2.status !== "optimal") {
    return { status: phase2.status, x: [], objective: NaN, iterations: phase2.iterations, reason: phase2.reason };
  }

  const x = new Array(nVars).fill(0);
  for (let r = 0; r < basis.length; r++) {
    if (basis[r] < nVars) x[basis[r]] = rows[r][totalCols];
  }
  return { status: "optimal", x, objective: phase2.objective, iterations: phase2.iterations };
}

interface SimplexOutcome {
  status: "optimal" | "unbounded" | "undetermined";
  objective: number;
  iterations: number;
  reason?: string;
}

function pivotSimplex(
  rows: number[][],
  basis: number[],
  costs: number[],
  opts: { tol: number; maxIterations: number; phase: number }
): SimplexOutcome {
  const m = rows.length;
  const totalCols = costs.length;

  // 目标行：z = cB b - (cB B^-1 A - c) x，以 z 行系数 cB*row - c 表示；
  // 最小化问题中这些系数 < 0 的列可以改进目标。
  let objRow = new Array(totalCols + 1).fill(0);
  for (let r = 0; r < m; r++) {
    const cb = costs[basis[r]];
    for (let j = 0; j <= totalCols; j++) objRow[j] += cb * rows[r][j];
  }
  for (let j = 0; j < totalCols; j++) objRow[j] -= costs[j];

  let iterations = 0;
  while (iterations < opts.maxIterations) {
    iterations++;
    // Bland 规则：取下标最小的合格入基列。
    let enter = -1;
    for (let j = 0; j < totalCols; j++) {
      if (objRow[j] < -opts.tol) { enter = j; break; }
    }
    if (enter === -1) return { status: "optimal", objective: objRow[totalCols], iterations };

    let leave = -1;
    let bestRatio = Infinity;
    for (let r = 0; r < m; r++) {
      const a = rows[r][enter];
      if (a > opts.tol) {
        const ratio = rows[r][totalCols] / a;
        if (ratio < -opts.tol) continue;
        // Bland 平手时取基变量下标最小的行。
        if (ratio + opts.tol < bestRatio || (Math.abs(ratio - bestRatio) <= opts.tol && (leave === -1 || basis[r] < basis[leave]))) {
          bestRatio = ratio;
          leave = r;
        }
      }
    }
    if (leave === -1) return { status: "unbounded", objective: NaN, iterations, reason: "目标无下界" };

    gaussianIn(rows, leave, enter, basis, opts.tol, objRow);
  }
  return { status: "undetermined", objective: NaN, iterations, reason: "超过最大迭代次数" };
}

function gaussianIn(
  rows: number[][],
  leaveRow: number,
  enterCol: number,
  basis: number[],
  tol: number,
  objRow?: number[]
): void {
  const lastCol = rows[0].length - 1;
  const pivot = rows[leaveRow][enterCol];
  if (Math.abs(pivot) < tol) throw new Error("主元过小");
  for (let j = 0; j <= lastCol; j++) rows[leaveRow][j] /= pivot;
  rows[leaveRow][enterCol] = 1;
  for (let r = 0; r < rows.length; r++) {
    if (r === leaveRow) continue;
    const factor = rows[r][enterCol];
    if (factor === 0) continue;
    for (let j = 0; j <= lastCol; j++) rows[r][j] -= factor * rows[leaveRow][j];
    rows[r][enterCol] = 0;
  }
  if (objRow) {
    const factor = objRow[enterCol];
    for (let j = 0; j <= lastCol; j++) objRow[j] -= factor * rows[leaveRow][j];
    objRow[enterCol] = 0;
  }
  basis[leaveRow] = enterCol;
}

// 连分数法有理重建：寻找分母不超过 maxDenominator、与 x 最接近的分数。
export function rationalReconstruct(x: number, maxDenominator = 1_000_000n): { num: bigint; den: bigint } {
  if (!Number.isFinite(x)) throw new Error("解中出现非有限数");
  const negative = x < 0;
  let a = negative ? -x : x;
  let h1 = 1n, h0 = 0n;
  let k1 = 0n, k0 = 1n;
  const bound = maxDenominator;
  for (let guard = 0; guard < 200; guard++) {
    const q = BigInt(Math.floor(a));
    const h2 = q * h1 + h0;
    const k2 = q * k1 + k0;
    if (k2 > bound) break;
    h0 = h1; h1 = h2;
    k0 = k1; k1 = k2;
    const rem = a - Number(q);
    if (Math.abs(rem) < 1e-14) break;
    a = 1 / rem;
  }
  const num = negative ? -h1 : h1;
  return { num, den: k1 };
}
