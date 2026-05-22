import { access, mkdtemp, readFile, realpath, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

export const SUPPORTED_ACTIONS = [
  "capture",
  "click",
  "double_click",
  "right_click",
  "middle_click",
  "drag",
  "scroll",
  "type",
  "key",
  "set_value",
  "wait",
  "list_apps",
  "focus_app",
  "launch_app",
  "focus",
  "launch",
] as const;

export const HERMES_ACTIONS = [
  "capture",
  "click",
  "double_click",
  "right_click",
  "middle_click",
  "drag",
  "scroll",
  "type",
  "key",
  "set_value",
  "wait",
  "list_apps",
  "focus_app",
] as const;

export type ComputerUseAction = (typeof SUPPORTED_ACTIONS)[number];
export type CaptureMode = "som" | "semantic" | "ax" | "image" | "screenshot";

export interface Point {
  x: number;
  y: number;
}

export interface ComputerUseParams {
  action: ComputerUseAction;
  mode?: CaptureMode;
  app?: string;
  windowId?: number;
  pid?: number;
  element?: number;
  coordinate?: Point;
  from_element?: number;
  to_element?: number;
  from_coordinate?: Point;
  to_coordinate?: Point;
  button?: "left" | "right" | "middle";
  modifiers?: string[];
  keys?: string[];
  seconds?: number;
  value?: string;
  capture_after?: boolean;
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
    rawAction?: string;
    data?: unknown;
    warning?: string;
    error?: {
      code: string;
      message: string;
    };
  };
}

export interface CaptureContext {
  recentCaptureId: string;
  pid?: number;
  windowId?: number;
  app?: string;
  bundleId?: string;
  title?: string;
  mode?: string;
  elementCount: number;
  timestamp: number;
  partial?: boolean;
}

export interface CaptureContextStore {
  issue(context: Omit<CaptureContext, "recentCaptureId" | "timestamp">): CaptureContext;
  get(id: string): CaptureContext | undefined;
  has(id: string): boolean;
}

export interface ExecuteDeps {
  platform?: NodeJS.Platform | string;
  runCua: (args: string[], timeoutMs: number) => Promise<CommandResult>;
  requestApproval?: (message: string) => Promise<boolean>;
  timeoutMs?: number;
  captureApproved?: boolean;
  allowedScreenshotDirs?: string[];
  validRecentCaptureIds?: Set<string>;
  captureContexts?: CaptureContextStore;
  debugDiagnostics?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

const MUTATING_ACTIONS = new Set<ComputerUseAction>([
  "focus",
  "launch",
  "focus_app",
  "launch_app",
  "click",
  "double_click",
  "right_click",
  "middle_click",
  "type",
  "key",
  "scroll",
  "drag",
  "set_value",
]);
const SENSITIVE_SURFACE_PATTERN = /\b(permission|password|passcode|payment|credit card|card number|2fa|two[- ]factor|mfa|otp|verification code|touch id|face id)\b/i;
const SECRET_TEXT_PATTERN = /\b(password|passcode|token|api[_-]?key|secret|recovery code)\b/i;
const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_=-]{32,})\b/;
const OTP_PATTERN = /^\s*\d{6,8}\s*$/;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const DEFAULT_CONTEXT_TTL_MS = 10 * 60_000;

export class RecentCaptureStore implements CaptureContextStore {
  private readonly records = new Map<string, CaptureContext>();

  constructor(private readonly maxRecords = 5, private readonly ttlMs = DEFAULT_CONTEXT_TTL_MS, private readonly now = () => Date.now()) {}

  issue(context: Omit<CaptureContext, "recentCaptureId" | "timestamp">): CaptureContext {
    this.prune();
    const record: CaptureContext = { ...context, recentCaptureId: `capture-${randomUUID()}`, timestamp: this.now() };
    this.records.set(record.recentCaptureId, record);
    this.prune();
    return record;
  }

  get(id: string): CaptureContext | undefined {
    this.prune();
    return this.records.get(id);
  }

