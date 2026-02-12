## Context

openspec 项目在 git 仓库中维护 `openspec/specs/` 目录，其中包含层级化的 spec.md 文件。当前只能通过文件管理器或 CLI 浏览，缺乏可视化工具。本设计为一个纯前端单页应用，运行在浏览器中，无需后端。

## Goals / Non-Goals

**Goals:**
- 提供最简的 UI 来可视化浏览 openspec/specs 目录结构
- 左侧树形目录 + 右侧可拖拽画布的双面板布局
- 支持 spec.md 的查看和编辑，保存回本地文件
- 纯客户端运行，零后端依赖

**Non-Goals:**
- 不支持创建新的 spec 文件或目录
- 不支持 git 操作（commit、push 等）
- 不支持多人协作或实时同步
- 不做 spec 内容的语义解析或校验
- 不支持 Firefox/Safari（File System Access API 限制）

## Decisions

### 1. 框架选择：React + Vite
- **选择**: React 18 + Vite + TypeScript
- **理由**: React 生态成熟，Vite 构建快，TypeScript 类型安全。对于这种组件化 UI 最合适。
- **替代方案**: Vue/Svelte 也可行，但 React 社区资源最丰富。

### 2. 文件访问：File System Access API
- **选择**: 使用浏览器原生 File System Access API
- **理由**: 无需后端，直接读写本地文件。用户授权后可持续访问。
- **替代方案**: `<input type="file">` 只能读不能写；Electron 太重。
- **限制**: 仅 Chromium 内核浏览器支持。

### 3. 画布拖拽：轻量自实现
- **选择**: 基于 React state + mouse/pointer events 自行实现拖拽
- **理由**: 需求简单（卡片自由定位），不需要引入 react-dnd 或 react-flow 等重依赖。
- **替代方案**: react-beautiful-dnd（过重）、react-flow（面向图表，过度设计）。

### 4. Markdown 编辑：纯文本 textarea
- **选择**: 使用原生 textarea 编辑 markdown 原文
- **理由**: 最简实现，spec.md 本身就是纯文本。避免引入富文本编辑器的复杂度。
- **替代方案**: CodeMirror/Monaco（功能强大但体积大，后续可升级）。

### 5. 状态管理：React useState/useContext
- **选择**: 使用 React 内置状态管理
- **理由**: 应用状态简单（文件树 + 选中项 + 卡片位置），不需要 Redux/Zustand。

### 6. 布局结构
```
┌─────────────────────────────────────────┐
│  Header: [Open Directory] 按钮          │
├──────────┬──────────────────────────────┤
│  Tree    │  Canvas                      │
│  View    │  ┌──────┐  ┌──────┐         │
│          │  │Card 1│  │Card 2│         │
│  ├─dir1  │  └──────┘  └──────┘         │
│  │ └spec │                              │
│  ├─dir2  │         ┌──────┐            │
│  │ └spec │         │Card 3│            │
│          │         └──────┘            │
├──────────┴──────────────────────────────┤
│  Editor Panel (底部弹出，选中 spec 时)    │
└─────────────────────────────────────────┘
```

## Risks / Trade-offs

- **[浏览器兼容性]** File System Access API 仅 Chrome/Edge 支持 → 在 UI 中检测并提示不支持的浏览器
- **[大目录性能]** specs 目录层级很深时可能卡顿 → 初始只加载前两层，按需展开
- **[卡片位置不持久]** 刷新后卡片位置丢失 → 可后续用 localStorage 持久化，MVP 不做
- **[文件权限]** 用户可能拒绝文件访问权限 → 优雅处理权限拒绝错误
