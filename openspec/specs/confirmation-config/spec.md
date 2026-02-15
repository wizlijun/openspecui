## ADDED Requirements

### Requirement: YAML 配置支持 confirmation 字段
`droid_worker_define.yml` 和 `codex_worker_define.yml` 的 `modes.<mode>` 配置 SHALL 支持可选的 `confirmation` 配置块。

#### Scenario: 配置文件包含 confirmation 字段
- **WHEN** 配置文件中某个 mode 包含如下配置：
  ```yaml
  confirmation:
    enabled: true
    response_template: "已确认以下项目：\n{selected_items}"
  ```
- **THEN** 系统 SHALL 解析该配置并应用到对应 Worker 模式

#### Scenario: 配置文件不包含 confirmation 字段
- **WHEN** 配置文件中某个 mode 未包含 `confirmation` 字段
- **THEN** 系统 SHALL 使用默认值：`enabled: true`，`response_template` 为内置默认模板

### Requirement: enabled 字段控制弹窗启用
`confirmation.enabled` 字段 SHALL 控制是否启用人工确认弹窗功能。

#### Scenario: enabled 为 true
- **WHEN** `confirmation.enabled` 为 `true`（或未配置，默认值）
- **THEN** 系统 SHALL 在检测到未勾选 checkbox 时触发确认弹窗

#### Scenario: enabled 为 false
- **WHEN** `confirmation.enabled` 为 `false`
- **THEN** 系统 SHALL NOT 触发确认弹窗，消息正常显示在聊天历史中

### Requirement: response_template 字段自定义响应格式
`confirmation.response_template` 字段 SHALL 定义确认消息的格式模板，支持 `{selected_items}` 占位符。

#### Scenario: 使用自定义模板
- **WHEN** 配置了 `response_template: "执行以下任务：\n{selected_items}"`
- **THEN** 系统 SHALL 使用该模板格式化确认消息

#### Scenario: 未配置模板
- **WHEN** 未配置 `response_template`
- **THEN** 系统 SHALL 使用默认模板 `"已确认以下项目：\n{selected_items}"`

### Requirement: 配置加载集成到现有加载机制
confirmation 配置 SHALL 通过现有的 `loadWorkerConfig.ts` 和 `loadCodexWorkerConfig.ts` 加载，作为 `DroidWorkerConfig` 和 `CodexWorkerConfig` 类型的一部分。

#### Scenario: 配置加载成功
- **WHEN** 系统加载 Worker 配置文件
- **THEN** `confirmation` 字段 SHALL 被解析并合并到对应的 config 对象中

#### Scenario: 配置加载失败回退
- **WHEN** 配置文件格式错误或不存在
- **THEN** 系统 SHALL 回退到默认配置，`confirmation` 使用默认值（enabled: true，无自定义模板）
