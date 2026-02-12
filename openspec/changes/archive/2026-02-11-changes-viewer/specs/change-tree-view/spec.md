## ADDED Requirements

### Requirement: Display changes section in tree
The system SHALL display a "Changes" top-level section in the tree view, listing all active changes as expandable nodes.

#### Scenario: Show active changes
- **WHEN** the openspec directory is loaded and contains active changes
- **THEN** the tree SHALL show a "Changes" section with each change as a child node, using a distinct change icon

### Requirement: Display archive section in tree
The system SHALL display an "Archive" section under Changes, listing all archived changes.

#### Scenario: Show archived changes
- **WHEN** the openspec directory contains archived changes
- **THEN** the tree SHALL show an "Archive" subsection with each archived change as a child node, visually dimmed to indicate archived status

### Requirement: Expand change to show artifacts
Clicking a change node SHALL expand it to show its artifact files (proposal.md, design.md, tasks.md) and a specs sub-tree.

#### Scenario: Expand active change
- **WHEN** user clicks on a change node
- **THEN** the node SHALL expand to show its artifact files and specs subdirectory as children

#### Scenario: Change specs sub-tree
- **WHEN** a change node is expanded and contains a specs subdirectory
- **THEN** the specs SHALL be displayed as a nested tree following the same pattern as the main specs tree

### Requirement: Click artifact file to edit
Clicking an artifact file node (proposal.md, design.md, tasks.md, or spec.md) SHALL open it in the editor panel.

#### Scenario: Open change artifact
- **WHEN** user clicks on a proposal.md, design.md, or tasks.md node under a change
- **THEN** the system SHALL open the file content in the editor panel for viewing and editing
