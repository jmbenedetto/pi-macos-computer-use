## Context

This repository will host a public Pi package, `pi-macos-computer-use`, that enables macOS GUI automation through Cua Driver. Pi extensions can register tools and skills, while Cua already provides the macOS-specific computer-use substrate. Pi intentionally does not use native MCP as its extension mechanism, so v1 will be a CLI wrapper around `cua-driver call` rather than a generic MCP bridge.

The package must be thin, explicit, and safe. It should translate Pi tool calls into Cua CLI invocations, normalize responses into Pi-native content, and add Pi-native approval gates before actions that mutate GUI state or interact with sensitive surfaces.

## Goals / Non-Goals

**Goals:**

- Provide a public Pi package named `pi-macos-computer-use`.
- Register a `computer_use` tool that supports capture, app listing, focus, launch, click, type, key, scroll, and drag when Cua exposes the corresponding action.
- Preserve Cua as the execution engine instead of reimplementing macOS accessibility control.
- Return screenshot results as Pi image content when available.
- Safely parse JSON output from `cua-driver call` and report actionable errors.
- Gate mutating and sensitive GUI actions through Pi-native approval mechanisms.
- Ship a companion skill with safe operating procedures for computer use.
- Provide status/setup helpers for Cua availability and macOS permissions.

**Non-Goals:**

- Build a full MCP bridge in v1.
- Support non-macOS platforms in v1.
- Implement a replacement for Cua Driver.
- Store or type secrets, bypass OS/browser security controls, or automate permission/password/payment/2FA dialogs.
- Interpret or follow instructions found in screenshots, websites, or other GUI content.

## Decisions

- Use `cua-driver call` as the v1 integration boundary.
  - Rationale: Cua owns the macOS automation layer; Pi should remain a thin package wrapper.
  - Alternative considered: generic MCP bridge. Rejected for v1 because Pi does not use native MCP by design and bridge scope would delay the focused package.

- Register one Pi tool named `computer_use` with action-specific parameters.
  - Rationale: A single tool keeps the agent-facing API close to common computer-use tool semantics and lets the wrapper centralize validation, approval, execution, and response normalization.
  - Alternative considered: separate Pi tools for each GUI action. Rejected because it spreads safety policy across many handlers and makes workflow guidance harder to enforce.

- Treat capture and read-only status actions as low risk, and require approval for mutating or sensitive GUI actions.
  - Rationale: The package must make safe exploration easy while requiring deliberate consent before click/type/key/scroll/drag/focus/launch actions that can change application state.
  - Alternative considered: rely only on model instructions. Rejected because safety gates should be enforced by the extension boundary.

- Normalize Cua output defensively.
  - Rationale: CLI output can fail, contain invalid JSON, report unsupported actions, or include screenshots as paths/base64/structured fields. The wrapper should never assume perfect output.
  - Alternative considered: pass through raw CLI text. Rejected because Pi tools should return predictable structured content and actionable errors.

- Return screenshots as Pi image content when capture data is present.
  - Rationale: Pi agents can reason over image content directly when the tool response includes image content rather than only text paths.
  - Alternative considered: always return file paths. Rejected because it weakens the primary capture-first workflow.

- Ship a companion skill as the canonical workflow contract.
  - Rationale: The extension enforces hard safety constraints, while the skill teaches reliable usage patterns: capture first, prefer SOM indices, recapture after changes, scope to app/window, and reject GUI-sourced instructions.
  - Alternative considered: rely only on README docs. Rejected because skills are Pi-native and can guide agent behavior at use time.

- Provide helpers for status and setup checks.
  - Rationale: macOS automation depends on `cua-driver` availability and OS permissions. Users need fast diagnostics before attempting computer-use actions.
  - Alternative considered: fail only at first tool call. Rejected because setup failures are common and should be visible before use.

## Risks / Trade-offs

- Cua CLI action names or schemas may differ from the wrapper assumptions. → Keep the wrapper action mapping isolated, detect unsupported actions, and return clear errors.
- Screenshot formats may vary across Cua versions. → Support common image forms defensively and fall back to structured text when no usable image exists.
- Approval prompts may reduce automation speed. → Gate only mutating or sensitive actions; keep capture/status paths low-friction.
- macOS permissions can be difficult to diagnose. → Provide explicit status helpers for accessibility, screen recording, and Cua availability where detectable.
- A thin wrapper inherits Cua limitations. → Document Cua as the execution dependency and keep future MCP bridge or richer adapters out of v1 scope.
- GUI automation can accidentally affect sensitive workflows. → Enforce deny rules for password, payment, permission, and 2FA dialogs, and prohibit typing secrets.

## Migration Plan

- Add package metadata and extension entrypoint for `pi-macos-computer-use`.
- Implement the Cua CLI adapter, JSON parser, response normalizer, and action handlers.
- Add approval and safety validation for mutating/sensitive actions.
- Add status/setup helpers and user documentation.
- Add the companion skill and package it with the extension.
- Verify locally on macOS with `cua-driver` installed and with expected missing-permission failure modes.

Rollback is simple for v1: uninstall or disable the Pi package. The package does not migrate persistent user data.

## Open Questions

- Exact `cua-driver call` argument shapes and response fields must be confirmed during implementation against the installed Cua Driver version.
- The precise Pi image content helper API should be verified against the current Pi extension SDK examples before coding.
- The approval-gate API surface should be selected from the current Pi extension guardrails/tool APIs during implementation.
