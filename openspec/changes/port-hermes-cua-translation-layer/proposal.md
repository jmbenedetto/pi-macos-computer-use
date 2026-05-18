## Why

The current Pi `computer_use` package exposes Hermes-like action names but forwards them directly to `cua-driver call`, which fails against current Cua Driver because names such as `capture`, `type`, `key`, `focus`, and `launch` are wrapper-level actions rather than raw Cua tools. Recent testing also showed that Cua can control macOS apps in the background only when the target window/state is usable, so the package and skill need a real translation layer plus clearer operating guidance.

## What Changes

- Add a Hermes-style translation layer between Pi's public `computer_use` API and raw Cua Driver CLI tools.
- Align the public Pi API with Hermes action names where practical: `capture`, `click`, `double_click`, `right_click`, `middle_click`, `drag`, `scroll`, `type`, `key`, `set_value`, `wait`, `list_apps`, and `focus_app`.
- Translate wrapper actions to current Cua Driver tools, for example:
  - `capture` -> `list_windows` + `get_window_state` or `screenshot`.
  - `type` -> `type_text`.
  - `key` -> `press_key` or `hotkey`.
  - `launch_app`/launch aliases -> Cua `launch_app`.
  - `focus_app` -> select/store target pid/window context without foregrounding by default.
- Preserve and extend Pi-native safety controls: approval gates, target descriptions, sensitive-surface blocking, secret/OTP typing blocks, recent-capture provenance, screenshot validation, and diagnostic redaction.
- Track richer capture context (`pid`, `windowId`, app/window metadata, mode, element count, issued timestamp) instead of treating `recentCaptureId` as a bare token.
- Update the companion skill to teach the Hermes-compatible API, Cua background-control limits, coordinate semantics, daemon/permission diagnostics, and safe fallback behavior.
- Add runtime behavior around Cua daemon/permission diagnosis using `check_permissions` where possible.
- Avoid foregrounding fallbacks such as `open -a` or Teams deep links unless the user explicitly asks for a foreground action.

## Capabilities

### New Capabilities
- `hermes-cua-translation-layer`: Provides the public Hermes-style `computer_use` API and maps it to raw Cua Driver CLI tools while maintaining target context.
- `macos-background-control-workflow`: Defines reliable background-control behavior, limits, diagnostics, and skill guidance for Cua-backed macOS automation.

### Modified Capabilities
- None. There are no archived baseline specs yet; this change supersedes and refines the completed proposal-era v1 behavior through new specs.

## Impact

- Affected code:
  - `src/computer-use.ts`: action model, Cua command mapping, result normalization, capture context tracking, permission/status handling.
  - `extensions/index.ts`: tool schema/action names, capture context IDs, approval prompts, status command behavior.
  - `skills/macos-computer-use/SKILL.md`: workflow and safety instructions.
  - `tests/computer-use.test.ts`: adapter, safety, coordinate, permission, and response-shape coverage.
  - `README.md`: public API, install/status, and background-control expectations.
- Public API impact:
  - The package should prefer Hermes-compatible action names.
  - Existing aliases such as `focus`, `launch`, `elementIndex`, and `windowId` may remain as compatibility aliases, but the documented API should center on Hermes names and Cua-backed target context.
- Dependency/system impact:
  - Continues to depend on external `cua-driver` CLI on macOS.
  - Must account for current stable Cua Driver behavior where `cua-driver call` and MCP expose the same raw tool names, and where image content may require `--raw`, `--screenshot-out-file`, or explicit file-output handling.
