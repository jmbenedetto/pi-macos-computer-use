## Why

Pi users need a macOS computer-use capability that can drive real desktop applications while staying aligned with Pi's extension model. Hermes-style background computer use is currently best served by Cua Driver, so v1 should provide a thin, Pi-native wrapper around the Cua CLI rather than introducing a broad MCP bridge.

## What Changes

- Add a public Pi package named `pi-macos-computer-use` that registers a `computer_use` tool.
- Shell out to `cua-driver call` for supported macOS GUI actions: capture, list apps, focus, launch, click, type, key, scroll, and drag where exposed by Cua.
- Return screenshots as Pi image content when capture responses include image data or image paths.
- Parse Cua JSON output safely and surface structured errors for invalid JSON, command failures, missing Cua, and unsupported actions.
- Add Pi-native approval gates before mutating or sensitive GUI actions.
- Add an accompanying skill that documents the canonical safe workflow for macOS computer use.
- Add installer/status commands or command helpers for checking `cua-driver` availability and macOS permissions.
- Keep v1 macOS-only and Cua CLI-based; generic MCP bridging remains a separate future option.

## Capabilities

### New Capabilities
- `macos-computer-use`: Pi extension package behavior for invoking Cua Driver through a `computer_use` tool, returning captures, gating risky actions, and exposing setup/status helpers.
- `macos-computer-use-safety-workflow`: Skill guidance for safe and reliable use of the macOS computer-use tool.

### Modified Capabilities

## Impact

- Adds a new public Pi package in this repository.
- Adds extension registration and tool implementation for `computer_use`.
- Adds command helpers for installation/status/permission checks.
- Adds skill documentation shipped with the package.
- Introduces runtime dependency on the external `cua-driver` CLI for v1 macOS operation.
