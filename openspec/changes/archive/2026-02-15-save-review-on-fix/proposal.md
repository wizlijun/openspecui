## Why

记录所有评审过程，便于追溯和分析 Auto Fix 循环中的评审历史。当前系统在执行 Fix 操作时，评审要求仅存在于运行时内存中，无法持久化查看和分析。

## What Changes

- 在每次 Fix 操作时，自动保存评审要求到 `/openspec/reviews/yyyy-mm-dd-review-<git-commit-hash>.md` 文件
- 文件名中的 `<git-commit-hash>` 部分为当前 git 提交的短哈希（7 位，如 `2026-02-14-review-1242271.md`）
- 同一个 review 文件中，每次 Fix 评审追加一行记录，标注第 N 次评审
- 每次 git 提交后，新建新的 review 文件（新的日期戳 + 新的 commit hash）

## Capabilities

### New Capabilities
- `review-persistence`: 评审要求持久化存储，包括内容格式、追加逻辑、第 N 次评审标注
- `review-naming`: 评审文件命名，基于当前日期和 git commit hash 生成文件名
- `review-lifecycle`: 评审文件生命周期管理，包括 git 提交后检测并创建新文件的触发逻辑

### Modified Capabilities
- `autofix-loop-orchestration`: 在 Auto Fix 循环中集成评审保存逻辑，每次触发 Droid Worker Fix 时保存评审要求

## Impact

- **App.tsx**: 在 `handleDroidFixRequest` 和 `handleAutoFixReviewComplete` 中添加评审保存调用
- **新增模块**: 创建 `reviewPersistenceService.ts` 处理文件写入、命名（基于日期+git hash）、追加逻辑
- **openspec/reviews/**: 新增目录用于存储评审文档