  has(id: string): boolean {
    return Boolean(this.get(id));
  }

  private prune() {
    const expiresBefore = this.now() - this.ttlMs;
    for (const [id, record] of this.records) {
      if (record.timestamp < expiresBefore) this.records.delete(id);
    }
    while (this.records.size > this.maxRecords) {
      const oldest = this.records.keys().next().value as string | undefined;
      if (!oldest) break;
      this.records.delete(oldest);
    }
  }
}

export function isSupportedAction(action: string): action is ComputerUseAction {
  return (SUPPORTED_ACTIONS as readonly string[]).includes(action);
}

export function normalizeAction(action: ComputerUseAction): ComputerUseAction {
  if (action === "focus") return "focus_app";
  if (action === "launch") return "launch_app";
  return action;
}

export function buildCuaCallArgs(params: ComputerUseParams): string[] {
  return buildTranslatedCuaCall(params).args;
}

export function buildTranslatedCuaCall(params: ComputerUseParams, context?: CaptureContext): { args: string[]; rawAction: string; payload: Record<string, unknown> } {
  const action = normalizeAction(params.action);
  const payload = targetPayload(params, context);
  const addText = (text?: string) => {
    if (text !== undefined) payload.text = text;
  };

  switch (action) {
    case "list_apps":
      return cuaCall("list_apps", payload);
    case "launch_app":
      if (params.app !== undefined) payload.app = params.app;
      return cuaCall("launch_app", payload);
    case "type":
      addText(params.text ?? params.value);
      return cuaCall("type_text", payload);
    case "key": {
      const keys = keyParts(params);
      if (keys.length > 1) {
        payload.keys = keys;
        return cuaCall("hotkey", payload);
      }
      payload.key = keys[0] ?? params.key;
      return cuaCall("press_key", payload);
    }
    case "click":
    case "double_click":
    case "right_click":
    case "middle_click": {
      const rawAction = action === "click" ? "click" : action;
      const element = params.element ?? params.elementIndex;
      const coordinate = params.coordinate ?? pointFromXY(params.x, params.y);
      if (element !== undefined) payload.element_index = element;
      if (coordinate) Object.assign(payload, coordinate);
      if (params.button !== undefined) payload.button = params.button;
      return cuaCall(rawAction, payload);
    }
    case "scroll":
      if (params.direction !== undefined) payload.direction = params.direction;
      if (params.amount !== undefined) payload.amount = params.amount;
      return cuaCall("scroll", payload);
    case "drag": {
      const fromElement = params.from_element ?? params.element ?? params.elementIndex;
      const toElement = params.to_element;
      const fromCoordinate = params.from_coordinate ?? pointFromXY(params.x, params.y);
      const toCoordinate = params.to_coordinate ?? pointFromXY(params.toX, params.toY);
      if (fromElement !== undefined) payload.from_element_index = fromElement;
      if (toElement !== undefined) payload.to_element_index = toElement;
      if (fromCoordinate) Object.assign(payload, { from_x: fromCoordinate.x, from_y: fromCoordinate.y });
      if (toCoordinate) Object.assign(payload, { to_x: toCoordinate.x, to_y: toCoordinate.y });
      return cuaCall("drag", payload);
    }
    case "set_value":
      if (params.value !== undefined) payload.value = params.value;
      if (params.text !== undefined) payload.value = params.text;
      if ((params.element ?? params.elementIndex) !== undefined) payload.element_index = params.element ?? params.elementIndex;
      return cuaCall("set_value", payload);
    case "capture":
    case "focus_app":
    case "wait":
      throw new Error(`${action} requires higher-level translation`);
    default:
      return cuaCall(String(action), payload);
  }
}

