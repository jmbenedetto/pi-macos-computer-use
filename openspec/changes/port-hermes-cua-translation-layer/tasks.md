## 1. Baseline and Test Harness

- [x] 1.1 Add unit tests proving wrapper actions are not forwarded directly to raw Cua names (`capture`, `type`, `key`, `focus`, `launch`).
- [x] 1.2 Add unit tests for Hermes-compatible action schema and compatibility aliases.
- [x] 1.3 Add Cua command-runner fixtures for JSON output, raw MCP-style output, human-readable errors, and screenshot file output.
- [x] 1.4 Add tests for capture context storage, expiry/bounded retention, and invalid/mismatched `recentCaptureId` rejection.
- [x] 1.5 Add tests documenting coordinate semantics as latest-capture image/window coordinates.

## 2. Hermes-Compatible Public API

- [x] 2.1 Update the Pi tool schema to expose Hermes-compatible actions: `capture`, `click`, `double_click`, `right_click`, `middle_click`, `drag`, `scroll`, `type`, `key`, `set_value`, `wait`, `list_apps`, and `focus_app`.
- [x] 2.2 Add public fields used by Hermes-style actions: `mode`, `app`, `element`, `coordinate`, `from_element`, `to_element`, `from_coordinate`, `to_coordinate`, `button`, `modifiers`, `keys`, `seconds`, `value`, and `capture_after` where supported.
- [x] 2.3 Preserve safe aliases for existing Pi fields/actions (`elementIndex`, `windowId`, `focus`, `launch`) or return explicit unsupported-alias errors where aliasing is unsafe.
- [x] 2.4 Update approval prompt construction to display Hermes-compatible fields and resolved target context.

## 3. Cua Translation Layer

- [x] 3.1 Replace direct action passthrough with an isolated action-to-Cua translation layer.
- [x] 3.2 Implement `capture` translation through `list_windows` plus `get_window_state` for semantic/SOM capture.
- [x] 3.3 Implement image-only capture through Cua `screenshot` and validated screenshot file handling.
- [x] 3.4 Implement `type` translation to detected Cua text insertion support, targeting the active/recent capture process.
- [x] 3.5 Implement `key` translation that chooses `press_key` for single keys and `hotkey` for modifier combinations.
- [x] 3.6 Implement `click`, `double_click`, `right_click`, and `middle_click` translation using element indices or latest-capture coordinates.
- [x] 3.7 Implement `scroll`, `drag`, and `set_value` translation using Cua-supported argument shapes and target context.
- [x] 3.8 Implement `focus_app` as non-foregrounding target selection via `list_windows`.
- [x] 3.9 Implement `launch_app`/launch alias through Cua `launch_app` only, without `open -a`.
- [x] 3.10 Implement `wait` locally without invoking Cua.

## 4. Capture Context and Target Resolution

- [x] 4.1 Add a capture context store keyed by random `recentCaptureId` with `pid`, `windowId`, app/window metadata, mode, element count, and timestamp.
- [x] 4.2 Bind element-index actions to the matching stored capture context.
- [x] 4.3 Require valid capture context for coordinate-based actions.
- [x] 4.4 Prefer current-Space, on-screen, layer-0 windows when resolving captures and focus targets.
- [x] 4.5 Detect and warn on menu-bar-only, low-element, off-Space, minimized, hidden, or Stage Manager thumbnail-like states.
- [x] 4.6 Ensure failed/partial captures do not issue misleading full-control context.

## 5. CLI Response Normalization and Diagnostics

- [x] 5.1 Update Cua CLI invocation to use raw output or screenshot file output where needed for reliable structured/image handling.
- [x] 5.2 Normalize Cua `structuredContent`, text content, image content, screenshot file paths, and human-readable failures into Pi tool results.
- [x] 5.3 Keep screenshot path/data validation, image magic-byte validation, size limits, and diagnostic redaction.
- [x] 5.4 Improve status command to use `cua-driver call check_permissions` when available.
- [x] 5.5 Detect daemon/permission attribution issues and report actionable guidance.
- [x] 5.6 Keep non-macOS and missing-dependency failures fail-closed.

## 6. Safety and Approval Preservation

- [x] 6.1 Preserve approval gates for mutating actions and privacy-sensitive captures.
- [x] 6.2 Keep `targetDescription` required for mutating actions even when a recent capture context is supplied.
- [x] 6.3 Preserve sensitive-surface blocking for permission, password, payment, 2FA/MFA/OTP, verification-code, Touch ID, and Face ID surfaces.
- [x] 6.4 Preserve secret/credential/OTP typing blocks for `type` actions.
- [x] 6.5 Preserve sanitized approval prompts to prevent newline/control/ANSI/bidi injection.
- [x] 6.6 Ensure no safety path silently falls back to foregrounding an app.

## 7. Skill and Documentation Updates

- [x] 7.1 Update `skills/macos-computer-use/SKILL.md` to teach the Hermes-compatible API names and fields.
- [x] 7.2 Update the skill to define coordinates as latest-capture image/window coordinates, not global screen coordinates.
- [x] 7.3 Update the skill to explain Cua background-control limits for off-Space, minimized, hidden, and Stage Manager thumbnail windows.
- [x] 7.4 Update the skill to prohibit `open -a`, URL deep links, or foregrounding fallbacks unless the user explicitly requests foregrounding.
- [x] 7.5 Update the skill daemon/permissions section with `cua-driver status`, `cua-driver call check_permissions`, and daemon restart guidance.
- [x] 7.6 Update README examples and troubleshooting to match the new translation layer and tested Cua behavior.

## 8. Verification

- [x] 8.1 Run unit tests and typecheck.
- [x] 8.2 Manually verify `capture(app="Microsoft Teams")` no longer invokes raw Cua `capture` and returns usable context when the window is current-Space/usable.
- [x] 8.3 Manually verify `type`, `key`, and `click(element)` translate to the expected Cua raw tools.
- [x] 8.4 Manually verify Cua background actions do not foreground the target app when using supported background primitives.
- [x] 8.5 Manually verify off-Space/hidden/minimized or partial AX states return warnings instead of silently foregrounding.
- [x] 8.6 Run OpenSpec validation for the change.
