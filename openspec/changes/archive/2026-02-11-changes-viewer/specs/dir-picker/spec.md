## MODIFIED Requirements

### Requirement: Select openspec directory via browser
The system SHALL provide a button that invokes the browser File System Access API (`showDirectoryPicker`) to let the user select a local openspec root directory. The system SHALL read both the `specs` subdirectory and the `changes` subdirectory (including `changes/archive`).

#### Scenario: User selects a valid openspec directory
- **WHEN** user clicks the "Open Directory" button and selects a directory containing `specs` and/or `changes` subdirectories
- **THEN** the system SHALL read both subdirectories and build an in-memory structure containing the specs tree, active changes, and archived changes

#### Scenario: User selects an invalid directory
- **WHEN** user clicks the "Open Directory" button and selects a directory that contains neither `specs` nor `changes` subdirectory
- **THEN** the system SHALL display an error message indicating the directory is not a valid openspec directory

### Requirement: Parse specs directory hierarchy
The system SHALL recursively traverse the `specs` subdirectory and produce a tree data structure where each node is either a directory or a `spec.md` file.

#### Scenario: Nested directory structure
- **WHEN** the specs directory contains nested subdirectories with spec.md files at leaf positions
- **THEN** the system SHALL produce a tree with directory nodes as branches and spec.md files as leaf nodes, preserving the original hierarchy
