## Context

The first version of `pi-macos-computer-use` created a safe Pi package shell around Cua Driver, but its adapter treats the Pi action name as the raw Cua tool name. That is incompatible with current Cua Driver: `capture`, `type`, `key`, `focus`, and `launch` are wrapper concepts, while raw Cua exposes tools such as `list_windows`, `get_window_state`, `screenshot`, `type_text`, `press_key`, `hotkey`, and `launch_app`.

Hermes solves this by exposing a model-facing `computer_use` API and translating it to Cua raw tools in a backend layer. Our investigation confirmed that Cua MCP and `cua-driver call` share the same raw tool handlers; the difference is not MCP naming, but Hermes' translation layer. We also tested real Cua behavior on macOS: Cua can read and manipulate current-Space usable windows without foregrounding them, but off-Space, hidden, minimized, or Stage Manager thumbnail windows may yield only screenshots or menu-bar-only AX trees.

The design must preserve Pi's stricter safety posture while adopting the Hermes-style public API and adapter architecture.

## Goals / Non-Goals

**Goals:**
- Expose a Hermes-compatible public `computer_use` action vocabulary in Pi.
- Translate public actions to current Cua Driver CLI tools instead of forwarding action names directly.
- Preserve Pi-native safety gates and improve provenance by binding actions to recent capture context.
- Make background-control behavior explicit and testable.
- Update the companion skill so agents use the new API correctly and avoid foregrounding fallbacks.
- Improve diagnostics for daemon/permission state using Cua's real permission tools where available.

**Non-Goals:**
- Do not implement a generic MCP bridge in this change.
- Do not replace Cua Driver or reimplement macOS Accessibility/SkyLight behavior.
- Do not guarantee control of off-Space, minimized, hidden, or Stage Manager thumbnail windows when Cua returns only partial state.
- Do not silently use `open -a`, URL deep links, or other foregrounding mechanisms to make an app controllable.
- Do not remove all compatibility aliases immediately if they can be supported safely.

## Decisions

### Decision: Use a Hermes-style adapter layer, not raw Cua passthrough

The Pi tool SHALL expose wrapper actions such as `capture`, `type`, and `key`, then translate those actions to raw Cua tools. Direct passthrough caused the observed `Unknown tool: capture` failure because `capture` is not a raw Cua tool.

Alternatives considered:
- Expose raw Cua tools directly. Rejected because it makes the agent API less stable, loses Hermes compatibility, and pushes window-resolution boilerplate into model prompts.
- Keep current passthrough and rename actions to raw Cua names. Rejected because the user wants Hermes-compatible names and because Pi's safety/provenance layer benefits from high-level actions.

### Decision: Keep CLI transport but parse Cua response shapes intentionally

The v1 package should continue using `cua-driver call` as the integration boundary. Cua documentation states that CLI calls run the same handlers as MCP. However, image and structured responses differ at the transport/formatting layer, so the adapter should use `--raw` or `--screenshot-out-file`/explicit screenshot file fields where needed.

Alternatives considered:
- Switch to MCP stdio like Hermes. Deferred because v1 is explicitly CLI-based and Pi has its own extension mechanism. This can be revisited if raw MCP content handling is materially cleaner.

### Decision: `capture` maps to window resolution plus state capture

`capture(mode="som", app?)` SHALL:
1. Use `list_windows` to resolve candidate windows.
2. Prefer current-Space, on-screen, layer-0 windows matching the requested app when app is provided.
3. Call `get_window_state(pid, window_id)` for `som`/semantic capture.
4. Call `screenshot(window_id)` for image-only capture when appropriate.
5. Return normalized text/image content plus target metadata and a `recentCaptureId`.

The adapter SHOULD warn when Cua returns only menu-bar/low-element state or when the target is off-Space/hidden/minimized/thumbnail-like.

### Decision: Treat coordinates as latest-capture image coordinates

Testing confirmed that raw Cua pixel clicks use window-local screenshot pixels, not macOS global screen coordinates. The public API may retain Hermes' `coordinate` field, but the Pi skill and schema SHALL define it as coordinates in the latest capture image/window coordinate frame. Element indices remain preferred.

Alternatives considered:
- Emulate global screen coordinates. Rejected for this change because it requires additional translation, scale, and bounds handling and increases risk of wrong-target clicks.
- Copy Hermes wording exactly. Rejected because it is ambiguous/stale relative to observed Cua behavior.

### Decision: Recent capture context is a first-class state object

The extension SHALL store bounded recent capture records, not just opaque IDs. Each record SHOULD include:
- `recentCaptureId`.
- `pid`.
- `windowId`.
- app name/bundle identifier where available.
- window title where available.
- capture mode.
- element count.
- issued timestamp.

Mutating actions that rely on element indices or coordinates SHOULD validate against this context. `targetDescription` remains required for mutating actions because provenance is not semantic intent.

### Decision: `focus_app` selects target context by default

Hermes' `focus_app` should map to target selection, not user-visible foregrounding. The adapter should resolve an app/window and store it as active context. It MUST NOT use `open -a` or URL deep links as an implicit fallback. Any foregrounding action must be explicit and separately approved.

### Decision: Preserve stronger Pi safety controls

Hermes has approval and hard-block rules, but Pi's package already added stricter safety controls. This change should keep and adapt them:
- Approval before mutating GUI actions.
- First/unscoped capture approval as privacy-sensitive.
- Required `targetDescription` for mutating actions.
- Sensitive-surface refusal.
- Secret/credential/OTP typing refusal.
- Sanitized approval prompts.
- Redacted diagnostics.
- Screenshot path/data validation.

### Decision: Update skill to teach tested behavior, not idealized behavior

The skill SHALL explain that Cua background control works best for normal current-Space windows that provide a full AX tree. It SHALL instruct agents not to foreground apps unless the user asks, not to use `open -a` as fallback, and to report partial/off-Space/thumbnail states honestly.

## Risks / Trade-offs

- Cua raw tool availability may vary by version. → Query available tools or keep mapping isolated with clear unsupported-tool errors and tests against the installed stable CLI.
- `cua-driver call` image formatting differs from MCP. → Use raw/file-output paths for image capture and test both success and no-image cases.
- Background control may fail for off-Space, minimized, hidden, or Stage Manager thumbnail windows. → Detect low-quality capture/state and return warnings instead of foregrounding silently.
- Coordinates can still be dangerous. → Require recent capture context, prefer elements, and document coordinate frame precisely.
- More stateful adapter logic increases complexity. → Keep state bounded, explicit, and covered by unit tests.
- Maintaining Hermes compatibility plus old Pi aliases can confuse users. → Document Hermes names as primary; keep aliases only where unambiguous and safe.

## Migration Plan

- Add the translation layer behind the existing Pi tool registration.
- Update schema to Hermes-compatible public names while preserving safe aliases where possible.
- Update tests before behavior changes to pin expected raw Cua command calls.
- Update skill and README in the same change so runtime behavior and instructions stay aligned.
- Keep current package install path and package metadata unchanged.
- Rollback strategy: revert to previous direct-passthrough implementation if translation layer causes regressions, though current passthrough is known incompatible with Cua 0.2.0 for several actions.

## Open Questions

- Should the adapter support `capture(mode="ax")` by changing Cua persistent `capture_mode`, passing a mode if future Cua supports it per call, or treating it as `get_window_state` with image ignored?
- Should `launch_app` be added as a documented action, or should `launch` remain an alias only?
- Should the adapter expose `list_windows` as a public action for expert/debug use, even if Hermes' public schema does not include it?
- Should foregrounding be supported as an explicit action in this package, or kept out of scope for safety?
