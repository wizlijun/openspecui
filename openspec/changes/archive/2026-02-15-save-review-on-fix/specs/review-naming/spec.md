## ADDED Requirements

### Requirement: 基于日期和 Git Hash 生成 Review 文件名
系统 SHALL 在首次 Fix 操作时，基于当前日期和 git commit 短哈希自动生成 review 文件名。

#### Scenario: 首次评审时生成文件名
- **WHEN** 首次 Fix 操作触发且需要创建新的 review 文件
- **THEN** 系统 SHALL 通过 native bridge 执行 `git log -1 --format=%h` 获取 7 位短哈希
- **THEN** 最终文件名格式为 `yyyy-mm-dd-review-<git-short-hash>.md`（如 `2026-02-14-review-1242271.md`）

#### Scenario: Git hash 获取失败时的降级
- **WHEN** git 命令执行失败（如不在 git 仓库中、git 未安装）
- **THEN** 系统 SHALL 使用时间戳作为 fallback 文件名
- **THEN** fallback 格式为 `yyyy-mm-dd-review-HHmmss.md`

### Requirement: 文件名缓存
系统 SHALL 缓存当前活跃的 review 文件名，避免重复获取 git hash。

#### Scenario: 同一评审周期内复用文件名
- **WHEN** 当前已有活跃的 review 文件名
- **WHEN** 触发新的 Fix 操作
- **THEN** 系统 SHALL 直接使用缓存的文件名，不再获取 git hash

#### Scenario: 新评审周期清空缓存
- **WHEN** git 提交检测到新提交
- **THEN** 系统 SHALL 清空文件名缓存
- **THEN** 下次 Fix 操作时重新获取 git hash 生成新文件名