export async function executeComputerUse(params: ComputerUseParams, deps: ExecuteDeps): Promise<ComputerUseToolResult> {
  if (deps.platform !== "darwin") {
    return errorResult("unsupported-platform", "pi-macos-computer-use v1 only supports macOS.", params.action);
  }

  if (!isSupportedAction(params.action)) {
    return errorResult("unsupported-action", `Unsupported computer_use action: ${String(params.action)}`, String(params.action));
  }

  const provenanceError = getProvenanceError(params, deps);
  if (provenanceError) return errorResult(provenanceError.code, provenanceError.message, params.action);

  const safetyError = getSafetyError(params);
  if (safetyError) return errorResult(safetyError.code, safetyError.message, params.action);

  if (requiresApproval(params, deps)) {
    const approve = deps.requestApproval ?? (async () => false);
    const approvalMessage = buildApprovalMessage(params, deps);
    const approved = await approve(approvalMessage);
    if (!approved) return errorResult("approval-denied", `User denied approval for ${params.action}.`, params.action);
  }

  try {
    return await executeTranslated(params, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return errorResult("missing-dependency", "cua-driver was not found on PATH. Install Cua Driver and retry.", params.action);
    }
    return errorResult("command-failed", redactDiagnostic(message, deps.debugDiagnostics), params.action);
  }
}

