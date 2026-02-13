## 1. Setup & Dependencies

- [x] 1.1 Install xterm.js and @xterm/addon-fit as frontend dependencies
- [x] 1.2 Install ws (WebSocket library) as a dev dependency for the local backend server
- [x] 1.3 Create backend server directory structure (`app/server/`)

## 2. WebSocket Backend Server

- [x] 2.1 Create WebSocket server entry point (`app/server/index.ts`) that listens on a configurable port
- [x] 2.2 Implement agent process spawner: map agent types (droid, claudecode, codex) to their CLI commands and spawn child processes
- [x] 2.3 Implement stdin piping: receive "command" messages from WebSocket and write to agent process stdin
- [x] 2.4 Implement stdout/stderr streaming: forward agent process output to WebSocket client with agent identifier and stream type
- [x] 2.5 Implement process exit detection: send "exit" message with exit code when agent process terminates
- [x] 2.6 Implement kill handler: receive "kill" messages and send SIGTERM to the target agent process
- [x] 2.7 Implement command timeout: kill process and notify client if command exceeds configurable timeout (default 300s)

## 3. Agent Session Manager (Frontend)

- [x] 3.1 Create `useAgentSession` hook with WebSocket connection lifecycle (connect, reconnect with exponential backoff, disconnect)
- [x] 3.2 Implement per-agent session state tracking (idle, starting, connected, running, exited, error)
- [x] 3.3 Implement per-agent output buffer with 1MB size limit and oldest-data trimming
- [x] 3.4 Implement cleanup on panel close and page unload (kill processes, close WebSocket)
- [x] 3.5 Expose connection status (connected, reconnecting, disconnected) for UI indicator

## 4. Agent CLI Terminal Component

- [x] 4.1 Create `AgentTerminal` React component wrapping xterm.js with fit addon
- [x] 4.2 Implement tab bar with "Droid", "Claude Code", "Codex", and "Debug" tabs
- [x] 4.3 Wire terminal instances to session manager output buffers — render real-time output with ANSI formatting
- [x] 4.4 Preserve scrollback history when switching between agent tabs
- [x] 4.5 Implement panel toggle button in the app header to show/hide the agent panel
- [x] 4.6 Implement drag-to-resize on the panel top edge (min 150px, max 70% viewport)

## 5. Debug Command Window

- [x] 5.1 Create `DebugPanel` component with text input area and "Run" button
- [x] 5.2 Implement command submission via Enter key and Run button, routing to the active agent tab
- [x] 5.3 Implement command history log showing command text, target agent, and status (running/completed/failed)
- [x] 5.4 Implement execution-in-progress indicator (spinner) and completion status with exit code
- [x] 5.5 Display truncated output summary (last N lines) in the debug log on command completion
- [x] 5.6 Auto-scroll the corresponding agent terminal to bottom when a command is submitted

## 6. App Integration

- [x] 6.1 Add agent panel state management to `App.tsx` (visible/hidden, active tab)
- [x] 6.2 Integrate `AgentTerminal` and `DebugPanel` into the app layout below the canvas
- [x] 6.3 Add connection status indicator to the header (green/yellow/red dot)
- [x] 6.4 Add CSS styles for agent panel, tabs, debug window, and resize handle to `App.css`
- [x] 6.5 Ensure agent panel coexists with EditorPanel (stack or toggle between them)

## 7. Dev Tooling & Documentation

- [x] 7.1 Add npm script to start the WebSocket backend server alongside Vite dev server
- [x] 7.2 Configure Vite proxy or document the WebSocket URL configuration
