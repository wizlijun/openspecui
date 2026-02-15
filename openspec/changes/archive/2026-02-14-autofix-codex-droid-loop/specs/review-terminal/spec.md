## ADDED Requirements

### Requirement: Codex Worker 支持外部触发 Re-review
Codex Worker SHALL 提供 `onTriggerReReviewRef` 接口，允许外部（App.tsx）在 Droid Worker 完成修复后触发重新评审。

#### Scenario: Droid 完成后触发 Re-review
- **WHEN** App.tsx 通过 `onTriggerReReviewRef` 调用触发 Re-review
- **THEN** Codex Worker SHALL 自动发送 Review Again 提示到 Codex 终端
- **THEN** Codex Worker 历史中显示 "[Auto Fix → Review] ..."
- **THEN** Codex Worker 进入等待状态

### Requirement: Codex Worker Auto Fix 状态显示
Codex Worker SHALL 在 Auto Fix 模式下显示当前阶段状态。

#### Scenario: 显示修复中状态
- **WHEN** Codex Worker 处于 Auto Fix 模式且 Droid 正在修复
- **THEN** 标题后缀显示 "[Auto Fix 修复中...]"

#### Scenario: 显示评审中状态
- **WHEN** Codex Worker 处于 Auto Fix 模式且正在 Re-review
- **THEN** 标题后缀显示 "[Auto Fix 评审中...]"

### Requirement: Auto Fix 完成后 Codex Worker 恢复正常
Auto Fix 完成后，Codex Worker SHALL 恢复到正常模式。

#### Scenario: Auto Fix 完成恢复
- **WHEN** Auto Fix 循环完成（无 P0/P1 问题或达到最大次数）
- **THEN** Codex Worker 清除 Auto Fix 状态
- **THEN** 标题恢复正常（无后缀）
- **THEN** 用户可以正常使用所有按钮和输入框