async function executeTranslated(params: ComputerUseParams, deps: ExecuteDeps): Promise<ComputerUseToolResult> {
  const action = normalizeAction(params.action);
  const timeout = deps.timeoutMs ?? 30_000;

  if (action === "wait") {
    const seconds = Math.max(0, params.seconds ?? 1);
    await (deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(seconds * 1000);
    return okResult("wait", { seconds }, undefined, "wait completed.");
  }

  if (action === "capture") return executeCapture(params, deps, timeout);
  if (action === "focus_app") return executeFocusApp(params, deps, timeout);

  const context = contextForAction(params, deps);
  const translated = buildTranslatedCuaCall(params, context);
  const result = await deps.runCua(translated.args, timeout);
  return await normalizeCuaResultAsync(result, { action: params.action, rawAction: translated.rawAction }, deps);
}

async function executeCapture(params: ComputerUseParams, deps: ExecuteDeps, timeout: number): Promise<ComputerUseToolResult> {
  const windowsResult = await deps.runCua(cuaCall("list_windows", params.app ? { app: params.app } : {}).args, timeout);
  const windowsNormalized = normalizeCuaResult(windowsResult, { action: "capture", rawAction: "list_windows" });
  if (!windowsNormalized.details.ok) return windowsNormalized;

  const windows = extractWindows(windowsNormalized.details.data);
  const window = selectUsableWindow(windows, params);
  if (!window) {
    return errorResult("no-usable-window", "No matching current-Space, on-screen, layer-0 window is available for background control. Ask the user to make the target window usable; no foregrounding fallback was used.", params.action);
  }

  const captureMode = params.mode ?? "som";
  const imageOnly = captureMode === "image" || captureMode === "screenshot";
  const payload = targetPayload(params, windowToContext(window, captureMode));
  payload.pid = window.pid;
  payload.window_id = window.windowId;

  let rawAction = "get_window_state";
  let args = cuaCall(rawAction, payload).args;
  let screenshotPath: string | undefined;
  if (imageOnly) {
    rawAction = "screenshot";
    const outDir = await mkdtemp(join(tmpdir(), "pi-cua-shot-"));
    screenshotPath = join(outDir, "capture.png");
    args = [...cuaCall(rawAction, payload).args, "--screenshot-out-file", screenshotPath];
  }

  const captureResult = await deps.runCua(args, timeout);
  const normalized = imageOnly && captureResult.code === 0 && screenshotPath
    ? await normalizeCuaResultAsync({ ...captureResult, stdout: JSON.stringify({ screenshot_path: screenshotPath, cli_stdout: captureResult.stdout }) }, { action: params.action, rawAction }, deps)
    : await normalizeCuaResultAsync(captureResult, { action: params.action, rawAction }, deps);
  if (!normalized.details.ok) return normalized;

  const elementCount = countElements(normalized.details.data);
  const warning = captureWarning(window, elementCount, normalized.details.warning);
  const partial = Boolean(warning);
  const shouldIssueContext = !partial || elementCount > 0 || imageOnly;
  let issued: CaptureContext | undefined;

  if (shouldIssueContext) {
    issued = deps.captureContexts?.issue({
      pid: window.pid,
      windowId: window.windowId,
      app: window.app,
      bundleId: window.bundleId,
      title: window.title,
      mode: captureMode,
      elementCount,
      partial,
    });
  }

  const data = objectData(normalized.details.data);
  normalized.details.data = {
    ...data,
    target: window,
    mode: captureMode,
    elementCount,
    ...(issued ? { recentCaptureId: issued.recentCaptureId } : {}),
  };
  if (warning) {
    normalized.details.warning = warning;
    normalized.content[0] = { type: "text", text: `capture completed with warning: ${warning}` };
  } else {
    normalized.content[0] = { type: "text", text: `capture completed for ${window.app ?? "selected window"}.${issued ? ` recentCaptureId: ${issued.recentCaptureId}` : ""}` };
  }
  return normalized;
}

async function executeFocusApp(params: ComputerUseParams, deps: ExecuteDeps, timeout: number): Promise<ComputerUseToolResult> {
  const windowsResult = await deps.runCua(cuaCall("list_windows", params.app ? { app: params.app } : {}).args, timeout);
  const normalized = normalizeCuaResult(windowsResult, { action: params.action, rawAction: "list_windows" });
  if (!normalized.details.ok) return normalized;
  const window = selectUsableWindow(extractWindows(normalized.details.data), params);
  if (!window) {
    return errorResult("no-usable-window", "focus_app could not find a usable target window and did not foreground, open, or deep-link the app.", params.action);
  }
  const issued = deps.captureContexts?.issue({ ...windowToContext(window, "focus"), elementCount: 0 });
  return okResult(params.action, { target: window, ...(issued ? { recentCaptureId: issued.recentCaptureId } : {}) }, undefined, `focus_app selected ${window.app ?? "target window"} without foregrounding.`);
}

export function normalizeCuaResult(result: CommandResult, params: Pick<ComputerUseParams, "action"> & { rawAction?: string }): ComputerUseToolResult {
  if (result.code !== 0) {
    return errorResult("command-failed", safeSummary(result.stderr || result.stdout || `cua-driver exited with code ${result.code}`), params.action, params.rawAction);
  }

  let data: unknown;
  try {
    data = parseCuaOutput(result.stdout);
  } catch {
    return errorResult("invalid-json", `cua-driver returned invalid JSON: ${safeSummary(result.stdout)}`, params.action, params.rawAction);
  }

  return normalizeParsedData(data, params.action, params.rawAction);
}

async function normalizeCuaResultAsync(result: CommandResult, params: Pick<ComputerUseParams, "action"> & { rawAction?: string }, deps: Pick<ExecuteDeps, "allowedScreenshotDirs"> = {}): Promise<ComputerUseToolResult> {
  const normalized = normalizeCuaResult(result, params);
  if (!normalized.details.ok) return normalized;

  const imagePath = findStringField(normalized.details.data, ["screenshot_path", "image_path", "path", "screenshot_out_file"]);
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

function normalizeParsedData(data: unknown, action: string, rawAction?: string): ComputerUseToolResult {
  const content: Array<ToolContentText | ToolContentImage> = [{ type: "text", text: `computer_use ${action} completed.` }];
  const extracted = extractMcpContent(data);
  content.push(...extracted.content);

  const base64 = extracted.imageBase64 ?? findStringField(data, ["screenshot_base64", "image_base64", "data"]);
  const mediaType = extracted.mimeType ?? findStringField(data, ["screenshot_media_type", "media_type", "mime_type"]) ?? "image/png";
  const hasValidImage = Boolean(base64 && isValidImageBase64(base64, mediaType));
  if (hasValidImage && base64 && !content.some((item) => item.type === "image")) {
    content.push({ type: "image", mimeType: mediaType, data: base64 });
  }

  const warning = action === "capture" && !hasValidImage && !findStringField(data, ["screenshot_path", "image_path", "path", "screenshot_out_file"])
    ? "capture succeeded but no usable image content was available."
    : undefined;
  if (warning) content[0] = { type: "text", text: warning };

  return { content, details: { ok: true, action, rawAction, data, warning } };
}

function parseCuaOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed);
}

