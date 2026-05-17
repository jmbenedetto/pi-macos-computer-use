import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildCuaCallArgs,
  executeComputerUse,
  normalizeCuaResult,
  statusCheck,
  type ComputerUseParams,
} from "../src/computer-use.js";

describe("Cua command mapping", () => {
  it("builds cua-driver call arguments for capture", () => {
    expect(buildCuaCallArgs({ action: "capture", app: "Safari" })).toEqual([
      "call",
      "capture",
      JSON.stringify({ app: "Safari" }),
    ]);
  });

  it("builds cua-driver call arguments for element-indexed click", () => {
    expect(buildCuaCallArgs({ action: "click", elementIndex: 14, windowId: 10725 })).toEqual([
      "call",
      "click",
      JSON.stringify({ element_index: 14, window_id: 10725 }),
    ]);
  });

  it("rejects unsupported actions before invoking Cua", async () => {
    const run = vi.fn();
    const result = await executeComputerUse({ action: "screenshot" } as unknown as ComputerUseParams, {
      platform: "darwin",
      runCua: run,
    });

    expect(result.details.ok).toBe(false);
    expect(result.details.error?.code).toBe("unsupported-action");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("platform and safety gates", () => {
  it("rejects non-macOS platforms before invoking Cua", async () => {
    const run = vi.fn();
    const result = await executeComputerUse({ action: "capture" }, { platform: "linux", runCua: run });

    expect(result.details.ok).toBe(false);
    expect(result.details.error?.code).toBe("unsupported-platform");
    expect(run).not.toHaveBeenCalled();
  });

  it("requires approval before first capture", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });
    const requestApproval = vi.fn().mockResolvedValue(true);

    await executeComputerUse({ action: "capture", app: "Safari" }, { platform: "darwin", runCua: run, requestApproval, captureApproved: false });

    expect(requestApproval).toHaveBeenCalledWith(expect.stringContaining("Approve macOS computer_use capture"));
    expect(run).toHaveBeenCalledOnce();
  });

  it("requires approval for unscoped capture even after prior capture approval", async () => {
    const run = vi.fn();
    const requestApproval = vi.fn().mockResolvedValue(false);

    const result = await executeComputerUse({ action: "capture" }, { platform: "darwin", runCua: run, requestApproval, captureApproved: true });

    expect(result.details.error?.code).toBe("approval-denied");
    expect(requestApproval).toHaveBeenCalledWith(expect.stringContaining("unscoped"));
    expect(run).not.toHaveBeenCalled();
  });

  it("requires target metadata before mutating GUI actions", async () => {
    const run = vi.fn();
    const result = await executeComputerUse(
      { action: "click", x: 10, y: 20 },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true },
    );

    expect(result.details.error?.code).toBe("target-context-required");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects valid recent capture IDs without target description", async () => {
    const run = vi.fn();
    const result = await executeComputerUse(
      { action: "click", x: 10, y: 20, recentCaptureId: "capture-1" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, validRecentCaptureIds: new Set(["capture-1"]) },
    );

    expect(result.details.error?.code).toBe("target-context-required");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects spoofed recent capture IDs", async () => {
    const run = vi.fn();
    const result = await executeComputerUse(
      { action: "click", x: 10, y: 20, targetDescription: "Search field", recentCaptureId: "anything" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, validRecentCaptureIds: new Set(["capture-1"]) },
    );

    expect(result.details.error?.code).toBe("invalid-recent-capture");
    expect(run).not.toHaveBeenCalled();
  });

  it("sanitizes control characters in approval messages", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });
    const requestApproval = vi.fn().mockResolvedValue(true);

    await executeComputerUse(
      { action: "click", x: 10, y: 20, app: "Safari\nFake: app", targetDescription: "Search\nAction: type\u001b[31m", recentCaptureId: "capture-1\nFake: yes" },
      { platform: "darwin", runCua: run, requestApproval, captureApproved: true, validRecentCaptureIds: new Set(["capture-1\nFake: yes"]) },
    );

    const message = requestApproval.mock.calls[0]?.[0] ?? "";
    expect(message).toContain("Target: Search Action: type");
    expect(message).toContain("App/window scope: Safari Fake: app");
    expect(message).toContain("Recent capture: capture-1 Fake: yes");
    expect(message).not.toContain("\u001b");
    expect(message).not.toMatch(/Target: Search\nAction: type/);
  });

  it("requires approval before mutating GUI actions with detailed context", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });
    const requestApproval = vi.fn().mockResolvedValue(true);

    await executeComputerUse(
      { action: "click", x: 10, y: 20, app: "Safari", targetDescription: "Search field" },
      { platform: "darwin", runCua: run, requestApproval, captureApproved: true },
    );

    expect(requestApproval).toHaveBeenCalledWith(expect.stringContaining("Action: click"));
    expect(requestApproval).toHaveBeenCalledWith(expect.stringContaining("App/window scope: Safari"));
    expect(requestApproval).toHaveBeenCalledWith(expect.stringContaining("Target: Search field"));
    expect(requestApproval).toHaveBeenCalledWith(expect.stringContaining("Coordinates: 10,20"));
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not invoke Cua when approval is denied", async () => {
    const run = vi.fn();
    const requestApproval = vi.fn().mockResolvedValue(false);

    const result = await executeComputerUse({ action: "type", text: "hello", targetDescription: "Search field" }, { platform: "darwin", runCua: run, requestApproval, captureApproved: true });

    expect(result.details.ok).toBe(false);
    expect(result.details.error?.code).toBe("approval-denied");
    expect(run).not.toHaveBeenCalled();
  });

  it("blocks declared sensitive surfaces", async () => {
    const run = vi.fn();
    const result = await executeComputerUse(
      { action: "click", x: 1, y: 2, targetDescription: "Touch ID password dialog" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true },
    );

    expect(result.details.ok).toBe(false);
    expect(result.details.error?.code).toBe("sensitive-surface");
    expect(run).not.toHaveBeenCalled();
  });

  it("blocks credential-like text from type actions", async () => {
    const run = vi.fn();
    const result = await executeComputerUse(
      { action: "type", text: "sk-1234567890abcdef1234567890abcdef", targetDescription: "API key field" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true },
    );

    expect(result.details.ok).toBe(false);
    expect(result.details.error?.code).toBe("secret-blocked");
    expect(run).not.toHaveBeenCalled();
  });

  it("blocks OTP-like codes from type actions", async () => {
    const run = vi.fn();
    const result = await executeComputerUse(
      { action: "type", text: "123456", targetDescription: "Verification code" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true },
    );

    expect(result.details.ok).toBe(false);
    expect(result.details.error?.code).toBe("secret-blocked");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("Cua result normalization", () => {
  it("normalizes valid JSON text", () => {
    const result = normalizeCuaResult({ code: 0, stdout: JSON.stringify({ apps: ["Finder"] }), stderr: "" }, { action: "list_apps" });

    expect(result.details.ok).toBe(true);
    expect(result.details.data).toEqual({ apps: ["Finder"] });
    expect(result.content[0]).toEqual({ type: "text", text: expect.stringContaining("list_apps") });
  });

  it("returns structured error for invalid JSON", () => {
    const result = normalizeCuaResult({ code: 0, stdout: "not json", stderr: "" }, { action: "capture" });

    expect(result.details.ok).toBe(false);
    expect(result.details.error?.code).toBe("invalid-json");
  });

  it("returns structured error for command failure", () => {
    const result = normalizeCuaResult({ code: 2, stdout: "", stderr: "permission denied" }, { action: "capture" });

    expect(result.details.ok).toBe(false);
    expect(result.details.error?.code).toBe("command-failed");
    expect(result.details.error?.message).toContain("permission denied");
  });

  it("returns Pi image content from explicit valid base64 screenshot data", () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const result = normalizeCuaResult(
      { code: 0, stdout: JSON.stringify({ screenshot_base64: png, screenshot_media_type: "image/png" }), stderr: "" },
      { action: "capture" },
    );

    expect(result.content).toContainEqual({ type: "image", mimeType: "image/png", data: png });
  });

  it("does not trust generic data fields as screenshot bytes", () => {
    const result = normalizeCuaResult(
      { code: 0, stdout: JSON.stringify({ data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" }), stderr: "" },
      { action: "capture" },
    );

    expect(result.content.some((item) => item.type === "image")).toBe(false);
    expect(result.details.warning).toContain("no usable image");
  });

  it("redacts secrets and absolute paths from error summaries", () => {
    const result = normalizeCuaResult(
      { code: 1, stdout: "", stderr: "failed with sk-1234567890abcdef1234567890abcdef at /Users/alice/.ssh/id_rsa" },
      { action: "capture" },
    );

    expect(result.details.error?.message).not.toContain("sk-123");
    expect(result.details.error?.message).not.toContain("/Users/alice");
    expect(result.details.error?.message).toContain("[REDACTED_SECRET]");
    expect(result.details.error?.message).toContain("[REDACTED_PATH]");
  });

  it("warns when capture succeeds without image content", () => {
    const result = normalizeCuaResult({ code: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }, { action: "capture" });

    expect(result.details.warning).toContain("no usable image");
    expect(result.content[0]).toEqual({ type: "text", text: expect.stringContaining("no usable image") });
  });

  it("accepts valid screenshot paths inside allowed directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-cua-test-"));
    const pngPath = join(dir, "shot.png");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
    await writeFile(pngPath, png);
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify({ screenshot_path: pngPath }), stderr: "" });

    const result = await executeComputerUse(
      { action: "capture", app: "Safari" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, allowedScreenshotDirs: [dir] },
    );

    expect(result.content).toContainEqual({ type: "image", mimeType: "image/png", data: png.toString("base64") });
  });

  it("rejects screenshot paths outside allowed directories", async () => {
    const allowedDir = await mkdtemp(join(tmpdir(), "pi-cua-allowed-"));
    const otherDir = await mkdtemp(join(tmpdir(), "pi-cua-other-"));
    const pngPath = join(otherDir, "shot.png");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
    await writeFile(pngPath, png);
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify({ screenshot_path: pngPath }), stderr: "" });

    const result = await executeComputerUse(
      { action: "capture", app: "Safari" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, allowedScreenshotDirs: [allowedDir] },
    );

    expect(result.content.some((item) => item.type === "image")).toBe(false);
    expect(result.details.warning).toContain("rejected");
  });

  it("rejects non-image screenshot paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-cua-test-"));
    const txtPath = join(dir, "not-image.png");
    await writeFile(txtPath, "not an image");
    const run = vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify({ screenshot_path: txtPath }), stderr: "" });

    const result = await executeComputerUse(
      { action: "capture", app: "Safari" },
      { platform: "darwin", runCua: run, requestApproval: async () => true, captureApproved: true, allowedScreenshotDirs: [dir] },
    );

    expect(result.content.some((item) => item.type === "image")).toBe(false);
    expect(result.details.warning).toContain("not a recognized");
  });
});

describe("status helper", () => {
  it("reports available cua-driver", async () => {
    const result = await statusCheck({ platform: "darwin", which: async () => "/opt/homebrew/bin/cua-driver", version: async () => "1.2.3" });

    expect(result.cua.available).toBe(true);
    expect(result.cua.path).toBe("/opt/homebrew/bin/cua-driver");
    expect(result.cua.version).toBe("1.2.3");
  });

  it("reports missing cua-driver", async () => {
    const result = await statusCheck({ platform: "darwin", which: async () => undefined });

    expect(result.cua.available).toBe(false);
    expect(result.nextSteps.join(" ")).toContain("Install Cua Driver");
  });
});
