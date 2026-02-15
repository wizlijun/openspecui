## ADDED Requirements

### Requirement: Git 提交检测触发新 Review 文件
系统 SHALL 通过轮询 git log 检测新提交，检测到新提交后触发创建新的 review 文件。

#### Scenario: 启动 git 提交轮询
- **WHEN** App 加载且 projectPath 可用
- **WHEN** 运行在 Native App 模式
- **THEN** 系统 SHALL 启动 30 秒间隔的轮询，执行 `git log -1 --format=%H` 获取最新提交哈希

#### Scenario: 检测到新提交
- **WHEN** 轮询检测到当前提交哈希与上次记录的不同
- **THEN** 系统 SHALL 清空当前活跃的 review 文件名缓存
- **THEN** 下次 Fix 操作时 SHALL 创建新的 review 文件（新日期戳 + 新 commit hash）

#### Scenario: 首次轮询初始化
- **WHEN** 轮询首次执行
- **THEN** 系统 SHALL 记录当前提交哈希作为基准
- **THEN** 不触发新文件创建

#### Scenario: 轮询失败时的容错
- **WHEN** git 命令执行失败（如不在 git 仓库中）
- **THEN** 系统 SHALL 静默忽略错误
- **THEN** 保持当前状态不变
- **THEN** 下次轮询继续尝试

### Requirement: 轮询生命周期管理
系统 SHALL 在 App 卸载或 projectPath 变更时清理轮询定时器。

#### Scenario: App 卸载时清理
- **WHEN** App 组件卸载
- **THEN** 系统 SHALL 清除轮询定时器
- **THEN** 释放相关资源

#### Scenario: projectPath 变更时重置
- **WHEN** 用户切换项目目录
- **THEN** 系统 SHALL 清除旧的轮询定时器
- **THEN** 清空 review 文件名缓存和提交哈希记录
- **THEN** 启动新的轮询