function extractMcpContent(data: unknown): { content: Array<ToolContentText | ToolContentImage>; imageBase64?: string; mimeType?: string } {
  const content: Array<ToolContentText | ToolContentImage> = [];
  const items = Array.isArray((data as { content?: unknown } | undefined)?.content) ? (data as { content: unknown[] }).content : [];
  let imageBase64: string | undefined;
  let mimeType: string | undefined;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") content.push({ type: "text", text: safeSummary(record.text) });
    if (record.type === "image") {
      const dataValue = typeof record.data === "string" ? record.data : typeof record.image === "string" ? record.image : undefined;
      const media = typeof record.mimeType === "string" ? record.mimeType : typeof record.mime_type === "string" ? record.mime_type : "image/png";
      if (dataValue && isValidImageBase64(dataValue, media)) {
        imageBase64 = dataValue;
        mimeType = media;
        content.push({ type: "image", mimeType: media, data: dataValue });
      }
    }
  }
  return { content, imageBase64, mimeType };
}

function getProvenanceError(params: ComputerUseParams, deps: Pick<ExecuteDeps, "validRecentCaptureIds" | "captureContexts">): { code: string; message: string } | undefined {
  if (!params.recentCaptureId) return undefined;
  if (deps.captureContexts) {
    if (!deps.captureContexts.has(params.recentCaptureId)) return { code: "invalid-capture-context", message: "recentCaptureId is unknown, expired, or unavailable for this extension session." };
    return undefined;
  }
  if (!deps.validRecentCaptureIds?.has(params.recentCaptureId)) {
    return { code: "invalid-capture-context", message: "recentCaptureId was not issued by a successful capture in this extension session." };
  }
  return undefined;
}

function getSafetyError(params: ComputerUseParams): { code: string; message: string } | undefined {
  if (MUTATING_ACTIONS.has(params.action) && !params.targetDescription) {
    return { code: "target-context-required", message: "Mutating computer_use actions require targetDescription. recentCaptureId is provenance only, not target context." };
  }
  if (usesCoordinate(params) && !params.recentCaptureId) {
    return { code: "capture-context-required", message: "Coordinate actions use latest-capture image/window coordinates and require a valid recentCaptureId. Capture first or use an element index." };
  }
  if (params.action === "type") {
    const typeText = params.text ?? params.value;
    if (typeText && (SECRET_TEXT_PATTERN.test(typeText) || SECRET_VALUE_PATTERN.test(typeText) || OTP_PATTERN.test(typeText))) {
      return { code: "secret-blocked", message: "Refusing to type content that looks like a secret, credential, or verification code." };
    }
  }
  const target = params.targetDescription ?? "";
  if (target && SENSITIVE_SURFACE_PATTERN.test(target)) {
    return { code: "sensitive-surface", message: "Refusing to interact with a permission, password, payment, or 2FA surface." };
  }
  return undefined;
}

function errorResult(code: string, message: string, action?: string, rawAction?: string): ComputerUseToolResult {
  return { content: [{ type: "text", text: `computer_use error (${code}): ${message}` }], details: { ok: false, action, rawAction, error: { code, message } } };
}

function okResult(action: string, data: unknown, warning?: string, text = `computer_use ${action} completed.`): ComputerUseToolResult {
  return { content: [{ type: "text", text }], details: { ok: true, action, data, warning } };
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
  return Boolean(params.app || params.windowId !== undefined || params.pid !== undefined);
}

