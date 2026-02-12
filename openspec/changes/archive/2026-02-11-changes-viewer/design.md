## Context

现有 OpenSpec Viewer 只支持浏览 `specs` 目录。需要扩展以支持 `changes` 目录的可视化。Change 是核心实体，包含 proposal.md、design.md、tasks.md 和 specs/ 子目录。

现有代码结构：
- `useDirectoryPicker.ts` — 目录选择和文件树解析
- `TreeView.tsx` — 左侧树形目录
- `Canvas.tsx` — 右侧画布卡片
- `EditorPanel.tsx` — 底部编辑面板
- `Icons.tsx` — SVG 图标组件

## Goals / Non-Goals

**Goals:**
- 将 `FileTreeNode` 扩展为支持 change 实体和 artifact 文件
- 树视图显示 Specs 和 Changes 两个顶层分支
- Change 节点展开后显示其 artifact 文件列表
- 编辑器支持打开任意 .md 文件
- 区分 active changes 和 archived changes

**Non-Goals:**
- 不支持创建新 change 或 artifact
- 不支持 change 的状态管理（如标记完成）
- 不做 archive/unarchive 操作

## Decisions

### 1. 数据模型：扩展 FileTreeNode
- **选择**: 在 `FileTreeNode` 上增加 `nodeType` 字段区分节点类型
- **类型**: `'directory' | 'spec' | 'change' | 'artifact' | 'section'`
  - `section`: 顶层分组节点（"Specs"、"Changes"、"Archive"）
  - `change`: change 实体节点
  - `artifact`: change 下的 .md 文件（proposal.md 等）
  - `spec`: 包含 spec.md 的目录
  - `directory`: 普通目录
- **理由**: 单一类型字段比多个 boolean 更清晰，便于在 TreeView 和 Canvas 中做条件渲染

### 2. 目录解析：pickDirectory 返回完整结构
- **选择**: `pickDirectory()` 返回一个包含 specs 和 changes 两个子树的根节点
- **结构**:
  ```
  root (section: "OpenSpec")
  ├── Specs (section)
  │   └── ... (现有 spec 树)
  └── Changes (section)
      ├── change-1 (change)
      │   ├── proposal.md (artifact)
      │   ├── design.md (artifact)
      │   ├── tasks.md (artifact)
      │   └── specs/ (directory)
      │       └── capability-1/ (spec)
      └── Archive (section)
          └── 2026-02-11-change-1 (change, archived)
  ```

### 3. 树视图：section 节点不可拖拽
- **选择**: section 节点（Specs、Changes、Archive）作为分组标题，始终展开，不可拖拽到画布
- **理由**: 它们是导航结构，不是实体

### 4. 编辑器：统一处理所有 .md 文件
- **选择**: `EditorPanel` 接受 `FileTreeNode`，通过 `handle` 字段读写文件
- **理由**: 所有 artifact 都是 .md 文件，编辑逻辑完全相同，只需调整标题显示

## Risks / Trade-offs

- **[节点类型复杂度]** 增加 nodeType 会影响现有的 isSpecNode 判断 → 更新 isSpecNode 使用 nodeType
- **[大量 changes]** 如果 archive 目录很大可能影响加载速度 → archive 默认折叠，按需加载
