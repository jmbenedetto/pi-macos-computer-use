## ADDED Requirements

### Requirement: Pi package exposes macOS computer-use tool
The package SHALL register a Pi extension tool named `computer_use` for macOS desktop automation through Cua Driver.

#### Scenario: Tool is available after package installation
- **WHEN** the `pi-macos-computer-use` package is installed and enabled on macOS
- **THEN** Pi exposes a `computer_use` tool to agents.

#### Scenario: Non-macOS platform is rejected
- **WHEN** the `computer_use` tool is invoked on a non-macOS platform
- **THEN** the tool returns an unsupported-platform error without invoking Cua Driver.

### Requirement: Tool delegates supported actions to Cua CLI
The `computer_use` tool SHALL shell out to `cua-driver call` for supported actions and SHALL support capture, list apps, focus, launch, click, type, key, scroll, and drag where Cua exposes equivalent actions.

#### Scenario: Supported action is delegated
- **WHEN** an agent invokes `computer_use` with a supported action and valid parameters
- **THEN** the extension invokes `cua-driver call` with the corresponding Cua action and arguments.

#### Scenario: Unsupported action is rejected
- **WHEN** an agent invokes `computer_use` with an action not supported by the v1 wrapper or the detected Cua capability set
- **THEN** the tool returns an unsupported-action error without attempting GUI automation.

### Requirement: Capture returns Pi image content when available
The `computer_use` capture action SHALL return screenshots as Pi image content when Cua output includes usable image data or a readable image path.

#### Scenario: Capture includes image data
- **WHEN** Cua returns a screenshot as image data or a readable image path
- **THEN** the tool response includes Pi image content for the screenshot.

#### Scenario: Capture lacks image data
- **WHEN** Cua returns a successful capture response without usable image data
- **THEN** the tool response includes the structured capture metadata and a warning that no image content was available.

### Requirement: Cua output is parsed safely
The extension SHALL parse Cua CLI output defensively and SHALL return structured errors for command failure, invalid JSON, missing executable, and unsupported Cua behavior.

#### Scenario: Cua returns valid JSON
- **WHEN** `cua-driver call` exits successfully with valid JSON
- **THEN** the extension returns normalized structured content derived from the JSON.

#### Scenario: Cua returns invalid JSON
- **WHEN** `cua-driver call` exits successfully but emits invalid JSON
- **THEN** the extension returns an invalid-json error that includes safe diagnostic text without crashing.

#### Scenario: Cua command fails
- **WHEN** `cua-driver call` exits with a non-zero status
- **THEN** the extension returns a command-failed error containing the exit code and safe stderr summary.

#### Scenario: Cua executable is missing
- **WHEN** `cua-driver` cannot be found on PATH
- **THEN** the extension returns a missing-dependency error with setup guidance.

### Requirement: Mutating GUI actions require approval
The extension SHALL require Pi-native approval before executing GUI actions that can mutate state or interact with sensitive surfaces.

#### Scenario: Mutating action awaits approval
- **WHEN** an agent requests click, type, key, scroll, drag, focus, or launch
- **THEN** the extension requests Pi-native approval before invoking Cua Driver.

#### Scenario: Approval is denied
- **WHEN** approval for a mutating GUI action is denied
- **THEN** the extension returns an approval-denied result and does not invoke Cua Driver for the action.

### Requirement: Sensitive GUI actions are blocked
The extension SHALL block actions targeting permission, password, payment, or 2FA dialogs and SHALL block attempts to type secrets.

#### Scenario: Sensitive dialog target is detected
- **WHEN** an agent requests an action that targets a permission, password, payment, or 2FA dialog
- **THEN** the extension refuses the action with a sensitive-surface error.

#### Scenario: Secret typing is requested
- **WHEN** an agent requests typing content identified as a secret or credential
- **THEN** the extension refuses the action and does not send text to Cua Driver.

### Requirement: Status helpers diagnose setup
The package SHALL provide installer/status commands or command helpers that check Cua Driver availability and relevant macOS permissions.

#### Scenario: Status check finds Cua
- **WHEN** the status helper runs and `cua-driver` is available
- **THEN** the helper reports the resolved Cua Driver command and version or availability status.

#### Scenario: Status check finds missing permissions
- **WHEN** the status helper detects missing or unverifiable macOS permissions
- **THEN** the helper reports the affected permission category and gives next-step guidance.