function buildApprovalMessage(params: ComputerUseParams, deps: Pick<ExecuteDeps, "captureApproved">): string {
  const lines = [`Approve macOS computer_use ${params.action}${params.action === "capture" && deps.captureApproved && !isScoped(params) ? " unscoped" : ""} action?`];
  lines.push(`Action: ${params.action}`);
  if (params.app || params.windowId !== undefined || params.pid !== undefined) {
    lines.push(`Target context: ${[params.app ? sanitizeApprovalField(params.app) : undefined, params.windowId !== undefined ? `window ${params.windowId}` : undefined, params.pid !== undefined ? `pid ${params.pid}` : undefined].filter(Boolean).join(" / ")}`);
  } else {
    lines.push("Target context: unscoped (privacy-sensitive)");
  }
  if (params.mode) lines.push(`Mode: ${sanitizeApprovalField(params.mode)}`);
  if (params.targetDescription) lines.push(`Target: ${sanitizeApprovalField(params.targetDescription)}`);
  const element = params.element ?? params.elementIndex;
  if (element !== undefined) lines.push(`Element: ${element}`);
  const coordinate = params.coordinate ?? pointFromXY(params.x, params.y);
  if (coordinate) lines.push(`Coordinate: ${coordinate.x},${coordinate.y} (latest-capture image/window coordinates; higher risk than element index)`);
  if (params.from_coordinate) lines.push(`From coordinate: ${params.from_coordinate.x},${params.from_coordinate.y}`);
  if (params.to_coordinate) lines.push(`To coordinate: ${params.to_coordinate.x},${params.to_coordinate.y}`);
  if (params.key || params.keys?.length) lines.push(`Keys: ${sanitizeApprovalField((params.keys ?? [params.key]).filter(Boolean).join("+"))}${/^(return|enter)$/i.test(params.key ?? "") ? " (confirm/submit risk)" : ""}`);
  if (params.text !== undefined) lines.push(`Text preview: ${redactTextPreview(params.text)}`);
  if (params.value !== undefined) lines.push(`Value preview: ${redactTextPreview(params.value)}`);
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
    .replace(/(\b(?:token|key|api[_-]?key|password|secret))=\S+/gi, "$1=[REDACTED_SECRET]")
    .replace(/\b[A-Za-z0-9_=-]{32,}\b/g, "[REDACTED_SECRET]")
    .replace(/(?:\/Users\/|\/home\/|\/private\/|\/var\/|\/tmp\/)[^\s:'\"]+/g, "[REDACTED_PATH]");
}

async function readValidatedScreenshotPath(path: string, allowedDirs?: string[]): Promise<ToolContentImage> {
  const defaults = ["/tmp", "/var/tmp", process.env.TMPDIR].filter((dir): dir is string => Boolean(dir));
  const allowed = await Promise.all((allowedDirs && allowedDirs.length > 0 ? allowedDirs : defaults).map((dir) => realpath(resolve(dir)).catch(() => resolve(dir))));
  const canonical = await realpath(path);
  if (!allowed.some((dir) => canonical === dir || canonical.startsWith(`${dir}/`))) throw new Error("outside allowed screenshot directories");
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

interface CuaWindow {
  pid?: number;
  windowId?: number;
  app?: string;
  bundleId?: string;
  title?: string;
  onScreen?: boolean;
  isOnCurrentSpace?: boolean;
  layer?: number;
  minimized?: boolean;
  hidden?: boolean;
  raw: Record<string, unknown>;
}

function extractWindows(data: unknown): CuaWindow[] {
  const source = objectData(data);
  const candidates = Array.isArray(source.windows) ? source.windows : Array.isArray(source.data) ? source.data : Array.isArray(data) ? data : [];
  return candidates.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((item) => ({
    pid: numberField(item, ["pid", "process_id"]),
    windowId: numberField(item, ["window_id", "windowId", "id"]),
    app: stringField(item, ["app", "app_name", "application", "owner_name", "name"]),
    bundleId: stringField(item, ["bundle_id", "bundleId"]),
    title: stringField(item, ["title", "window_title"]),
    onScreen: booleanField(item, ["on_screen", "is_on_screen", "onscreen"]),
    isOnCurrentSpace: booleanField(item, ["is_on_current_space", "current_space", "on_current_space"]),
    layer: numberField(item, ["layer", "window_layer"]),
    minimized: booleanField(item, ["minimized", "is_minimized"]),
    hidden: booleanField(item, ["hidden", "is_hidden"]),
    raw: item,
  }));
}

function selectUsableWindow(windows: CuaWindow[], params: ComputerUseParams): CuaWindow | undefined {
  const requested = params.app?.toLowerCase();
  const filtered = requested ? windows.filter((w) => [w.app, w.bundleId, w.title].some((v) => v?.toLowerCase().includes(requested))) : windows;
  return [...filtered].sort(windowScore).find((w) => w.pid !== undefined || w.windowId !== undefined);
}

function windowScore(a: CuaWindow, b: CuaWindow): number {
  return scoreWindow(b) - scoreWindow(a);
}

function scoreWindow(window: CuaWindow): number {
  let score = 0;
  if (window.isOnCurrentSpace !== false) score += 8;
  if (window.onScreen !== false) score += 4;
  if ((window.layer ?? 0) === 0) score += 2;
  if (!window.minimized && !window.hidden) score += 2;
  return score;
}

function captureWarning(window: CuaWindow, elementCount: number, existing?: string): string | undefined {
  const warnings: string[] = [];
  if (existing) warnings.push(existing);
  if (window.isOnCurrentSpace === false) warnings.push("target window appears off-Space");
  if (window.onScreen === false) warnings.push("target window is not on screen");
  if ((window.layer ?? 0) !== 0) warnings.push("target window is not layer 0 and may be a menu/status or thumbnail surface");
  if (window.minimized) warnings.push("target window is minimized");
  if (window.hidden) warnings.push("target app/window is hidden");
  if (elementCount > 0 && elementCount < 3) warnings.push("capture returned very few AX elements; background control may be unreliable");
  return warnings.length ? warnings.join("; ") : undefined;
}

function countElements(data: unknown): number {
  const source = objectData(data);
  const explicitCount = numberField(source, ["element_count", "elementCount", "ax_element_count"]);
  if (explicitCount !== undefined) return explicitCount;
  const candidates = [source.elements, source.ax_elements, source.tree, source.nodes, source.som];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.length;
    if (candidate && typeof candidate === "object") return countNodes(candidate);
  }
  return 0;
}

function countNodes(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  const children = Array.isArray(record.children) ? record.children : [];
  return 1 + children.reduce((sum, child) => sum + countNodes(child), 0);
}

function objectData(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (record.structuredContent && typeof record.structuredContent === "object") return record.structuredContent as Record<string, unknown>;
    return record;
  }
  return {};
}

function targetPayload(params: ComputerUseParams, context?: CaptureContext): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (params.app !== undefined) payload.app = params.app;
  if (context?.pid !== undefined) payload.pid = context.pid;
  if (context?.windowId !== undefined) payload.window_id = context.windowId;
  if (params.pid !== undefined) payload.pid = params.pid;
  if (params.windowId !== undefined) payload.window_id = params.windowId;
  return payload;
}

