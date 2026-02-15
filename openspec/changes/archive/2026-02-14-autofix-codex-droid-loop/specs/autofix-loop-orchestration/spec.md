## ADDED Requirements

### Requirement: Auto Fix 循环协调
App.tsx SHALL 作为 Auto Fix 循环的协调器，管理 Codex Worker（评审）和 Droid Worker（修复）之间的交替执行流程。

#### Scenario: 用户启动 Auto Fix
- **WHEN** 用户在 Confirmation Card 中点击 "Auto Fix" 按钮
- **THEN** App.tsx 将选中的修复项发送给绑定的 Droid Worker
- **THEN** App.tsx 将该 Codex Worker 标记为 Auto Fix 模式
- **THEN** Codex Worker 标题显示 "[Auto Fix 修复中...]"

#### Scenario: Droid Worker 完成修复
- **WHEN** Droid Worker 完成 Fix 任务（收到 Stop 事件）
- **THEN** App.tsx 检测到绑定的 Codex Worker 处于 Auto Fix 模式
- **THEN** App.tsx 触发 Codex Worker 执行 Re-review

#### Scenario: Codex Worker 完成 Re-review 且仍有 P0/P1 问题
- **WHEN** Codex Worker 完成 Re-review
- **THEN** 系统解析返回结果中的 checkbox 项
- **THEN** 过滤出 P0/P1 优先级的未勾选项
- **THEN** 如果存在 P0/P1 项，自动将这些项发送给 Droid Worker 继续修复

#### Scenario: Codex Worker 完成 Re-review 且无 P0/P1 问题
- **WHEN** Codex Worker 完成 Re-review
- **THEN** 系统解析返回结果中的 checkbox 项
- **THEN** 过滤出 P0/P1 优先级的未勾选项
- **THEN** 如果不存在 P0/P1 项，标记 Auto Fix 完成
- **THEN** 触发庆祝动画
- **THEN** 在 Codex Worker 历史中显示 "🎉 Auto Fix 完成！所有 P0/P1 问题已解决！"

### Requirement: Auto Fix 状态跟踪
App.tsx SHALL 维护 `autoFixActiveMap` 状态，跟踪每个 Codex Worker 的 Auto Fix 模式。

#### Scenario: 多个 Codex Worker 同时 Auto Fix
- **WHEN** 多个 Codex Worker 分别启动 Auto Fix
- **THEN** 每个 Codex Worker 独立维护自己的 Auto Fix 循环
- **THEN** 互不干扰

### Requirement: Auto Fix 最大循环次数限制
系统 SHALL 设置最大循环次数为 10 次，防止无限循环。

#### Scenario: 达到最大循环次数
- **WHEN** Auto Fix 循环次数达到 10 次
- **THEN** 自动停止 Auto Fix 模式
- **THEN** 在 Codex Worker 历史中显示 "⚠ Auto Fix 已达最大尝试次数（10次），请手动检查剩余问题"

### Requirement: 用户手动停止 Auto Fix
用户 SHALL 能够随时停止正在进行的 Auto Fix 循环。

#### Scenario: 用户点击停止按钮
- **WHEN** Auto Fix 正在进行中
- **WHEN** 用户点击 "停止 Auto Fix" 按钮
- **THEN** 立即停止循环
- **THEN** 清除 Auto Fix 状态
- **THEN** 在 Codex Worker 历史中显示 "⏹ Auto Fix 已停止"

### Requirement: Droid Worker 自动创建
当 Auto Fix 启动时，如果没有绑定的 Droid Worker，系统 SHALL 自动创建一个 fix_review 模式的 Droid Worker。

#### Scenario: 无绑定 Droid Worker 时启动 Auto Fix
- **WHEN** 用户在 Codex Worker 中启动 Auto Fix
- **WHEN** 该 Codex Worker 没有绑定的 Droid Worker
- **THEN** 自动创建 fix_review 模式的 Droid Worker
- **THEN** 建立 Codex ↔ Droid 双向绑定
- **THEN** 将修复项发送给新创建的 Droid Worker
