# Logs

- 2026-05-15: Created OpenSpec change `port-hermes-style-macos-background-computer-use-to-pi` with proposal, design, specs, and tasks artifacts.
- 2026-05-15: Implemented `pi-macos-computer-use` package structure, extension tool, Cua CLI adapter, safety gates, status command, companion skill, docs, and tests.
- 2026-05-15: Added `.gitignore` for `node_modules/`, `.agents/tmp/`, and `.DS_Store`.
- 2026-05-15: Implemented adversarial safety fixes: capture approval, unscoped-capture approval, mutating target-context requirement, detailed approval prompts, stricter screenshot validation, secret/OTP typing blocks, and redacted diagnostics.
- 2026-05-15: Fixed security re-review finding by validating recent capture IDs against extension-issued IDs and adding screenshot-path hardening tests.
- 2026-05-17: Fixed PR review findings by requiring `targetDescription` for mutating actions and sanitizing human-facing approval fields.
- 2026-05-17: Addressed CodeRabbit review items: random capture IDs, schema description alignment, peer dependency ranges, redaction label preservation, and strict numeric scope checks.
- 2026-05-17: Created OpenSpec change `port-hermes-cua-translation-layer` to align Pi API with Hermes-style Cua translation and update companion skill guidance.
- 2026-05-17: Backed up files for `port-hermes-cua-translation-layer` implementation under `.agents/tmp/backups/port-hermes-cua-translation-layer/`.
- 2026-05-17: Implemented Hermes-compatible Cua translation layer, capture context store, safety/approval preservation, status diagnostics, docs/skill updates, and tests for `port-hermes-cua-translation-layer`.
- 2026-05-17: Marked code/doc/test OpenSpec tasks for `port-hermes-cua-translation-layer`; then completed live Cua verification with evidence under `.agents/tmp/live-verification/`.
