## MODIFIED Requirements

### Requirement: 确认和取消按钮
弹窗底部 SHALL 根据配置显示多个操作按钮，包括"取消"、"Fix"、"Droid Fix"和"Auto Fix"。

#### Scenario: 点击确认按钮
- **WHEN** 用户勾选了至少一个项目并点击"Fix"或"Droid Fix"按钮
- **THEN** 弹窗 SHALL 关闭，并将勾选的项目列表传递给结果处理逻辑

#### Scenario: 未勾选任何项目时点击确认
- **WHEN** 用户未勾选任何项目并点击需要选择的按钮
- **THEN** 该按钮 SHALL 处于禁用状态，不可点击

#### Scenario: 点击取消按钮
- **WHEN** 用户点击"取消"按钮
- **THEN** 弹窗 SHALL 关闭，不发送任何内容给 Worker

#### Scenario: 点击 Auto Fix 按钮启动跨 Worker 循环
- **WHEN** 用户勾选了至少一个项目并点击 "Auto Fix" 按钮
- **THEN** 弹窗 SHALL 关闭
- **THEN** 系统 SHALL 将选中项发送给绑定的 Droid Worker 进行修复
- **THEN** 系统 SHALL 进入 Auto Fix 循环模式（Codex Review ↔ Droid Fix）
