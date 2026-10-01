// 自行实现的两阶段单纯形（浮点，全部变量非负）。
// 自由变量用标准 x = u - v（u,v >= 0）拆分表示，因此“变量可为负”天然支持。
// Bland 规则保证有限步终止与确定性选基。

export type Op = "<=" | ">=" | "==";

export interface Constraint {
  a: number[];
  op: Op;
  b: number;
}

export interface LPResult {
  status: "optimal" | "infeasible" | "unbounded" | "failed";
  x: number[]; // 原空间结构变量（自由变量已由 u-v 还原）
  objective: number;
  iterations: number;
  reason?: string;
}

export interface LPSolveOptions {
  nonnegative?: boolean[]; // 原空间变量是否非负；默认全部自由
  extraEqualities?: { a: number[]; b: number }[];
  tolerance?: number;
  maxIterations?: number;
  // 对自由变量拆分 u-v 额外最小化 δ·Σ(u+v)，用于在最优解集合中消除
  // 无代价方向上的漂移（字典序次级规划的有界化），不改变主目标最优值
  freeRegularization?: number;
}

interface Internal {
  status: LPResult["status"];
  cols: number[]; // 原变量 -> 主列；自由变量主列为 u（v = 主列+1）
  free: boolean[];
  objective: number;
  iterations: number;
  reason?: string;
}

// min c·x
export function solveLP(c: number[], constraints: Constraint[], opts: LPSolveOptions = {}): LPResult {
  const nv = c.length;
  const nonnegative = opts.nonnegative ?? Array.from({ length: nv }, () => false);
  const free = nonnegative.map((b) => !b);
  const tol = opts.tolerance ?? 1e-10;
  const maxIter = opts.maxIterations ?? 50000;

  const rows = constraints.map((con) => {
    if (con.a.length !== nv) throw new Error("约束系数维度与变量数不一致");
    return { a: [...con.a], op: con.op, b: con.b };
  });
  for (const eq of opts.extraEqualities ?? []) {
    if (eq.a.length !== nv) throw new Error("附加等式约束维度不一致");
    rows.push({ a: [...eq.a], op: "==" as Op, b: eq.b });
  }
  const m = rows.length;

  // 列：非负变量 1 列；自由变量 2 列(u,v)；之后每行松弛列；需要时人工列
  let nc = 0;
  const cols: number[] = [];
  for (let j = 0; j < nv; j++) {
    cols.push(nc);
    nc += free[j] ? 2 : 1;
  }
  const slack: number[] = [];
  const art: number[] = [];
  for (const row of rows) {
    if (row.b < 0) {
      row.a = row.a.map((x) => -x);
      row.b = -row.b;
      row.op = row.op === "<=" ? ">=" : row.op === ">=" ? "<=" : "==";
    }
    slack.push(nc++);
    if (row.op !== "<=") art.push(nc++);
    else art.push(-1);
  }
  const artSet = new Set(art.filter((x) => x >= 0));

  const putCoeff = (line: number[], j: number, val: number): void => {
    line[cols[j]] += val;
    if (free[j]) line[cols[j] + 1] -= val;
  };

  const tab: number[][] = rows.map((row) => {
    const line = new Array(nc + 1).fill(0);
    for (let j = 0; j < nv; j++) putCoeff(line, j, row.a[j]);
    if (row.op === "<=") line[slack[rows.indexOf(row)]] = 1;
    else {
      if (row.op === ">=") line[slack[rows.indexOf(row)]] = -1;
      line[art[rows.indexOf(row)]] = 1;
    }
    line[nc] = row.b;
    return line;
  });
  const basis = rows.map((_, r) => (art[r] >= 0 ? art[r] : slack[r]));

  let iterations = 0;
  const pivot = (leave: number, enter: number): void => {
    const pv = tab[leave][enter];
    for (let j = 0; j <= nc; j++) tab[leave][j] /= pv;
    for (let r = 0; r < m; r++) {
      if (r === leave) continue;
      const f = tab[r][enter];
      if (f === 0) continue;
      for (let j = 0; j <= nc; j++) tab[r][j] -= f * tab[leave][j];
    }
    basis[leave] = enter;
    iterations++;
  };

  const makeObj = (cvec: number[]): number[] => {
    const z = new Array(nc + 1).fill(0);
    for (let j = 0; j < nv; j++) putCoeff(z, j, -cvec[j]);
    const delta = opts.freeRegularization ?? 0;
    if (delta > 0) {
      for (let j = 0; j < nv; j++) {
        if (free[j]) {
          z[cols[j]] -= delta; // u 列
          z[cols[j] + 1] -= delta; // v 列
        }
      }
    }
    for (let r = 0; r < m; r++) {
      const f = z[basis[r]];
      if (f !== 0) for (let j = 0; j <= nc; j++) z[j] -= f * tab[r][j];
    }
    return z;
  };

  const run = (z: number[], phase: 1 | 2): Internal["status"] => {
    while (iterations < maxIter) {
      let enter = -1;
      for (let j = 0; j < nc; j++) {
        if (phase === 2 && artSet.has(j)) continue;
        if (z[j] > tol) {
          enter = j;
          break;
        }
      }
      if (enter < 0) return "optimal";
      let leave = -1;
      let best = Infinity;
      for (let r = 0; r < m; r++) {
        const a = tab[r][enter];
        if (a <= tol) continue;
        const ratio = tab[r][nc] / a;
        if (ratio < -1e-9) continue;
        if (ratio < best - tol || (Math.abs(ratio - best) <= tol && (leave < 0 || basis[r] < basis[leave]))) {
          best = ratio;
          leave = r;
        }
      }
      if (leave < 0) return "unbounded";
      pivot(leave, enter);
      const f = z[enter];
      for (let j = 0; j <= nc; j++) z[j] -= f * tab[leave][j];
    }
    return "failed";
  };

  if (artSet.size > 0) {
    const w = new Array(nc + 1).fill(0);
    for (let r = 0; r < m; r++) {
      for (let j = 0; j <= nc; j++) w[j] += tab[r][j];
    }
    for (let r = 0; r < m; r++) w[basis[r]] -= 1;
    const p1 = run(w, 1);
    if (p1 !== "optimal") return { status: "failed", x: [], objective: NaN, iterations, reason: `第一阶段${p1}` };
    if (w[nc] > 1e-7 * Math.max(1, m)) {
      return { status: "infeasible", x: [], objective: NaN, iterations, reason: "第一阶段最优值 > 0，约束不可行" };
    }
    for (let r = 0; r < m; r++) {
      if (artSet.has(basis[r])) {
        let col = -1;
        for (let j = 0; j < nc; j++) if (!artSet.has(j) && Math.abs(tab[r][j]) > 1e-9) { col = j; break; }
        if (col >= 0) pivot(r, col);
      }
    }
  }

  const z = makeObj(c);
  const p2 = run(z, 2);
  if (p2 === "unbounded") return { status: "unbounded", x: [], objective: -Infinity, iterations };
  if (p2 !== "optimal") return { status: "failed", x: [], objective: NaN, iterations, reason: "第二阶段未收敛" };

  const colVal = new Array(nc).fill(0);
  for (let r = 0; r < m; r++) colVal[basis[r]] = tab[r][nc];
  const x = c.map((_, j) =>
    free[j] ? colVal[cols[j]] - colVal[cols[j] + 1] : colVal[cols[j]]
  );
  return { status: "optimal", x, objective: z[nc], iterations };
}
