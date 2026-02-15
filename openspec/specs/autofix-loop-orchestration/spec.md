## MODIFIED Requirements

### Requirement: Auto Fix 循环协调
App.tsx SHALL 作为 Auto Fix 循环的协调器，管理 Codex Worker（评审）和 Droid Worker（修复）之间的交替执行流程。每次触发 Droid Worker Fix 时，SHALL 同时保存评审要求到 review 文件。

#### Scenario: 用户启动 Auto Fix
- **WHEN** 用户在 Confirmation Card 中点击 "Auto Fix" 按钮
- **THEN** App.tsx 将选中的修复项发送给绑定的 Droid Worker
- **THEN** App.tsx 将该 Codex Worker 标记为 Auto Fix 模式
- **THEN** Codex Worker 标题显示 "[Auto Fix 修复中...]"
- **THEN** 系统 SHALL 调用 reviewPersistenceService 保存本次评审要求

#### Scenario: Droid Worker 完成修复
- **WHEN** Droid Worker 完成 Fix 任务（收到 Stop 事件）
- **THEN** App.tsx 检测到绑定的 Codex Worker 处于 Auto Fix 模式
- **THEN** App.tsx 触发 Codex Worker 执行 Re-review

#### Scenario: Codex Worker 完成 Re-review 且仍有 P0/P1 问题
- **WHEN** Codex Worker 完成 Re-review
- **THEN** 系统解析返回结果中的 checkbox 项
- **THEN** 过滤出 P0/P1 优先级的未勾选项
- **THEN** 如果存在 P0/P1 项，自动将这些项发送给 Droid Worker 继续修复
- **THEN** 系统 SHALL 调用 reviewPersistenceService 保存本次评审要求

#### Scenario: Codex Worker 完成 Re-review 且无 P0/P1 问题
- **WHEN** Codex Worker 完成 Re-review
- **THEN** 系统解析返回结果中的 checkbox 项
- **THEN** 过滤出 P0/P1 优先级的未勾选项
- **THEN** 如果不存在 P0/P1 项，标记 Auto Fix 完成
- **THEN** 触发庆祝动画
- **THEN** 在 Codex Worker 历史中显示 "🎉 Auto Fix 完成！所有 P0/P1 问题已解决！"
