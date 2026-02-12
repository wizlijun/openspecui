## Why

Git 仓库中的 openspec/specs 目录包含层级化的 spec.md 文件，当前只能通过文件系统浏览，缺乏直观的可视化方式来查看和编辑这些 spec。需要一个轻量的纯前端工具，以树形目录 + 画布卡片的方式可视化展示和编辑 spec 内容。

## What Changes

- 新建一个纯前端 TypeScript 应用（单页应用）
- 用户通过文件选择器选择本地 git 仓库的 openspec 目录
- 左侧面板：树形目录展示 specs 目录下的层级结构（目录节点 + spec.md 叶子节点）
- 右侧画布：可自由拖动的卡片视图，支持目录卡片和 spec 卡片
- 点击 spec 卡片可浏览和编辑 spec.md 内容
- 使用 File System Access API 读写本地文件

## Capabilities

### New Capabilities

- `dir-picker`: 通过浏览器 File System Access API 选择并读取 openspec 目录，解析 specs 子目录的层级文件结构
- `spec-tree-view`: 左侧树形目录组件，按层级展示 specs 目录结构，目录可展开/折叠，叶子节点为 spec.md
- `spec-canvas`: 右侧可拖拽画布，支持将目录和 spec 以卡片形式自由拖放布局
- `spec-editor`: 点击 spec 卡片后弹出编辑面板，支持 markdown 内容的查看和编辑，保存回本地文件

### Modified Capabilities

（无已有 capability 需要修改）

## Impact

- 新增前端项目，技术栈：TypeScript + 现代前端框架（React/Vite）
- 依赖浏览器 File System Access API（Chrome/Edge 支持）
- 无后端依赖，纯客户端运行
- 不影响现有 openspec CLI 或目录结构
