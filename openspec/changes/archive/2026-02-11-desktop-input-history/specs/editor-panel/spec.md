## ADDED Requirements

### Requirement: 编辑器集成输入历史保存
EditorPanel 组件 SHALL 在用户输入或编辑文本时自动触发输入历史保存机制。

#### Scenario: 监听文本变化
- **WHEN** 用户在编辑器的 textarea 中输入或修改文本
- **THEN** 系统 SHALL 触发防抖保存逻辑，在用户停止输入 2 秒后保存当前内容到历史记录

#### Scenario: 保存时包含文件路径
- **WHEN** 保存输入历史
- **THEN** 系统 SHALL 记录当前编辑的文件路径（从 `spec.nativePath` 获取）

### Requirement: 编辑器添加历史记录入口
EditorPanel 组件 SHALL 在编辑器头部添加"历史记录"按钮，用户点击后打开历史记录面板。

#### Scenario: 显示历史记录按钮
- **WHEN** EditorPanel 渲染
- **THEN** 编辑器头部 SHALL 在保存按钮旁边显示"历史记录"按钮

#### Scenario: 点击打开历史记录面板
- **WHEN** 用户点击"历史记录"按钮
- **THEN** 系统 SHALL 打开历史记录面板，显示与当前文件相关的所有历史记录

### Requirement: 仅在 Native App 模式下启用
输入历史功能 SHALL 仅在 native app 模式下启用（`window.__isNativeApp` 为 true），浏览器模式下不显示历史记录功能。

#### Scenario: Native App 模式显示历史功能
- **WHEN** EditorPanel 在 native app 模式下渲染
- **THEN** 系统 SHALL 显示历史记录按钮并启用自动保存功能

#### Scenario: 浏览器模式隐藏历史功能
- **WHEN** EditorPanel 在浏览器模式下渲染
- **THEN** 系统 SHALL 不显示历史记录按钮，不启用自动保存功能
