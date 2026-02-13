# debug-command-window Specification

## Purpose
TBD - created by archiving change web-agent-cli-window. Update Purpose after archive.
## Requirements
### Requirement: Command input for agent execution
The debug window SHALL provide a text input area where users can type commands to be sent to the currently selected agent.

#### Scenario: Submit command via Enter key
- **WHEN** the user types a command in the debug input and presses Enter
- **THEN** the command SHALL be sent to the currently active agent's CLI session for execution

#### Scenario: Submit command via button
- **WHEN** the user types a command and clicks the "Run" button
- **THEN** the command SHALL be sent to the currently active agent's CLI session for execution

### Requirement: Command targets active agent
The debug window SHALL route commands to whichever agent tab is currently selected.

#### Scenario: Route to selected agent
- **WHEN** the user has the "Droid" tab selected and submits a command in the debug window
- **THEN** the command SHALL be executed in the droid agent's CLI session

#### Scenario: Switch agent then send command
- **WHEN** the user switches from "Droid" to "Codex" tab and submits a command
- **THEN** the command SHALL be executed in the codex agent's CLI session

### Requirement: Display command history and results
The debug window SHALL maintain a log of submitted commands and their completion status/results.

#### Scenario: Command logged on submit
- **WHEN** a command is submitted
- **THEN** the debug log SHALL show the command text, target agent, and a "running" status indicator

#### Scenario: Command completion displayed
- **WHEN** an agent command finishes execution
- **THEN** the debug log SHALL update the command entry with a "completed" or "failed" status and the exit code

### Requirement: Wait for command completion
After submitting a command, the debug window SHALL indicate that execution is in progress and SHALL display the final result when the command completes.

#### Scenario: Execution in progress indicator
- **WHEN** a command is running
- **THEN** the debug window SHALL show a spinner or "Executing..." indicator next to the command entry

#### Scenario: Result returned on completion
- **WHEN** the agent command completes
- **THEN** the debug window SHALL display the command's exit status and a summary of the output (last N lines or truncated)

### Requirement: Auto-scroll terminal to latest output
When a command is submitted from the debug window, the corresponding agent terminal tab SHALL auto-scroll to the bottom to show the latest output.

#### Scenario: Auto-scroll on command submit
- **WHEN** a command is submitted from the debug window
- **THEN** the agent terminal SHALL scroll to the bottom to show real-time output

