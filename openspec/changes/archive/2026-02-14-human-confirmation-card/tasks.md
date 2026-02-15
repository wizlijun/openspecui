## 1. 配置类型扩展与加载

- [x] 1.1 在 `DroidWorkerBase.tsx` 的 `DroidWorkerConfig` 类型中添加可选的 `confirmation` 字段（`{ enabled?: boolean; responseTemplate?: string }`）
- [x] 1.2 在 `CodexWorkerBase.tsx` 的 `CodexWorkerConfig` 类型中添加相同的 `confirmation` 字段
- [x] 1.3 在 `loadWorkerConfig.ts` 中解析 YAML 配置的 `confirmation` 字段，合并到 `DroidWorkerConfig` 对象中，缺失时使用默认值（enabled: true）
- [x] 1.4 在 `loadCodexWorkerConfig.ts` 中解析 YAML 配置的 `confirmation` 字段，合并到 `CodexWorkerConfig` 对象中，缺失时使用默认值（enabled: true）

## 2. 检测逻辑

- [x] 2.1 创建工具函数 `hasUncheckedCheckbox(text: string): boolean`，使用正则 `/- \[ \]/` 检测消息文本中是否存在未勾选 checkbox
- [x] 2.2 在 `DroidWorkerBase.tsx` 的 `Stop` 事件处理中，收到 assistant 消息后调用检测函数，若检测到且 `config.confirmation?.enabled !== false`，设置 `confirmationData` state
- [x] 2.3 在 `CodexWorkerBase.tsx` 的 `codex-notify` 完成事件处理中，收到 assistant 消息后调用检测函数，若检测到且 `config.confirmation?.enabled !== false`，设置 `confirmationData` state

## 3. HumanConfirmationCard 弹窗组件

- [x] 3.1 创建 `app/src/HumanConfirmationCard.tsx` 组件，接收 props：`text`（消息文本）、`onConfirm`（确认回调，参数为勾选项列表）、`onCancel`（取消回调）
- [x] 3.2 实现 checkbox 解析逻辑：从文本中提取所有 `- [ ]` 和 `- [x]` 项，生成可交互的 checkbox 列表，非 checkbox 文本作为上下文显示
- [x] 3.3 实现勾选状态管理：用户可自由勾选/取消勾选任意项
- [x] 3.4 实现"确认"按钮：至少勾选一项时可点击，点击后调用 `onConfirm` 并传递勾选项文本列表；未勾选任何项时按钮禁用
- [x] 3.5 实现"取消"按钮：点击后调用 `onCancel`
- [x] 3.6 添加模态弹窗样式（遮罩层、居中卡片），与现有 UI 风格一致

## 4. 结果处理与 Worker 集成

- [x] 4.1 在 `DroidWorkerBase.tsx` 中添加 `confirmationData` state 和弹窗渲染逻辑
- [x] 4.2 实现 Droid Worker 的 `onConfirm` 回调：根据 `config.confirmation?.responseTemplate` 或默认模板格式化确认消息，通过 `sendToDroid()` 发送，追加到聊天历史，设置 waiting 状态
- [x] 4.3 实现 Droid Worker 的 `onCancel` 回调：关闭弹窗，不发送任何内容
- [x] 4.4 在 `CodexWorkerBase.tsx` 中添加 `confirmationData` state 和弹窗渲染逻辑
- [x] 4.5 实现 Codex Worker 的 `onConfirm` 回调：根据 `config.confirmation?.responseTemplate` 或默认模板格式化确认消息，通过 `sendToReview()` 发送，追加到聊天历史，设置 waiting 状态
- [x] 4.6 实现 Codex Worker 的 `onCancel` 回调：关闭弹窗，不发送任何内容

## 5. 样式与配置文件更新

- [x] 5.1 在 `App.css` 中添加 Human Confirmation Card 的模态弹窗样式（遮罩层、卡片容器、checkbox 列表、按钮样式）
- [x] 5.2 在 `.openspec/droid_worker_define.yml` 中为 `continue_change` 模式添加 `confirmation` 配置示例
- [x] 5.3 在 `.openspec/codex_worker_define.yml` 中为 `code_review` 模式添加 `confirmation` 配置示例
