## ADDED Requirements

### Requirement: 历史记录持久化到 JSON 文件
系统 SHALL 将用户输入历史保存到项目目录下 `openspec/desktop_chat_history.json` 文件中，使用 JSON 格式存储。每条历史记录 SHALL 包含以下字段：
- `id`: 唯一标识符（时间戳 + 随机后缀）
- `timestamp`: ISO 8601 格式的保存时间
- `filePath`: 编辑的文件路径
- `content`: 用户输入的文本内容
- `preview`: 内容前 100 个字符的预览文本

#### Scenario: 首次保存时创建文件
- **WHEN** 用户首次在编辑器中输入内容且 `openspec/desktop_chat_history.json` 不存在
- **THEN** 系统 SHALL 自动创建该文件并写入包含该条记录的 JSON 数组

#### Scenario: 追加保存到已有文件
- **WHEN** 用户输入内容且 `openspec/desktop_chat_history.json` 已存在
- **THEN** 系统 SHALL 读取现有记录，追加新记录，并写回文件

### Requirement: 通过 Native Bridge 读写历史文件
系统 SHALL 通过 desktop Python 后端的 native bridge 接口读写 `openspec/desktop_chat_history.json`，复用现有的 `nativeReadFile` 和 `nativeWriteFile` 方法。

#### Scenario: 使用 native bridge 保存历史
- **WHEN** 在 native app 模式下保存输入历史
- **THEN** 系统 SHALL 调用 `nativeWriteFile` 将 JSON 内容写入 `openspec/desktop_chat_history.json`

#### Scenario: 使用 native bridge 读取历史
- **WHEN** 在 native app 模式下加载输入历史列表
- **THEN** 系统 SHALL 调用 `nativeReadFile` 读取 `openspec/desktop_chat_history.json` 的内容

### Requirement: 防抖保存机制
系统 SHALL 使用防抖（debounce）机制保存用户输入，避免每次按键都触发文件写入。防抖延迟 SHALL 为 2 秒。

#### Scenario: 用户连续输入时防抖
- **WHEN** 用户在 2 秒内连续输入多个字符
- **THEN** 系统 SHALL 仅在最后一次输入后 2 秒触发一次保存操作

#### Scenario: 用户停止输入后保存
- **WHEN** 用户停止输入超过 2 秒
- **THEN** 系统 SHALL 将当前编辑器内容保存为一条新的历史记录

### Requirement: 历史记录按时间倒序排列
系统 SHALL 按时间戳倒序存储和返回历史记录，最新的记录排在最前面。

#### Scenario: 读取历史记录列表
- **WHEN** 用户打开历史记录面板
- **THEN** 系统 SHALL 返回按 `timestamp` 倒序排列的历史记录列表

### Requirement: 删除历史记录
系统 SHALL 支持删除单条历史记录和清空所有历史记录。

#### Scenario: 删除单条历史记录
- **WHEN** 用户选择删除某条历史记录
- **THEN** 系统 SHALL 从 JSON 文件中移除该条记录并保存

#### Scenario: 清空所有历史记录
- **WHEN** 用户选择清空所有历史记录
- **THEN** 系统 SHALL 将 JSON 文件内容重置为空数组
