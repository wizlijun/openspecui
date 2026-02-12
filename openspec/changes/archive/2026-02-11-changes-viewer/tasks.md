## 1. Data Model Updates

- [x] 1.1 Update `FileTreeNode` interface: add `nodeType: 'directory' | 'spec' | 'change' | 'artifact' | 'section'` field and optional `artifactType` field
- [x] 1.2 Update `isSpecNode()` helper to check `nodeType === 'spec'` instead of checking specHandle
- [x] 1.3 Add helper functions: `isChangeNode()`, `isArtifactNode()`, `isSectionNode()`

## 2. Directory Picker (change-loader)

- [x] 2.1 Refactor `pickDirectory()` to read openspec root directory instead of just specs subdirectory
- [x] 2.2 Create `parseChangesDirectory()` function to read changes/ and build change nodes with artifact children
- [x] 2.3 Create `parseArchiveDirectory()` function to read changes/archive/ and mark nodes as archived
- [x] 2.4 Update `pickDirectory()` to return a root node with "Specs" and "Changes" section children
- [x] 2.5 For each change, detect proposal.md, design.md, tasks.md files and create artifact nodes with file handles

## 3. Tree View Updates (change-tree-view, spec-tree-view)

- [x] 3.1 Update `TreeView` to handle section nodes (render as non-clickable headers)
- [x] 3.2 Update `TreeNode` to render change nodes with a distinct icon (e.g., GitBranch icon)
- [x] 3.3 Update `TreeNode` to render artifact nodes (proposal.md, design.md, tasks.md) with document icons
- [x] 3.4 Add visual styling for archived changes (dimmed/grayed out)
- [x] 3.5 Wire artifact node clicks to open the file in the editor

## 4. Canvas Updates

- [x] 4.1 Update `Canvas` to filter out section nodes (don't render them as cards)
- [x] 4.2 Add change card variant with distinct styling (border color, icon)
- [x] 4.3 Update card click handler to support change nodes (expand to show artifacts)

## 5. Editor Updates (artifact-editor)

- [x] 5.1 Update `EditorPanel` to accept any .md file node (not just spec nodes)
- [x] 5.2 Update editor header to show artifact type and parent change name (e.g., "changes-viewer / proposal.md")
- [x] 5.3 Add icon selection logic based on artifact type (proposal, design, tasks, spec)

## 6. Icons

- [x] 6.1 Add new icons: `GitBranchIcon` (for change nodes), `FileTextIcon` (for artifact files), `ArchiveIcon` (for archive section)
