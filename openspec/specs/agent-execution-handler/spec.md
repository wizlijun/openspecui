# agent-execution-handler Specification

## Purpose
TBD - created by archiving change web-agent-cli-window. Update Purpose after archive.
## Requirements
### Requirement: Spawn agent process on demand
The execution handler SHALL spawn the appropriate CLI process when a command is first sent to an agent that has no running session.

#### Scenario: First command spawns process
- **WHEN** a command is sent to the "droid" agent and no droid process is running
- **THEN** the handler SHALL spawn the droid CLI process and pipe the command as input

#### Scenario: Agent command mapping
- **WHEN** a command is sent to an agent
- **THEN** the handler SHALL use the correct CLI binary: `openspec droid` for droid, `claude` for claudecode, `codex` for codex

### Requirement: Stream process output via WebSocket
The execution handler SHALL stream stdout and stderr from the agent process to the connected WebSocket client in real-time.

#### Scenario: stdout streaming
- **WHEN** the agent process writes to stdout
- **THEN** the handler SHALL forward the data to the WebSocket client as a message with type "stdout" and the agent identifier

#### Scenario: stderr streaming
- **WHEN** the agent process writes to stderr
- **THEN** the handler SHALL forward the data to the WebSocket client as a message with type "stderr" and the agent identifier

### Requirement: Receive commands via WebSocket
The execution handler SHALL accept command messages from the WebSocket client and write them to the agent process's stdin.

#### Scenario: Command received and piped
- **WHEN** a WebSocket message with type "command" is received
- **THEN** the handler SHALL write the command text followed by a newline to the target agent process's stdin

### Requirement: Report command completion
The execution handler SHALL detect when a command finishes and send a completion message to the client.

#### Scenario: Process exit notification
- **WHEN** an agent process exits
- **THEN** the handler SHALL send a message with type "exit", the agent identifier, and the exit code to the WebSocket client

#### Scenario: Command timeout
- **WHEN** a command has been running longer than the configured timeout (default 300 seconds)
- **THEN** the handler SHALL send a "timeout" message and optionally kill the process

### Requirement: Kill agent process
The execution handler SHALL support forcefully terminating a running agent process.

#### Scenario: Kill command received
- **WHEN** a WebSocket message with type "kill" is received for a specific agent
- **THEN** the handler SHALL send SIGTERM to the agent process and report termination to the client

