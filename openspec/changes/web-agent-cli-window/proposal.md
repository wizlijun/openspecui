## Why

The current OpenSpec UI lacks the ability to interact with AI agents (droid, claudecode, codex) directly from the web interface. Users need a web-based CLI window to execute commands and test agent interactions in real-time, with a debug window that allows immediate command injection and execution monitoring until completion.

## What Changes

- Add web-based CLI terminal interface for multiple agent types (droid, claudecode, codex)
- Create debug/testing window for command input and execution
- Implement agent command execution handler with real-time output streaming
- Add agent session management and state tracking
- Integrate CLI window into existing OpenSpec UI layout

## Capabilities

### New Capabilities
- `agent-cli-terminal`: Web-based terminal interface that displays agent CLI output and accepts user input for droid, claudecode, and codex agents
- `debug-command-window`: Debug interface for injecting test commands into agent CLI sessions with immediate execution and result monitoring
- `agent-execution-handler`: Backend service that manages agent process lifecycle, command routing, and output streaming until completion
- `agent-session-manager`: Session state management for multiple concurrent agent instances with proper cleanup

### Modified Capabilities
<!-- No existing capabilities are being modified -->

## Impact

- **Frontend**: New React components for CLI terminal and debug window in `app/src/`
- **State Management**: Agent session state, command queue, and output buffering
- **Backend/API**: May require WebSocket or SSE for real-time bidirectional communication with agent processes
- **Dependencies**: Terminal emulation library (e.g., xterm.js), WebSocket client
- **UI Layout**: New panel/window system for CLI and debug interfaces alongside existing canvas and editor
