import { access, readFile, realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

export const SUPPORTED_ACTIONS = [
  "capture",
  "list_apps",
  "focus",
  "launch",
  "click",
  "type",
  "key",
  "scroll",
  "drag",
] as const;

export type ComputerUseAction = (typeof SUPPORTED_ACTIONS)[number];

export interface ComputerUseParams {
  action: ComputerUseAction;
  app?: string;
  windowId?: number;
  pid?: number;
  elementIndex?: number;
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  text?: string;
  key?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  targetDescription?: string;
  recentCaptureId?: string;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ToolContentText {
  type: "text";
  text: string;
}

export interface ToolContentImage {
  type: "image";
  mimeType: string;
  data: string;
}

export interface ComputerUseToolResult {
  content: Array<ToolContentText | ToolContentImage>;
  details: {
    ok: boolean;
    action?: string;
    data?: unknown;
    warning?: string;
    error?: {
      code: string;
      message: string;
    };
  };
}

export interface ExecuteDeps {
  platform?: NodeJS.Platform | string;
  runCua: (args: string[], timeoutMs: number) => Promise<CommandResult>;
  requestApproval?: (message: string) => Promise<boolean>;
  timeoutMs?: number;
  captureApproved?: boolean;
  allowedScreenshotDirs?: string[];
  validRecentCaptureIds?: Set<string>;
  debugDiagnostics?: boolean;
}

const MUTATING_ACTIONS = new Set<ComputerUseAction>(["focus", "launch", "click", "type", "key", "scroll", "drag"]);
const SENSITIVE_SURFACE_PATTERN = /\b(permission|password|passcode|payment|credit card|card number|2fa|two[- ]factor|mfa|otp|verification code|touch id|face id)\b/i;
const SECRET_TEXT_PATTERN = /\b(password|passcode|token|api[_-]?key|secret|recovery code)\b/i;
const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_=-]{32,})\b/;
const OTP_PATTERN = /^\s*\d{6,8}\s*$/;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export function isSupportedAction(action: string): action is ComputerUseAction {
  return (SUPPORTED_ACTIONS as readonly string[]).includes(action);
}

export function buildCuaCallArgs(params: ComputerUseParams): string[] {
  const payload: Record<string, unknown> = {};

  if (params.app !== undefined) payload.app = params.app;
  if (params.pid !== undefined) payload.pid = params.pid;
  if (params.elementIndex !== undefined) payload.element_index = params.elementIndex;
  if (params.windowId !== undefined) payload.window_id = params.windowId;
  if (params.x !== undefined) payload.x = params.x;
  if (params.y !== undefined) payload.y = params.y;
  if (params.toX !== undefined) payload.to_x = params.toX;
  if (params.toY !== undefined) payload.to_y = params.toY;
  if (params.text !== undefined) payload.text = params.text;
  if (params.key !== undefined) payload.key = params.key;
  if (params.direction !== undefined) payload.direction = params.direction;
  if (params.amount !== undefined) payload.amount = params.amount;

  return ["call", params.action, JSON.stringify(payload)];
}

export async function executeComputerUse(params: ComputerUseParams, deps: ExecuteDeps): Promise<ComputerUseToolResult> {
  if (deps.platform !== "darwin") {
    return errorResult("unsupported-platform", "pi-macos-computer-use v1 only supports macOS.", params.action);
  }

  if (!isSupportedAction(params.action)) {
    return errorResult("unsupported-action", `Unsupported computer_use action: ${String(params.action)}`, String(params.action));
  }

  const provenanceError = getProvenanceError(params, deps);
  if (provenanceError) {
    return errorResult(provenanceError.code, provenanceError.message, params.action);
  }

  const safetyError = getSafetyError(params);
  if (safetyError) {
    return errorResult(safetyError.code, safetyError.message, params.action);
  }

  if (requiresApproval(params, deps)) {
    const approve = deps.requestApproval ?? (async () => false);
    const approvalMessage = buildApprovalMessage(params, deps);
    const approved = await approve(approvalMessage);
    if (!approved) {
      return errorResult("approval-denied", `User denied approval for ${params.action}.`, params.action);
    }
  }

  try {
    const command = buildCuaCallArgs(params);
    const result = await deps.runCua(command, deps.timeoutMs ?? 30_000);
    return await normalizeCuaResultAsync(result, params, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return errorResult("missing-dependency", "cua-driver was not found on PATH. Install Cua Driver and retry.", params.action);
    }
    return errorResult("command-failed", redactDiagnostic(message, deps.debugDiagnostics), params.action);
  }
}

export function normalizeCuaResult(result: CommandResult, params: Pick<ComputerUseParams, "action">): ComputerUseToolResult {
  if (result.code !== 0) {
    return errorResult("command-failed", safeSummary(result.stderr || result.stdout || `cua-driver exited with code ${result.code}`), params.action);
  }

  let data: unknown;
  try {
    data = result.stdout.trim() ? JSON.parse(result.stdout) : {};
  } catch {
    return errorResult("invalid-json", `cua-driver returned invalid JSON: ${safeSummary(result.stdout)}`, params.action);
  }

  return normalizeParsedData(data, params.action);
}

