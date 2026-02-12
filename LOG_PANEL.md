# 日志面板功能说明

## 概述

桌面应用底部新增了一个**消息日志面板**，实时显示所有 terminal 交互消息，方便调试和监控命令执行流程。

## 布局结构

```
┌─────────────────────────────────────────────────┐
│  Web App (左)          │  Terminal (右)         │
│                        │                        │
│                        │                        │
├────────────────────────┴────────────────────────┤
│  📋 Message Log                    [Auto-scroll] [Clear]
│  ──────────────────────────────────────────────
│  12:34:56.789  → SEND    write_to_terminal    cd /path
│  12:34:56.890  ← RECV    terminal_output      /path $
│  12:34:57.001  ⟲ CALLBACK command_complete    [cd-project]
│  12:34:57.123  → SEND    runCommandWithCallback  droid [cb=launch-droid]
│  12:34:58.456  ← RECV    terminal_output      How can I help?
│  12:34:58.567  ⟲ CALLBACK command_complete    [launch-droid]
│  12:34:58.678  ⚡ HOOK    notify_refresh       SessionEnd
└─────────────────────────────────────────────────┘
```

## 日志类型

### 消息方向标识

- **→ SEND** (绿色) - 发送到 terminal 的命令
- **← RECV** (蓝色) - 从 terminal 接收的输出
- **⟲ CALLBACK** (黄色) - 命令回调完成通知
- **⚡ HOOK** (紫色) - Factory droid hooks 触发
- **ℹ INFO** (灰色) - 系统信息（启动、退出等）

### 记录的事件

1. **write_to_terminal** - 直接写入 terminal 的文本
2. **runCommandWithCallback** - 带回调的命令执行（显示 callback ID 和等待的 prompt 类型）
3. **terminal_output** - Terminal 输出（自动 strip ANSI 转义序列）
4. **command_complete** - 命令回调触发（检测到 shell/droid prompt）
5. **terminal_exit** - Terminal 进程退出
6. **notify_refresh** - Hook 通知 web app 刷新文件树
7. **start_terminal** - PTY 启动

## 功能特性

### 自动滚动
- 默认开启，新消息自动滚动到底部
- 点击 **Auto-scroll** 按钮切换开关
- 手动滚动时不影响日志记录

### 清空日志
- 点击 **Clear** 按钮清空所有日志
- 不影响 terminal 实际运行状态

### 性能优化
- 最多保留 2000 条日志（自动删除旧条目）
- 长文本自动截断（显示前 300 字符）
- ANSI 转义序列自动过滤（避免显示乱码）

### 样式设计
- 深色主题，与 terminal 风格一致
- 等宽字体（SF Mono / Menlo / Monaco）
- 时间戳精确到毫秒
- 悬停高亮当前行

## 调试用途

### 1. 命令回调流程追踪

查看 "New Change" 功能的完整执行流程：

```
→ SEND    runCommandWithCallback    cd /path [cb=cd-project, wait=shell]
← RECV    terminal_output           /path $
⟲ CALLBACK command_complete         [cd-project]
→ SEND    runCommandWithCallback    droid [cb=launch-droid, wait=droid]
← RECV    terminal_output           How can I help?
⟲ CALLBACK command_complete         [launch-droid]
→ SEND    write_to_terminal         /opsx-new 添加功能
```

### 2. Hook 触发监控

查看 Factory droid hooks 何时触发：

```
⚡ HOOK    notify_refresh           PostToolUse
⚡ HOOK    notify_refresh           SessionEnd
```

### 3. Terminal 输出分析

实时查看 terminal 的原始输出（已过滤 ANSI）：

```
← RECV    terminal_output          ╭─ Proposal
← RECV    terminal_output          │  Title: Add user auth
← RECV    terminal_output          ╰─────────────────
```

## 实现细节

### Python 端 (desktop/app.py)

```python
# AppCoordinator 新增方法
def log(self, direction: str, msg_type: str, detail: str = ''):
    """发送日志到 log panel WebView"""
    # direction: 'send' | 'recv' | 'callback' | 'hook' | 'info'
    # 自动转义和截断，通过 evaluateJavaScript 调用 JS
```

### 日志插入点

- `write_to_terminal()` - 记录所有发送的命令
- `run_command_with_callback()` - 记录带回调的命令
- `_on_terminal_output()` - 记录所有 terminal 输出
- `_fire_callback()` - 记录回调触发
- `_on_terminal_exit()` - 记录进程退出
- `notify_web_refresh()` - 记录 hook 通知
- `start_terminal()` - 记录 PTY 启动

### HTML 端 (desktop/log_panel.html)

- 纯 HTML + CSS + Vanilla JS
- 通过 `window.logSend()`, `window.logRecv()` 等全局函数接收日志
- 自动 HTML 转义防止注入
- 自动截断长文本
- Strip ANSI 转义序列

## 故障排除

### 日志面板不显示

1. 检查 `desktop/log_panel.html` 是否存在
2. 查看 Python 控制台是否有 WebView 加载错误
3. 确认窗口高度足够显示底部面板

### 日志不更新

1. 打开 Safari 开发者工具 → 开发 → OpenSpec Desktop → log_panel.html
2. 查看控制台是否有 JS 错误
3. 确认 `self.coordinator.log_webview` 已正确设置

### 性能问题

- 如果日志过多导致卡顿，点击 **Clear** 清空
- 考虑减少 `maxEntries` 限制（默认 2000）
- 关闭 **Auto-scroll** 减少 DOM 操作

## 未来改进

- [ ] 添加日志过滤（按类型、关键词）
- [ ] 支持导出日志到文件
- [ ] 添加日志搜索功能
- [ ] 支持折叠/展开长文本
- [ ] 添加日志统计（命令数、错误数等）
