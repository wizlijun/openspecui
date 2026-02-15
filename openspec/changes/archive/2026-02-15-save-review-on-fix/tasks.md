## 1. reviewPersistenceService 核心模块

- [x] 1.1 创建 `app/src/reviewPersistenceService.ts`，定义模块接口：`saveReviewEntry(projectPath, reviewItems)` 和 `resetReviewFile()` 和 `startCommitPolling(projectPath)` / `stopCommitPolling()`
- [x] 1.2 实现 `getGitShortHash(projectPath: string): Promise<string>` 函数，通过 native bridge 调用 `git log -1 --format=%h` 获取 7 位短哈希
- [x] 1.3 实现 fallback 文件名生成 `generateFallbackName(): string`，格式为 `yyyy-mm-dd-review-HHmmss`（git hash 获取失败时使用）
- [x] 1.4 实现评审序号解析函数 `parseLastReviewNumber(content: string): number`，从文件内容中提取最后一个 `## 第 N 次评审` 的 N 值
- [x] 1.5 实现 `saveReviewEntry` 核心逻辑：首次创建文件（基于日期+git hash 生成文件名）或追加到已有文件，写入 Markdown 格式的评审记录

## 2. 文件名生成

- [x] 2.1 实现 `generateReviewFileName(projectPath: string): Promise<string>` 函数，格式为 `yyyy-mm-dd-review-<git-short-hash>.md`
- [x] 2.2 添加 git hash 获取失败时的 fallback 处理，使用时间戳替代
- [x] 2.3 添加文件名缓存逻辑，同一 commit 下复用同一文件名

## 3. Git 提交轮询检测

- [x] 3.1 实现 `startCommitPolling(projectPath: string)` 函数，30 秒间隔轮询 `git log -1 --format=%H`
- [x] 3.2 实现提交哈希变化检测逻辑：首次记录基准哈希，后续检测到变化时调用 `resetReviewFile()` 清空文件名缓存
- [x] 3.3 实现 `stopCommitPolling()` 函数，清除定时器并释放资源
- [x] 3.4 添加轮询容错：git 命令失败时静默忽略，保持当前状态

## 4. App.tsx 集成

- [x] 4.1 在 App.tsx 中 import `reviewPersistenceService`，在 `useEffect` 中根据 `tree?.nativePath` 启动/停止 git 提交轮询
- [x] 4.2 在 `handleDroidFixRequest` 中，发送 Fix 消息后调用 `saveReviewEntry` 保存评审要求（传入选中的评审项列表）
- [x] 4.3 在 `handleAutoFixReviewComplete` 中，当决定继续 Fix 循环时调用 `saveReviewEntry` 保存本轮评审要求
- [x] 4.4 无需传递 Droid 文件名生成回调，文件名由 git hash 自动生成

## 5. 测试验证

- [x] 5.1 为 `getGitShortHash` 编写单元测试，覆盖正常获取、git 命令失败等场景
- [x] 5.2 为 `parseLastReviewNumber` 编写单元测试，覆盖空文件、单次评审、多次评审场景
- [x] 5.3 为 `saveReviewEntry` 编写单元测试（mock nativeWriteFile / nativeReadFile），验证首次创建和追加逻辑
- [x] 5.4 手动端到端测试：触发 Fix 操作，验证 `/openspec/reviews/` 下生成正确格式的 review 文件（文件名包含 git hash）
