## MODIFIED Requirements

### Requirement: Ops Agent Tab 创建和显示
应用 SHALL 支持创建 Ops Agent Tab，用于日志监控和分析。

#### Scenario: 用户点击 Ops Agent 按钮
- **WHEN** 用户点击顶部工具栏的"🔍 Ops Agent"按钮
- **THEN** 系统 SHALL 检查是否已存在 Ops Agent Tab
- **THEN** 如果已存在，系统 SHALL 切换到该 Tab
- **THEN** 如果不存在，系统 SHALL 调用 native bridge 创建新的 Ops Agent Tab

#### Scenario: Native 创建 Ops Agent Tab
- **WHEN** native bridge 接收到 createOpsAgentTab 消息
- **THEN** Python 后端 SHALL 读取 ops_agent_panel.html 文件内容
- **THEN** Python 后端 SHALL 注入项目路径到 HTML 中
- **THEN** Python 后端 SHALL 调用前端的 __createOpsAgentTab 函数传递 HTML 内容
- **THEN** 前端 SHALL 创建新的 Ops Agent Tab 并切换到该 Tab

### Requirement: 日志文件列表显示
Ops Agent Tab SHALL 显示项目中的日志文件列表供用户选择。

#### Scenario: 刷新日志文件列表
- **WHEN** Ops Agent Tab 加载完成或用户点击刷新按钮
- **THEN** 前端 SHALL 通过 JS Bridge 发送 opsAgentRefreshLogList 消息
- **THEN** Python 后端 SHALL 扫描项目日志目录（logs/、*.log 文件）
- **THEN** Python 后端 SHALL 返回日志文件列表（包含路径、大小、修改时间）
- **THEN** 前端 SHALL 更新左侧面板的日志文件列表

#### Scenario: 用户选择日志文件查看详情
- **WHEN** 用户点击日志文件名
- **THEN** 前端 SHALL 通过 JS Bridge 发送 opsAgentSelectLogFile 消息
- **THEN** Python 后端 SHALL 读取该日志文件的最后 100 行
- **THEN** Python 后端 SHALL 返回日志内容
- **THEN** 前端 SHALL 在右侧面板显示日志内容

### Requirement: 日志分析和 Droid Worker 集成
Ops Agent Tab SHALL 支持合并日志并创建 Droid Worker 进行分析。

#### Scenario: 用户触发日志分析
- **WHEN** 用户选择了至少一个日志文件、选择了时间范围、输入了上下文 Prompt 并点击"分析日志"按钮
- **THEN** 前端 SHALL 通过 JS Bridge 发送 opsAgentAnalyzeLogs 消息
- **THEN** Python 后端 SHALL 读取选中的日志文件并按时间范围过滤
- **THEN** Python 后端 SHALL 合并日志文件，添加文件名和时间段标记
- **THEN** Python 后端 SHALL 保存合并日志到 ops-agent/YYYY-MM-DD-HHmm-merged.log
- **THEN** Python 后端 SHALL 创建或重用 Droid Worker（general 模式）
- **THEN** Python 后端 SHALL 发送分析请求到 Droid Worker（上下文 Prompt + 合并日志路径）

#### Scenario: 重用已存在的 Droid Worker
- **WHEN** Ops Agent Tab 已绑定了一个 Droid Worker 且该 Worker 仍然存在
- **THEN** 系统 SHALL 重用该 Worker 而不是创建新的
- **THEN** 系统 SHALL 切换到该 Worker Tab
- **THEN** 如果有新的 autoSendMessage，系统 SHALL 更新并发送该消息

#### Scenario: Droid Worker 被关闭后清理绑定
- **WHEN** 用户关闭了绑定到 Ops Agent 的 Droid Worker Tab
- **THEN** 系统 SHALL 从 opsAgentToDroidRef 中删除该绑定关系
- **THEN** 下次分析时系统 SHALL 创建新的 Droid Worker

### Requirement: 状态持久化
Ops Agent Tab SHALL 保存和恢复用户的选择状态。

#### Scenario: 保存状态到项目目录
- **WHEN** 用户修改了日志选择、时间范围或上下文 Prompt
- **THEN** 前端 SHALL 通过 JS Bridge 发送 opsAgentSaveState 消息（debounce 500ms）
- **THEN** Python 后端 SHALL 保存状态到 <project>/ops-agent/.ops_agent_state.json
- **THEN** 状态文件 SHALL 包含 selected_logs、time_range、context_prompt

#### Scenario: 恢复上次的选择状态
- **WHEN** Ops Agent Tab 加载完成
- **THEN** Python 后端 SHALL 读取 <project>/ops-agent/.ops_agent_state.json
- **THEN** Python 后端 SHALL 通过 JS Bridge 发送状态数据到前端
- **THEN** 前端 SHALL 恢复上次选中的日志、时间范围和上下文 Prompt

### Requirement: 日志合并和时间戳处理
系统 SHALL 支持多种时间戳格式的日志合并和排序。

#### Scenario: 合并多个日志文件
- **WHEN** 系统合并多个日志文件
- **THEN** 系统 SHALL 解析每行的 ISO 8601 时间戳
- **THEN** 系统 SHALL 支持多种时间戳格式（YYYY-MM-DDTHH:mm:ss.sssZ、YYYY-MM-DD HH:mm:ss,SSS）
- **THEN** 系统 SHALL 按时间戳排序所有日志条目
- **THEN** 系统 SHALL 在切换文件时添加文件名标记（--- filename ---）
- **THEN** 系统 SHALL 在合并日志开头添加元数据（时间范围、源文件数量、总条目数）

#### Scenario: 处理无时间戳的日志行
- **WHEN** 日志行没有时间戳
- **THEN** 系统 SHALL 使用该文件的上一个有效时间戳
- **THEN** 如果没有上一个有效时间戳，系统 SHALL 使用 datetime.max 排序到最后

### Requirement: 错误处理
系统 SHALL 处理各种异常情况并提供友好的错误提示。

#### Scenario: 日志文件不存在
- **WHEN** 选中的日志文件不存在
- **THEN** 系统 SHALL 跳过该文件并记录警告
- **THEN** 系统 SHALL 继续处理其他日志文件

#### Scenario: 日志文件过大
- **WHEN** 日志文件大小超过 100MB
- **THEN** 系统 SHALL 只读取最后 10000 行
- **THEN** 系统 SHALL 在日志中记录该限制

#### Scenario: 日志合并失败
- **WHEN** 日志合并过程中发生错误
- **THEN** 系统 SHALL 记录错误信息
- **THEN** 系统 SHALL 保留原始日志文件不受影响
