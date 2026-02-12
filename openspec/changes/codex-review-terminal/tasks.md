## 1. Desktop 后端 - 评审 PTY 会话

- [x] 1.1 在 `app.py` 的 `AppCoordinator.__init__` 中新增 `review_terminal` 属性（TerminalSession 实例）和 `review_terminal_webview` 属性
- [x] 1.2 新增 `start_review_terminal(cols, rows)` 方法，启动评审 PTY 并绑定输出回调
- [x] 1.3 新增 `write_to_review_terminal(text)` 方法
- [x] 1.4 新增 `stop_review_terminal()` 方法，终止评审 PTY 并释放资源
- [x] 1.5 新增 `_on_review_terminal_output(data)` 和 `_on_review_terminal_exit(code)` 回调方法，将输出发送到 web app

## 2. Desktop 后端 - Native Bridge 消息扩展

- [x] 2.1 在 `NativeBridgeHandler` 中处理 `startReviewTerminal` 消息：启动评审 PTY，cd 到项目目录并运行 codex
- [x] 2.2 在 `NativeBridgeHandler` 中处理 `writeReviewInput` 消息：转发输入到评审 terminal
- [x] 2.3 在 `NativeBridgeHandler` 中处理 `stopReviewTerminal` 消息：终止评审 PTY

## 3. Desktop 后端 - Native Bridge JS 注入

- [x] 3.1 在 `AppDelegate` 的 inject_js 中扩展 `window.__nativeBridge`，新增 `startReviewTerminal(projectPath)`、`writeReviewInput(data)`、`stopReviewTerminal()` 方法
- [x] 3.2 新增 `window.__onReviewTerminalOutput(data)` 回调接口，供 Python 端调用向前端推送评审 terminal 输出

## 4. 前端 - ReviewTerminal 组件

- [x] 4.1 创建 `app/src/ReviewTerminal.tsx` 组件，内嵌 xterm.js Terminal 实例
- [x] 4.2 在组件 mount 时初始化 xterm.js，注册 `window.__onReviewTerminalOutput` 回调接收输出
- [x] 4.3 在组件 mount 时通过 `__nativeBridge.startReviewTerminal(projectPath)` 启动评审 PTY
- [x] 4.4 将 xterm.js 的 `onData` 事件通过 `__nativeBridge.writeReviewInput(data)` 发送到评审 PTY
- [x] 4.5 在组件 unmount 时调用 `__nativeBridge.stopReviewTerminal()` 并清理 xterm.js 实例

## 5. 前端 - UI 集成

- [x] 5.1 在 `App.tsx` 的 header 中新增 "Review" 按钮（仅 `window.__isNativeApp` 时显示）
- [x] 5.2 新增 `showReviewTerminal` state，控制评审 terminal 面板的显示/隐藏
- [x] 5.3 在 App 组件中渲染 `ReviewTerminal` 组件（当 `showReviewTerminal` 为 true 时），传入 `projectPath` 和 `onClose` 回调
- [x] 5.4 在 `App.css` 中添加评审 terminal 面板的样式（底部面板，类似 EditorPanel）
