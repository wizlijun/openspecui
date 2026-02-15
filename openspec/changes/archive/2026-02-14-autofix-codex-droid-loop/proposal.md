## Why

当前的 Auto Fix 功能完全在 Codex Worker 内部运行（既做 Review 又做 Fix），这违背了职责分离原则。Codex Worker 应专注于代码评审，而 Droid Worker 应负责实际修复。需要重构为：Codex Review → Droid Fix → Codex Re-review 的循环模式，直到所有 P0/P1 问题解决，最后展示庆祝动画。

## What Changes

- 移除 Codex Worker 内部的自修复循环逻辑
- 新增 Codex Worker 与 Droid Worker 之间的双向通信机制
- Codex Worker 完成 Review 后，将待修复项发送给绑定的 Droid Worker
- Droid Worker 完成 Fix 后，通知 Codex Worker 触发 Re-review
- App.tsx 作为协调器，管理 Codex ↔ Droid 的循环流程
- 仅 P0/P1 优先级问题阻塞 Auto Fix 完成（P2 及以下不阻塞）
- Auto Fix 完成时触发升级版庆祝动画（彩带 + 烟花效果）

## Capabilities

### New Capabilities
- `autofix-loop-orchestration`: Codex Worker 和 Droid Worker 之间的 Auto Fix 循环协调机制
- `priority-filtering`: 基于优先级（P0/P1）的问题过滤逻辑
- `celebration-animation`: 升级版庆祝动画效果

### Modified Capabilities
- `confirmation-card`: 需要支持 Auto Fix 按钮触发跨 Worker 流程
- `review-terminal`: Codex Worker 需要支持外部触发 Re-review

## Impact

**受影响的文件：**
- `app/src/CodexWorkerBase.tsx` - 移除内部 auto-fix 循环，添加外部触发 re-review 接口
- `app/src/DroidWorkerBase.tsx` - 添加完成回调通知机制
- `app/src/App.tsx` - 实现 Codex ↔ Droid 循环协调逻辑
- `app/src/checkboxUtils.ts` - 添加 P0/P1 优先级过滤函数
- `app/src/loadConfirmationCardConfig.ts` - 确保 Auto Fix 按钮配置正确

**API 变更：**
- CodexWorkerBase 新增 prop: `onTriggerReReviewRef` - 外部触发 re-review
- DroidWorkerBase 新增 prop: `onFixComplete` - Fix 完成回调
- App.tsx 新增状态: `autoFixActiveMap` - 跟踪哪些 Codex Worker 处于 Auto Fix 模式

**依赖：**
- 无新增外部依赖
- 依赖现有的 Worker 绑定机制（`codexToDroidRef`, `droidToCodexRef`）
