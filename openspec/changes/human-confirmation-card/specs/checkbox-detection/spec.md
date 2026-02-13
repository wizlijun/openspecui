## ADDED Requirements

### Requirement: 检测 assistant 消息中的未勾选 checkbox
当 Worker（Droid/Codex）的 hook 监听器收到 assistant 消息时，系统 SHALL 检测消息文本中是否包含至少一个未勾选的 checkbox（`- [ ]` 格式）。

#### Scenario: 消息包含未勾选 checkbox
- **WHEN** Worker 返回的消息中包含 `- [ ] 修复类型错误` 格式的未勾选项
- **THEN** 系统 SHALL 识别该消息需要人工确认，并触发确认弹窗

#### Scenario: 消息仅包含已勾选 checkbox
- **WHEN** Worker 返回的消息中仅包含 `- [x] 已完成项` 格式的已勾选项，不包含任何 `- [ ]`
- **THEN** 系统 SHALL NOT 触发确认弹窗，消息正常显示在聊天历史中

#### Scenario: 消息不包含任何 checkbox
- **WHEN** Worker 返回的消息中不包含任何 checkbox 格式文本
- **THEN** 系统 SHALL NOT 触发确认弹窗，消息正常显示在聊天历史中

### Requirement: 检测逻辑适用于 Droid Worker 和 Codex Worker
检测逻辑 SHALL 同时在 `DroidWorkerBase` 的 `Stop` 事件处理和 `CodexWorkerBase` 的 `codex-notify` 完成事件处理中生效。

#### Scenario: Droid Worker 返回包含 checkbox 的消息
- **WHEN** Droid Worker 的 `Stop` hook 事件返回包含 `- [ ]` 的 `last_result`
- **THEN** 系统 SHALL 触发确认弹窗

#### Scenario: Codex Worker 返回包含 checkbox 的消息
- **WHEN** Codex Worker 的 `codex-notify` 完成事件返回包含 `- [ ]` 的 `last-assistant-message`
- **THEN** 系统 SHALL 触发确认弹窗

### Requirement: 检测使用正则匹配
系统 SHALL 使用正则表达式 `/- \[ \]/` 检测消息文本中是否存在未勾选的 checkbox。

#### Scenario: 标准格式匹配
- **WHEN** 消息文本包含 `- [ ] 任务描述` 格式的行
- **THEN** 正则匹配成功，触发确认流程

#### Scenario: 混合格式消息
- **WHEN** 消息文本同时包含 `- [ ] 未完成` 和 `- [x] 已完成` 以及普通文本
- **THEN** 系统 SHALL 因存在未勾选项而触发确认弹窗
