# 🚀 OpenSpecUI

**一个狂野的、规格驱动的开发环境，让 AI 智能体在你的终端中活起来。**

OpenSpecUI 是一个原生 macOS 桌面应用，融合了基于 Web 的 UI 和真实的终端能力，为 AI 驱动的软件开发创造了一个交互式游乐场。专为想要驾驭 AI 智能体原始能量，同时保持对工作流程完全控制的开发者而构建。

---

## ⚡ 狂野之处

- **双智能体架构**：同时运行 Droid Workers（任务执行）和 Codex Workers（代码审查），每个都在独立的终端会话中
- **真实 PTY 集成**：不是假终端——通过 Python 的 `pty` 模块管理的真实 `zsh` 进程，具备完整的 shell 能力
- **人机协同确认**：AI 智能体可以暂停并通过交互式复选框卡片请求你的批准后再继续
- **实时 Hook 系统**：Factory droid hooks 在智能体创建或修改文件时自动刷新文件树——无需手动刷新
- **规格驱动工作流**：按照 OpenSpec 方法论将工作组织为 changes、proposals、specs 和 tasks
- **多标签会话**：打开多个智能体会话，恢复之前的对话，在上下文之间无缝切换
- **实时日志面板**：在实时消息日志中观察每个命令、回调和 hook 触发——完美的智能体行为调试工具

---

## 🎯 核心功能

### 🤖 Droid Workers
在你的项目中执行任务的 AI 智能体：
- **New Change**：从头开始一个新功能或修复
- **Continue Change**：继续现有 change 的工作
- **Fix Review**：处理审查反馈并迭代

### 🔍 Codex Workers
专门从事代码审查的 AI 智能体：
- **Standalone Review**：独立的代码分析
- **Code Review**：与 Droid Workers 双向通信的集成审查工作流

### 🎨 交互式 UI
- **文件树浏览器**：浏览你的 OpenSpec changes、specs 和 artifacts
- **Canvas 查看器**：渲染带语法高亮的 Markdown specs
- **嵌入式终端**：具有真实 shell 访问权限的完整 xterm.js 终端
- **确认卡片**：用于智能体-人类交互的动态 UI，带复选框列表

### 🔧 开发者体验
- **配置驱动**：基于 YAML 的 worker 定义，支持自定义提示词、快捷按钮和确认模板
- **会话持久化**：在中断的地方精确恢复智能体会话
- **输入历史**：使用方向键浏览命令历史
- **自动滚动日志**：实时消息记录，支持过滤和搜索

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────┐
│  macOS 桌面应用 (Python + PyObjC)                           │
│  ┌─────────────────────┐  ┌──────────────────────────────┐ │
│  │  Web 应用 (React)   │  │  终端 (xterm.js + PTY)       │ │
│  │  - 文件树           │  │  - 真实 zsh shells           │ │
│  │  - Canvas 查看器    │  │  - 多通道                    │ │
│  │  │  - Droid Workers │  │  │  - main, review, droid,  │ │
│  │  │  - Codex Workers │  │  │    codex (每个标签)      │ │
│  │  - 确认 UI          │  │  - WebSocket 桥接            │ │
│  └─────────────────────┘  └──────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  消息日志面板                                        │  │
│  │  → SEND  ← RECV  ⟲ CALLBACK  ⚡ HOOK  ℹ INFO        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ↕ HTTP 服务器 (端口 18888)
┌─────────────────────────────────────────────────────────────┐
│  Factory Droid Hooks                                        │
│  - SessionEnd → curl POST /api/hook-notify                  │
│  - PostToolUse → curl POST /api/hook-notify                 │
└─────────────────────────────────────────────────────────────┘
```

**技术栈：**
- **前端**：React 19 + TypeScript + Vite
- **终端**：xterm.js + node-pty
- **桌面**：Python 3.14 + PyObjC (Cocoa/WebKit)
- **配置**：YAML (js-yaml)
- **通信**：WebSocket + HTTP

---

## 🚀 快速开始

### 前置要求
- macOS（在 macOS 15.2+ 上测试）
- Python 3.14+
- Node.js 18+
- 支持 droid 的 Factory CLI

### 安装

1. **克隆仓库**
   ```bash
   git clone https://github.com/wizlijun/openspecui.git
   cd openspecui
   ```

2. **设置 Web 应用**
   ```bash
   cd app
   npm install
   npm run build
   ```

3. **设置桌面应用**
   ```bash
   cd ../desktop
   python3 -m venv .venv
   source .venv/bin/activate
   pip install pyobjc-framework-Cocoa pyobjc-framework-WebKit
   ```

4. **启动**
   ```bash
   python app.py
   ```

应用将打开：
- 左侧面板：用于浏览 specs 和管理智能体的 Web UI
- 右侧面板：带有你的 shell 的终端
- 底部面板：实时消息日志

---

## 📖 使用方法

### 打开项目
1. 点击左上角的文件夹图标
2. 选择你的项目目录（必须包含 `.openspec/` 文件夹）
3. 文件树将填充你的 changes 和 specs

### 启动 Droid Worker
1. 点击 **"+ New Change"** 按钮
2. 选择模式（New Change、Continue Change、Fix Review）
3. 智能体在专用终端标签中启动
4. 输入你的请求并按 Enter

### 启动 Codex Worker
1. 点击 **"+ Code Review"** 按钮
2. 选择模式（Standalone、Code Review）
3. 审查智能体在单独的终端中启动
4. 可选地将其链接到 Droid Worker 以进行双向通信

### 人工确认流程
当智能体返回带有复选框的消息时：
```markdown
请选择要执行的任务：
- [ ] 修复类型错误
- [ ] 更新文档
- [ ] 添加单元测试
```

确认卡片会自动出现。勾选你想要的项目，点击 **确认**，智能体就会收到你的选择。

### 恢复会话
- 点击任何 worker 标签上的 **"Resume"** 按钮
- 从下拉列表中选择之前的会话
- 智能体重新加载完整的对话历史

---

## ⚙️ 配置

### Worker 定义

创建 `.openspec/droid_worker_define.yml`：
```yaml
modes:
  new_change:
    name: "New Change"
    autoInitPrompt: "你正在帮助创建一个新的 change。询问用户想要构建什么。"
    quickButtons:
      - label: "创建提案"
        prompt: "/opsx-new {input}"
        requiresInput: true
      - label: "列出 Changes"
        action: "list_changes"
    confirmation:
      enabled: true
      responseTemplate: "已确认：\n{selected_items}"
