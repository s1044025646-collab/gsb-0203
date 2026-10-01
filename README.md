# 可转移效用合作博弈分配与联盟稳定性后端

纯本地后端（仅 API + CLI，无前端），用于求解小规模**可转移效用合作博弈（TU Cooperative Game）**：

- **精确 Shapley 值**：BigInt 有理数，按边际贡献与排列权重聚合，并**独立枚举全部 n! 排列**交叉核对；
- **核心（Core）核验**：检查外部分配向量的总额约束与**每一个非空真联盟**，给出松弛量与最大违约联盟；
- **最小统一违约额 ε（最小核 / least-core）**：自行构造约束、自行实现两阶段单纯形 LP，
  求满足总额约束的最小非负 ε，使所有非空真联盟满足 `Σx_i ≥ v(S) − ε`，并返回一份实现该 ε 的分配；
- 每次价值函数与求解配置的**快照持久化到项目内 SQLite**，可重启后复核历史。

> 本工具处理的是**合作博弈特征函数**（每个联盟一个价值），不是双方对抗的收益矩阵；
> 不依赖任何外部经济数据或在线服务。

## 环境要求

- Windows + Node.js **≥ 22.5**（推荐 24/25；使用内置实验模块 `node:sqlite`，已用 `--no-warnings` 静默提示）
- 无需 Docker、WSL、编译器、付费服务或任何在线 API

## 安装与构建

```powershell
npm install
npm run build
```

## 测试

```powershell
npm test
```

覆盖：可加博弈、虚拟参与者、对称参与者、负收益、三人多数博弈（ε=1/3、核心为空）、
效率性、对称性、线性性、编号重排不变性、4 人 24 排列独立枚举、输入校验（重复成员、
顺序冲突、缺联盟、非法分数等）、错误方案证据、确定性选解可重复性。

## 启动 HTTP 服务

```powershell
# 默认端口 8080，数据目录 ./data
npm start

# 自定义端口与数据目录
$env:PORT="9000"; $env:TUGAME_DATA_DIR="E:\tugame-data"; npm start
```

健康检查：`GET http://localhost:8080/health`

### API 一览（除 /health、/api/runs 外均为 POST，JSON）

| 路径 | 说明 |
| --- | --- |
| `POST /api/games/validate` | 校验并规范化博弈输入 |
| `POST /api/shapley` | 精确 Shapley 值 |
| `POST /api/shapley/details` | Shapley 值 + 按玩家/联盟查询贡献明细（body 可带 `player`） |
| `POST /api/verify` | 核验外部分配向量（body：`{game, allocation}`） |
| `POST /api/least-core` | 最小统一违约额 ε 与实现分配（裸博弈或 `{game}` 均可） |
| `POST /api/report` | 公平性 + 稳定性综合报告 |
| `POST /api/revise` | 两份价值函数修订对比（`{oldGame, newGame}`） |
| `POST /api/export` | 导出 JSON 包（`include: ["shapley","leastcore"]`，可带 `allocation`） |
| `GET  /api/runs?limit=` | 历史列表 |
| `GET  /api/runs/:id` | 某次价值函数/配置/结果快照复核 |

### 博弈输入格式

```json
{
  "name": "可选名称",
  "players": ["A", "B", "C"],
  "values": {
    "A": "0",
    "B": "0",
    "C": "0",
    "A,B": "1",
    "A,C": "1",
    "B,C": "1",
    "A,B,C": "1"
  }
}
```

- 参与者 2–8 个，编号唯一；联盟键为逗号分隔的成员集合，**成员书写顺序不改变联盟身份**
  （`"A,B"` 与 `"B,A"` 是同一联盟，重复提交即拒绝）；
- 联盟内成员重复、引用未登记成员、缺少任意联盟价值、同一联盟冲突值都会返回 400；
- 价值接受**整数或分数字符串**（`"2"`、`"-1/4"`、`"3/2"`），可为负；空联盟价值固定为 0（忽略外部输入）。

### PowerShell 调用示例

```powershell
$body = Get-Content examples/majority3.json -Raw
Invoke-RestMethod -Uri http://localhost:8080/api/least-core -Method Post -ContentType 'application/json' -Body $body
```

## CLI

