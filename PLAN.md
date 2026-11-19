# prk-todolist 计划

## 2026-11-19 独立仓库

项目改名为 `prk-todolist`，定位为 PRK 的 todo 插件，同时支持标准 Pi TUI。核心原样保留，Hermes 来源见 `NOTICE` 与 `src/todo-store.ts` 文件头。
工具名保持 `todo_list`；widget、快照、压缩注入统一使用 `prk-todolist.*` 标识；折叠配置仅使用 `PRK_TODOLIST_COLLAPSE_COMPLETED`。不读取或迁移老插件的会话快照，已删除 toolResult 恢复分支。


本轮实现已完成；README 与 VALIDATION 已同步到当前 TypeScript 版本。2026-10-22 的三层结构（见下）推翻了 2026-10-12 的“不搬阶段结构”和“只能一项 in_progress”。

## 2026-10-22 三层结构、并行与 owner、widget 文本契约（已实现，分支 `feat/phases`）

方向：Hermes 的魂（调用方式 + 对模型的提醒），OMP 的壳（阶段布局、阻塞原因），Claude Code 的并发（多个 in_progress、owner）。**推翻 2026-10-12 的两条**：“不搬 OMP 阶段结构”改为搬阶段布局；“只能一项 in_progress”改为允许并行。不再兼容 Hermes 的 todo 参数格式。

1. **数据**：最多三层，阶段 `{id, kind:"phase", content}`（无 status/reason/owner，传了报错）→ 任务（`parent` 省略或指向阶段）→ 子任务（`parent` 指向任务）。超三层报错、整次写入回滚；无阶段时平铺；任务和子任务可带可选 `owner`（单行；渲染时空白折叠，不做 ` · ` 校验）。旧快照无需迁移，超三层的旧快照恢复时校验失败，被当作坏快照跳过。
2. **并行**：允许多个 in_progress，不硬校验；多于一个时保持作者顺序（Hermes 的“in_progress 提到首个 pending 前”只对平铺且恰好一个 in_progress 的列表生效，有阶段/子任务时仍不重排）。`summary` 只统计任务和子任务。
3. **工具说明**：保留 Hermes 的全部提醒，把“只能一项 in_progress”换成并行规则（并行才同时进行，用 owner 标明），加入三层说明和 “blocked requires reason”。
4. **压缩注入**：只含未完成项，有未完成后代的父项（阶段、任务）一并保留并显示真实状态，带阶段名、owner、blocked 原因。
5. **widget 文本**：`docs/widget-format.md` 是 PRK 网页解析的契约，`tests/fixtures/widget-samples.json` 是共享样例（PRK 复制一份）；改格式必须同步 PRK。已折叠的完成项、阶段折叠、未归阶段任务缩进、owner（内容后第一个两空格之后的 `· owner`）等细节见该文档。
6. **取舍记录**：owner 分隔符改为两个空格加 `· `（2026-10-22 早上凛音决定，取代“内容里的 ` · ` 不转义”的已知限制）：内容里的 ` · ` 原样保留，owner 渲染时空白折叠；展开态 renderResult 用同一渲染器但不折叠；阶段“活动”高亮只看任务（不看子任务）的 in_progress。

## 2026-10-12 核心改为 TypeScript，结合 Hermes 与 OMP 的 todo 特性（已实现）

状态：已按确认项实现。上游参照 `tools/todo_tool.py` commit `ea61bb9ef8`。
背景：v0.0.1 用一次性 Python 子进程桥接逐字节 vendor 的 Hermes `todo_tool.py`（commit `bc6cd46`）。2026-10-10 对比 OMP 18.6.0 的 `tools/todo.ts` 与 Hermes 的 `todo_tool.py` 后定下组合方向；2026-10-12 定下实现方式。目标宿主除 Pi TUI 外还有 PRK：Pi SDK 内嵌，code 模式 worker 经 `ctx.executeTool` 间接调用插件工具。

### 已确认

1. **模型侧语义沿用 Hermes**：单个工具，按 id 整份替换或 `merge` 合并，不传参数即读取；每次调用向模型返回完整列表；列表顺序即优先级；压缩后只注入未完成项，有活跃子项的父项一并保留；“同一时间只有一项 in_progress”仍只是描述里的 guidance，不加硬校验（**2026-10-22 起改为允许并行，见上**）。不搬 OMP 的 9 种操作、按任务原文定位、HUD、Markdown 互转和停下时的提醒；“不搬阶段结构”**已于 2026-10-22 推翻**。
2. **跟进上游最新 TodoStore**（参照 Hermes `tools/todo_tool.py` 最后改动 `ea61bb9ef8`，2026-10-06）：`parent` 子任务（悬空或成环的引用改为顶层）、单调递增的 `revision`、空 `content` 报错而不是填占位、写入出错整体回滚、没有子任务时把 `in_progress` 提到第一个 pending 之前、内容与条数上限。
3. **从 OMP 拿 `blocked` 状态，带原因**。这是有意偏离 Hermes 的一处。
4. **核心移植到 TypeScript**：删除 Python 桥（`bridge/`、`src/bridge-client.ts`）、`vendor/hermes/` 和对 `python3` 的运行时依赖。移植代码仍属上游衍生，保留来源（上游路径与 commit）和 MIT 许可证声明。
5. **持久化**：每次改变列表的调用都用 `pi.appendEntry()` 写一份 `prk-todolist.todo-snapshot` 快照（自定义条目，不进模型上下文）；恢复时只取当前分支上本插件最新的有效快照，不读取或迁移老插件的快照。Pi 的嵌套调用（codemode 脚本、`ctx.executeTool`）不会在会话记录里留下 toolResult，因此使用自定义条目恢复状态。
6. **结构化结果**：声明 `outputSchema` 并返回 `structuredContent`，模型仍收到 `content` 文本；失败但要带数据时用 `isError: true` 返回，不抛异常。
7. **`exposure` 保持默认 `direct`**：`codemode` 的意思是只给脚本调用、不声明给模型，不为适配 PRK 修改。PRK worker 拿不到 direct 插件工具的问题由 PRK 改放行规则解决。
8. **UI 宿主判断不变**：widget 仍按 `ctx.mode === "tui"` 画；非 TUI 宿主的显示由宿主负责（PRK 以 `tui` 身份绑定插件并承载 UI），插件不为 RPC／SDK 宿主另写纯文本分支。
9. **渲染要改**：自定义 `renderCall`／`renderResult`，不再把整段 JSON 原样打出来；widget 按 `parent` 显示层级。

### 未定

- 工具名：现已统一为 `todo_list`，无旧别名。
- `blocked`：原因的字段名、是否必填，`merge` 时怎么清除；blocked 项是否计入压缩注入和 `summary`。
- 渲染的具体样式。2026-10-10 的候选：调用显示一行摘要（如“写入 5 项”“合并 2 项”“读取”）；结果默认只显示变化，展开看完整列表。（widget 部分已于 2026-10-13 在 `feat/widget-style` 实现：`○ ▸ ✓ ✕` 区分状态，进行中加粗 accent，pending muted，已完成 dim，已取消 dim 加删除线；已完成达到阈值（默认 3，`PRK_TODOLIST_COLLAPSE_COMPLETED` 可改，`0` 关闭）时在首个已完成项位置折叠成 `✓ N completed`。）
- 包名与定位：已于 2026-11-19 定为 `prk-todolist`；README 保留 Hermes 核心语义出处，不再使用兼容插件定位。
