## Why

当前 OpenSpec Viewer 只能查看 `specs` 目录下的规范文件，无法可视化管理 `changes` 目录中正在进行的变更（change）。每个 change 包含 proposal.md、design.md、tasks.md 和多个 specs，需要一个统一的界面来浏览和编辑这些 change artifacts，以及查看 archive 目录中已归档的 change。

## What Changes

- 扩展目录选择器，支持读取 `openspec` 根目录（而不仅仅是 `specs` 子目录）
- 在树视图中增加 `changes` 和 `archive` 节点，展示所有 change 目录
- 将 change 作为一等实体对象，点击 change 节点时展开其内部结构（proposal.md、design.md、tasks.md、specs/）
- 支持在编辑器中查看和编辑 change 的各类 artifact 文件（.md 文件）
- 区分 active changes（`changes/` 下）和 archived changes（`changes/archive/` 下）

## Capabilities

### New Capabilities

- `change-loader`: 读取 `openspec/changes` 目录，解析所有 change 子目录，识别每个 change 的 artifact 文件（proposal.md、design.md、tasks.md、specs/）
- `change-tree-view`: 在树视图中展示 changes 和 archive 节点，change 节点可展开显示其内部 artifact 结构
- `artifact-editor`: 支持编辑 change 的各类 artifact 文件（proposal.md、design.md、tasks.md、以及 specs 下的 spec.md）

### Modified Capabilities

- `dir-picker`: 修改为选择 `openspec` 根目录而非仅 `specs` 子目录，同时读取 `specs`、`changes` 和 `changes/archive` 三个子目录
- `spec-tree-view`: 扩展树视图以支持显示 changes 和 specs 两个顶层分支，change 节点展开后显示其 artifact 文件
- `spec-editor`: 扩展编辑器以支持编辑任意 .md 文件（不仅限于 spec.md），根据文件类型显示不同的标题和图标

## Impact

- 修改 `useDirectoryPicker.ts` 的目录遍历逻辑，增加 change 结构的解析
- 修改 `FileTreeNode` 类型定义，增加 `changeHandle` 和 `artifactType` 字段以区分不同类型的节点
- 修改 `TreeView.tsx` 以支持 change 节点的展开和 artifact 文件的显示
- 修改 `EditorPanel.tsx` 以支持编辑任意 .md 文件
- 不影响现有的 specs 浏览功能，保持向后兼容
