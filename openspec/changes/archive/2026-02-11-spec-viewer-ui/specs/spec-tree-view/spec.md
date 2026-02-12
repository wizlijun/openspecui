## ADDED Requirements

### Requirement: Display specs as a tree
The system SHALL render a tree view component in the left panel that mirrors the specs directory hierarchy. Directory nodes SHALL be expandable/collapsible. Leaf nodes SHALL represent spec.md files.

#### Scenario: Initial tree rendering
- **WHEN** a valid openspec directory is loaded
- **THEN** the left panel SHALL display the specs directory tree with all top-level items visible and directories collapsed by default

#### Scenario: Expand a directory node
- **WHEN** user clicks on a collapsed directory node
- **THEN** the node SHALL expand to show its children (subdirectories and spec.md files)

#### Scenario: Collapse a directory node
- **WHEN** user clicks on an expanded directory node
- **THEN** the node SHALL collapse and hide its children

### Requirement: Visual distinction between node types
The system SHALL visually distinguish directory nodes from spec.md leaf nodes using different icons or styling.

#### Scenario: Directory vs spec node appearance
- **WHEN** the tree is rendered
- **THEN** directory nodes SHALL display a folder icon and spec.md nodes SHALL display a document icon

### Requirement: Click spec node to select
The system SHALL allow users to click a spec.md leaf node to select it, triggering the spec content to be shown in the editor.

#### Scenario: Select a spec from tree
- **WHEN** user clicks a spec.md leaf node in the tree
- **THEN** the system SHALL highlight the selected node and open the spec content in the editor panel
