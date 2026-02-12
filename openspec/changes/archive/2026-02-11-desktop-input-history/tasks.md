## 1. 输入历史存储服务模块

- [x] 1.1 创建 `app/src/inputHistoryService.ts` 文件
- [x] 1.2 实现 `HistoryEntry` 类型定义（id, timestamp, filePath, content, preview）
- [x] 1.3 实现 `loadHistory(projectPath)` 函数，通过 nativeReadFile 读取并解析 JSON
- [x] 1.4 实现 `saveHistoryEntry(projectPath, filePath, content)` 函数，追加新记录并写入
- [x] 1.5 实现 `deleteHistoryEntry(projectPath, id)` 函数，删除单条记录
- [x] 1.6 实现 `clearHistory(projectPath)` 函数，清空所有记录
- [x] 1.7 实现 ID 生成逻辑（Date.now() + 4位随机字符串）
- [x] 1.8 实现内容预览截取逻辑（前100字符）

## 2. 时间格式化工具函数

- [x] 2.1 创建 `app/src/timeUtils.ts` 文件
- [x] 2.2 实现 `formatRelativeTime(timestamp)` 函数，24小时内显示相对时间
- [x] 2.3 实现 `formatAbsoluteTime(timestamp)` 函数，超过24小时显示 YYYY-MM-DD HH:mm

## 3. 历史记录面板组件

- [x] 3.1 创建 `app/src/InputHistoryPanel.tsx` 文件
- [x] 3.2 实现 InputHistoryPanel 组件基础结构（props: projectPath, onLoadContent, onClose）
- [x] 3.3 实现历史记录列表加载逻辑（调用 loadHistory）
- [x] 3.4 实现历史记录列表 UI（时间戳、文件路径、内容预览）
- [x] 3.5 实现空历史记录提示 UI
- [x] 3.6 实现查看详情功能（展开显示完整内容）
- [x] 3.7 实现"加载到编辑器"按钮及确认对话框
- [x] 3.8 实现删除单条记录功能
- [x] 3.9 实现清空所有历史功能及确认对话框
- [x] 3.10 添加历史记录面板样式到 `app/src/App.css`

## 4. EditorPanel 集成输入历史

- [x] 4.1 在 EditorPanel props 中添加 `projectPath?: string` 参数
- [x] 4.2 在 App.tsx 中传递 `tree?.nativePath` 到 EditorPanel
- [x] 4.3 在 EditorPanel 中添加 state 管理历史面板显示状态
- [x] 4.4 在 EditorPanel header 添加"历史记录"按钮（仅 native app 模式）
- [x] 4.5 实现历史面板切换逻辑（显示/隐藏）
- [x] 4.6 实现防抖保存逻辑（useRef + setTimeout，2秒延迟）
- [x] 4.7 在 textarea onChange 中触发防抖保存
- [x] 4.8 实现从历史面板加载内容到编辑器的回调函数
- [x] 4.9 添加历史记录按钮图标到 Icons.tsx（可选）

## 5. 测试与验证

- [x] 5.1 测试首次保存时自动创建 `openspec/desktop_chat_history.json` 文件
- [x] 5.2 测试连续输入时防抖机制（2秒内只保存一次）
- [x] 5.3 测试历史记录按时间倒序显示
- [x] 5.4 测试查看历史记录详情和加载到编辑器功能
- [x] 5.5 测试删除单条历史记录
- [x] 5.6 测试清空所有历史记录
- [x] 5.7 测试浏览器模式下历史功能不显示
- [x] 5.8 测试多个文件编辑时历史记录正确关联文件路径
