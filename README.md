# 🔥 Taichi Forge

> **"The future of coding isn't writing code. It's commanding an army of AI agents to do it for you."**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![macOS](https://img.shields.io/badge/platform-macOS-blue.svg)](https://www.apple.com/macos/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![Python 3.14](https://img.shields.io/badge/Python-3.14-3776AB.svg)](https://python.org)

---

## 💀 What the hell is this?

Taichi Forge is a **CRAZY** native macOS desktop app that throws AI agents into real terminal sessions and lets them go absolutely wild on your codebase — while YOU hold the leash.

No sandboxes. No toy terminals. No bullshit.

Real `zsh`. Real PTY. Real AI agents. Real chaos.

You type a sentence. AI agents write the code, review the code, fix the code, and argue with each other about the code. You sit back, sip your coffee, and approve or reject their work with a single click.

**This is not an IDE plugin. This is a command center.**

---

## 🤯 Why Should You Care?

| Traditional Dev | With Taichi Forge |
|---|---|
| You write code | AI writes code, you approve |
| You review PRs | AI reviews PRs, you confirm |
| You fix bugs | AI fixes bugs, asks you which ones first |
| You context-switch | Multiple AI agents work in parallel tabs |
| You wait | Agents work while you think about what's next |

---

## ⚡ Features That'll Blow Your Mind

### 🤖 Dual-Agent Warfare
Run **Droid Workers** (builders) and **Codex Workers** (reviewers) simultaneously. They can even talk to each other. One builds, the other reviews. You play god.

### 💻 Real Terminal, Not a Toy
Every agent gets a real `zsh` shell through Python's `pty` module. Full ANSI support. Full shell power. `xterm.js` on the frontend. It's the real deal.

### ✋ Human-in-the-Loop Confirmations
Agent returns a checklist? A beautiful confirmation card pops up. Check what you want. Hit confirm. The agent obeys. You're the boss.

Fix actions from the confirmation card are sent through the Fix button path (fill textarea → trigger Fix button → wrap with promptTemplate → send via Send button), identical to the Self-Review Cycle flow, ensuring long text is correctly delivered to the Droid CLI.

```
Agent: "Found 3 issues. Pick which to fix:"
  ☐ P0: Critical type error in auth module
  ☐ P1: Memory leak in WebSocket handler  
  ☐ P2: Missing error boundary in Dashboard

You: *checks P0 and P1, hits Confirm*

Agent: "On it." *starts fixing*
```

### 🔄 Live Hook System
Factory droid hooks fire HTTP callbacks to your app. File tree refreshes automatically. You never hit refresh. Ever.

### 📋 Spec-Driven Chaos
Organize your madness: **Changes → Proposals → Specs → Tasks**. Structure the chaos. Ship faster.

### 🗂️ Multi-Tab Mayhem
Open 5 agents. Each in their own tab. Each with their own terminal. Each doing different things. Resume any session from where you left off.

### 📊 Real-Time War Room
A live log panel shows every command, every response, every callback, every hook trigger. Color-coded. Timestamped to the millisecond. Debug like a maniac.

---

## 🏗️ Architecture — The Beast Under the Hood

```
┌──────────────────────────────────────────────────────────┐
│  macOS Native App (Python + PyObjC)                      │
│                                                          │
│  ┌────────────────────┐  ┌────────────────────────────┐  │
│  │  🌐 Web UI (React) │  │  💻 Terminals (xterm.js)   │  │
│  │                    │  │                            │  │
│  │  File Tree         │  │  zsh ──── Droid Agent #1   │  │
│  │  Spec Viewer       │  │  zsh ──── Droid Agent #2   │  │
│  │  Worker Controls   │  │  zsh ──── Codex Agent #1   │  │
│  │  Confirmation UI   │  │  zsh ──── Main Shell       │  │
│  └────────────────────┘  └────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  📊 Live War Room (Message Log)                    │  │
│  │  → SEND  ← RECV  ⟲ CALLBACK  ⚡ HOOK  ℹ INFO      │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         ↕ HTTP :18888
┌──────────────────────────────────────────────────────────┐
│  🔗 Factory Droid Hooks (SessionEnd / PostToolUse)       │
└──────────────────────────────────────────────────────────┘
```

**Tech Stack — No compromises:**
- **Frontend**: React 19 + TypeScript + Vite 7
- **Terminal**: xterm.js + node-pty (real PTY, not a joke)
- **Desktop**: Python 3.14 + PyObjC (Cocoa/WebKit native)
- **Config**: YAML-driven everything
- **Comms**: WebSocket + HTTP hooks

---

## 🚀 Get Started in 60 Seconds

```bash
# Clone the beast
git clone https://github.com/wizlijun/openspecui.git
cd openspecui

# Build the web app
cd app && npm install && npm run build && cd ..

# Set up the desktop app
cd desktop
python3 -m venv .venv
source .venv/bin/activate
pip install pyobjc-framework-Cocoa pyobjc-framework-WebKit

# UNLEASH
python app.py
```

Boom. You're in.

- **Left**: Web UI — browse specs, control agents
- **Right**: Terminal — real shell, real power
- **Bottom**: War room — see everything happening in real-time

---

## 🎮 How to Use This Thing

### 1. Open Your Project
Click the folder icon → pick your project (needs an `openspec/` directory) → file tree loads.

### 2. Summon a Droid
Click **"+ New Change"** → pick a mode → agent spawns in a new terminal tab → tell it what to build.

### 3. Summon a Reviewer
Click **"+ Code Review"** → Codex agent launches → link it to a Droid → they coordinate automatically.

### 4. Approve or Reject
Agent shows you a checklist → confirmation card pops up → check what you want → hit Confirm → agent executes.

### 5. Resume Anytime
Closed a tab? No problem. Hit **Resume** → pick a session → full conversation history reloads.

---

## ⚙️ Configure Your Agents

### Droid Worker — `.openspec/droid_worker_define.yml`
```yaml
modes:
  new_change:
    name: "New Change"
    autoInitPrompt: "You are a coding machine. Ask what to build."
    quickButtons:
      - label: "🚀 Create Proposal"
        prompt: "/opsx-new {input}"
        requiresInput: true
      - label: "📋 List Changes"
        action: "list_changes"
    confirmation:
      enabled: true
      responseTemplate: "Confirmed:\n{selected_items}"
```

### Codex Worker — `.openspec/codex_worker_define.yml`
```yaml
modes:
  code_review:
    name: "Code Review"
    autoInitPrompt: "You are a ruthless code reviewer. Find every flaw."
    quickButtons:
      - label: "🔍 Start Review"
        prompt: "Review the current change"
```

### Confirmation Cards — `.openspec/confirmation_card.yml`
```yaml
scenarios:
  - name: "task_selection"
    trigger:
      pattern: "请选择|Please select|Choose"
    buttons:
      - label: "✅ Confirm"
        action: "send_selected"
        template: "Confirmed:\n{selected_items}"
      - label: "🔥 Do Everything"
        action: "send_all"
      - label: "❌ Cancel"
        action: "cancel"
```

---

## 🛠️ Development

```bash
# Hot-reload web app
cd app && npm run dev

# Desktop app (separate terminal)
cd desktop && source .venv/bin/activate && python app.py
```

### Project Map
```
openspecui/
├── app/                    # React frontend
│   └── src/
│       ├── App.tsx                    # Command center
│       ├── DroidWorkerBase.tsx        # Droid agent UI
│       ├── CodexWorkerBase.tsx        # Codex agent UI
│       ├── HumanConfirmationCard.tsx  # Human-in-the-loop
│       ├── EmbeddedTerminal.tsx       # xterm.js wrapper
│       └── TreeView.tsx               # File tree
├── desktop/                # macOS native shell
│   ├── app.py              # 2000+ lines of pure power
│   ├── log_panel.html      # War room UI
│   └── confirmation_dialog.html
├── openspec/               # Your workspace
│   ├── changes/
│   └── specs/
├── README.md
└── README_CN.md
```

---

## 🎭 The Philosophy

Most AI coding tools treat you like a passenger. Taichi Forge treats you like a **general**.

You define the strategy. AI agents execute the tactics. When they need a decision, they come to you. When they're done, they report back. You approve, reject, or redirect.

**Spec-driven** = think before you code.  
**AI-powered** = let machines do the heavy lifting.  
**Human-in-the-loop** = you always have the final say.

This isn't about replacing developers. This is about giving developers **superpowers**.

---

## 📜 License

MIT — do whatever you want with it.

---

## 🤝 Contributing

This project is experimental, evolving, and a little bit insane. Perfect for contributors who like living on the edge. PRs and issues welcome.

---

**Stop writing code like it's 2015. Command your AI army. Ship at the speed of thought.** 🔥🔥🔥
