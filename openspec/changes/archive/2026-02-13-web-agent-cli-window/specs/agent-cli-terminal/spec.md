## ADDED Requirements

### Requirement: Display terminal panel with agent tabs
The UI SHALL provide a bottom panel containing tabs for each agent type (droid, claudecode, codex). Each tab SHALL render an xterm.js terminal instance that displays the agent's CLI output.

#### Scenario: Panel with three agent tabs
- **WHEN** the user opens the agent CLI panel
- **THEN** the panel SHALL display three tabs labeled "Droid", "Claude Code", and "Codex", plus a "Debug" tab

#### Scenario: Switch between agent tabs
- **WHEN** the user clicks on a different agent tab
- **THEN** the terminal SHALL switch to show that agent's output, preserving scrollback history of the previous tab

### Requirement: Render real-time agent output in terminal
The terminal SHALL display agent CLI output in real-time as it is received via WebSocket, including ANSI color codes and formatting.

#### Scenario: Streaming output display
- **WHEN** an agent process produces output
- **THEN** the terminal SHALL render the output immediately with correct ANSI formatting (colors, bold, etc.)

#### Scenario: Scrollback buffer
- **WHEN** agent output exceeds the visible terminal area
- **THEN** the user SHALL be able to scroll up to view previous output

### Requirement: Toggle agent panel visibility
The user SHALL be able to show and hide the agent CLI panel to maximize canvas/editor space.

#### Scenario: Show agent panel
- **WHEN** the user clicks the agent panel toggle button in the header
- **THEN** the agent panel SHALL appear at the bottom of the layout

#### Scenario: Hide agent panel
- **WHEN** the user clicks the toggle button while the panel is visible
- **THEN** the panel SHALL be hidden and the canvas/editor SHALL expand to fill the space

### Requirement: Resize agent panel height
The user SHALL be able to drag the top edge of the agent panel to resize its height.

#### Scenario: Drag to resize
- **WHEN** the user drags the top border of the agent panel
- **THEN** the panel height SHALL adjust accordingly, with a minimum height of 150px and maximum of 70% viewport height
