# Factory Droid Hooks Integration

这个项目配置了 Factory droid hooks，当 droid 执行命令时自动通知桌面应用刷新文件树。

## 工作原理

1. **Desktop App HTTP 服务器**: `desktop/app.py` 启动一个 HTTP 服务器监听 `http://127.0.0.1:18888`
2. **Factory Hooks 配置**: `.factory/settings.json` 配置了两个 hooks：
   - `SessionEnd`: 当 droid 会话结束时触发
   - `PostToolUse`: 当 droid 使用任何工具后触发
3. **Web App 监听**: `app/src/App.tsx` 监听 `window.__onHookNotify` 事件，收到通知后自动刷新文件树

## 配置文件

### `.factory/settings.json`

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -X POST http://127.0.0.1:18888/api/hook-notify -H 'Content-Type: application/json' -d '{\"event\":\"SessionEnd\",\"timestamp\":\"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'\"}' 2>/dev/null || true",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "curl -X POST http://127.0.0.1:18888/api/hook-notify -H 'Content-Type: application/json' -d '{\"event\":\"PostToolUse\",\"tool\":\"'\"$TOOL_NAME\"'\",\"timestamp\":\"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'\"}' 2>/dev/null || true",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

## 使用方法

1. **启动桌面应用**:
   ```bash
   cd desktop
   .venv/bin/python app.py
   ```
   
   应用启动时会显示：
   ```
   Hook notification server listening on http://127.0.0.1:18888
   App started. Terminal PTY running.
   ```

2. **在终端中使用 droid**:
   - 在桌面应用的右侧终端中运行 `droid`
   - 执行任何命令，例如 `/opsx-new 添加用户认证功能`
   - 当命令完成或会话结束时，hooks 会自动触发

3. **自动刷新**:
   - Web app 会收到通知并在 500ms 后自动刷新文件树
   - 新创建的 changes/specs 会立即显示在左侧文件树中

## 测试 Hooks

运行测试脚本验证 HTTP 服务器是否正常工作：

```bash
cd desktop
./test_hook.sh
```

如果服务器正常运行，你会看到：
```
{"status":"ok"}
```

并且桌面应用的控制台会显示：
```
Hook notification sent to web app: SessionEnd
```

## 调试

### 查看 Hook 执行日志

在 droid 中运行：
```bash
droid --debug
```

你会看到类似的日志：
```
[DEBUG] Executing hooks for SessionEnd
[DEBUG] Hook command completed with status 0
```

### 检查 HTTP 服务器

确认服务器正在监听：
```bash
lsof -i :18888
```

### 手动测试通知

```bash
curl -X POST http://127.0.0.1:18888/api/hook-notify \
  -H 'Content-Type: application/json' \
  -d '{"event":"test","timestamp":"2026-02-11T10:00:00Z"}'
```

## 支持的 Hook 事件

根据 Factory 文档，可以配置以下事件：

- `SessionStart`: 会话开始
- `SessionEnd`: 会话结束 ✅ (已配置)
- `UserPromptSubmit`: 用户提交 prompt
- `PreToolUse`: 工具使用前
- `PostToolUse`: 工具使用后 ✅ (已配置)
- `Stop`: Droid 停止
- `SubagentStop`: 子 agent 停止
- `Notification`: 通知事件

## 故障排除

### Hooks 不触发

1. 检查 `.factory/settings.json` 是否存在且格式正确
2. 确认 droid 版本支持 hooks（需要较新版本）
3. 运行 `droid --debug` 查看详细日志

### HTTP 请求失败

1. 确认桌面应用正在运行
2. 检查端口 18888 是否被占用
3. 查看防火墙设置

### 文件树不刷新

1. 打开浏览器开发者工具查看控制台
2. 确认 `window.__onHookNotify` 已定义
3. 检查 `refreshDirectory` 函数是否正常执行

## 参考文档

- [Factory Hooks Guide](https://docs.factory.ai/cli/configuration/hooks-guide)
- [Factory Hooks Reference](https://docs.factory.ai/reference/hooks-reference)
