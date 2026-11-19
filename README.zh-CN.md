# prk-todolist

PRK 的 todo 插件，同时也是标准 Pi 扩展，在 Pi TUI 里一样可用。核心语义源自 Hermes Agent 的 todo 工具（出处见 `NOTICE`），结合 OMP 的阶段布局与 blocked 原因，以及 Claude Code 式的并行与负责人（owner）。

## 功能

- 唯一直接工具 `todo_list`；不传参数读取完整的有序列表。
- 按 id 整体替换或 `merge` 合并；列表顺序就是优先级；重复 id 保留最后一次。
- 最多三层：`kind: "phase"` 阶段项（只有标题，不能带 status / reason / owner）→ 任务（`parent` 为阶段 id 或省略）→ 子任务（`parent` 为任务 id）。超过三层报错，整次写入回滚；悬空和成环 parent 自动变为顶层；没有阶段时就是平铺列表。
- 任务和子任务可带可选的 `owner`（如 worker 名，单行；widget 中以两个空格加 `·` 接在内容后，空白折叠）。
- 单调递增 `revision`、写入整体回滚、空 content 校验，以及内容/条数上限。
- `blocked` 必须有 `reason`；改成其他状态自动清除原因。允许多个 `in_progress`（不做硬校验）；多于一个时保持作者顺序。
- 提供 `outputSchema` 与 `structuredContent`；带数据的失败用 `isError` 返回且列表不变。
- 列表变化通过 `appendEntry` 持久化，不进入模型上下文；恢复支持当前 branch、reload 和嵌套调用。不读取或迁移其他插件的快照。
- 压缩时只注入未完成项（pending、in_progress、blocked），保留有未完成后代的阶段/任务，并带上阶段名、owner 和 blocked 原因。
- TUI widget（`Todo closed/total`、罗马数字阶段标题加进度、已结束阶段折成一行、`✓ N completed` 折叠、行尾 owner、blocked 原因独占下一行）只用 Pi theme 语义色。它的纯文本是 PRK 网页解析的契约，见 [`docs/widget-format.md`](docs/widget-format.md) 与 `tests/fixtures/widget-samples.json`。

## 动机

本扩展保留 Hermes 的小型契约（单工具、按 id 替换/合并、不传参读取、每次返回完整列表、工具说明里的提醒、压缩后重新注入），加入 OMP 的阶段布局和 Claude Code 的并行 `in_progress` 与 `owner`，不搬 OMP 的九种操作。核心改为 TypeScript，去掉 Python 运行时桥；Pi 的 `appendEntry` 让嵌套调用、分支切换、reload 和 compaction 都能恢复权威状态。

## 使用

```json
{"todos":[{"id":"inspect","content":"检查故障","status":"in_progress"}]}
```

```json
{"todos":[
  {"id":"p1","kind":"phase","content":"实现"},
  {"id":"t1","content":"写解析器","status":"in_progress","parent":"p1","owner":"worker-a"},
  {"id":"s1","content":"边界用例","status":"pending","parent":"t1"}
]}
```

使用 `merge: true` 做局部更新；blocked 项必须提供 `reason`。

## 开发

```bash
npm install --include=dev
npm test
npm run check
npm pack --dry-run
```

扩展使用 MIT License。核心源自 Hermes Agent `tools/todo_tool.py`，commit 为 `ea61bb9ef8`；归属信息见 `NOTICE`。
