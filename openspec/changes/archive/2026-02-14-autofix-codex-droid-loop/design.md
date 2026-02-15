## Context

当前 Auto Fix 实现在 `CodexWorkerBase.tsx` 中，通过 `handleAutoFixCycle` 函数管理内部循环：
- `autoFixStage` 状态：'fixing' | 'reviewing' | null
- Codex Worker 既负责 Review 又负责 Fix
- 循环逻辑完全封装在 Codex Worker 内部

问题：
1. 职责混乱：Codex Worker 应专注评审，不应执行修复
2. 无法利用 Droid Worker 的修复能力
3. 用户已有 Codex ↔ Droid 绑定机制（`codexToDroidRef`），但 Auto Fix 未使用

目标：重构为 Codex Worker（评审）↔ Droid Worker（修复）的协作模式。

## Goals / Non-Goals

**Goals:**
- Codex Worker 专注评审，Droid Worker 专注修复
- App.tsx 作为协调器管理循环状态
- 仅 P0/P1 问题阻塞完成（P2+ 不阻塞）
- 完成时展示升级版庆祝动画
- 保持现有 Worker 绑定机制不变

**Non-Goals:**
- 不改变 Confirmation Card UI 交互
- 不修改 Codex/Droid Worker 的初始化流程
- 不引入新的外部依赖

## Decisions

### 1. 循环协调器位置：App.tsx

**决策：** 将 Auto Fix 循环状态和协调逻辑放在 App.tsx

**理由：**
- App.tsx 已管理 Codex ↔ Droid 绑定关系（`codexToDroidRef`, `droidToCodexRef`）
- 需要跨 Worker 通信，App 是唯一能访问两者的组件
- 避免 Worker 组件之间直接耦合

**替代方案：**
- ❌ 在 Codex Worker 内部管理：无法访问 Droid Worker
- ❌ 使用全局状态管理（Redux/Zustand）：过度设计，增加复杂度

### 2. 通信机制：Ref 回调

**决策：** 使用 React Ref 传递回调函数

**Codex Worker 新增：**
```typescript
onTriggerReReviewRef?: React.MutableRefObject<(() => void) | null>
```
App 设置此 ref，当 Droid 完成时调用，触发 Codex 重新 Review。

**Droid Worker 新增：**
```typescript
onFixComplete?: (codexWorkerId: string) => void
```
Droid 完成 Fix 后调用，通知 App 协调下一步。

**理由：**
- 与现有 `onStopHookRef`, `onSendMessageRef` 模式一致
- 避免 prop drilling
- 支持动态绑定/解绑

**替代方案：**
- ❌ Event Emitter：需要引入新依赖，过度设计
- ❌ 直接 prop 传递：需要多层传递，代码冗余

### 3. 优先级过滤：P0/P1 only

**决策：** 在 `checkboxUtils.ts` 新增 `filterP0P1Items` 函数

```typescript
export function filterP0P1Items(items: CheckboxItem[]): CheckboxItem[] {
  return items.filter(item => {
    const text = item.text.trim().toUpperCase()
    return text.startsWith('P0') || text.startsWith('P1')
  })
}
```

**理由：**
- P0/P1 是关键问题，必须修复
- P2+ 是优化建议，不阻塞发布
- 简单的前缀匹配，性能好

**替代方案：**
- ❌ 正则表达式：过度复杂，性能差
- ❌ 配置化优先级：增加复杂度，当前需求不需要

### 4. 状态管理：autoFixActiveMap

**决策：** App.tsx 新增状态跟踪哪些 Codex Worker 处于 Auto Fix 模式

```typescript
const [autoFixActiveMap, setAutoFixActiveMap] = useState<Map<string, boolean>>(new Map())
```

**理由：**
- 支持多个 Codex Worker 同时运行 Auto Fix
- 避免状态冲突
- 便于调试和监控

### 5. 庆祝动画升级

**决策：** 增强现有 `triggerCelebration` 函数

**新增效果：**
- 彩带数量：150 → 300
- 新增烟花效果（中心爆炸式扩散）
- 新增音效提示（可选，通过 Audio API）
- 动画时长：5s → 8s

**理由：**
- Auto Fix 完成是重要里程碑，值得更强烈的视觉反馈
- 纯 CSS/JS 实现，无需外部依赖
- 性能影响可控（动画结束后清理 DOM）

## Risks / Trade-offs

### Risk 1: Droid Worker 未就绪时触发 Auto Fix
**风险：** 用户点击 Auto Fix，但 Droid Worker 尚未初始化或已关闭

**缓解：**
- App.tsx 在 `handleDroidFixRequest` 中检查 Droid Worker 状态
- 如果未就绪，自动创建 `fix_review` 模式的 Droid Worker（现有逻辑）
- 如果创建失败，显示错误提示并退出 Auto Fix 模式

### Risk 2: 循环无限进行（Droid 修复后仍有 P0/P1）
**风险：** Droid Worker 修复不彻底，Codex Re-review 后仍有 P0/P1 问题

**缓解：**
- 设置最大循环次数（如 10 次）
- 超过限制后显示警告："Auto Fix 已达最大尝试次数，请手动检查"
- 用户可随时点击"停止 Auto Fix"按钮中断循环

### Risk 3: 用户在 Auto Fix 期间关闭 Worker
**风险：** 用户关闭 Codex 或 Droid Worker，导致循环中断

**缓解：**
- 关闭 Worker 前检查 `autoFixActiveMap`，如果处于 Auto Fix 模式，弹窗确认
- 清理绑定关系时同步清理 Auto Fix 状态
- 记录日志便于调试

### Risk 4: 性能影响（频繁 Review）
**风险：** 多次 Review 可能消耗大量 Codex 资源

**缓解：**
- 仅在 Droid 完成后触发 Re-review，不是轮询
- Review 结果缓存在 history 中，避免重复计算
- 用户可随时停止循环

## Migration Plan

**部署步骤：**
1. 合并代码到 main 分支
2. 本地测试 Auto Fix 循环流程
3. 验证庆祝动画效果
4. 发布新版本

**回滚策略：**
- 如果发现严重 bug，回退到上一个 commit
- Auto Fix 是可选功能，不影响核心 Review/Fix 流程
- 用户可继续使用手动 "Droid Fix" 按钮

**兼容性：**
- 向后兼容：现有 Confirmation Card 配置无需修改
- 新增的 props 都是可选的（`onTriggerReReviewRef`, `onFixComplete`）
- 不影响非 Auto Fix 模式的使用

## Open Questions

1. **最大循环次数设置为多少？**
   - 建议：10 次（可配置）
   - 待确认：是否需要在 UI 显示当前循环次数？

2. **庆祝动画是否需要音效？**
   - 建议：可选，默认关闭（避免打扰用户）
   - 待确认：是否需要在设置中添加开关？

3. **P0/P1 过滤逻辑是否需要配置化？**
   - 当前：硬编码 P0/P1
   - 待确认：是否需要支持自定义优先级规则（如 P0/P1/P2）？