function contextForAction(params: ComputerUseParams, deps: ExecuteDeps): CaptureContext | undefined {
  if (!params.recentCaptureId) return undefined;
  const context = deps.captureContexts?.get(params.recentCaptureId);
  if (context) return context;
  return undefined;
}

function windowToContext(window: CuaWindow, mode?: string): CaptureContext {
  return { recentCaptureId: "", timestamp: 0, pid: window.pid, windowId: window.windowId, app: window.app, bundleId: window.bundleId, title: window.title, mode, elementCount: 0 };
}

function cuaCall(rawAction: string, payload: Record<string, unknown>): { args: string[]; rawAction: string; payload: Record<string, unknown> } {
  return { args: ["call", rawAction, JSON.stringify(payload)], rawAction, payload };
}

function keyParts(params: ComputerUseParams): string[] {
  if (params.keys?.length) return params.keys;
  const raw = params.key ?? "";
  const split = raw.split(/[+\-]/).map((part) => part.trim()).filter(Boolean);
  if (params.modifiers?.length) return [...params.modifiers, raw].filter(Boolean);
  return split.length ? split : raw ? [raw] : [];
}

function pointFromXY(x?: number, y?: number): Point | undefined {
  return x !== undefined && y !== undefined ? { x, y } : undefined;
}