async function normalizeCuaResultAsync(result: CommandResult, params: Pick<ComputerUseParams, "action">, deps: Pick<ExecuteDeps, "allowedScreenshotDirs"> = {}): Promise<ComputerUseToolResult> {
  const normalized = normalizeCuaResult(result, params);
  if (!normalized.details.ok || params.action !== "capture") return normalized;

  const imagePath = findStringField(normalized.details.data, ["screenshot_path", "image_path"]);
  if (!imagePath || normalized.content.some((item) => item.type === "image")) return normalized;

  try {
    const image = await readValidatedScreenshotPath(imagePath, deps.allowedScreenshotDirs);
    normalized.content.push(image);
    normalized.details.warning = undefined;
    return normalized;
  } catch (error) {
    const message = error instanceof Error ? error.message : "image path was not accepted";
    normalized.details.warning = `capture succeeded but screenshot path was rejected: ${basename(imagePath)} (${message})`;
    normalized.content[0] = { type: "text", text: `capture succeeded, but ${normalized.details.warning}` };
    return normalized;
  }
}

function normalizeParsedData(data: unknown, action: string): ComputerUseToolResult {
  const content: Array<ToolContentText | ToolContentImage> = [{ type: "text", text: `computer_use ${action} completed.` }];
  const base64 = findStringField(data, ["screenshot_base64", "image_base64"]);
  const mediaType = findStringField(data, ["screenshot_media_type", "media_type", "mime_type"]) ?? "image/png";

  const hasValidImage = Boolean(action === "capture" && base64 && isValidImageBase64(base64, mediaType));
  if (hasValidImage && base64) {
    content.push({ type: "image", mimeType: mediaType, data: base64 });
  }

  const warning = action === "capture" && !hasValidImage ? "capture succeeded but no usable image content was available." : undefined;
  if (warning) content[0] = { type: "text", text: warning };

  return {
    content,
    details: {
      ok: true,
      action,
      data,
      warning,
    },
  };
}

function getProvenanceError(params: ComputerUseParams, deps: Pick<ExecuteDeps, "validRecentCaptureIds">): { code: string; message: string } | undefined {
  if (!params.recentCaptureId) return undefined;
  if (!deps.validRecentCaptureIds?.has(params.recentCaptureId)) {
    return { code: "invalid-recent-capture", message: "recentCaptureId was not issued by a successful capture in this extension session." };
  }
  return undefined;
}

function getSafetyError(params: ComputerUseParams): { code: string; message: string } | undefined {
  if (MUTATING_ACTIONS.has(params.action) && !params.targetDescription) {
    return { code: "target-context-required", message: "Mutating computer_use actions require targetDescription. recentCaptureId is provenance only, not target context." };
  }

  if (params.action === "type" && params.text) {
    if (SECRET_TEXT_PATTERN.test(params.text) || SECRET_VALUE_PATTERN.test(params.text) || OTP_PATTERN.test(params.text)) {
      return { code: "secret-blocked", message: "Refusing to type content that looks like a secret, credential, or verification code." };
    }
  }

  const target = params.targetDescription ?? "";
  if (target && SENSITIVE_SURFACE_PATTERN.test(target)) {
    return { code: "sensitive-surface", message: "Refusing to interact with a permission, password, payment, or 2FA surface." };
  }

  return undefined;
}

function errorResult(code: string, message: string, action?: string): ComputerUseToolResult {
  return {
    content: [{ type: "text", text: `computer_use error (${code}): ${message}` }],
    details: { ok: false, action, error: { code, message } },
  };
}

