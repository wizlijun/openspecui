## Context

当前 OpenSpecUI 中 Droid Worker 和 Codex Worker 通过 hook 机制接收 terminal 返回的消息，并将其渲染到聊天历史面板中。消息中如果包含 `- [ ]` / `- [x]` 格式的 checkbox 列表，会通过 `MarkdownWithCheckbox` 组件渲染为可交互的 checkbox，但勾选状态仅停留在前端，无法反馈给 Worker。

现有消息处理流程：
1. Hook 监听器（`onStopHookRef`）接收到 `Stop` 或 `codex-notify` 事件
2. 提取 `last_result` 或 `last-assistant-message` 作为消息文本
3. 将消息追加到 `history` 状态数组
4. 渲染时检测 `- [[ x]\]` 正则，决定使用 `MarkdownWithCheckbox` 还是普通 `<pre>`

关键约束：
- Droid Worker 通过 `sendToDroid()` 向 terminal 写入文本
- Codex Worker 通过 `sendToReview()` 向 terminal 写入文本
- 两者的配置分别由 `droid_worker_define.yml` 和 `codex_worker_define.yml` 驱动
- 配置通过 `loadWorkerConfig.ts` 和 `loadCodexWorkerConfig.ts` 加载

## Goals / Non-Goals

**Goals:**
- 当 Worker 返回包含未勾选 checkbox（`- [ ]`）的消息时，自动弹出模态确认卡片
- 用户可在卡片中勾选/取消勾选项目，点击"确认"将选择结果发送回 Worker
- 用户点击"取消"可关闭卡片，不发送任何内容
- 通过 YAML 配置文件控制确认行为（是否启用、响应模板）
- 同时支持 Droid Worker 和 Codex Worker

**Non-Goals:**
- 不支持嵌套 checkbox 列表
- 不支持非标准 checkbox 格式
- 不支持多轮确认（一次弹窗处理一次确认）
- 不修改现有 `MarkdownWithCheckbox` 组件的行为

## Decisions

### 1. 检测时机：在 hook 监听器中检测，而非渲染层

**选择**：在 `DroidWorkerBase` 和 `CodexWorkerBase` 的 hook 监听器（处理 `Stop` / `codex-notify` 事件）中，收到 assistant 消息后立即检测是否包含 `- [ ]`。

**理由**：
- 检测逻辑与消息接收紧密耦合，在 hook 中处理可以在消息进入 history 之前决定是否弹窗
- 避免在渲染层做副作用操作（弹窗触发）
- 替代方案：在 `useEffect` 中监听 history 变化 → 会导致不必要的重渲染和竞态问题

### 2. 弹窗状态管理：使用 React state 而非全局 store

**选择**：在 `DroidWorkerBase` / `CodexWorkerBase` 中新增 `confirmationData` state，控制弹窗的显示/隐藏和数据传递。

**理由**：
- 弹窗与特定 Worker 实例绑定，不需要跨组件共享状态
- 保持组件自包含，不引入额外状态管理库
- 替代方案：全局 Context / Redux → 过度设计，增加复杂度

### 3. 新建独立组件 `HumanConfirmationCard`

**选择**：创建 `app/src/HumanConfirmationCard.tsx` 作为独立的模态弹窗组件。

**理由**：
- 职责单一：解析 checkbox 文本、管理勾选状态、处理确认/取消
- 可复用：Droid Worker 和 Codex Worker 共用同一组件
- 替代方案：在 `MarkdownWithCheckbox` 中扩展 → 违反单一职责，且 `MarkdownWithCheckbox` 是纯展示组件

### 4. 确认结果发送方式：复用现有 `sendToDroid` / `sendToReview`

**选择**：确认后通过回调函数调用 Worker 已有的 terminal 写入方法，将格式化的确认消息发送回 Worker。

**理由**：
- 复用现有通信通道，无需新增 bridge API
- Worker 端无需修改，直接接收文本输入
- 消息格式通过配置模板控制，灵活可扩展

### 5. 配置结构：在现有 mode 配置中添加 `confirmation` 字段

**选择**：在 `droid_worker_define.yml` / `codex_worker_define.yml` 的 `modes.<mode>` 下添加可选的 `confirmation` 配置块。

```yaml
confirmation:
  enabled: true
  response_template: "已确认以下项目：\n{selected_items}"
```

**理由**：
- 与现有配置结构一致，不引入新的配置文件
- `enabled` 默认为 `true`，向后兼容
- `response_template` 可选，默认使用内置模板
- 替代方案：独立配置文件 → 增加管理复杂度，不值得

### 6. 弹窗触发条件：仅当存在未勾选项 `- [ ]` 时触发

**选择**：使用正则 `/- \[ \]/` 检测消息中是否存在至少一个未勾选的 checkbox。如果消息中只有 `- [x]`（全部已勾选），不触发弹窗。

**理由**：
- 全部已勾选意味着不需要人工确认
- 避免误触发，减少用户干扰
- 检测逻辑简单高效

## Risks / Trade-offs

**[误触发风险]** Worker 返回的消息中可能包含代码示例或说明文本中的 `- [ ]`，并非真正需要确认的列表。
→ 缓解：仅在消息中存在未勾选项时触发；用户可通过配置 `enabled: false` 关闭；后续可增加更精确的上下文检测。

**[模态阻塞]** 弹窗为模态窗口，会阻止用户在确认前操作 Worker 面板。
→ 这是有意设计：确认操作需要用户明确决策，避免在未确认时继续发送消息导致状态混乱。用户可随时点击"取消"关闭弹窗。

**[配置加载时机]** 配置在项目路径变化时加载，如果 YAML 文件格式错误会导致回退到默认配置。
→ 缓解：复用现有的配置加载机制（`loadWorkerConfig.ts`），已有错误处理逻辑；`confirmation` 字段为可选，缺失时使用默认值。

**[消息格式依赖]** 确认结果以纯文本发送回 Worker，Worker 需要能正确解析。
→ 缓解：使用清晰的默认模板格式；支持自定义模板以适配不同 Worker 的解析需求。
