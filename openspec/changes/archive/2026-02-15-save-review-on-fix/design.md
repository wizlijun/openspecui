## Context

当前系统在 Auto Fix 循环中，评审要求仅存在于运行时内存（传递给 Droid Worker 的消息），无法持久化查看和分析。需要在每次 Fix 操作时，将评审要求保存到文件系统，便于追溯和分析评审历史。

系统架构：
- **App.tsx**: 协调 Codex Worker（评审）和 Droid Worker（修复）的交互，通过 `handleDroidFixRequest` 触发 Fix 操作
- **Native Bridge**: 通过 `window.__nativeBridge.writeFile()` 提供文件系统写入能力
- **openspec/reviews/**: 目标存储目录（已存在但为空）

约束：
- 文件名必须包含日期戳（yyyy-mm-dd）便于按时间排序
- 文件名包含当前 git commit 的 7 位短哈希，便于关联代码版本
- 每次 git 提交后需要创建新文件（新日期戳 + 新 commit hash）

## Goals / Non-Goals

**Goals:**
- 在每次 Fix 操作时自动保存评审要求到 `/openspec/reviews/yyyy-mm-dd-review-<git-short-hash>.md`
- 同一文件中追加多次评审记录，标注第 N 次
- git 提交后自动创建新的 review 文件
- 文件名基于当前日期和 git commit hash 自动生成

**Non-Goals:**
- 不修改现有 Auto Fix 循环的核心逻辑
- 不处理浏览器模式（仅支持 native app）
- 不实现评审文件的 UI 展示（仅持久化存储）

## Decisions

### Decision 1: 创建独立的 reviewPersistenceService 模块

**选择**: 创建 `app/src/reviewPersistenceService.ts` 处理所有评审持久化逻辑

**理由**:
- 分离关注点：App.tsx 已经很复杂（1000+ 行），不应再添加文件操作逻辑
- 可测试性：独立模块便于单元测试
- 复用性：未来其他地方也可能需要保存评审记录

**替代方案**: 直接在 App.tsx 中实现 → 被拒绝，因为会进一步增加 App.tsx 的复杂度

### Decision 2: 文件命名策略 — 使用日期 + git commit hash

**选择**: 文件名格式为 `yyyy-mm-dd-review-<git-short-hash>.md`，其中 git short hash 为当前 HEAD 的 7 位短哈希

**理由**:
- 确定性：文件名完全由日期和 git 状态决定，无需依赖 LLM 生成
- 可追溯：通过 commit hash 可以直接关联到对应的代码版本
- 简单可靠：不需要额外的 Droid 调用，减少复杂度和延迟

**实现方式**:
```typescript
// 获取当前 git short hash
const hash = await getGitShortHash(projectPath) // e.g. "1242271"
const date = formatDate(new Date()) // e.g. "2026-02-14"
const filename = `${date}-review-${hash}.md`
```

**替代方案 A**: 使用 LLM 生成语义化文件名 → 被拒绝，增加复杂度和延迟，且依赖 Droid 可用性
**替代方案 B**: 使用固定模板（如 `review-1`, `review-2`）→ 被拒绝，无法关联代码版本

### Decision 3: Git 提交检测 — 使用轮询 + git log

**选择**: 在 reviewPersistenceService 中实现轮询机制，定期检查 `git log -1 --format=%H`，检测到新提交时触发新文件创建

**理由**:
- 简单可靠：不依赖 git hooks 或外部工具
- 跨平台：纯 JavaScript 实现，通过 native bridge 调用 git 命令
- 实时性足够：30 秒轮询间隔对评审场景足够

**实现方式**:
```typescript
let lastCommitHash: string | null = null
setInterval(async () => {
  const currentHash = await getLatestCommitHash()
  if (lastCommitHash && currentHash !== lastCommitHash) {
    // 检测到新提交，清空当前文件名缓存，下次评审时创建新文件
    currentReviewFile = null
  }
  lastCommitHash = currentHash
}, 30000) // 30 秒轮询
```

**替代方案 A**: 使用 git hooks → 被拒绝，需要用户手动配置
**替代方案 B**: 监听文件系统变化 → 被拒绝，复杂度高且不可靠

### Decision 4: 评审内容格式 — Markdown 列表

**选择**: 使用简单的 Markdown 格式，每次评审追加一行

```markdown
# Review: 2026-02-14-review-1242271

## 第 1 次评审 (2026-02-14 10:30:15)
- 修复登录表单验证逻辑
- 添加邮箱格式检查
- 处理空输入边界情况

## 第 2 次评审 (2026-02-14 11:05:42)
- 优化错误提示文案
- 修复密码长度限制
```

**理由**:
- 可读性强：Markdown 格式便于人工查看
- 可扩展：未来可以添加更多元数据（如 Codex Worker ID、Droid Worker ID）
- 简单：不需要复杂的解析逻辑

**替代方案**: JSON 格式 → 被拒绝，可读性差

## Risks / Trade-offs

**[Risk] Droid 生成的文件名可能不符合 kebab-case 规范**
→ **已移除**: 文件名改为基于日期 + git hash，不再依赖 Droid 生成

**[Risk] 轮询 git log 可能影响性能**
→ **Mitigation**: 30 秒轮询间隔足够低频，且 git log 命令执行很快（< 10ms）

**[Risk] 多个 Codex Worker 同时触发 Fix 时可能产生文件名冲突**
→ **Mitigation**: 文件名基于 git commit hash，同一 commit 下的多次评审会追加到同一文件，不会冲突

**[Risk] 用户可能在 git 提交前关闭应用，导致轮询停止**
→ **Mitigation**: 这是可接受的限制，下次启动应用时会创建新文件

## Migration Plan

1. **Phase 1**: 创建 `reviewPersistenceService.ts` 模块，实现核心逻辑
2. **Phase 2**: 在 App.tsx 的 `handleDroidFixRequest` 中集成评审保存调用
3. **Phase 3**: 启动 git 提交轮询（在 App.tsx 的 useEffect 中初始化）
4. **Phase 4**: 测试验证（手动触发 Fix 操作，检查文件生成和追加逻辑）

**Rollback**: 如果出现问题，移除 `handleDroidFixRequest` 中的保存调用即可，不影响现有功能

## Open Questions

1. **文件名生成失败时的降级策略？**
   - 建议：git hash 获取失败时使用时间戳作为 fallback（如 `2026-02-14-review-103015.md`）

2. **是否需要限制单个 review 文件的大小？**
   - 建议：暂不限制，如果未来出现问题再考虑分页

3. **是否需要在 UI 中显示"评审已保存"的提示？**
   - 建议：暂不实现，保持 UI 简洁
