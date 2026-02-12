## Context

OpenSpec Desktop 是一个 macOS 原生应用，使用 Python (PyObjC) 后端 + React 前端架构。前端通过 `window.__nativeBridge` 与 Python 后端通信，已有 `nativeReadFile` / `nativeWriteFile` 接口用于文件读写。

当前 `EditorPanel` 组件提供 textarea 编辑器，用户编辑 spec 和 artifact 文件。但程序异常退出时，未保存的编辑内容会丢失。

项目根路径通过 `tree.nativePath` 获取（App.tsx 中的 `tree` state），EditorPanel 通过 `spec.nativePath` 获取当前编辑文件的路径。

## Goals / Non-Goals

**Goals:**
- 自动保存用户在编辑器中的输入到 `openspec/desktop_chat_history.json`
- 提供历史记录浏览和恢复 UI
- 复用现有 native bridge 文件读写接口，无需新增后端 API
- 仅在 native app 模式下启用

**Non-Goals:**
- 不实现版本对比（diff）功能
- 不实现自动恢复（crash recovery 自动弹窗）
- 不支持浏览器模式
- 不限制历史记录数量上限（后续可优化）

## Decisions

### D1: 存储方案 — 复用 nativeReadFile/nativeWriteFile

直接复用现有的 `nativeReadFile` 和 `nativeWriteFile` 读写 JSON 文件，无需在 Python 后端新增专用 API。

**理由**: 现有 bridge 已支持任意文件的读写，新增 API 会增加不必要的复杂度。JSON 文件体积小，全量读写性能可接受。

**替代方案**: 在 Python 后端新增专用的 history CRUD API — 过度设计，增加维护成本。

### D2: 历史文件路径 — 基于项目根路径拼接

历史文件路径为 `${projectRootPath}/openspec/desktop_chat_history.json`。`projectRootPath` 需要从 App.tsx 传递到 EditorPanel。

**实现方式**: 在 EditorPanel 的 props 中新增 `projectPath?: string`，由 App.tsx 传入 `tree?.nativePath`。历史文件路径在组件内拼接：`${projectPath}/openspec/desktop_chat_history.json`。

### D3: 新增独立模块 — inputHistoryService.ts

创建 `app/src/inputHistoryService.ts` 封装所有历史记录的读写逻辑：
- `loadHistory(projectPath)` — 读取并解析 JSON
- `saveHistoryEntry(projectPath, entry)` — 追加一条记录并写入
- `deleteHistoryEntry(projectPath, id)` — 删除单条记录
- `clearHistory(projectPath)` — 清空所有记录

**理由**: 将存储逻辑与 UI 分离，便于测试和复用。

### D4: 防抖机制 — useRef + setTimeout

在 EditorPanel 中使用 `useRef` 保存 timer ID，在 `onChange` 回调中实现 2 秒防抖。不引入外部库（如 lodash），保持零依赖。

```typescript
const debounceRef = useRef<ReturnType<typeof setTimeout>>()

const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  const newContent = e.target.value
  setContent(newContent)
  if (debounceRef.current) clearTimeout(debounceRef.current)
  debounceRef.current = setTimeout(() => {
    saveHistoryEntry(projectPath, { filePath, content: newContent })
  }, 2000)
}
```

### D5: UI 方案 — 内嵌面板切换

在 EditorPanel 内部添加历史记录面板，通过 toggle 按钮切换显示。面板覆盖 textarea 区域，不使用弹窗。

**理由**: 弹窗会打断编辑流程，内嵌面板更自然。用户可以快速切换查看历史和继续编辑。

**布局**:
- 编辑器 header 添加 "History" 按钮
- 点击后 textarea 区域替换为历史记录列表
- 点击某条记录展开显示完整内容
- "加载到编辑器" 按钮将内容写入 textarea 并切回编辑模式

### D6: 新增 InputHistoryPanel 组件

创建 `app/src/InputHistoryPanel.tsx` 作为独立组件：

```typescript
interface InputHistoryPanelProps {
  projectPath: string
  onLoadContent: (content: string) => void
  onClose: () => void
}
```

**理由**: 保持 EditorPanel 简洁，历史面板逻辑独立管理。

### D7: 历史记录 ID 生成

使用 `Date.now()` + 4 位随机字符串作为 ID，避免引入 uuid 依赖。

```typescript
const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
```

### D8: 时间格式化 — 纯手写工具函数

不引入 dayjs/moment，手写简单的相对时间格式化函数。24 小时内显示相对时间，超过显示 `YYYY-MM-DD HH:mm`。

## Risks / Trade-offs

- **[并发写入冲突]** 多个编辑器窗口同时保存可能导致数据丢失 → 当前应用只有一个 EditorPanel 实例，风险极低。后续如需多编辑器支持，可引入写入队列。

- **[JSON 文件增长]** 长期使用后文件可能变大 → 当前不限制数量，后续可添加自动清理策略（如保留最近 500 条）。

- **[全量读写性能]** 每次保存都全量读写 JSON 文件 → 防抖 2 秒已大幅减少写入频率，JSON 文件通常不大，性能影响可忽略。

- **[内容重复]** 同一文件多次编辑会产生多条相似记录 → 可接受，用户可手动删除不需要的记录。

## Open Questions

无。方案基于现有架构，复用已有接口，实现路径清晰。
