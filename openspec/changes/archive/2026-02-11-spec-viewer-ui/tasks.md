## 1. Project Setup

- [x] 1.1 Initialize Vite + React + TypeScript project in the repository root (npm create vite, install dependencies)
- [x] 1.2 Clean up default boilerplate, set up basic App component with the three-panel layout structure (header, left tree, right canvas)
- [x] 1.3 Add minimal global CSS for the layout (flexbox split: left sidebar 250px, right canvas fills remaining)

## 2. Directory Picker (dir-picker)

- [x] 2.1 Create `useDirectoryPicker` hook: invoke `showDirectoryPicker()`, locate `specs` subdirectory, return error if not found
- [x] 2.2 Create `FileTreeNode` type definition (name, kind: 'directory' | 'file', children, fileHandle) and recursive directory traversal function
- [x] 2.3 Add "Open Directory" button in the header, wire it to the hook, store the parsed file tree in App state
- [x] 2.4 Add browser compatibility check — show warning if File System Access API is not available

## 3. Tree View (spec-tree-view)

- [x] 3.1 Create `TreeView` component that renders the file tree recursively with indentation
- [x] 3.2 Add expand/collapse toggle for directory nodes (collapsed by default)
- [x] 3.3 Add folder/document icons to distinguish directory vs spec.md nodes
- [x] 3.4 Add click handler on spec.md leaf nodes to set the selected spec in App state

## 4. Canvas (spec-canvas)

- [x] 4.1 Create `Canvas` component with a container that supports relative positioning of child cards
- [x] 4.2 Create `Card` component (directory card and spec card variants) showing name and optional preview text
- [x] 4.3 Implement drag-to-reposition using pointer events: track mousedown/mousemove/mouseup, update card position state
- [x] 4.4 Auto-layout initial card positions in a grid when directory is first loaded
- [x] 4.5 Implement directory card double-click to expand and show child cards near the parent
- [x] 4.6 Wire spec card click to open the editor (set selected spec in App state)

## 5. Spec Editor (spec-editor)

- [x] 5.1 Create `EditorPanel` component: a bottom panel with a textarea showing the selected spec.md content
- [x] 5.2 Read spec.md content on selection using the stored FileSystemFileHandle
- [x] 5.3 Implement save: write edited content back via FileSystemWritableFileStream, show success feedback
- [x] 5.4 Add Cmd+S / Ctrl+S keyboard shortcut to trigger save
- [x] 5.5 Add close button to dismiss the editor panel
