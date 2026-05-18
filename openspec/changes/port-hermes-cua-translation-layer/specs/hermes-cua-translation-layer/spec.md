## ADDED Requirements

### Requirement: Public API uses Hermes-compatible actions
The `computer_use` tool SHALL expose Hermes-compatible action names as the primary public API: `capture`, `click`, `double_click`, `right_click`, `middle_click`, `drag`, `scroll`, `type`, `key`, `set_value`, `wait`, `list_apps`, and `focus_app`.

`launch_app` MAY be exposed as a package-specific launch action and `launch` MAY be accepted as a compatibility alias, but neither is part of the primary Hermes-compatible action set.

#### Scenario: Agent sees Hermes-compatible actions
- **WHEN** the Pi extension registers the `computer_use` tool
- **THEN** the tool schema includes the Hermes-compatible action names.

#### Scenario: Compatibility aliases are accepted only when safe
- **WHEN** an agent invokes a legacy alias such as `focus`, `launch`, `elementIndex`, or `windowId`
- **THEN** the extension either maps the alias to the corresponding Hermes-style field/action or returns a clear unsupported-alias error without invoking Cua.

### Requirement: Wrapper actions are translated to raw Cua tools
The extension SHALL translate wrapper-level `computer_use` actions to current raw Cua Driver tools instead of forwarding wrapper action names directly to `cua-driver call`.

#### Scenario: Capture is not forwarded as raw capture
- **WHEN** an agent invokes `computer_use` with `action` set to `capture`
- **THEN** the extension invokes Cua raw tools such as `list_windows`, `get_window_state`, or `screenshot` and SHALL NOT invoke `cua-driver call capture`.

#### Scenario: Type action maps to Cua text insertion
- **WHEN** an agent invokes `computer_use` with `action` set to `type`
- **THEN** the extension invokes the Cua raw text insertion tool supported by the detected driver, such as `type_text`, with the selected target process context.

#### Scenario: Key action maps to press key or hotkey
- **WHEN** an agent invokes `computer_use` with `action` set to `key` and the key string contains modifiers
- **THEN** the extension invokes Cua `hotkey` with an ordered key list.

#### Scenario: Single key maps to press key
- **WHEN** an agent invokes `computer_use` with `action` set to `key` and the key string contains no modifiers
- **THEN** the extension invokes Cua `press_key` with the target key.

#### Scenario: Launch maps to Cua launch app
- **WHEN** an agent invokes a supported launch action
- **THEN** the extension invokes Cua `launch_app` and SHALL NOT shell out to `open -a`.

### Requirement: Capture resolves a target window
The `capture` action SHALL resolve a target app/window before capturing state, using Cua `list_windows` and app/window filters when provided.

#### Scenario: Capture with app selects matching usable window
- **WHEN** an agent invokes `capture` with an app name or bundle identifier
- **THEN** the extension searches Cua window records for a matching current-Space, on-screen, layer-0 window and uses that window for capture when available.

#### Scenario: Capture without app selects a visible target
- **WHEN** an agent invokes `capture` without an app or window identifier
- **THEN** the extension selects a current-Space visible window using deterministic window ordering and returns metadata for the selected target.

#### Scenario: No usable window is available
- **WHEN** no matching usable window is available for a requested capture
- **THEN** the extension returns a structured warning or error explaining that the app/window is unavailable for background control without foregrounding the app.

### Requirement: Capture returns Pi-native content and metadata
The `capture` action SHALL normalize Cua output into Pi-native text/image content and structured metadata.

#### Scenario: SOM capture returns tree and image
- **WHEN** Cua `get_window_state` returns AX tree data and image content or an image file path
- **THEN** the tool response includes a text summary, Pi image content when available, target metadata, and a recent capture identifier.

#### Scenario: AX-only or partial capture returns warning
- **WHEN** Cua returns AX state without usable image content or returns only low-quality/menu-bar state
- **THEN** the tool response includes the available structured state plus a warning describing the limitation.

#### Scenario: Image-only capture returns screenshot
- **WHEN** an agent requests image-only capture mode
- **THEN** the extension invokes Cua `screenshot` for the selected window and returns the screenshot as Pi image content when available.

### Requirement: Recent capture context binds follow-up actions
The extension SHALL store bounded recent capture context records and use them to validate follow-up actions.

#### Scenario: Successful capture issues context id
- **WHEN** a capture succeeds
- **THEN** the extension stores a recent capture record containing `pid`, `windowId`, app/window metadata, capture mode, element count, and timestamp, and returns its `recentCaptureId`.

#### Scenario: Element action uses matching capture context
- **WHEN** an agent invokes `click` with an element index and `recentCaptureId`
- **THEN** the extension uses the stored `pid` and `windowId` from the capture context when invoking Cua `click` with `element_index`.

#### Scenario: Invalid capture context is rejected
- **WHEN** an agent supplies an unknown, expired, or mismatched `recentCaptureId`
- **THEN** the extension returns an invalid-capture-context error without invoking Cua.

### Requirement: Coordinate actions use latest capture image coordinates
The extension SHALL define `coordinate`, `from_coordinate`, and `to_coordinate` as coordinates in the latest capture image/window coordinate frame, not global macOS screen coordinates.

#### Scenario: Coordinate click requires recent capture
- **WHEN** an agent invokes `click` with coordinates
- **THEN** the extension requires a valid recent capture context and sends Cua window-local screenshot coordinates for that captured target.

#### Scenario: Global coordinate ambiguity is avoided
- **WHEN** an agent attempts coordinate-based action without a recent capture context
- **THEN** the extension refuses the action and instructs the agent to capture first or use an element index.

### Requirement: Focus app selects target without foregrounding by default
The `focus_app` action SHALL select and store target app/window context for subsequent actions without bringing the app to the foreground by default.

#### Scenario: Focus app resolves context
- **WHEN** an agent invokes `focus_app` with an app name or bundle identifier
- **THEN** the extension resolves a matching window and stores its target context for later actions.

#### Scenario: Focus app does not use open-a
- **WHEN** `focus_app` cannot find a usable target window
- **THEN** the extension returns a structured warning or error and SHALL NOT invoke `open -a` or URL deep links as an implicit fallback.

### Requirement: Cua CLI transport handles raw and image responses
The extension SHALL handle current Cua CLI response shapes, including structured JSON, raw MCP-style output, human-readable errors, and screenshot file outputs.

#### Scenario: Raw Cua output is parsed safely
- **WHEN** Cua CLI returns raw or structured output
- **THEN** the extension parses the response defensively and returns normalized Pi tool details.

#### Scenario: Screenshot file output is validated
- **WHEN** Cua writes screenshot bytes to a file path
- **THEN** the extension validates the path, size, and image magic bytes before returning Pi image content.

#### Scenario: Human-readable Cua error is preserved safely
- **WHEN** Cua returns a non-JSON error or warning
- **THEN** the extension returns a structured error with redacted diagnostics.
