## 1. 优先级过滤

- [x] 1.1 在 `checkboxUtils.ts` 中添加 `filterP0P1Items` 函数，过滤出 P0/P1 优先级的 checkbox 项
- [x] 1.2 在 `checkboxUtils.ts` 中添加 `hasP0P1Items` 辅助函数，判断列表中是否存在 P0/P1 项

## 2. Codex Worker 重构

- [x] 2.1 在 `CodexWorkerBase.tsx` 的 Props 中添加 `onTriggerReReviewRef` 接口
- [x] 2.2 实现 `onTriggerReReviewRef` 回调：接收外部触发后发送 Review Again 提示
- [x] 2.3 重构 `handleAutoFixCycle`：移除内部自修复逻辑，改为在 reviewing 阶段完成后通过 `onAutoFixReviewComplete` 回调通知 App
- [x] 2.4 在 Props 中添加 `onAutoFixReviewComplete` 回调，传递 review 结果文本给 App.tsx
- [x] 2.5 保留 Auto Fix 状态显示（标题后缀、停止按钮），但状态由 App 控制

## 3. Droid Worker 增强

- [x] 3.1 在 `DroidWorkerBase.tsx` 的 Props 中添加 `onFixComplete` 回调
- [x] 3.2 在 Droid Worker 的 Stop 事件处理中，检测是否处于 Auto Fix 模式并调用 `onFixComplete`

## 4. App.tsx 循环协调器

- [x] 4.1 添加 `autoFixActiveMap` 状态（Map<codexTabId, { active: boolean, cycleCount: number }>）
- [x] 4.2 重构 `handleConfirmationAction` 中 `auto_fix` 分支：将修复项发送给 Droid Worker（复用 `handleDroidFixRequest`）
- [x] 4.3 实现 `handleDroidFixComplete` 回调：Droid 完成后通过 `onTriggerReReviewRef` 触发 Codex Re-review
- [x] 4.4 实现 `handleAutoFixReviewComplete` 回调：解析 review 结果，过滤 P0/P1，决定继续循环或完成
- [x] 4.5 实现最大循环次数限制（10 次），超限时停止并显示警告
- [x] 4.6 在 Codex Worker 和 Droid Worker 渲染中传递新增的 props 和 refs
- [x] 4.7 在关闭 Worker 时清理 `autoFixActiveMap` 状态

## 5. 庆祝动画升级

- [x] 5.1 重写 `triggerCelebration` 函数：增加彩带数量到 300，添加多种形状
- [x] 5.2 添加烟花效果：中心爆炸式粒子扩散动画
- [x] 5.3 延长动画时长到 8 秒，确保动画结束后清理 DOM

## 6. 验证

- [x] 6.1 运行 TypeScript 类型检查，确保无编译错误
- [x] 6.2 运行 Vite 构建，确保打包成功（预先存在的错误不在本次修复范围内）
