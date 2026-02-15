## ADDED Requirements

### Requirement: Fix 操作时保存评审要求
系统 SHALL 在每次 Fix 操作（包括手动 Droid Fix 和 Auto Fix）触发时，将评审要求内容保存到对应的 review 文件中。

#### Scenario: 首次 Fix 操作创建 review 文件
- **WHEN** 用户触发 Fix 操作（手动或 Auto Fix）
- **WHEN** 当前不存在活跃的 review 文件
- **THEN** 系统 SHALL 创建新的 review 文件，路径为 `/openspec/reviews/yyyy-mm-dd-review-<git-short-hash>.md`
- **THEN** 文件头部包含标题 `# Review: yyyy-mm-dd-review-<git-short-hash>`
- **THEN** 写入第 1 次评审记录，格式为 `## 第 1 次评审 (yyyy-mm-dd HH:mm:ss)`
- **THEN** 评审要求内容以 Markdown 列表形式追加在标题下方

#### Scenario: 后续 Fix 操作追加评审记录
- **WHEN** 用户触发 Fix 操作
- **WHEN** 当前已存在活跃的 review 文件
- **THEN** 系统 SHALL 在现有文件末尾追加新的评审记录
- **THEN** 评审序号自动递增（第 N 次评审）
- **THEN** 包含当前时间戳

#### Scenario: 评审内容格式
- **WHEN** 系统保存评审要求
- **THEN** 每条评审项 SHALL 以 `- ` 前缀的 Markdown 列表项格式写入
- **THEN** 保留原始评审文本内容

### Requirement: Review 文件读写通过 Native Bridge
系统 SHALL 通过 `nativeReadFile` 和 `nativeWriteFile` 进行 review 文件的读写操作。

#### Scenario: Native App 模式下写入 review 文件
- **WHEN** 系统需要写入 review 文件
- **WHEN** 运行在 Native App 模式（`window.__isNativeApp === true`）
- **THEN** 系统 SHALL 使用 `nativeWriteFile` 写入文件
- **THEN** 写入路径为 `<projectPath>/openspec/reviews/<filename>.md`

#### Scenario: 非 Native App 模式跳过保存
- **WHEN** 系统需要写入 review 文件
- **WHEN** 运行在浏览器模式（`window.__isNativeApp !== true`）
- **THEN** 系统 SHALL 静默跳过保存操作，不报错

### Requirement: 评审序号自动管理
系统 SHALL 自动管理每个 review 文件中的评审序号。

#### Scenario: 解析现有文件获取当前序号
- **WHEN** 系统需要追加评审记录到已有文件
- **THEN** 系统 SHALL 读取文件内容，解析最后一个 `## 第 N 次评审` 标题
- **THEN** 新记录的序号为 N + 1

#### Scenario: 新文件从第 1 次开始
- **WHEN** 系统创建新的 review 文件
- **THEN** 首条评审记录的序号 SHALL 为 1
