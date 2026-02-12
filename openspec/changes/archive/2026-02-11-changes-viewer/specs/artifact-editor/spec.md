## ADDED Requirements

### Requirement: Edit any markdown artifact
The editor panel SHALL support viewing and editing any .md file from a change (proposal.md, design.md, tasks.md, spec.md), not just spec.md files.

#### Scenario: Open proposal.md
- **WHEN** user selects a proposal.md file from a change
- **THEN** the editor SHALL display the file content with the title showing the change name and file name

#### Scenario: Open tasks.md
- **WHEN** user selects a tasks.md file from a change
- **THEN** the editor SHALL display the file content and allow editing and saving

### Requirement: Display artifact type in editor header
The editor header SHALL show the artifact type and parent change name for context.

#### Scenario: Editor header for change artifact
- **WHEN** a change artifact is opened in the editor
- **THEN** the header SHALL display the format: `<change-name> / <filename>` with an appropriate icon for the artifact type
