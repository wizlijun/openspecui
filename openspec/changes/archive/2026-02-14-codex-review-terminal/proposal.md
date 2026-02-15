## Why


当前 OpenSpec UI 的 ChangeWizard 只支持通过 droid 来创建和管理 change。用户希望新增一个独立的"评审"功能，调用 Codex CLI 在一个新的 terminal 中对当前项目或 change 进行代码评审。目前没有办法在 UI 中直接发起 Codex 评审，用户需要手动切换到外部终端执行 codex 命令。

## What Changes

- 新增一个评审 terminal 面板，专门用于运行 Codex CLI 进行代码评审
- 在 UI 中添加"Review"入口按钮，点击后打开独立的评审 terminal
- 评审 terminal 通过 desktop 的 native bridge 启动一个新的 PTY 会话，运行 codex CLI
- 支持用户在评审 terminal 中与 codex 进行交互（输入评审指令、查看评审结果）
- 评审 terminal 与现有的主 terminal 独立运行，互不干扰

## Capabilities

### New Capabilities
- `review-terminal`: 独立的评审 terminal 面板，用于启动和管理 Codex CLI 评审会话，包括 PTY 会话管理、xterm.js 渲染、以及与 desktop native bridge 的通信

### Modified Capabilities
<!-- 无需修改现有 capabilities -->

## Impact

- **Desktop (app.py)**: 需要支持多 PTY 会话管理，新增第二个 TerminalSession 实例用于评审 terminal
- **Frontend (App.tsx)**: 新增 Review 按钮和评审 terminal 面板组件
- **Native Bridge**: 扩展消息协议，支持向评审 terminal 发送输入和接收输出
- **依赖**: 复用现有的 xterm.js 和 PTY 基础设施，无需新增外部依赖
