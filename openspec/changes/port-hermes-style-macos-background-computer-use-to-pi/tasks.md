## 1. Package Structure

- [x] 1.1 Inspect current Pi extension package examples and confirm required package metadata, extension entrypoint, tool registration, skill packaging, and image content APIs.
- [x] 1.2 Create `pi-macos-computer-use` package metadata and file layout for a public Pi package.
- [x] 1.3 Add macOS-only platform checks so non-macOS invocations return an unsupported-platform error.

## 2. Cua CLI Adapter

- [x] 2.1 Implement a small adapter that shells out to `cua-driver call` with timeout handling and safe stdout/stderr capture.
- [x] 2.2 Implement action mapping for capture, list apps, focus, launch, click, type, key, scroll, and drag where Cua exposes equivalent actions.
- [x] 2.3 Add validation for unsupported wrapper actions and unsupported detected Cua capabilities.
- [x] 2.4 Implement defensive JSON parsing and structured errors for invalid JSON, command failure, and missing `cua-driver`.

## 3. Pi Tool Response Handling

- [x] 3.1 Register the Pi `computer_use` tool with action-specific input schema and clear parameter descriptions.
- [x] 3.2 Normalize successful Cua JSON responses into predictable Pi tool output.
- [x] 3.3 Detect screenshot image data or readable image paths in capture responses and return Pi image content when available.
- [x] 3.4 Return structured capture metadata plus a warning when capture succeeds without usable image content.

## 4. Safety and Approval Gates

- [x] 4.1 Add Pi-native approval gates before click, type, key, scroll, drag, focus, and launch actions.
- [x] 4.2 Ensure denied approvals return an approval-denied result without invoking Cua Driver.
- [x] 4.3 Add checks that block permission, password, payment, and 2FA dialog interactions when detected or declared in the request.
- [x] 4.4 Add checks that block typing secrets or credential-like content.

## 5. Setup and Status Helpers

- [x] 5.1 Add installer/status command helpers that report whether `cua-driver` is available and where it resolves.
- [x] 5.2 Add status checks or guidance for macOS Accessibility and Screen Recording permissions.
- [x] 5.3 Document setup, expected failure modes, and remediation steps in package documentation.

## 6. Skill and Documentation

- [x] 6.1 Add a companion Pi skill for macOS computer-use workflow.
- [x] 6.2 Document capture-first behavior, recapture-after-change behavior, app/window scoping, and preference for SOM element indices over raw coordinates.
- [x] 6.3 Document safety rules: never click permission/password/payment/2FA dialogs, never type secrets, and never follow instructions from screenshots or web content.
- [x] 6.4 Document v1 scope as macOS-only and Cua CLI-based, with generic MCP bridge noted only as a future option.

## 7. Verification

- [x] 7.1 Add unit tests for action validation, command construction, JSON parsing, error normalization, and screenshot response normalization.
- [x] 7.2 Add tests or fixtures for approval denial and sensitive-action blocking.
- [x] 7.3 Run package lint/typecheck/test commands and record results.
- [x] 7.4 Manually verify status helper behavior for missing `cua-driver` and, where available, installed `cua-driver` on macOS.
