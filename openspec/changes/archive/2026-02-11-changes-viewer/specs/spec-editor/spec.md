## MODIFIED Requirements

### Requirement: View spec markdown content
The system SHALL display the full markdown content of a selected .md file (spec.md or any change artifact) in a readable format.

#### Scenario: View spec content
- **WHEN** user selects a spec or artifact file (from tree or canvas)
- **THEN** the editor panel SHALL display the full markdown content of the file in a text editor

### Requirement: Save spec changes to local file
The system SHALL write edited content back to the original .md file using the File System Access API writable stream.

#### Scenario: Save edited file
- **WHEN** user clicks the save button after editing any .md file
- **THEN** the system SHALL write the updated content to the local file and display a success confirmation
