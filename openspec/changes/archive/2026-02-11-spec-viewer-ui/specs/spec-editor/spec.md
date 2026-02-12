## ADDED Requirements

### Requirement: View spec markdown content
The system SHALL display the full markdown content of a selected spec.md file in a readable format.

#### Scenario: View spec content
- **WHEN** user selects a spec (from tree or canvas)
- **THEN** the editor panel SHALL display the full markdown content of the spec.md file in a text editor

### Requirement: Edit spec markdown content
The system SHALL allow users to edit the markdown content of a spec.md file in a text area.

#### Scenario: Edit spec content
- **WHEN** user modifies text in the editor panel
- **THEN** the editor SHALL track the changes and enable a save action

### Requirement: Save spec changes to local file
The system SHALL write edited content back to the original spec.md file using the File System Access API writable stream.

#### Scenario: Save edited spec
- **WHEN** user clicks the save button after editing
- **THEN** the system SHALL write the updated content to the local spec.md file and display a success confirmation

#### Scenario: Save with keyboard shortcut
- **WHEN** user presses Cmd+S (Mac) or Ctrl+S (Windows) while the editor is focused
- **THEN** the system SHALL save the content identical to clicking the save button

### Requirement: Close editor panel
The system SHALL allow users to close the editor panel and return to the canvas/tree view.

#### Scenario: Close editor
- **WHEN** user clicks the close button on the editor panel
- **THEN** the editor panel SHALL close and the canvas/tree view SHALL remain in its previous state
