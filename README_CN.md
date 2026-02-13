# 🔥 OpenSpecUI

> **"编程的未来不是写代码，而是指挥一支 AI 军团替你写。"**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![macOS](https://img.shields.io/badge/platform-macOS-blue.svg)](https://www.apple.com/macos/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![Python 3.14](https://img.shields.io/badge/Python-3.14-3776AB.svg)](https://python.org)

---

## 💀 这到底是什么鬼？

OpenSpecUI 是一个 **疯狂的** macOS 原生桌面应用，它把 AI 智能体扔进真实的终端会话里，让它们在你的代码库里疯狂输出——而 **你** 握着缰绳。

没有沙盒。没有玩具终端。没有花架子。

真实的 `zsh`。真实的 PTY。真实的 AI 智能体。真实的混沌。

你打一句话，AI 智能体写代码、审代码、修代码，甚至互相争论代码该怎么写。你靠在椅子上，喝着咖啡，一键批准或驳回它们的工作。

**这不是 IDE 插件。这是一个作战指挥中心。**

---

## 🤯 为什么你应该在意？

| 传统开发 | 用 OpenSpecUI |
|---|---|
| 你写代码 | AI 写代码，你审批 |
| 你审 PR | AI 审 PR，你确认 |
| 你修 bug | AI 修 bug，先问你修哪个 |
| 你来回切换上下文 | 多个 AI 智能体在并行标签中工作 |
| 你等待 | 智能体干活的时候你想下一步 |

---

## ⚡ 让你炸裂的功能

### 🤖 双智能体对战
同时运行 **Droid Workers**（建造者）和 **Codex Workers**（审查者）。它们甚至可以互相对话。一个建，一个审。你扮演上帝。

### 💻 真终端，不是玩具
每个智能体都通过 Python 的 `pty` 模块获得一个真实的 `zsh` shell。完整 ANSI 支持。完整 shell 能力。前端用 `xterm.js`。货真价实。

### ✋ 人机协同确认
智能体返回一个清单？一张漂亮的确认卡片弹出来。勾选你想要的。点确认。智能体服从。你是老板。

```
智能体："发现 3 个问题，选择要修复哪些："
  ☐ P0: auth 模块的严重类型错误
  ☐ P1: WebSocket 处理器的内存泄漏
  ☐ P2: Dashboard 缺少错误边界

你：*勾选 P0 和 P1，点确认*

智能体："收到。" *开始修复*
```

### 🔄 实时 Hook 系统
Factory droid hooks 向你的应用发送 HTTP 回调。文件树自动刷新。你永远不用手动刷新。永远。

### 📋 规格驱动的混沌
组织你的疯狂：**Changes → Proposals → Specs → Tasks**。给混沌一个结构。更快交付。

### 🗂️ 多标签混战
开 5 个智能体。每个在自己的标签页。每个有自己的终端。每个干不同的事。随时恢复任何会话。

### 📊 实时作战室
一个实时日志面板展示每个命令、每个响应、每个回调、每个 hook 触发。颜色编码。精确到毫秒。像疯子一样调试。

---

## 🏗️ 架构 — 引擎盖下的猛兽

```
┌──────────────────────────────────────────────────────────┐
│  macOS 原生应用 (Python + PyObjC)                        │
│                                                          │
│  ┌────────────────────┐  ┌────────────────────────────┐  │
│  │  🌐 Web UI (React) │  │  💻 终端 (xterm.js)        │  │
│  │                    │  │                            │  │
│  │  文件树            │  │  zsh ──── Droid 智能体 #1  │  │
│  │  Spec 查看器       │  │  zsh ──── Droid 智能体 #2  │  │
│  │  Worker 控制台     │  │  zsh ──── Codex 智能体 #1  │  │
│  │  确认 UI           │  │  zsh ──── 主 Shell         │  │
│  └────────────────────┘  └────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  📊 实时作战室（消息日志）                          │  │
│  │  → SEND  ← RECV  ⟲ CALLBACK  ⚡ HOOK  ℹ INFO      │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         ↕ HTTP :18888
┌──────────────────────────────────────────────────────────┐
│  🔗 Factory Droid Hooks (SessionEnd / PostToolUse)       │
└──────────────────────────────────────────────────────────┘
```

**技术栈 — 毫不妥协：**
- **前端**：React 19 + TypeScript + Vite 7
- **终端**：xterm.js + node-pty（真 PTY，不是闹着玩的）
- **桌面**：Python 3.14 + PyObjC（Cocoa/WebKit 原生）
- **配置**：YAML 驱动一切
- **通信**：WebSocket + HTTP hooks

---

## 🚀 60 秒启动

```bash
# 克隆这头猛兽
git clone https://github.com/wizlijun/openspecui.git
cd openspecui

# 构建 Web 应用
cd app && npm install && npm run build && cd ..

# 设置桌面应用
cd desktop
python3 -m venv .venv
source .venv/bin/activate
pip install pyobjc-framework-Cocoa pyobjc-framework-WebKit

# 释放
python app.py
```

搞定。你进来了。

- **左侧**：Web UI — 浏览 specs，控制智能体
- **右侧**：终端 — 真实 shell，真实力量
- **底部**：作战室 — 实时看到一切

---

## 🎮 怎么用这玩意

### 1. 打开你的项目
点文件夹图标 → 选你的项目（需要 `openspec/` 目录）→ 文件树加载。

### 2. 召唤 Droid
点 **"+ New Change"** → 选模式 → 智能体在新终端标签中生成 → 告诉它你要造什么。

### 3. 召唤审查者
点 **"+ Code Review"** → Codex 智能体启动 → 链接到 Droid → 它们自动协调。

### 4. 批准或驳回
智能体给你一个清单 → 确认卡片弹出 → 勾选你要的 → 点确认 → 智能体执行。

### 5. 随时恢复
关了标签？没事。点 **Resume** → 选一个会话 → 完整对话历史重新加载。

---

## ⚙️ 配置你的智能体

### Droid Worker — `.openspec/droid_worker_define.yml`
```yaml
modes:
  new_change:
    name: "New Change"
    autoInitPrompt: "你是一台编码机器。问用户要造什么。"
    quickButtons:
      - label: "🚀 创建提案"
        prompt: "/opsx-new {input}"
        requiresInput: true
      - label: "📋 列出 Changes"
        action: "list_changes"
    confirmation:
      enabled: true
      responseTemplate: "已确认：\n{selected_items}"
```

### Codex Worker — `.openspec/codex_worker_define.yml`
```yaml
modes:
  code_review:
    name: "Code Review"
    autoInitPrompt: "你是一个无情的代码审查员。找出每一个缺陷。"
    quickButtons:
      - label: "🔍 开始审查"
        prompt: "审查当前 change"
```

### 确认卡片 — `.openspec/confirmation_card.yml`
```yaml
scenarios:
  - name: "task_selection"
    trigger:
      pattern: "请选择|Please select|Choose"
    buttons:
      - label: "✅ 确认"
        action: "send_selected"
        template: "已确认：\n{selected_items}"
      - label: "🔥 全部执行"
        action: "send_all"
      - label: "❌ 取消"
        action: "cancel"
```

---

## 🛠️ 开发

```bash
# 热重载 Web 应用
cd app && npm run dev

# 桌面应用（另一个终端）
cd desktop && source .venv/bin/activate && python app.py
```

### 项目地图
```
openspecui/
├── app/                    # React 前端
│   └── src/
│       ├── App.tsx                    # 指挥中心
│       ├── DroidWorkerBase.tsx        # Droid 智能体 UI
│       ├── CodexWorkerBase.tsx        # Codex 智能体 UI
│       ├── HumanConfirmationCard.tsx  # 人机协同
│       ├── EmbeddedTerminal.tsx       # xterm.js 封装
│       └── TreeView.tsx               # 文件树
├── desktop/                # macOS 原生外壳
│   ├── app.py              # 2000+ 行纯粹的力量
│   ├── log_panel.html      # 作战室 UI
│   └── confirmation_dialog.html
├── openspec/               # 你的工作区
│   ├── changes/
│   └── specs/
├── README.md
└── README_CN.md
```

---

## 🎭 理念

大多数 AI 编程工具把你当乘客。OpenSpecUI 把你当 **将军**。

你制定战略。AI 智能体执行战术。当它们需要决策时，来找你。当它们完成时，向你汇报。你批准、驳回或重新指挥。

**规格驱动** = 写代码之前先想清楚。  
**AI 驱动** = 让机器干重活。  
**人机协同** = 最终决定权永远在你手里。

这不是要取代开发者。这是要给开发者 **超能力**。

---

## 📜 许可证

MIT — 想怎么用就怎么用。

---

## 🤝 贡献

这个项目是实验性的、不断进化的、还有点疯狂。非常适合喜欢在刀尖上跳舞的贡献者。欢迎 PR 和 issue。

---

**别再像 2015 年那样写代码了。指挥你的 AI 军团。以思维的速度交付。** 🔥🔥🔥
