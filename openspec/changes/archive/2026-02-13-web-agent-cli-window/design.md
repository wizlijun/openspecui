## Context

The OpenSpec UI is a React + TypeScript + Vite web application that provides a visual interface for browsing and editing OpenSpec artifacts. It uses the File System Access API to load local directories, displaying specs and changes in a tree view and draggable canvas, with an editor panel at the bottom for markdown editing.

The current UI has no capability to interact with AI agents. Users must switch to separate terminal windows to run droid, claudecode, or codex commands. This context-switching breaks flow and makes it hard to correlate agent output with the artifacts being viewed.

The app structure is flat: `App.tsx` orchestrates layout with `TreeView`, `Canvas`, and `EditorPanel` components. State is managed via `useState` hooks in App. Styling is in a single `App.css`.

## Goals / Non-Goals

**Goals:**
- Provide a web-based CLI terminal panel for each agent type (droid, claudecode, codex) within the existing UI
- Create a debug command window where users can type text commands that get routed to the selected agent's CLI terminal for execution
- Stream agent output in real-time until command completion, then surface the result back to the debug window
- Support multiple agent sessions (one per agent type) running concurrently
- Integrate naturally into the existing panel-based layout

**Non-Goals:**
- Building a full terminal emulator (no shell access, only agent-specific commands)
- Supporting arbitrary CLI tools beyond the three specified agents
- Authentication or multi-user support
- Persisting agent sessions across page reloads
- Remote agent execution — agents run on the local machine via a local backend

## Decisions

### 1. Local WebSocket backend for agent process management

**Decision**: Use a lightweight local Node.js WebSocket server to spawn and manage agent processes (child_process).

**Rationale**: The browser cannot spawn local processes directly. The File System Access API handles file I/O, but process execution requires a backend. WebSocket provides bidirectional real-time streaming, which is essential for CLI output. SSE was considered but is unidirectional (server→client only), making it unsuitable for sending commands to running processes.

**Alternatives considered**:
- HTTP polling: Too slow, poor UX for real-time output
- SSE + POST: Workable but more complex than a single WebSocket connection
- Browser terminal via WASM: Too complex, agents need native OS access

### 2. xterm.js for terminal rendering

**Decision**: Use xterm.js to render agent CLI output in the browser.

**Rationale**: xterm.js is the de facto standard for web-based terminal emulation. It handles ANSI escape codes, colors, scrollback, and performance well. It integrates easily with React via a wrapper component. The agents (especially claudecode and codex) produce colored/formatted output that plain `<pre>` tags would mangle.

**Alternatives considered**:
- Custom `<pre>` + ANSI parser: More work, worse rendering quality
- react-terminal: Less mature, fewer features than xterm.js

### 3. Tab-based agent panel at the bottom

**Decision**: Add a new bottom panel (similar to the existing EditorPanel) with tabs for each agent (droid, claudecode, codex) and a "Debug" tab.

**Rationale**: The existing UI already has a bottom panel pattern (EditorPanel). Adding a tabbed agent panel follows the same layout convention. Users can switch between agents and the debug window via tabs. The panel can coexist with or replace the editor panel depending on what's selected.

**Alternatives considered**:
- Side panel: Would compete with the sidebar/tree view for horizontal space
- Floating windows: More complex drag/resize logic, inconsistent with current design
- Full-screen overlay: Blocks the canvas view

### 4. Debug window as command composer + result viewer

**Decision**: The debug window is a text input area where users type commands. On submit, the command is routed to the currently selected agent tab's CLI session. The debug window shows a log of sent commands and their completion results.

**Rationale**: This keeps the debug window focused on command injection and result monitoring, while the agent terminal tabs show the full real-time output stream. Separating concerns avoids cluttering the terminal with debug metadata.

### 5. Agent command mapping

**Decision**: Each agent type maps to a specific CLI command:
- `droid` → `openspec droid` (or configured command)
- `claudecode` → `claude` CLI
- `codex` → `codex` CLI

Commands entered in the debug window are piped as stdin to the running agent process. If no session exists, one is spawned on first command.

## Risks / Trade-offs

- **[Risk] WebSocket backend adds deployment complexity** → Mitigation: Keep it as a simple `vite` plugin or standalone script that starts alongside `vite dev`. Document the setup clearly.
- **[Risk] Agent processes may hang or produce unbounded output** → Mitigation: Add timeout configuration per command, output buffer limits, and a "kill process" button per agent tab.
- **[Risk] xterm.js bundle size (~400KB)** → Mitigation: Lazy-load the terminal component only when the agent panel is opened. Tree-shake unused addons.
- **[Risk] Cross-platform process spawning differences** → Mitigation: Use `cross-spawn` or Node's built-in `child_process` with shell option. Test on macOS (primary target per user system).
- **[Trade-off] Local-only architecture** → Acceptable for the current use case. Remote execution can be added later via the same WebSocket protocol.

## Open Questions

- Should the WebSocket server be embedded as a Vite plugin or run as a separate process?
- What is the exact CLI invocation for each agent? Are there specific flags or environment variables needed?
- Should agent sessions persist (long-running REPL) or be one-shot per command?