```powershell
# 开发态（tsx，免构建）
npm run cli -- shapley examples/majority3.json

# 构建后
node dist/src/cli.js report examples/majority3.json
```

命令：`validate | shapley | verify | leastcore | report | revise | export | history`

```powershell
node dist/src/cli.js shapley  examples/majority3.json
node dist/src/cli.js verify   examples/majority3.json examples/bad-allocation.json
node dist/src/cli.js leastcore examples/majority3.json
node dist/src/cli.js history          # 列表
node dist/src/cli.js history 1        # 查看 id=1 的完整快照
```

CLI 写库位置由环境变量 `TUGAME_DATA_DIR` 控制，默认 `./data`。

## 一键演示

```powershell
npm run demo
```

演示依次展示：

1. 三人多数博弈中，**公平的 Shapley 分配（各 1/3）仍被每个二人联盟反对**（松弛 −1/3），核心为空、ε=1/3；
2. 把联盟 `{A,C}` 价值从 1 改为 3/2 后，Shapley 值与 ε 的前后变化；
3. 错误方案 `(1, 1, 1/2)` 的证据（总额 5/2 ≠ 1、联盟违约）；
4. 负价值博弈中分配变量取负值（`v(AB)=-10` → `(-5,-5)`，ε=5）；
5. 关闭并重新打开 SQLite，复核此前写入的历史快照。

## 关键方法与确定性规则

- **精确 Shapley**：`φ_i = Σ_{S⊆N∖{i}} |S|!(n−|S|−1)!/n! · [v(S∪i)−v(S)]`，BigInt 分数运算；
  求和精确等于大联盟价值（效率性由独立的全排列枚举断言，**不做任何末尾补差**）。
- **核心判定**：`Σx = v(N)` 且对所有非空真联盟 `Σ_{i∈S}x_i ≥ v(S)`，逐一枚举，不只看单人。
- **最小违约额 LP**（自行实现的两阶段单纯形，`src/lp.ts`）：
  - min ε, s.t. `Σx = v(N)`；`Σ_{i∈S}x_i + ε ≥ v(S)` 对所有非空真 S；`ε ≥ 0`；
  - x 为自由变量（内部标准拆分为 `x=u−v`，**不施加非负约束**）；
  - ε=0 且全部精确残差通过才标记 `inCore: true`；ε>0 表示核心为空；
  - 最优解不唯一时的**公开确定性选取规则**：在 ε 最优解集合中，按参与者编号顺序
    分层依次最小化 `x_1, x_2, …`（每步等式固定前序取值）；并对拆分变量 `u+v` 加 1e-8
    的极小正则以消除无代价漂移（不改变主目标最优性）；
  - 浮点解用连分数重构为 BigInt 分数后做**精确残差核验**；默认容差 1e-9，
    若残差或总额不达标，状态返回 `undetermined`（未判定），绝不谎称最优。

## 项目结构

```
src/
  rational.ts   精确有理数（BigInt）、分数字符串解析、十进制近似、连分数重构
  game.ts       联盟规范化/枚举、输入校验、序列化、编号重排
  shapley.ts    精确 Shapley + 全排列独立核对 + 贡献明细
  lp.ts         两阶段单纯形（自由变量 u-v 拆分、Bland 规则、正则选项）
  stability.ts  核心核验 + 最小违约额 + 精确残差核验
  report.ts     公平性/稳定性报告、修订对比、导出
  db.ts         SQLite 快照持久化（node:sqlite）
  server.ts     零依赖 HTTP API
  cli.ts        命令行
test/           node:test 单元测试（22 个）
scripts/demo.ts 端到端演示
examples/       示例博弈与错误分配
data/           运行后生成：tugame.db（SQLite）
```

## 已知限制与假设

- 参与者上限 8 人（联盟至多 256 个、Shapley 排列至多 40320，精确枚举无压力；LP 为浮点内核）。
- LP 使用自行实现的浮点单纯形 + 分数重构/残差核验；极端病态系数下可能返回 `undetermined`，属预期保守行为。
- `node:sqlite` 在 Node 22/24/25 标记为实验模块（功能稳定），启动参数已加 `--no-warnings`。
- 单次请求为同步计算；定位为本地小规模工具，未做并发鉴权与分页。
