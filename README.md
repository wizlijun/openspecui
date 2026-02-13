# 🚀 OpenSpecUI

**A wild, spec-driven development environment that brings AI agents to life in your terminal.**

OpenSpecUI is a native macOS desktop application that fuses web-based UI with real terminal power, creating an interactive playground for AI-driven software development. Built for developers who want to harness the raw energy of AI agents while maintaining full control over their workflow.

---

## ⚡ What Makes This Wild

- **Dual-Agent Architecture**: Run both Droid Workers (task execution) and Codex Workers (code review) simultaneously, each in their own isolated terminal sessions
- **Real PTY Integration**: Not a fake terminal—actual `zsh` processes with full shell capabilities, managed through Python's `pty` module
- **Human-in-the-Loop Confirmations**: AI agents can pause and ask for your approval with interactive checkbox cards before proceeding
- **Live Hook System**: Factory droid hooks automatically refresh your file tree when agents create or modify files—no manual refresh needed
- **Spec-Driven Workflow**: Organize your work into changes, proposals, specs, and tasks following the OpenSpec methodology
- **Multi-Tab Sessions**: Open multiple agent sessions, resume previous conversations, and switch between contexts seamlessly
- **Real-Time Log Panel**: Watch every command, callback, and hook trigger in a live message log—perfect for debugging agent behavior

---

## 🎯 Core Features

### 🤖 Droid Workers
AI agents that execute tasks in your project:
- **New Change**: Start a new feature or fix from scratch
- **Continue Change**: Resume work on an existing change
- **Fix Review**: Address review feedback and iterate

### 🔍 Codex Workers
AI agents specialized in code review:
- **Standalone Review**: Independent code analysis
- **Code Review**: Integrated review workflow with bidirectional communication to Droid Workers

### 🎨 Interactive UI
- **File Tree Browser**: Navigate your OpenSpec changes, specs, and artifacts
- **Canvas Viewer**: Render Markdown specs with syntax highlighting
- **Embedded Terminals**: Full xterm.js terminals with real shell access
- **Confirmation Cards**: Dynamic UI for agent-human interaction with checkbox lists

### 🔧 Developer Experience
- **Config-Driven**: YAML-based worker definitions with custom prompts, quick buttons, and confirmation templates
- **Session Persistence**: Resume interrupted agent sessions exactly where you left off
- **Input History**: Navigate through your command history with arrow keys
- **Auto-Scroll Logs**: Real-time message logging with filtering and search

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  macOS Desktop App (Python + PyObjC)                        │
│  ┌─────────────────────┐  ┌──────────────────────────────┐ │
│  │  Web App (React)    │  │  Terminal (xterm.js + PTY)   │ │
│  │  - File Tree        │  │  - Real zsh shells           │ │
│  │  - Canvas Viewer    │  │  - Multiple channels         │ │
│  │  │  - Droid Workers │  │  │  - main, review, droid,  │ │
│  │  │  - Codex Workers │  │  │    codex (per tab)       │ │
│  │  - Confirmation UI  │  │  - WebSocket bridge          │ │
│  └─────────────────────┘  └──────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Message Log Panel                                   │  │
│  │  → SEND  ← RECV  ⟲ CALLBACK  ⚡ HOOK  ℹ INFO        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ↕ HTTP Server (port 18888)
┌─────────────────────────────────────────────────────────────┐
│  Factory Droid Hooks                                        │
│  - SessionEnd → curl POST /api/hook-notify                  │
│  - PostToolUse → curl POST /api/hook-notify                 │
└─────────────────────────────────────────────────────────────┘
```

**Tech Stack:**
- **Frontend**: React 19 + TypeScript + Vite
- **Terminal**: xterm.js + node-pty
- **Desktop**: Python 3.14 + PyObjC (Cocoa/WebKit)
- **Config**: YAML (js-yaml)
- **Communication**: WebSocket + HTTP

---

## 🚀 Quick Start

### Prerequisites
- macOS (tested on macOS 15.2+)
- Python 3.14+
- Node.js 18+
- Factory CLI with droid support

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/wizlijun/openspecui.git
   cd openspecui
   ```

2. **Set up the web app**
   ```bash
   cd app
   npm install
   npm run build
   ```

3. **Set up the desktop app**
   ```bash
   cd ../desktop
   python3 -m venv .venv
   source .venv/bin/activate
   pip install pyobjc-framework-Cocoa pyobjc-framework-WebKit
   ```

4. **Launch**
   ```bash
   python app.py
   ```

The app will open with:
- Left panel: Web UI for browsing specs and managing agents
- Right panel: Terminal with your shell
- Bottom panel: Live message log

---

## 📖 Usage

### Opening a Project
1. Click the folder icon in the top-left
2. Select your project directory (must contain `.openspec/` folder)
3. The file tree will populate with your changes and specs

