import { add, cmp, frac, fromString, sub, toString } from "./rational.js";
import { Game, allCoalitionMasks, coalitionKey, serializeGame, valueOf } from "./game.js";
import { ShapleyResult } from "./shapley.js";
import { LeastCoreResult, VerifyResult } from "./stability.js";

export interface FairnessReport {
  shapley: ShapleyResult;
  core: LeastCoreResult;
  summary: {
    grandCoalitionValue: string;
    efficiencyHolds: boolean;
    shapleyInCore: boolean | null;
    leastCoreEpsilon: string | null;
    coreEmpty: boolean | null;
    narrative: string;
  };
}

export function fairnessReport(
  game: Game,
  shapley: ShapleyResult,
  core: LeastCoreResult
): FairnessReport {
  const efficiencyHolds = shapley.total === shapley.grandCoalitionValue;
  let shapleyInCore: boolean | null = null;
  if (core.status === "optimal_confirmed") {
    shapleyInCore = checkShapleyCore(game, shapley);
  }
  const coreEmpty =
    core.status === "optimal_confirmed"
      ? cmp(fromString(core.epsilon!), frac(0n)) > 0
      : null;
  const narrative =
    core.status !== "optimal_confirmed"
      ? `稳定性未能确认：${core.reason ?? "求解失败"}`
      : core.inCore
        ? shapleyInCore
          ? "核心非空，且 Shapley 分配本身位于核心中：既有效率又对每个联盟稳定。"
          : "核心非空，但 Shapley 分配不在核心中：按边际贡献的公平分配未必是联盟稳定的。"
        : `核心为空（最小统一违约额 ε=${core.epsilon}）：任何满足总额的分配都会遭到至少一个联盟反对，ε 衡量最坏情况下必须容忍的不满程度。`;
  return {
    shapley,
    core,
    summary: {
      grandCoalitionValue: shapley.grandCoalitionValue,
      efficiencyHolds,
      shapleyInCore,
      leastCoreEpsilon: core.epsilon,
      coreEmpty,
      narrative,
    },
  };
}

function checkShapleyCore(game: Game, shapley: ShapleyResult): boolean {
  const x = game.players.map((p) => fromString(shapley.allocation[p]));
  for (const mask of allCoalitionMasks(game.n)) {
    if (mask === 0) continue;
    let got = frac(0n);
    for (let i = 0; i < game.n; i++) if (mask & (1 << i)) got = add(got, x[i]);
    if (cmp(got, valueOf(game, mask)) < 0) return false;
  }
  return true;
}

export interface RevisionComparison {
  changedCoalitions: {
    coalition: string;
    oldValue: string;
    newValue: string;
    delta: string;
  }[];
  oldShapley: ShapleyResult;
  newShapley: ShapleyResult;
  shapleyDelta: Record<string, string>;
  oldCore: LeastCoreResult;
  newCore: LeastCoreResult;
  narrative: string;
}

export function compareRevisions(
  oldGame: Game,
  newGame: Game,
  oldShapley: ShapleyResult,
  newShapley: ShapleyResult,
  oldCore: LeastCoreResult,
  newCore: LeastCoreResult
): RevisionComparison {
  const changed: RevisionComparison["changedCoalitions"] = [];
  for (const mask of allCoalitionMasks(oldGame.n)) {
    if (mask === 0) continue;
    const a = valueOf(oldGame, mask);
    const b = valueOf(newGame, mask);
    if (toString(a) !== toString(b)) {
      changed.push({
        coalition: coalitionKey(mask, oldGame.players),
        oldValue: toString(a),
        newValue: toString(b),
        delta: toString(sub(b, a)),
      });
    }
  }
  const delta: Record<string, string> = {};
  for (const p of oldGame.players) {
    delta[p] = toString(sub(fromString(newShapley.allocation[p]), fromString(oldShapley.allocation[p])));
  }
  const narrative =
    changed.length === 0
      ? "两次价值函数完全相同，结果无变化。"
      : `共修订 ${changed.length} 个联盟价值；Shapley 值与最小违约额随之变化，见明细对比。`;
  return {
    changedCoalitions: changed,
    oldShapley,
    newShapley,
    shapleyDelta: delta,
    oldCore,
    newCore,
    narrative,
  };
}

export interface ExportBundle {
  exportedAt: string;
  game: ReturnType<typeof serializeGame>;
  shapley?: ShapleyResult;
  verification?: VerifyResult;
  leastCore?: LeastCoreResult;
}

export function buildExport(
  game: Game,
  parts: { shapley?: ShapleyResult; verification?: VerifyResult; leastCore?: LeastCoreResult }
): ExportBundle {
  return { exportedAt: new Date().toISOString(), game: serializeGame(game), ...parts };
}
