# agent-session-manager Specification

## Purpose
TBD - created by archiving change web-agent-cli-window. Update Purpose after archive.
## Requirements
### Requirement: Manage per-agent session state
The session manager SHALL maintain state for each agent type including process reference, connection status, and output buffer.

#### Scenario: Initialize session on first use
- **WHEN** a command is first sent to an agent type that has no session
- **THEN** the session manager SHALL create a new session record with status "starting" and transition to "connected" once the process is ready

#### Scenario: Track session status
- **WHEN** an agent session exists
- **THEN** the session manager SHALL expose the current status as one of: "idle", "starting", "connected", "running", "exited", "error"

### Requirement: WebSocket connection lifecycle
The session manager SHALL establish and maintain the WebSocket connection to the local backend server.

#### Scenario: Auto-connect on panel open
- **WHEN** the agent panel is opened for the first time
- **THEN** the session manager SHALL establish a WebSocket connection to the local backend (ws://localhost:<port>)

#### Scenario: Reconnect on disconnect
- **WHEN** the WebSocket connection drops unexpectedly
- **THEN** the session manager SHALL attempt to reconnect with exponential backoff (1s, 2s, 4s, max 30s)

#### Scenario: Connection status indicator
- **WHEN** the WebSocket connection state changes
- **THEN** the UI SHALL display a connection indicator (green=connected, yellow=reconnecting, red=disconnected)

### Requirement: Output buffer per agent
The session manager SHALL maintain an output buffer per agent session for terminal rendering.

#### Scenario: Buffer incoming output
- **WHEN** output data arrives for an agent via WebSocket
- **THEN** the session manager SHALL append it to that agent's output buffer and notify the terminal component

#### Scenario: Buffer size limit
- **WHEN** an agent's output buffer exceeds 1MB
- **THEN** the session manager SHALL trim the oldest data to keep the buffer within limits

### Requirement: Worker 聊天历史条目上限
DroidWorkerBase 和 CodexWorkerBase 的聊天历史 SHALL 限制在 200 条以内，防止长时间运行后 DOM 节点过多导致界面卡顿。

#### Scenario: 超过上限时截断旧消息
- **WHEN** 新消息追加后聊天历史总条数超过 200 条
- **THEN** 系统 SHALL 自动丢弃最旧的消息，仅保留最新的 200 条

### Requirement: HMR 状态持久化防抖
Worker 组件的 HMR 状态持久化（`window.__workerStates`）SHALL 使用 500ms 防抖，避免每次 state 变化都立即序列化完整历史数组。

#### Scenario: 高频状态变化时防抖
- **WHEN** Worker 的 history、waiting、initialized 等状态在 500ms 内多次变化
- **THEN** 系统 SHALL 仅在最后一次变化后 500ms 执行一次 `__workerStates` 写入

### Requirement: Cleanup sessions on panel close
The session manager SHALL properly clean up resources when the agent panel is closed or the page is unloaded.

#### Scenario: Panel close cleanup
- **WHEN** the user closes the agent panel
- **THEN** the session manager SHALL send kill commands for all running agent processes and close the WebSocket connection

#### Scenario: Page unload cleanup
- **WHEN** the browser page is about to unload
- **THEN** the session manager SHALL attempt to terminate running agent processes via a beacon or synchronous close