### Starting a Droid Worker
1. Click the **"+ New Change"** button
2. Choose a mode (New Change, Continue Change, Fix Review)
3. The agent launches in a dedicated terminal tab
4. Type your request and press Enter

### Starting a Codex Worker
1. Click the **"+ Code Review"** button
2. Choose a mode (Standalone, Code Review)
3. The review agent launches in a separate terminal
4. Optionally link it to a Droid Worker for bidirectional communication

### Human Confirmation Flow
When an agent returns a message with checkboxes:
```markdown
Please select tasks to execute:
- [ ] Fix type errors
- [ ] Update documentation
- [ ] Add unit tests
```

A confirmation card automatically appears. Check the items you want, click **Confirm**, and the agent receives your selection.

### Resuming Sessions
- Click the **"Resume"** button on any worker tab
- Select a previous session from the dropdown
- The agent reloads the full conversation history

---

## ⚙️ Configuration

### Worker Definitions

Create `.openspec/droid_worker_define.yml`:
```yaml
modes:
  new_change:
    name: "New Change"
    autoInitPrompt: "You are helping create a new change. Ask the user what they want to build."
    quickButtons:
      - label: "Create Proposal"
        prompt: "/opsx-new {input}"
        requiresInput: true
      - label: "List Changes"
        action: "list_changes"
    confirmation:
      enabled: true
      responseTemplate: "Confirmed:\n{selected_items}"
```

Create `.openspec/codex_worker_define.yml`:
```yaml
modes:
  code_review:
    name: "Code Review"
    autoInitPrompt: "You are a code reviewer. Analyze the code and provide feedback."
    quickButtons:
      - label: "Start Review"
        prompt: "Review the current change"
```

### Confirmation Card Scenarios

Create `.openspec/confirmation_card.yml`:
```yaml
scenarios:
  - name: "task_selection"
    trigger:
      pattern: "请选择|Please select|Choose"
    buttons:
      - label: "确认选择"
        action: "send_selected"
        template: "已确认：\n{selected_items}"
      - label: "全部执行"
        action: "send_all"
        template: "执行全部任务"
      - label: "取消"
        action: "cancel"
```

---

## 🔥 Advanced Features

### Factory Hooks Integration
The app automatically listens for Factory droid hooks on `http://127.0.0.1:18888`. Configure in `.factory/settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "curl -X POST http://127.0.0.1:18888/api/hook-notify -H 'Content-Type: application/json' -d '{\"event\":\"PostToolUse\"}' 2>/dev/null || true"
      }]
    }]
  }
}
```

### Message Log Panel
- **Auto-scroll**: Toggle to follow new messages
- **Clear**: Wipe the log (keeps 2000 entries max)
- **Filters**: Color-coded by message type (SEND, RECV, CALLBACK, HOOK)

### Bidirectional Worker Communication
Link a Codex Worker to a Droid Worker:
1. Start a Droid Worker
2. Start a Codex Worker in "Code Review" mode
3. The Codex Worker can send commands to the Droid Worker's terminal
4. Both agents can coordinate on the same change

---

## 🛠️ Development

### Running in Dev Mode
```bash
# Terminal 1: Web app with hot reload
cd app
npm run dev

# Terminal 2: Desktop app
cd desktop
source .venv/bin/activate
python app.py
```

### Project Structure
```
openspecui/
├── app/                    # React web app
│   ├── src/
│   │   ├── App.tsx         # Main app component
│   │   ├── DroidWorkerBase.tsx
│   │   ├── CodexWorkerBase.tsx
│   │   ├── HumanConfirmationCard.tsx
│   │   ├── EmbeddedTerminal.tsx
│   │   └── TreeView.tsx
│   └── package.json
├── desktop/                # macOS native app
│   ├── app.py              # Main Python app
│   ├── log_panel.html      # Message log UI
│   └── confirmation_dialog.html
├── openspec/               # OpenSpec workspace
│   ├── changes/            # Active changes
│   ├── specs/              # Main specs
│   └── config.yaml
└── README.md
```

---

## 🎭 Philosophy

OpenSpecUI embraces the chaos of AI-driven development while giving you the reins. It's not about replacing developers—it's about amplifying your ability to think, design, and build at the speed of thought.

**Spec-driven** means you define the "what" and "why" before diving into code. **AI-powered** means agents handle the grunt work. **Human-in-the-loop** means you stay in control.

This is software development, untamed.

---

## 📜 License

MIT

---

## 🤝 Contributing

Contributions welcome! This project is experimental and evolving rapidly. Open an issue or PR if you want to add features, fix bugs, or improve the docs.

---

## 🙏 Acknowledgments

Built with:
- [Factory AI](https://factory.ai) - AI agent infrastructure
- [xterm.js](https://xtermjs.org) - Terminal emulation
- [React](https://react.dev) - UI framework
- [PyObjC](https://pyobjc.readthedocs.io) - macOS native bindings

---

**Ready to unleash AI agents in your terminal? Clone, build, and let the chaos begin.** 🔥