```

创建 `.openspec/codex_worker_define.yml`：
```yaml
modes:
  code_review:
    name: "Code Review"
    autoInitPrompt: "你是一个代码审查员。分析代码并提供反馈。"
    quickButtons:
      - label: "开始审查"
        prompt: "审查当前 change"
```

### 确认卡片场景

创建 `.openspec/confirmation_card.yml`：
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

## 🔥 高级功能

### Factory Hooks 集成
应用自动监听 `http://127.0.0.1:18888` 上的 Factory droid hooks。在 `.factory/settings.json` 中配置：
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

### 消息日志面板
- **自动滚动**：切换以跟随新消息
- **清除**：清空日志（最多保留 2000 条）
- **过滤器**：按消息类型（SEND、RECV、CALLBACK、HOOK）进行颜色编码

### 双向 Worker 通信
将 Codex Worker 链接到 Droid Worker：
1. 启动 Droid Worker
2. 在 "Code Review" 模式下启动 Codex Worker
3. Codex Worker 可以向 Droid Worker 的终端发送命令
4. 两个智能体可以在同一个 change 上协调

---

## 🛠️ 开发

### 在开发模式下运行
```bash
# 终端 1：带热重载的 Web 应用
cd app
npm run dev

# 终端 2：桌面应用
cd desktop
source .venv/bin/activate
python app.py
```

### 项目结构
```
openspecui/
├── app/                    # React web 应用
│   ├── src/
│   │   ├── App.tsx         # 主应用组件
│   │   ├── DroidWorkerBase.tsx
│   │   ├── CodexWorkerBase.tsx
│   │   ├── HumanConfirmationCard.tsx
│   │   ├── EmbeddedTerminal.tsx
│   │   └── TreeView.tsx
│   └── package.json
├── desktop/                # macOS 原生应用
│   ├── app.py              # 主 Python 应用
│   ├── log_panel.html      # 消息日志 UI
│   └── confirmation_dialog.html
├── openspec/               # OpenSpec 工作区
│   ├── changes/            # 活动 changes
│   ├── specs/              # 主 specs
│   └── config.yaml
└── README.md
```

---

## 🎭 理念

OpenSpecUI 拥抱 AI 驱动开发的混沌，同时让你掌控缰绳。它不是要取代开发者——而是要放大你以思维速度思考、设计和构建的能力。

**规格驱动**意味着在深入代码之前定义"是什么"和"为什么"。**AI 驱动**意味着智能体处理繁重的工作。**人机协同**意味着你保持控制。

这就是软件开发，未经驯服。

---

## 📜 许可证

MIT

---

## 🤝 贡献

欢迎贡献！这个项目是实验性的，正在快速发展。如果你想添加功能、修复 bug 或改进文档，请提交 issue 或 PR。

---

## 🙏 致谢

构建使用：
- [Factory AI](https://factory.ai) - AI 智能体基础设施
- [xterm.js](https://xtermjs.org) - 终端模拟
- [React](https://react.dev) - UI 框架
- [PyObjC](https://pyobjc.readthedocs.io) - macOS 原生绑定

---

**准备好在你的终端中释放 AI 智能体了吗？克隆、构建，让混沌开始。** 🔥
