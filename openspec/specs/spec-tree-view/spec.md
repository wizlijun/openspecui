## MODIFIED Requirements

### Requirement: Display specs as a tree
The system SHALL render a tree view component in the left panel that shows two top-level sections: "Specs" (the specs directory hierarchy) and "Changes" (the changes directory). Directory nodes SHALL be expandable/collapsible.

#### Scenario: Initial tree rendering
- **WHEN** a valid openspec directory is loaded
- **THEN** the left panel SHALL display two sections: "Specs" showing the specs tree, and "Changes" showing active and archived changes

#### Scenario: Expand a directory node
- **WHEN** user clicks on a collapsed directory node
- **THEN** the node SHALL expand to show its children

#### Scenario: Collapse a directory node
- **WHEN** user clicks on an expanded directory node
- **THEN** the node SHALL collapse and hide its children
