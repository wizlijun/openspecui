# Human Confirmation Card - 需求提案

## 背景

当前 OpenSpecUI 的 Worker（Droid Worker 和 Codex Worker）在 terminal 中返回消息时，如果消息包含 checkbox 列表（如 `- [ ] 任务项`），这些列表会直接显示在聊天历史中。用户可以在 `MarkdownWithCheckbox` 组件中勾选这些 checkbox，但这些勾选状态仅限于前端展示，无法反馈给 Worker 进行后续处理。

## 问题

1. **缺少人工确认机制**：当 Worker 返回需要人工判断的选项列表时（如多个修复方案、待确认的任务项等），用户无法将选择结果反馈给 Worker
2. **交互不明确**：用户不清楚勾选 checkbox 后是否需要进一步操作，也不知道如何将选择结果提交
3. **配置缺失**：没有配置机制来定义如何处理用户确认后的结果（如自动发送确认消息、执行特定命令等）

## 目标

实现一个 **Human Confirmation Card** 弹窗组件，当 Worker 返回包含未勾选 checkbox 列表的消息时：

1. **自动检测并弹窗**：检测到消息中存在 `- [ ]` 格式的未勾选项时，自动弹出确认卡片
2. **交互式确认**：用户可以在弹窗中逐项勾选/取消勾选，并通过"确认"或"取消"按钮提交选择
3. **结果反馈**：
   - 用户点击"确认"后，将勾选的项目列表反馈给 Worker（通过 terminal 输入）
   - 用户点击"取消"后，关闭弹窗，不发送任何内容
4. **配置驱动**：在 Worker 配置文件（`droid_worker_define.yml` / `codex_worker_define.yml`）中支持配置确认后的处理行为

## 核心功能

### 1. 检测逻辑

在 `DroidWorkerBase` 和 `CodexWorkerBase` 的 hook 监听器中，当收到 assistant 消息时：
- 检测消息文本是否包含 `- [ ]` 格式的未勾选 checkbox
- 如果包含，触发弹窗显示

### 2. 弹窗组件 `HumanConfirmationCard`

- **输入**：包含 checkbox 列表的原始消息文本
- **解析**：提取所有 `- [ ]` 和 `- [x]` 项，生成可交互的 checkbox 列表
- **交互**：
  - 用户可以勾选/取消勾选任意项
  - 底部显示"确认"和"取消"按钮
- **输出**：
  - 确认：返回勾选项的文本列表（或格式化的确认消息）
  - 取消：返回 null

### 3. 结果处理

用户确认后，根据配置决定如何处理：
- **默认行为**：将勾选的项目以文本形式发送回 Worker（如 `"已确认：\n- 项目1\n- 项目3"`）
- **配置行为**（可选）：在 Worker 配置中定义 `confirmation_response_template`，支持占位符如 `{selected_items}`

### 4. 配置扩展

在 `droid_worker_define.yml` 和 `codex_worker_define.yml` 中添加可选配置：

```yaml
modes:
  continue_change:
    name: "Continue Change"
    # ... 现有配置 ...
    confirmation:
      enabled: true  # 是否启用人工确认弹窗（默认 true）
      response_template: "已确认以下项目：\n{selected_items}"  # 可选，自定义确认消息格式
```

## 用户体验流程

1. Worker 返回消息："请选择要修复的问题：\n- [ ] P0: 修复类型错误\n- [ ] P1: 优化性能\n- [ ] P2: 更新文档"
2. 系统检测到未勾选 checkbox，自动弹出 Human Confirmation Card
3. 用户在弹窗中勾选 "P0: 修复类型错误" 和 "P1: 优化性能"
4. 用户点击"确认"按钮
5. 系统将确认消息发送回 Worker："已确认以下项目：\n- P0: 修复类型错误\n- P1: 优化性能"
6. Worker 收到确认消息，继续执行后续操作

## 技术约束

- 弹窗应为模态窗口，阻止用户在确认前进行其他操作
- 弹窗样式应与现有 UI 风格一致（参考 `EditorPanel` 的弹窗样式）
- 检测逻辑应高效，避免误触发（仅当存在至少一个 `- [ ]` 时触发）
- 配置为可选，默认启用，不影响现有功能

## 非目标

- 不支持嵌套 checkbox 列表
- 不支持自定义 checkbox 格式（仅支持标准 Markdown `- [ ]` / `- [x]`）
- 不支持多轮确认（每次弹窗仅处理一次确认）
