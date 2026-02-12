## ADDED Requirements

### Requirement: Canvas with free-form card layout
The system SHALL render a canvas area in the right panel where cards (directory cards and spec cards) can be freely positioned by dragging.

#### Scenario: Initial canvas display
- **WHEN** a valid openspec directory is loaded
- **THEN** the canvas SHALL display cards representing the top-level items in the specs directory, auto-laid out in a grid

### Requirement: Drag cards to reposition
The system SHALL allow users to drag any card on the canvas to a new position. Card positions SHALL be maintained during the session.

#### Scenario: Drag a card
- **WHEN** user clicks and drags a card on the canvas
- **THEN** the card SHALL move with the cursor and stay at the released position

### Requirement: Directory card expansion
A directory card SHALL be expandable to show its child cards (subdirectories and spec files) on the canvas.

#### Scenario: Expand a directory card
- **WHEN** user double-clicks a directory card
- **THEN** the canvas SHALL display child cards for that directory's contents, positioned near the parent card

### Requirement: Spec card shows preview
A spec card SHALL display the spec name and a brief preview of the spec.md content (first few lines).

#### Scenario: Spec card content preview
- **WHEN** a spec card is rendered on the canvas
- **THEN** the card SHALL show the spec name as title and the first 3 lines of the spec.md content as preview text

### Requirement: Click spec card to open editor
The system SHALL open the spec editor when a user clicks on a spec card.

#### Scenario: Open editor from canvas
- **WHEN** user clicks on a spec card on the canvas
- **THEN** the system SHALL open the spec editor panel with the full content of that spec.md
