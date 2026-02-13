## ADDED Requirements

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

### Requirement: Cleanup sessions on panel close
The session manager SHALL properly clean up resources when the agent panel is closed or the page is unloaded.

#### Scenario: Panel close cleanup
- **WHEN** the user closes the agent panel
- **THEN** the session manager SHALL send kill commands for all running agent processes and close the WebSocket connection

#### Scenario: Page unload cleanup
- **WHEN** the browser page is about to unload
- **THEN** the session manager SHALL attempt to terminate running agent processes via a beacon or synchronous close
