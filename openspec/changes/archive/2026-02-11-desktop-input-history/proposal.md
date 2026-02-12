## Why

Desktop 应用中用户在编辑窗口输入的内容在程序异常退出时会丢失，导致用户工作成果损失。需要自动保存所有人工输入和编辑的文本到历史记录中，并提供恢复机制，确保用户内容不会因程序崩溃而丢失。

## What Changes

- 在 desktop 应用的所有编辑窗口中自动捕获用户的输入和编辑操作
- 将用户输入的文本内容实时保存到项目 `openspec/desktop_chat_history.json` 文件中
- 在编辑窗口中添加历史记录列表 UI，显示所有保存的输入历史
- 用户可以点击历史记录项查看内容，并选择加载到当前编辑器中
- 历史记录按时间倒序排列，包含时间戳和内容预览
- 支持清理过期或不需要的历史记录

## Capabilities

### New Capabilities
- `input-history-storage`: 输入历史的持久化存储机制，包括保存、读取、清理历史记录
- `input-history-ui`: 编辑窗口中的历史记录列表界面，支持查看和加载历史内容

### Modified Capabilities
- `editor-panel`: EditorPanel 组件需要集成输入历史功能，在用户输入时自动保存，并提供历史记录访问入口

## Impact

- **前端代码**: `app/src/EditorPanel.tsx` 需要添加输入历史保存逻辑和 UI 组件
- **存储**: 历史记录持久化到项目目录下 `openspec/desktop_chat_history.json` 文件，通过 desktop Python 后端的 native bridge 进行读写
- **Python 后端**: `desktop/app.py` 需要新增读写 `openspec/desktop_chat_history.json` 的 bridge 接口
- **用户体验**: 编辑器界面需要添加历史记录面板或弹窗
- **性能**: 需要考虑频繁保存对性能的影响，可能需要防抖或节流机制
