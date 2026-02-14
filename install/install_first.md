# OpenSpec Desktop - 项目配置安装指南

## 前提条件

1. 已安装并运行 OpenSpec Desktop 应用
2. 目标项目已完成 `openspec init` 初始化

> ⚠️ **必须先执行 `openspec init`**，确保项目根目录下已生成 `.openspec/` 目录后，再进行以下配置文件的复制。否则后续复制可能覆盖或冲突。

## 配置目录说明

本目录包含三组配置，分别对应不同的 AI Agent 工具：

| 目录 | 用途 | 目标工具 |
|------|------|----------|
| `.openspec/` | Worker 定义、通知脚本、确认卡片配置 | OpenSpec Desktop |
| `.codex/` | Codex notify hook 及启动配置 | OpenAI Codex CLI |
| `.factory/` | Hook 事件配置（Session/Stop 等） | Kiro / Factory |

### `.openspec/` 文件清单

| 文件 | 说明 |
|------|------|
| `droid_worker_define.yml` | Droid Worker 模式定义（New Change / Continue / Fix Review） |
| `codex_worker_define.yml` | Codex Worker 模式定义（Standalone / Code Review） |
| `confirmation_card.yml` | 评审确认弹窗的触发条件、按钮和行为配置 |
| `codex-notify.sh` | Codex 事件转发脚本，将通知 POST 到 Desktop |
| `codex_init_cmd.sh` | Review 终端环境初始化（代理、notify hook 安装） |
| `desktop_chat_history.json` | 示例对话历史（可选） |

### `.codex/` 文件清单

| 文件 | 说明 |
|------|------|
| `config.toml` | Codex CLI 配置，注册 notify hook 路径 |
| `notify.sh` | notify hook 脚本（由 `codex_init_cmd.sh` 自动安装） |
| `test-notify-hook.sh` | notify hook 测试脚本 |

### `.factory/` 文件清单

| 文件 | 说明 |
|------|------|
| `settings.json` | Hook 事件配置（SessionStart/End、Stop、Notification 等） |
| `hooks/stop_with_result.sh` | Stop 事件处理脚本 |
| `test_hook_stdin.sh` | Hook stdin 测试脚本 |

## 安装步骤

### 1. 初始化项目（如尚未执行）

```bash
cd /path/to/your-project
openspec init
```

### 2. 复制配置文件到项目根目录

```bash
# 假设 openspecui 仓库路径为 $OPENSPECUI_DIR
OPENSPECUI_DIR="/path/to/openspecui"
PROJECT_DIR="/path/to/your-project"

# 复制 .openspec 配置（合并到已有目录）
cp -a "$OPENSPECUI_DIR/install/.openspec/." "$PROJECT_DIR/.openspec/"

# 复制 .codex 配置
cp -a "$OPENSPECUI_DIR/install/.codex/." "$PROJECT_DIR/.codex/"

# 复制 .factory 配置
cp -a "$OPENSPECUI_DIR/install/.factory/." "$PROJECT_DIR/.factory/"
```

### 3. 确保脚本可执行

```bash
cd "$PROJECT_DIR"
chmod +x .openspec/codex-notify.sh .openspec/codex_init_cmd.sh
chmod +x .codex/notify.sh .codex/test-notify-hook.sh
chmod +x .factory/hooks/stop_with_result.sh .factory/test_hook_stdin.sh
```

### 4. 更新 .codex/config.toml 中的路径

`config.toml` 中的 notify hook 路径是绝对路径，需要更新为当前项目的实际路径：

```bash
cd "$PROJECT_DIR"
# codex_init_cmd.sh 会自动处理路径更新，直接执行即可
bash .openspec/codex_init_cmd.sh
```

## 验证

```bash
# 测试 notify hook 是否正常工作（需先启动 OpenSpec Desktop）
bash .codex/test-notify-hook.sh
```

## 注意事项

- `.codex/config.toml` 中的 notify 路径为绝对路径，项目移动后需重新执行 `codex_init_cmd.sh`
- `.factory/settings.json` 中的 hook 通过 `127.0.0.1:18888` 与 Desktop 通信，确保端口未被占用
- `desktop_chat_history.json` 为示例文件，可按需保留或删除
