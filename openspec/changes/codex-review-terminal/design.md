## Context

OpenSpec Desktop 是一个 macOS 原生应用，左侧是加载 React Web App 的 WebView，右侧是基于 xterm.js 的真实 PTY terminal。当前架构中 `app.py` 的 `AppCoordinator` 管理一个 `TerminalSession` 实例，通过 `NativeBridgeHandler` 处理 Web ↔ Native 消息通信。

现有的 ChangeWizard 组件通过 `__nativeBridge.writeInput()` 和 `__nativeBridge.runCommand()` 向主 terminal 发送命令（如启动 droid）。但主 terminal 是共享的单一 PTY 会话，无法同时运行多个独立的 CLI 工具。

用户需要一个独立的评审 terminal 来运行 Codex CLI，与主 terminal 互不干扰。

## Goals / Non-Goals

**Goals:**
- 在 desktop app 中支持第二个独立的 PTY 会话，专门用于 Codex 评审
- 在 React 前端新增评审 terminal 面板组件，使用 xterm.js 渲染
- 通过 native bridge 扩展消息协议，支持评审 terminal 的输入/输出
- 用户点击 "Review" 按钮即可打开评审 terminal 并启动 codex CLI

**Non-Goals:**
- 不实现通用的多 terminal 管理器（只新增一个评审专用 terminal）
- 不修改现有主 terminal 的行为
- 不支持远程 codex 执行
- 不持久化评审会话

## Decisions

### 1. 在 AppCoordinator 中新增第二个 TerminalSession

**决定**: 在 `AppCoordinator` 中新增 `review_terminal` 属性，类型为 `TerminalSession`，独立于现有的 `terminal`。

**理由**: 现有的 `TerminalSession` 类已经封装了 PTY 管理逻辑，可以直接复用。新增一个实例即可支持独立的评审会话，无需重构。

**替代方案**:
- 多 terminal 管理器（dict 存储多个 session）：过度设计，当前只需要一个额外 terminal
- 在同一 PTY 中用 tmux 分屏：增加复杂度，用户体验差

### 2. 扩展 Native Bridge 消息协议

**决定**: 新增以下消息类型：
- `startReviewTerminal`: 启动评审 PTY 并运行 codex CLI
- `writeReviewInput`: 向评审 terminal 发送输入
- `stopReviewTerminal`: 终止评审 PTY 会话

**理由**: 与现有的 `runCommand`/`writeInput` 消息保持一致的模式，但通过不同的消息类型路由到评审 terminal，避免与主 terminal 混淆。

### 3. 前端使用独立的 ReviewTerminal 组件

**决定**: 新建 `ReviewTerminal.tsx` 组件，内嵌 xterm.js Terminal 实例，作为可切换的底部面板显示。

**理由**: 与 EditorPanel 类似的面板模式，用户熟悉。xterm.js 已在项目依赖中（package.json 中有 xterm 和 @xterm/addon-fit），可以直接在 React 中使用，无需像主 terminal 那样通过单独的 HTML 文件加载。

### 4. 评审 terminal 的生命周期

**决定**: 用户点击 "Review" 按钮时启动评审 PTY，自动 cd 到项目目录并运行 `codex` 命令。关闭面板时终止 PTY。

**理由**: 简单直接，评审是一次性操作，不需要持久化。

## Risks / Trade-offs

- **[Risk] 两个 PTY 同时运行可能增加资源消耗** → 评审 terminal 按需启动，关闭时立即释放 PTY 资源
- **[Risk] xterm.js 在 React 中的集成可能有生命周期问题** → 使用 useEffect 管理 Terminal 实例的创建和销毁，确保正确清理
- **[Trade-off] 评审 terminal 不复用主 terminal 的 WebView** → 接受这个开销，换取架构简洁和独立性
