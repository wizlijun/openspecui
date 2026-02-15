## ADDED Requirements

### Requirement: 用户可以打开评审 Terminal
系统 SHALL 在 header 中提供 "Review" 按钮（仅在 native app 模式下显示），点击后打开评审 terminal 面板。

#### Scenario: 点击 Review 按钮打开评审 terminal
- **WHEN** 用户在 native app 模式下点击 header 中的 "Review" 按钮
- **THEN** 系统在底部显示评审 terminal 面板，启动独立的 PTY 会话

#### Scenario: 非 native app 模式不显示 Review 按钮
- **WHEN** 应用在浏览器模式下运行（非 native app）
- **THEN** header 中不显示 "Review" 按钮

### Requirement: 评审 Terminal 启动 Codex CLI
系统 SHALL 在评审 terminal 的 PTY 会话启动时，自动 cd 到当前项目目录并执行 `codex` 命令。

#### Scenario: 自动启动 codex
- **WHEN** 评审 terminal 面板打开且项目目录已加载
- **THEN** 系统在评审 PTY 中执行 `cd <项目路径> && codex` 命令

#### Scenario: 无项目目录时直接启动 codex
- **WHEN** 评审 terminal 面板打开但没有加载项目目录
- **THEN** 系统在评审 PTY 中直接执行 `codex` 命令

### Requirement: 评审 Terminal 独立于主 Terminal
评审 terminal SHALL 使用独立的 PTY 会话，与主 terminal 互不干扰。

#### Scenario: 评审 terminal 不影响主 terminal
- **WHEN** 用户在评审 terminal 中输入命令
- **THEN** 主 terminal 不受影响，继续正常运行

#### Scenario: 主 terminal 不影响评审 terminal
- **WHEN** 用户在主 terminal 中输入命令
- **THEN** 评审 terminal 不受影响，继续正常运行

### Requirement: 评审 Terminal 支持交互式输入输出
评审 terminal SHALL 使用 xterm.js 渲染，支持完整的终端交互（输入、输出、ANSI 颜色等）。

#### Scenario: 显示 codex 输出
- **WHEN** codex CLI 产生输出（包括 ANSI 颜色和格式）
- **THEN** 评审 terminal 正确渲染所有输出内容

#### Scenario: 用户输入传递到 codex
- **WHEN** 用户在评审 terminal 中键入文本
- **THEN** 输入被发送到评审 PTY 的 codex 进程

### Requirement: 关闭评审 Terminal 终止 PTY
系统 SHALL 在用户关闭评审 terminal 面板时终止对应的 PTY 会话并释放资源。

#### Scenario: 关闭面板终止会话
- **WHEN** 用户点击评审 terminal 面板的关闭按钮
- **THEN** 系统终止评审 PTY 会话，释放进程资源，面板从 UI 中移除

#### Scenario: 重新打开创建新会话
- **WHEN** 用户关闭评审 terminal 后再次点击 "Review" 按钮
- **THEN** 系统创建一个全新的 PTY 会话并重新启动 codex
