## ADDED Requirements

### Requirement: Parse changes directory
The system SHALL read the `openspec/changes` directory and identify all subdirectories (excluding `archive`) as active change entities.

#### Scenario: Load active changes
- **WHEN** the openspec directory is loaded
- **THEN** the system SHALL enumerate all subdirectories under `changes/` (excluding `archive`) and create a change entity for each

### Requirement: Parse archive directory
The system SHALL read the `openspec/changes/archive` directory and identify all subdirectories as archived change entities.

#### Scenario: Load archived changes
- **WHEN** the openspec directory is loaded
- **THEN** the system SHALL enumerate all subdirectories under `changes/archive/` and mark them as archived changes

### Requirement: Parse change artifacts
For each change directory, the system SHALL detect and store file handles for: `proposal.md`, `design.md`, `tasks.md`, and a `specs/` subdirectory containing spec files.

#### Scenario: Change with all artifacts
- **WHEN** a change directory contains proposal.md, design.md, tasks.md, and specs/
- **THEN** the system SHALL store file handles for each artifact and recursively parse the specs subdirectory

#### Scenario: Change with partial artifacts
- **WHEN** a change directory is missing some artifact files (e.g., no design.md yet)
- **THEN** the system SHALL still load the change and only store handles for existing artifacts
