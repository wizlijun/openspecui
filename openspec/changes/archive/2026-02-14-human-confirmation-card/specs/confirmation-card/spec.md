## ADDED Requirements

### Requirement: 模态弹窗显示
当检测到需要人工确认的消息时，系统 SHALL 显示一个模态弹窗（Human Confirmation Card），覆盖在 Worker 面板之上。

#### Scenario: 弹窗弹出
- **WHEN** 系统检测到 assistant 消息包含未勾选 checkbox
- **THEN** 系统 SHALL 立即显示 Human Confirmation Card 模态弹窗

#### Scenario: 弹窗阻止背景操作
- **WHEN** Human Confirmation Card 弹窗处于显示状态
- **THEN** 用户 SHALL NOT 能够操作 Worker 面板中的输入框和按钮

### Requirement: 解析并展示 checkbox 列表
弹窗 SHALL 解析消息文本中的所有 checkbox 项（`- [ ]` 和 `- [x]`），以可交互的 checkbox 列表形式展示。

#### Scenario: 展示未勾选项
- **WHEN** 消息包含 `- [ ] P0: 修复类型错误`
- **THEN** 弹窗 SHALL 显示一个未勾选的 checkbox，标签为 "P0: 修复类型错误"

#### Scenario: 展示已勾选项
- **WHEN** 消息包含 `- [x] P1: 已修复`
- **THEN** 弹窗 SHALL 显示一个已勾选的 checkbox，标签为 "P1: 已修复"

#### Scenario: 展示非 checkbox 文本
- **WHEN** 消息包含 checkbox 列表之外的普通文本（如标题、说明）
- **THEN** 弹窗 SHALL 将这些文本作为上下文信息显示在 checkbox 列表上方

### Requirement: 用户可交互勾选
用户 SHALL 能够在弹窗中自由勾选或取消勾选任意 checkbox 项。

#### Scenario: 勾选未勾选项
- **WHEN** 用户点击一个未勾选的 checkbox
- **THEN** 该 checkbox SHALL 变为勾选状态

#### Scenario: 取消勾选已勾选项
- **WHEN** 用户点击一个已勾选的 checkbox
- **THEN** 该 checkbox SHALL 变为未勾选状态

### Requirement: 确认和取消按钮
弹窗底部 SHALL 显示"确认"和"取消"两个按钮。

#### Scenario: 点击确认按钮
- **WHEN** 用户勾选了至少一个项目并点击"确认"按钮
- **THEN** 弹窗 SHALL 关闭，并将勾选的项目列表传递给结果处理逻辑

#### Scenario: 未勾选任何项目时点击确认
- **WHEN** 用户未勾选任何项目并点击"确认"按钮
- **THEN** "确认"按钮 SHALL 处于禁用状态，不可点击

#### Scenario: 点击取消按钮
- **WHEN** 用户点击"取消"按钮
- **THEN** 弹窗 SHALL 关闭，不发送任何内容给 Worker
