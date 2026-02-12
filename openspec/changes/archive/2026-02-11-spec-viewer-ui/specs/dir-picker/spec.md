## ADDED Requirements

### Requirement: Select openspec directory via browser
The system SHALL provide a button that invokes the browser File System Access API (`showDirectoryPicker`) to let the user select a local directory.

#### Scenario: User selects a valid openspec directory
- **WHEN** user clicks the "Open Directory" button and selects a directory containing a `specs` subdirectory
- **THEN** the system SHALL read the `specs` subdirectory recursively and build an in-memory file tree structure

#### Scenario: User selects an invalid directory
- **WHEN** user clicks the "Open Directory" button and selects a directory that does not contain a `specs` subdirectory
- **THEN** the system SHALL display an error message indicating the directory is not a valid openspec directory

### Requirement: Parse specs directory hierarchy
The system SHALL recursively traverse the `specs` subdirectory and produce a tree data structure where each node is either a directory or a `spec.md` file.

#### Scenario: Nested directory structure
- **WHEN** the specs directory contains nested subdirectories with spec.md files at leaf positions
- **THEN** the system SHALL produce a tree with directory nodes as branches and spec.md files as leaf nodes, preserving the original hierarchy

### Requirement: Read spec.md file content
The system SHALL read the text content of any `spec.md` file on demand using the File System Access API file handle.

#### Scenario: User requests spec content
- **WHEN** a spec.md leaf node is accessed
- **THEN** the system SHALL read and return the full markdown text content of that file