function usesCoordinate(params: ComputerUseParams): boolean {
  return Boolean(params.coordinate || params.from_coordinate || params.to_coordinate || (params.x !== undefined && params.y !== undefined) || (params.toX !== undefined && params.toY !== undefined));
}

function stringField(record: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) if (typeof record[name] === "string") return record[name] as string;
  return undefined;
}

function numberField(record: Record<string, unknown>, names: string[]): number | undefined {
  for (const name of names) if (typeof record[name] === "number") return record[name] as number;
  return undefined;
}

function booleanField(record: Record<string, unknown>, names: string[]): boolean | undefined {
  for (const name of names) if (typeof record[name] === "boolean") return record[name] as boolean;
  return undefined;
}

export interface StatusCheckDeps {
  platform?: NodeJS.Platform | string;
  which: () => Promise<string | undefined>;
  version?: () => Promise<string | undefined>;
  checkPermissions?: () => Promise<CommandResult>;
}

export interface StatusCheckResult {
  platform: string;
  cua: { available: boolean; path?: string; version?: string };
  permissions: Array<{ name: string; status: "granted" | "denied" | "unknown" | "manual-check-required"; guidance: string }>;
  nextSteps: string[];
}

export async function statusCheck(deps: StatusCheckDeps): Promise<StatusCheckResult> {
  const platform = String(deps.platform ?? process.platform);
  const path = await deps.which();
  const version = path && deps.version ? await deps.version() : undefined;
  const nextSteps: string[] = [];
  let permissions: StatusCheckResult["permissions"] = [
    { name: "Accessibility", status: "manual-check-required", guidance: "Run `cua-driver call check_permissions` or verify Accessibility for CuaDriver.app and the Pi host." },
    { name: "Screen Recording", status: "manual-check-required", guidance: "Run `cua-driver call check_permissions` or verify Screen Recording for CuaDriver.app and the Pi host." },
  ];

  if (path && deps.checkPermissions) {
    const result = await deps.checkPermissions();
    if (result.code === 0) {
      try {
        const parsed = objectData(parseCuaOutput(result.stdout));
        permissions = permissions.map((permission) => {
          const key = permission.name.toLowerCase().replace(/\s+/g, "_");
          const raw = parsed[key] ?? parsed[permission.name] ?? parsed[permission.name.toLowerCase()];
          const granted = raw === true || raw === "granted" || (raw && typeof raw === "object" && (raw as Record<string, unknown>).granted === true);
          return { ...permission, status: granted ? "granted" : raw === false || raw === "denied" ? "denied" : "unknown", guidance: granted ? `${permission.name} appears granted for the active Cua daemon.` : permission.guidance };
        });
      } catch {
        nextSteps.push("`cua-driver call check_permissions` returned non-JSON output; use CuaDriver.app status and daemon restart guidance.");
      }
    } else {
      nextSteps.push("Permission probe failed. If CuaDriver.app is enabled but shell probes fail, restart the Cua daemon and re-run `cua-driver call check_permissions`.");
    }
  }

  if (platform !== "darwin") nextSteps.push("Use macOS for pi-macos-computer-use v1.");
  if (!path) nextSteps.push("Install Cua Driver and ensure cua-driver is on PATH.");

  return { platform, cua: { available: Boolean(path), path, version }, permissions, nextSteps };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
