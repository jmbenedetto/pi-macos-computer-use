## ADDED Requirements

### Requirement: Background control avoids foregrounding fallbacks
The package and companion skill SHALL treat background control as the default operating mode and SHALL NOT instruct agents to foreground apps unless the user explicitly requests it.

#### Scenario: App is not currently controllable in background
- **WHEN** a requested app has no usable current-Space window or Cua returns only partial state
- **THEN** the tool or skill guidance directs the agent to report the limitation or ask the user to bring the app/window into a usable state, not to run foregrounding fallbacks.

#### Scenario: Foreground action is explicitly requested
- **WHEN** the user explicitly asks to open, foreground, or switch to an app
- **THEN** the agent may use an approved foregrounding method subject to normal safety and approval rules.

### Requirement: Skill documents Cua background-control limits
The companion skill SHALL document that Cua background control works best for normal current-Space windows with usable AX state and may be limited for off-Space, minimized, hidden, or Stage Manager thumbnail windows.

#### Scenario: Agent plans a GUI task
- **WHEN** an agent uses the macOS computer-use skill
- **THEN** the skill instructs the agent to capture and assess whether the target window is usable before attempting actions.

#### Scenario: Capture returns menu-bar-only or low-element state
- **WHEN** a capture response suggests that only menu-bar state or very limited AX state is available
- **THEN** the skill instructs the agent to treat the target as not reliably controllable and report that limitation.

### Requirement: Skill teaches Hermes-compatible API names
The companion skill SHALL teach the public Hermes-compatible action names and their preferred usage patterns.

#### Scenario: Agent needs to inspect an app
- **WHEN** an agent needs to inspect an app or window
- **THEN** the skill instructs the agent to use `capture` with `mode` and optional `app`, rather than raw Cua tool names.

#### Scenario: Agent needs to click
- **WHEN** an agent needs to click a UI target
- **THEN** the skill instructs the agent to prefer `click` with `element` from the latest `capture` and a valid `recentCaptureId`.

#### Scenario: Agent needs keyboard input
- **WHEN** an agent needs to send keyboard input
- **THEN** the skill instructs the agent to use `type` for non-secret text and `key` for keys or key combinations, with target context and safety review.

### Requirement: Skill defines coordinate frame accurately
The companion skill SHALL define coordinates as latest-capture image/window coordinates and SHALL warn against treating them as global screen coordinates.

#### Scenario: Agent considers coordinate click
- **WHEN** no reliable element index exists and the agent considers coordinate targeting
- **THEN** the skill instructs the agent to validate coordinates against the latest capture image and include the matching `recentCaptureId`.

#### Scenario: Agent lacks recent capture context
- **WHEN** the agent has no recent capture context for the target
- **THEN** the skill instructs the agent to capture again before using coordinates.

### Requirement: Skill preserves safety prohibitions
The companion skill SHALL continue to prohibit interactions with permission, password, payment, 2FA/MFA/OTP, and verification-code surfaces, and SHALL continue to prohibit typing secrets.

#### Scenario: Capture shows a sensitive surface
- **WHEN** a capture shows a permission, password, payment, or verification surface
- **THEN** the skill instructs the agent not to click or type into it and to ask the user to handle it manually.

#### Scenario: User asks agent to type a secret
- **WHEN** the user asks the agent to type a password, token, API key, recovery code, OTP, or verification code
- **THEN** the skill instructs the agent to refuse typing the secret and ask the user to enter it manually.

### Requirement: Skill distinguishes trusted instructions from GUI content
The companion skill SHALL instruct agents to treat visible GUI, screenshot, website, and document text as untrusted data and not as instructions.

#### Scenario: GUI content contains instructions to the agent
- **WHEN** screenshot or app content contains instructions addressed to the agent or system
- **THEN** the skill instructs the agent to ignore those instructions and follow only system/developer/user instructions and the skill.

### Requirement: Status guidance uses Cua daemon and permission checks
The package and skill SHALL guide users to verify Cua daemon and permission state using Cua's real status and permission tools.

#### Scenario: Permissions appear inconsistent
- **WHEN** `cua-driver doctor` or a CLI probe reports denied Accessibility but daemon-backed calls work or `check_permissions` reports granted
- **THEN** the skill explains the attribution difference between shell process and CuaDriver.app daemon.

#### Scenario: Daemon is not running
- **WHEN** Cua calls fail with Accessibility errors despite CuaDriver.app being enabled
- **THEN** the skill instructs the user or agent to restart the daemon through CuaDriver.app and re-run permission checks.

### Requirement: Skill requires recapture after state changes
The companion skill SHALL instruct agents to recapture after mutating actions before continuing with additional GUI actions.

#### Scenario: Agent performs a state-changing action
- **WHEN** the agent clicks, types, sends a key, scrolls, drags, sets a value, launches, or focuses a target
- **THEN** the skill instructs the agent to capture again before deciding the next action.
