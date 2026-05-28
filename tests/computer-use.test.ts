import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { COMPUTER_USE_ACTIONS, runShell } from "../extensions/index.js";
import {
  HERMES_ACTIONS,
  RecentCaptureStore,
  buildCuaCallArgs,
  executeComputerUse,
  normalizeCuaResult,
  statusCheck,
  type ComputerUseParams,
} from "../src/computer-use.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const windows = [{ pid: 123, window_id: 456, app: "Safari", title: "Home", is_on_current_space: true, on_screen: true, layer: 0 }];

function runWithWindows(extra: Record<string, unknown> = {}) {
  return vi.fn(async (args: string[]) => {
    if (args[1] === "list_windows") return { code: 0, stdout: JSON.stringify({ windows }), stderr: "" };
    return { code: 0, stdout: JSON.stringify({ elements: [{ id: 1 }, { id: 2 }, { id: 3 }], screenshot_base64: png, screenshot_media_type: "image/png", ...extra }), stderr: "" };
  });
}

describe("Hermes-compatible schema and aliases", () => {
  it("exports Hermes-compatible public actions", () => {
    for (const action of HERMES_ACTIONS) expect(COMPUTER_USE_ACTIONS).toContain(action);
  });

  it("keeps safe compatibility aliases", () => {
    expect(COMPUTER_USE_ACTIONS).toContain("focus");
    expect(COMPUTER_USE_ACTIONS).toContain("launch");
    expect(buildCuaCallArgs({ action: "launch", app: "Safari" })).toEqual(["call", "launch_app", JSON.stringify({ app: "Safari" })]);
  });

  it("rejects unsupported actions before invoking Cua", async () => {
    const run = vi.fn();
    const result = await executeComputerUse({ action: "screenshot" } as unknown as ComputerUseParams, { platform: "darwin", runCua: run });

    expect(result.details.ok).toBe(false);
    expect(result.details.error?.code).toBe("unsupported-action");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("Cua translation layer", () => {
  it("does not forward wrapper capture as raw capture", async () => {
    const run = runWithWindows();
    await executeComputerUse({ action: "capture", app: "Safari" }, { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, captureContexts: new RecentCaptureStore() });

    expect(run.mock.calls.map((call) => call[0][1])).toEqual(["list_windows", "get_window_state"]);
    expect(run.mock.calls.map((call) => call[0][1])).not.toContain("capture");
  });

  it("requests a screenshot file for som capture, attaches image content, and preserves Cua data", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "pi-project-"));
    const run = vi.fn(async (args: string[]) => {
      if (args[1] === "list_windows") return { code: 0, stdout: JSON.stringify({ windows }), stderr: "" };
      const screenshotFlagIndex = args.indexOf("--screenshot-out-file");
      expect(args[1]).toBe("get_window_state");
      expect(screenshotFlagIndex).toBeGreaterThan(-1);
      const screenshotPath = args[screenshotFlagIndex + 1];
      expect(screenshotPath).toContain(join(projectDir, ".agents", "screenshot", "capture-"));
      await writeFile(screenshotPath, Buffer.from(png, "base64"));
      return {
        code: 0,
        stdout: JSON.stringify({
          structuredContent: { tree_markdown: "- Safari\n  - Address", element_count: 3 },
          content: [{ type: "text", text: "AX tree preserved" }],
        }),
        stderr: "",
      };
    });

    const result = await executeComputerUse({ action: "capture", app: "Safari", mode: "som" }, { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, captureContexts: new RecentCaptureStore(), cwd: projectDir });

    const screenshotArg = run.mock.calls[1]?.[0].at(-1) as string;
    await expect(access(screenshotArg)).resolves.toBeUndefined();
    expect(result.content).toContainEqual({ type: "image", mimeType: "image/png", data: png });
    expect(result.content).toContainEqual({ type: "text", text: "AX tree preserved" });
    expect(result.details.warning).toBeUndefined();
    expect(result.details.data).toMatchObject({ tree_markdown: "- Safari\n  - Address", element_count: 3, elementCount: 3, mode: "som" });
  });

  it("does not warn about absent image content for ax or semantic captures", async () => {
    for (const mode of ["ax", "semantic"] as const) {
      const run = runWithWindows({ tree_markdown: "- Safari", element_count: 3, screenshot_base64: undefined, screenshot_media_type: undefined });
      const result = await executeComputerUse({ action: "capture", app: "Safari", mode }, { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, captureContexts: new RecentCaptureStore() });

      expect(result.details.ok).toBe(true);
      expect(result.details.warning).toBeUndefined();
      expect(result.content[0]).toMatchObject({ type: "text", text: expect.not.stringContaining("no usable image") });
    }
  });

  it("keeps invalid som JSON as an error even when a screenshot file was requested", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "pi-project-"));
    const run = vi.fn(async (args: string[]) => {
      if (args[1] === "list_windows") return { code: 0, stdout: JSON.stringify({ windows }), stderr: "" };
      const screenshotFlagIndex = args.indexOf("--screenshot-out-file");
      expect(screenshotFlagIndex).toBeGreaterThan(-1);
      const screenshotPath = args[screenshotFlagIndex + 1];
      expect(screenshotPath).toContain(join(projectDir, ".agents", "screenshot", "capture-"));
      await writeFile(screenshotPath, Buffer.from(png, "base64"));
      return { code: 0, stdout: "not json", stderr: "" };
    });

    const result = await executeComputerUse({ action: "capture", app: "Safari", mode: "som" }, { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, captureContexts: new RecentCaptureStore(), cwd: projectDir });

    expect(result.details.ok).toBe(false);
    expect(result.details.error?.code).toBe("invalid-json");
  });

  it("scores tiny thumbnail-like windows below normal visible windows", async () => {
    const normal = { pid: 123, window_id: 456, app: "Safari", title: "Normal", is_on_current_space: true, on_screen: true, layer: 0, width: 900, height: 700 };
    const tiny = { pid: 999, window_id: 111, app: "Safari", title: "Tiny", is_on_current_space: true, on_screen: true, layer: 0, width: 120, height: 90 };
    const run = vi.fn(async (args: string[]) => {
      if (args[1] === "list_windows") return { code: 0, stdout: JSON.stringify({ windows: [tiny, normal] }), stderr: "" };
      return { code: 0, stdout: JSON.stringify({ elements: [{ id: 1 }, { id: 2 }, { id: 3 }] }), stderr: "" };
    });

    const result = await executeComputerUse({ action: "capture", app: "Safari", mode: "ax" }, { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, captureContexts: new RecentCaptureStore() });

    expect(run.mock.calls[1]?.[0][2]).toContain('"window_id":456');
    expect(result.details.data).toMatchObject({ target: expect.objectContaining({ windowId: 456, title: "Normal" }) });
  });

  it("does not forward type, key, focus, or launch aliases as raw wrapper names", async () => {
    const cases: Array<{ params: ComputerUseParams; expected: string }> = [
      { params: { action: "type", text: "hello", targetDescription: "Editor" }, expected: "type_text" },
      { params: { action: "key", key: "A", targetDescription: "Editor" }, expected: "press_key" },
      { params: { action: "key", key: "cmd+shift+p", targetDescription: "Editor" }, expected: "hotkey" },
      { params: { action: "launch", app: "Safari", targetDescription: "Safari app" }, expected: "launch_app" },
    ];

    for (const { params, expected } of cases) {
      const run = vi.fn().mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });
      await executeComputerUse(params, { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true });
      expect(run.mock.calls.at(-1)?.[0][1]).toBe(expected);
      expect(run.mock.calls.at(-1)?.[0][1]).not.toBe(params.action);
    }

    const focusRun = runWithWindows();
    await executeComputerUse({ action: "focus", app: "Safari", targetDescription: "Safari app" }, { platform: "darwin", runCua: focusRun, requestApproval: async () => true, captureApproved: true, captureContexts: new RecentCaptureStore() });
    expect(focusRun.mock.calls.map((call) => call[0][1])).toEqual(["list_windows"]);
    expect(focusRun.mock.calls.map((call) => call[0][1])).not.toContain("focus");
  });

  it("maps element-indexed click using capture context", async () => {
    const store = new RecentCaptureStore();
    const context = store.issue({ pid: 123, windowId: 456, app: "Safari", mode: "som", elementCount: 2 });
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });

    await executeComputerUse(
      { action: "click", element: 14, recentCaptureId: context.recentCaptureId, targetDescription: "Search field" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, captureContexts: store },
    );

    expect(run).toHaveBeenCalledWith(["call", "click", JSON.stringify({ pid: 123, window_id: 456, element_index: 14 })], 30_000);
  });

  it("maps coordinate click as latest-capture window coordinates", async () => {
    const store = new RecentCaptureStore();
    const context = store.issue({ pid: 123, windowId: 456, app: "Safari", mode: "som", elementCount: 2 });
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });

    await executeComputerUse(
      { action: "click", coordinate: { x: 10, y: 20 }, recentCaptureId: context.recentCaptureId, targetDescription: "Search field" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, captureContexts: store },
    );

    expect(run).toHaveBeenCalledWith(["call", "click", JSON.stringify({ pid: 123, window_id: 456, x: 10, y: 20 })], 30_000);
  });

  it("implements wait locally without invoking Cua", async () => {
    const run = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await executeComputerUse({ action: "wait", seconds: 0.1 }, { platform: "darwin", runCua: run, sleep });

    expect(result.details.ok).toBe(true);
    expect(sleep).toHaveBeenCalledWith(100);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("capture context storage", () => {
  it("stores rich capture context and returns recentCaptureId", async () => {
    const store = new RecentCaptureStore();
    const run = runWithWindows();

    const result = await executeComputerUse({ action: "capture", app: "Safari" }, { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, captureContexts: store });

    const id = (result.details.data as { recentCaptureId?: string }).recentCaptureId;
    expect(id).toMatch(/^capture-/);
    expect(store.get(id!)?.pid).toBe(123);
    expect(store.get(id!)?.windowId).toBe(456);
  });

  it("expires and bounds recent capture context", () => {
    let now = 1_000;
    const store = new RecentCaptureStore(2, 500, () => now);
    const first = store.issue({ pid: 1, windowId: 1, elementCount: 1 });
    store.issue({ pid: 2, windowId: 2, elementCount: 1 });
    store.issue({ pid: 3, windowId: 3, elementCount: 1 });
    expect(store.has(first.recentCaptureId)).toBe(false);

    const current = store.issue({ pid: 4, windowId: 4, elementCount: 1 });
    now = 2_000;
    expect(store.has(current.recentCaptureId)).toBe(false);
  });

  it("rejects unknown or expired recentCaptureId before invoking Cua", async () => {
    const run = vi.fn();
    const result = await executeComputerUse(
      { action: "click", element: 1, recentCaptureId: "capture-missing", targetDescription: "Button" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, captureContexts: new RecentCaptureStore() },
    );

    expect(result.details.error?.code).toBe("invalid-capture-context");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects coordinate actions without recent capture context", async () => {
    const run = vi.fn();
    const result = await executeComputerUse(
      { action: "click", coordinate: { x: 10, y: 20 }, targetDescription: "Button" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true },
    );

    expect(result.details.error?.code).toBe("capture-context-required");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("platform, approval, and safety gates", () => {
  it("rejects non-macOS platforms before invoking Cua", async () => {
    const run = vi.fn();
    const result = await executeComputerUse({ action: "capture" }, { platform: "linux", runCua: run });
    expect(result.details.error?.code).toBe("unsupported-platform");
    expect(run).not.toHaveBeenCalled();
  });

  it("requires approval before first capture", async () => {
    const run = runWithWindows();
    const requestApproval = vi.fn().mockResolvedValue(true);
    await executeComputerUse({ action: "capture", app: "Safari" }, { platform: "darwin", runCua: run, requestApproval, captureApproved: false, captureContexts: new RecentCaptureStore() });
    expect(requestApproval).toHaveBeenCalledWith(expect.stringContaining("Approve macOS computer_use capture"));
  });

  it("requires approval for unscoped capture even after prior approval", async () => {
    const run = vi.fn();
    const requestApproval = vi.fn().mockResolvedValue(false);
    const result = await executeComputerUse({ action: "capture" }, { platform: "darwin", runCua: run, requestApproval, captureApproved: true });
    expect(result.details.error?.code).toBe("approval-denied");
    expect(requestApproval).toHaveBeenCalledWith(expect.stringContaining("unscoped"));
    expect(run).not.toHaveBeenCalled();
  });

  it("requires target metadata before mutating GUI actions", async () => {
    const run = vi.fn();
    const result = await executeComputerUse({ action: "click", element: 1 }, { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true });
    expect(result.details.error?.code).toBe("target-context-required");
    expect(run).not.toHaveBeenCalled();
  });

  it("sanitizes Hermes-compatible fields in approval messages", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });
    const requestApproval = vi.fn().mockResolvedValue(true);
    await executeComputerUse(
      { action: "click", element: 10, app: "Safari\nFake: app", targetDescription: "Search\nAction: type\u001b[31m", recentCaptureId: "capture-1\nFake: yes" },
      { platform: "darwin", runCua: run, requestApproval, captureApproved: true, validRecentCaptureIds: new Set(["capture-1\nFake: yes"]) },
    );

    const message = requestApproval.mock.calls[0]?.[0] ?? "";
    expect(message).toContain("Target: Search Action: type");
    expect(message).toContain("Target context: Safari Fake: app");
    expect(message).toContain("Recent capture: capture-1 Fake: yes");
    expect(message).not.toContain("\u001b");
  });

  it("blocks declared sensitive surfaces", async () => {
    const result = await executeComputerUse(
      { action: "click", element: 1, targetDescription: "Touch ID password dialog" },
      { platform: "darwin", runCua: vi.fn(), requestApproval: async () => true, captureApproved: true },
    );
    expect(result.details.error?.code).toBe("sensitive-surface");
  });

  it("blocks credential-like and OTP text from type actions", async () => {
    const secret = await executeComputerUse(
      { action: "type", text: "sk-1234567890abcdef1234567890abcdef", targetDescription: "Text field" },
      { platform: "darwin", runCua: vi.fn(), requestApproval: async () => true, captureApproved: true },
    );
    const otp = await executeComputerUse(
      { action: "type", text: "123456", targetDescription: "Text field" },
      { platform: "darwin", runCua: vi.fn(), requestApproval: async () => true, captureApproved: true },
    );
    expect(secret.details.error?.code).toBe("secret-blocked");
    expect(otp.details.error?.code).toBe("secret-blocked");
  });

  it("blocks credential-like value fallback from type actions", async () => {
    const run = vi.fn();
    const result = await executeComputerUse(
      { action: "type", value: "sk-1234567890abcdef1234567890abcdef", targetDescription: "Text field" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true },
    );

    expect(result.details.error?.code).toBe("secret-blocked");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("Cua result normalization", () => {
  it("normalizes JSON, structuredContent, and raw MCP-style content", () => {
    const result = normalizeCuaResult(
      { code: 0, stdout: JSON.stringify({ structuredContent: { apps: ["Finder"] }, content: [{ type: "text", text: "ok" }] }), stderr: "" },
      { action: "list_apps", rawAction: "list_apps" },
    );
    expect(result.details.ok).toBe(true);
    expect(result.details.data).toEqual({ structuredContent: { apps: ["Finder"] }, content: [{ type: "text", text: "ok" }] });
    expect(result.content).toContainEqual({ type: "text", text: "ok" });
  });

  it("returns structured error for invalid JSON and human-readable failures", () => {
    const invalid = normalizeCuaResult({ code: 0, stdout: "not json", stderr: "" }, { action: "capture" });
    const failed = normalizeCuaResult({ code: 2, stdout: "", stderr: "permission denied" }, { action: "capture" });
    expect(invalid.details.error?.code).toBe("invalid-json");
    expect(failed.details.error?.message).toContain("permission denied");
  });

  it("returns Pi image content from valid image data and rejects generic invalid data", () => {
    const valid = normalizeCuaResult({ code: 0, stdout: JSON.stringify({ screenshot_base64: png, screenshot_media_type: "image/png" }), stderr: "" }, { action: "capture" });
    const invalid = normalizeCuaResult({ code: 0, stdout: JSON.stringify({ data: "not-image" }), stderr: "" }, { action: "capture" });
    expect(valid.content).toContainEqual({ type: "image", mimeType: "image/png", data: png });
    expect(invalid.content.some((item) => item.type === "image")).toBe(false);
  });

  it("accepts valid screenshot paths inside allowed directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-cua-test-"));
    const pngPath = join(dir, "shot.png");
    const bytes = Buffer.from(png, "base64");
    await writeFile(pngPath, bytes);
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify({ screenshot_path: pngPath }), stderr: "" });
    const result = await executeComputerUse(
      { action: "list_apps" },
      { platform: "darwin", runCua: run, allowedScreenshotDirs: [dir] },
    );
    expect(result.content).toContainEqual({ type: "image", mimeType: "image/png", data: bytes.toString("base64") });
  });

  it("rejects screenshot paths outside allowed directories and non-image paths", async () => {
    const allowedDir = await mkdtemp(join(tmpdir(), "pi-cua-allowed-"));
    const otherDir = await mkdtemp(join(tmpdir(), "pi-cua-other-"));
    const pngPath = join(otherDir, "shot.png");
    await writeFile(pngPath, Buffer.from(png, "base64"));
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify({ screenshot_path: pngPath }), stderr: "" });
    const result = await executeComputerUse({ action: "list_apps" }, { platform: "darwin", runCua: run, allowedScreenshotDirs: [allowedDir] });
    expect(result.content.some((item) => item.type === "image")).toBe(false);
    expect(result.details.warning).toContain("rejected");
  });

  it("redacts secrets and absolute paths from error summaries", () => {
    const result = normalizeCuaResult({ code: 1, stdout: "", stderr: "failed token=abcd1234secretvalue password=hunter2 at /Users/alice/.ssh/id_rsa" }, { action: "capture" });
    expect(result.details.error?.message).toContain("token=[REDACTED_SECRET]");
    expect(result.details.error?.message).toContain("password=[REDACTED_SECRET]");
    expect(result.details.error?.message).toContain("[REDACTED_PATH]");
  });
});

describe("extension shell runner", () => {
  it("rethrows aborted executions so cancellation is preserved", async () => {
    const controller = new AbortController();
    const pending = runShell(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], 30_000, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "ABORT_ERR" });
  });
});

describe("status helper", () => {
  it("reports available cua-driver and check_permissions output", async () => {
    const result = await statusCheck({
      platform: "darwin",
      which: async () => "/opt/homebrew/bin/cua-driver",
      version: async () => "1.2.3",
      checkPermissions: async () => ({ code: 0, stdout: JSON.stringify({ accessibility: true, screen_recording: false }), stderr: "" }),
    });

    expect(result.cua.available).toBe(true);
    expect(result.permissions.find((permission) => permission.name === "Accessibility")?.status).toBe("granted");
    expect(result.permissions.find((permission) => permission.name === "Screen Recording")?.status).toBe("denied");
  });

  it("reports missing cua-driver fail-closed", async () => {
    const result = await statusCheck({ platform: "darwin", which: async () => undefined });
    expect(result.cua.available).toBe(false);
    expect(result.nextSteps.join(" ")).toContain("Install Cua Driver");
  });
});
