## ADDED Requirements

### Requirement: 确认结果发送回 Worker
用户点击"确认"后，系统 SHALL 将勾选的项目格式化为文本消息，通过现有的 terminal 写入通道发送回 Worker。

#### Scenario: Droid Worker 确认结果发送
- **WHEN** 用户在 Droid Worker 的确认弹窗中勾选了项目并点击"确认"
- **THEN** 系统 SHALL 通过 `sendToDroid()` 将格式化的确认消息发送到 Droid terminal

#### Scenario: Codex Worker 确认结果发送
- **WHEN** 用户在 Codex Worker 的确认弹窗中勾选了项目并点击"确认"
- **THEN** 系统 SHALL 通过 `sendToReview()` 将格式化的确认消息发送到 Codex terminal

### Requirement: 默认确认消息格式
当未配置自定义响应模板时，系统 SHALL 使用默认格式生成确认消息。

#### Scenario: 默认格式输出
- **WHEN** 用户勾选了 "P0: 修复类型错误" 和 "P1: 优化性能" 两项，且未配置自定义模板
- **THEN** 系统 SHALL 生成如下格式的消息：
  ```
  已确认以下项目：
  - P0: 修复类型错误
  - P1: 优化性能
  ```

### Requirement: 自定义响应模板
当配置了 `response_template` 时，系统 SHALL 使用该模板生成确认消息，并将 `{selected_items}` 占位符替换为勾选项的列表文本。

#### Scenario: 使用自定义模板
- **WHEN** 配置了 `response_template: "请执行以下修复：\n{selected_items}"`，用户勾选了 "修复A"
- **THEN** 系统 SHALL 生成消息：`"请执行以下修复：\n- 修复A"`

### Requirement: 确认消息记录到聊天历史
确认消息发送后，系统 SHALL 将该消息作为 user 角色的消息追加到聊天历史中。

#### Scenario: 确认消息出现在历史中
- **WHEN** 用户确认并发送了确认消息
- **THEN** 聊天历史 SHALL 新增一条 role 为 `user` 的消息，内容为格式化后的确认文本

### Requirement: 取消不发送任何内容
用户点击"取消"后，系统 SHALL NOT 向 Worker 发送任何消息。

#### Scenario: 取消操作
- **WHEN** 用户点击"取消"按钮
- **THEN** 弹窗关闭，聊天历史 SHALL NOT 新增任何消息，Worker terminal SHALL NOT 收到任何输入
