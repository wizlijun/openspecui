# input-history-ui Specification

## Purpose
TBD - created by archiving change desktop-input-history. Update Purpose after archive.
## Requirements
### Requirement: 历史记录面板显示
系统 SHALL 在编辑器窗口中提供历史记录面板，显示所有保存的输入历史。面板 SHALL 包含：
- 历史记录列表（按时间倒序）
- 每条记录显示时间戳、文件路径和内容预览
- 查看详情按钮
- 删除按钮
- 清空所有历史按钮

#### Scenario: 打开历史记录面板
- **WHEN** 用户点击编辑器中的"历史记录"按钮
- **THEN** 系统 SHALL 显示历史记录面板，加载并展示所有历史记录

#### Scenario: 显示历史记录列表项
- **WHEN** 历史记录面板打开且有历史记录
- **THEN** 每条记录 SHALL 显示格式化的时间戳、文件路径和内容预览（前 100 字符）

#### Scenario: 空历史记录提示
- **WHEN** 历史记录面板打开但没有任何历史记录
- **THEN** 系统 SHALL 显示"暂无历史记录"提示信息

### Requirement: 查看历史记录详情
系统 SHALL 支持用户点击历史记录项查看完整内容，并提供加载到编辑器的功能。

#### Scenario: 点击查看历史记录详情
- **WHEN** 用户点击某条历史记录的查看按钮
- **THEN** 系统 SHALL 在弹窗或展开区域中显示该记录的完整内容

#### Scenario: 加载历史记录到编辑器
- **WHEN** 用户在查看详情时点击"加载到编辑器"按钮
- **THEN** 系统 SHALL 将该历史记录的内容替换当前编辑器中的文本

#### Scenario: 加载前确认提示
- **WHEN** 用户点击"加载到编辑器"且当前编辑器有未保存的内容
- **THEN** 系统 SHALL 显示确认对话框，提示用户当前内容将被替换

### Requirement: 删除历史记录
系统 SHALL 支持删除单条历史记录和清空所有历史记录。

#### Scenario: 删除单条历史记录
- **WHEN** 用户点击某条历史记录的删除按钮
- **THEN** 系统 SHALL 从列表中移除该记录并更新存储文件

#### Scenario: 清空所有历史记录
- **WHEN** 用户点击"清空所有历史"按钮
- **THEN** 系统 SHALL 显示确认对话框，确认后清空所有历史记录并更新 UI

### Requirement: 历史记录面板样式
历史记录面板 SHALL 与现有编辑器界面风格保持一致，使用相同的颜色方案和字体。

#### Scenario: 面板样式一致性
- **WHEN** 历史记录面板显示
- **THEN** 面板的背景色、文字颜色、按钮样式 SHALL 与 EditorPanel 组件保持一致

### Requirement: 时间戳格式化显示
系统 SHALL 将历史记录的时间戳格式化为易读的本地时间格式。

#### Scenario: 显示相对时间
- **WHEN** 历史记录的时间戳在 24 小时内
- **THEN** 系统 SHALL 显示相对时间（如"2 小时前"、"30 分钟前"）

#### Scenario: 显示绝对时间
- **WHEN** 历史记录的时间戳超过 24 小时
- **THEN** 系统 SHALL 显示绝对时间（如"2026-02-10 14:30"）