function safeSummary(value: string): string {
  const trimmed = redactDiagnostic(value, false).replace(/\s+/g, " ").trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

function findStringField(value: unknown, names: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const name of names) {
    const candidate = record[name];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return undefined;
}

function requiresApproval(params: ComputerUseParams, deps: Pick<ExecuteDeps, "captureApproved">): boolean {
  if (params.action === "capture") return !deps.captureApproved || !isScoped(params);
  return MUTATING_ACTIONS.has(params.action);
}

function isScoped(params: ComputerUseParams): boolean {
  return Boolean(params.app || params.windowId || params.pid);
}

function buildApprovalMessage(params: ComputerUseParams, deps: Pick<ExecuteDeps, "captureApproved">): string {
  const lines = [`Approve macOS computer_use ${params.action}${params.action === "capture" && deps.captureApproved && !isScoped(params) ? " unscoped" : ""} action?`];
  lines.push(`Action: ${params.action}`);
  if (params.app || params.windowId || params.pid) {
    lines.push(`App/window scope: ${[params.app ? sanitizeApprovalField(params.app) : undefined, params.windowId ? `window ${params.windowId}` : undefined, params.pid ? `pid ${params.pid}` : undefined].filter(Boolean).join(" / ")}`);
  } else {
    lines.push("App/window scope: unscoped (privacy-sensitive)");
  }
  if (params.targetDescription) lines.push(`Target: ${sanitizeApprovalField(params.targetDescription)}`);
  if (params.elementIndex !== undefined) lines.push(`Element index: ${params.elementIndex}`);
  if (params.x !== undefined && params.y !== undefined) lines.push(`Coordinates: ${params.x},${params.y} (higher risk than element index)`);
  if (params.key) lines.push(`Key: ${sanitizeApprovalField(params.key)}${/^(return|enter)$/i.test(params.key) ? " (confirm/submit risk)" : ""}`);
  if (params.text !== undefined) lines.push(`Text preview: ${redactTextPreview(params.text)}`);
  if (params.recentCaptureId) lines.push(`Recent capture: ${sanitizeApprovalField(params.recentCaptureId)}`);
  return lines.join("\n");
}

function redactTextPreview(text: string): string {
  const redacted = sanitizeApprovalField(redactDiagnostic(text, false));
  return redacted.length > 60 ? `${redacted.slice(0, 60)}…` : redacted;
}

function sanitizeApprovalField(value: string, maxLength = 160): string {
  const withoutAnsi = value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, " ");
  const withoutBidi = withoutAnsi.replace(/[\u202A-\u202E\u2066-\u2069]/g, " ");
  const withoutControl = withoutBidi.replace(/[\x00-\x1F\x7F]/g, " ");
  const collapsed = withoutControl.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
}

function redactDiagnostic(value: string, debug = false): string {
  if (debug) return value;
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED_SECRET]")
    .replace(/\b(?:token|key|api[_-]?key|password|secret)=\S+/gi, "$1=[REDACTED_SECRET]")
    .replace(/\b[A-Za-z0-9_=-]{32,}\b/g, "[REDACTED_SECRET]")
    .replace(/(?:\/Users\/|\/home\/|\/private\/|\/var\/|\/tmp\/)[^\s:'\"]+/g, "[REDACTED_PATH]");
}

async function readValidatedScreenshotPath(path: string, allowedDirs?: string[]): Promise<ToolContentImage> {
  const defaults = ["/tmp", "/var/tmp", process.env.TMPDIR].filter((dir): dir is string => Boolean(dir));
  const allowed = await Promise.all((allowedDirs && allowedDirs.length > 0 ? allowedDirs : defaults).map((dir) => realpath(resolve(dir)).catch(() => resolve(dir))));
  const canonical = await realpath(path);
  if (!allowed.some((dir) => canonical === dir || canonical.startsWith(`${dir}/`))) {
    throw new Error("outside allowed screenshot directories");
  }
  const info = await stat(canonical);
  if (!info.isFile()) throw new Error("not a file");
  if (info.size > MAX_SCREENSHOT_BYTES) throw new Error("image too large");
  const bytes = await readFile(canonical);
  const mimeType = mediaTypeForBytes(bytes);
  if (!mimeType) throw new Error("not a recognized PNG/JPEG/WebP image");
  return { type: "image", mimeType, data: bytes.toString("base64") };
}

function isValidImageBase64(data: string, mediaType: string): boolean {
  if (!/^image\/(png|jpeg|webp)$/.test(mediaType)) return false;
  try {
    const bytes = Buffer.from(data, "base64");
    return bytes.length <= MAX_SCREENSHOT_BYTES && mediaTypeForBytes(bytes) === mediaType;
  } catch {
    return false;
  }
}

function mediaTypeForBytes(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}

export interface StatusCheckDeps {
  platform?: NodeJS.Platform | string;
  which: () => Promise<string | undefined>;
  version?: () => Promise<string | undefined>;
}

export interface StatusCheckResult {
  platform: string;
  cua: {
    available: boolean;
    path?: string;
    version?: string;
  };
  permissions: Array<{ name: string; status: "manual-check-required"; guidance: string }>;
  nextSteps: string[];
}

export async function statusCheck(deps: StatusCheckDeps): Promise<StatusCheckResult> {
  const platform = String(deps.platform ?? process.platform);
  const path = await deps.which();
  const version = path && deps.version ? await deps.version() : undefined;
  const nextSteps: string[] = [];

  if (platform !== "darwin") nextSteps.push("Use macOS for pi-macos-computer-use v1.");
  if (!path) nextSteps.push("Install Cua Driver and ensure cua-driver is on PATH.");

  return {
    platform,
    cua: { available: Boolean(path), path, version },
    permissions: [
      {
        name: "Accessibility",
        status: "manual-check-required",
        guidance: "Grant Accessibility permission to the terminal or host app running Pi and Cua Driver.",
      },
      {
        name: "Screen Recording",
        status: "manual-check-required",
        guidance: "Grant Screen Recording permission to the terminal or host app running Pi and Cua Driver.",
      },
    ],
    nextSteps,
  };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
