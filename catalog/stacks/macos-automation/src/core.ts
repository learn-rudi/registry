import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const MAX_TITLE_LENGTH = 160;
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_SHORTCUT_NAME_LENGTH = 160;
export const DEFAULT_COMMAND_TIMEOUT_MS = 15000;
export const MAX_WINDOW_LIMIT = 50;
export const LAUNCH_AGENT_LABEL_PREFIX = "dev.rudi.";
export const MAX_LAUNCH_AGENT_COMMAND_ARGS = 40;
export const MAX_LAUNCH_AGENT_ENV_VARS = 20;
export const MAX_WATCH_PATHS = 20;
export const DEFAULT_KEEP_AWAKE_MINUTES = 60;
export const MAX_KEEP_AWAKE_MINUTES = 24 * 60;
export const KEEP_AWAKE_SESSION_ID_PREFIX = "awake-";

export type ToolArgs = Record<string, unknown> | undefined;

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: NodeJS.Signals | null;
}

export interface CommandOptions {
  timeoutMs?: number;
  input?: string;
}

export interface DetachedProcess {
  pid: number;
}

export interface CommandRunner {
  execFile(file: string, args: string[], options?: CommandOptions): Promise<CommandResult>;
  spawnDetached?(file: string, args: string[]): Promise<DetachedProcess> | DetachedProcess;
}

export interface ProcessManager {
  isAlive(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
}

export interface MacosAutomationDependencies {
  runner?: CommandRunner;
  processManager?: ProcessManager;
  platform?: NodeJS.Platform | string;
  homeDir?: string;
  uid?: number;
}

export interface OpenUrlInput {
  url: string;
}

export interface AppInput {
  app_name: string;
}

export interface NotificationInput {
  title: string;
  message: string;
  subtitle?: string;
  sound_name?: string;
}

export interface ShortcutInput {
  name: string;
  input_path?: string;
  output_path?: string;
  output_type?: string;
  confirm_run: boolean;
}

export interface ReminderDateParts {
  year: number;
  month: number;
  day: number;
  seconds_since_midnight: number;
}

export interface ReminderInput {
  title: string;
  notes?: string;
  list_name?: string;
  due_at?: string;
  due_date_parts?: ReminderDateParts;
  confirm_create: boolean;
}

export interface PathInput {
  path: string;
}

export interface ListWindowsInput {
  app_name?: string;
  limit: number;
}

export type LaunchAgentSchedule =
  | { type: "daily"; hour: number; minute: number }
  | { type: "interval"; seconds: number }
  | { type: "watch_paths"; paths: string[] };

export interface InstallLaunchAgentInput {
  label: string;
  command: string[];
  schedule: LaunchAgentSchedule;
  run_at_load: boolean;
  working_directory?: string;
  environment?: Record<string, string>;
  stdout_path?: string;
  stderr_path?: string;
  load_now: boolean;
  confirm_install: boolean;
}

export interface LaunchAgentLabelInput {
  label: string;
  confirm_remove: boolean;
  confirm_run: boolean;
}

export interface KeepAwakeStartInput {
  session_id?: string;
  duration_minutes: number;
  prevent_display_sleep: boolean;
  prevent_idle_sleep: boolean;
  prevent_disk_sleep: boolean;
  prevent_system_sleep: boolean;
  assert_user_active: boolean;
  reason?: string;
  confirm_start: boolean;
}

export interface KeepAwakeStopInput {
  session_id?: string;
  confirm_stop: boolean;
}

interface KeepAwakeSession {
  session_id: string;
  pid: number;
  started_at: string;
  expires_at: string;
  duration_seconds: number;
  reason?: string;
  command: string[];
  options: {
    prevent_display_sleep: boolean;
    prevent_idle_sleep: boolean;
    prevent_disk_sleep: boolean;
    prevent_system_sleep: boolean;
    assert_user_active: boolean;
  };
}

export interface ClassifiedMacosError {
  kind: "permission" | "not_found" | "unsupported_platform" | "command_failed";
  message: string;
  remediation?: string;
  stderr?: string;
  exitCode?: number;
}

export class MacosAutomationError extends Error {
  constructor(public readonly details: ClassifiedMacosError) {
    super(details.message);
    this.name = "MacosAutomationError";
  }
}

const defaultRunner: CommandRunner = {
  execFile(file: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
      const timer = setTimeout(() => {
        if (settled) return;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          exitCode: exitCode ?? (signal ? 1 : 0),
          signal,
        });
      });

      if (options.input !== undefined) {
        child.stdin.end(options.input);
      } else {
        child.stdin.end();
      }
    });
  },
  spawnDetached(file: string, args: string[]): DetachedProcess {
    const child = spawn(file, args, {
      stdio: "ignore",
      shell: false,
      detached: true,
    });
    child.unref();
    if (typeof child.pid !== "number") {
      throw new Error(`Failed to start detached process: ${file}`);
    }
    return { pid: child.pid };
  },
};

const defaultProcessManager: ProcessManager = {
  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: any) {
      if (error?.code === "ESRCH") return false;
      if (error?.code === "EPERM") return true;
      return false;
    }
  },
  kill(pid: number, signal: NodeJS.Signals): void {
    process.kill(pid, signal);
  },
};

function getRunner(deps: MacosAutomationDependencies = {}): CommandRunner {
  return deps.runner ?? defaultRunner;
}

function getProcessManager(
  deps: MacosAutomationDependencies = {}
): ProcessManager {
  return deps.processManager ?? defaultProcessManager;
}

function getHomeDir(deps: MacosAutomationDependencies = {}): string {
  return deps.homeDir ?? os.homedir();
}

function getUid(deps: MacosAutomationDependencies = {}): number {
  if (typeof deps.uid === "number") return deps.uid;
  if (typeof process.getuid === "function") return process.getuid();
  throw new Error("A numeric uid is required for launchctl on this platform");
}

function ensureMacos(deps: MacosAutomationDependencies = {}): void {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new MacosAutomationError({
      kind: "unsupported_platform",
      message: "This stack only supports macOS.",
      remediation: "Run this stack on macOS, or use a platform-specific automation stack.",
    });
  }
}

function trimCommandOutput(value: string): string {
  return value.replace(/\s+$/g, "");
}

function requireArgs(args: ToolArgs): Record<string, unknown> {
  return args ?? {};
}

function requireString(
  args: Record<string, unknown>,
  name: string,
  options: { maxLength?: number; allowNewline?: boolean } = {}
): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return validateText(value.trim(), name, options);
}

function optionalString(
  args: Record<string, unknown>,
  name: string,
  options: { maxLength?: number; allowNewline?: boolean } = {}
): string | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed ? validateText(trimmed, name, options) : undefined;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function validateText(
  value: string,
  name: string,
  options: { maxLength?: number; allowNewline?: boolean } = {}
): string {
  const maxLength = options.maxLength ?? MAX_MESSAGE_LENGTH;
  if (value.length > maxLength) {
    throw new Error(`${name} must be ${maxLength} characters or fewer`);
  }
  if (value.includes("\0")) {
    throw new Error(`${name} must not contain null bytes`);
  }
  if (!options.allowNewline && /[\r\n]/.test(value)) {
    throw new Error(`${name} must not contain newlines`);
  }
  if (/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    throw new Error(`${name} contains unsupported control characters`);
  }
  return value;
}

function optionalAbsolutePath(args: Record<string, unknown>, name: string): string | undefined {
  const value = optionalString(args, name, { maxLength: 2048 });
  if (!value) return undefined;
  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return value;
}

function requireAbsolutePath(args: Record<string, unknown>, name: string): string {
  const value = requireString(args, name, { maxLength: 2048 });
  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return value;
}

function validateAbsolutePathValue(value: string, name: string): string {
  const trimmed = validateText(value.trim(), name, { maxLength: 2048 });
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return trimmed;
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) return 20;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("limit must be an integer");
  }
  if (value < 1 || value > MAX_WINDOW_LIMIT) {
    throw new Error(`limit must be between 1 and ${MAX_WINDOW_LIMIT}`);
  }
  return value;
}

function parseInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

function parseDueDateParts(dueAt: string): ReminderDateParts {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error("due_at must be an ISO date or datetime");
  }
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    seconds_since_midnight:
      date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds(),
  };
}

function osascriptArgs(lines: string[], argv: string[] = []): string[] {
  return lines.flatMap((line) => ["-e", line]).concat(argv);
}

function launchAgentsDir(deps: MacosAutomationDependencies = {}): string {
  return path.join(getHomeDir(deps), "Library", "LaunchAgents");
}

function launchAgentPath(label: string, deps: MacosAutomationDependencies = {}): string {
  return path.join(launchAgentsDir(deps), `${label}.plist`);
}

function launchctlTarget(label: string, deps: MacosAutomationDependencies = {}): string {
  return `gui/${getUid(deps)}/${label}`;
}

function launchctlDomain(deps: MacosAutomationDependencies = {}): string {
  return `gui/${getUid(deps)}`;
}

function keepAwakeDir(deps: MacosAutomationDependencies = {}): string {
  return path.join(getHomeDir(deps), ".rudi", "state", "macos-automation", "keep-awake");
}

function keepAwakeSessionPath(
  sessionId: string,
  deps: MacosAutomationDependencies = {}
): string {
  return path.join(keepAwakeDir(deps), `${sessionId}.json`);
}

function createKeepAwakeSessionId(): string {
  return `${KEEP_AWAKE_SESSION_ID_PREFIX}${randomUUID()}`;
}

function buildCaffeinateArgs(input: KeepAwakeStartInput): string[] {
  const args: string[] = [];
  if (input.prevent_display_sleep) args.push("-d");
  if (input.prevent_idle_sleep) args.push("-i");
  if (input.prevent_disk_sleep) args.push("-m");
  if (input.prevent_system_sleep) args.push("-s");
  if (input.assert_user_active) args.push("-u");
  args.push("-t", String(input.duration_minutes * 60));
  return args;
}

function validateKeepAwakeSession(value: unknown): KeepAwakeSession | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const session = value as Partial<KeepAwakeSession>;
  try {
    if (
      typeof session.session_id !== "string" ||
      typeof session.pid !== "number" ||
      !Number.isInteger(session.pid) ||
      session.pid <= 1 ||
      typeof session.started_at !== "string" ||
      typeof session.expires_at !== "string" ||
      typeof session.duration_seconds !== "number" ||
      !Array.isArray(session.command)
    ) {
      return undefined;
    }
    parseKeepAwakeSessionId(session.session_id);
    if (session.command.some((item) => typeof item !== "string")) return undefined;
    return session as KeepAwakeSession;
  } catch {
    return undefined;
  }
}

async function readKeepAwakeSessionFile(
  filePath: string
): Promise<KeepAwakeSession | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return validateKeepAwakeSession(parsed);
  } catch {
    return undefined;
  }
}

async function readKeepAwakeSessions(
  deps: MacosAutomationDependencies = {},
  sessionId?: string
): Promise<KeepAwakeSession[]> {
  if (sessionId) {
    const session = await readKeepAwakeSessionFile(keepAwakeSessionPath(sessionId, deps));
    return session ? [session] : [];
  }

  let names: string[];
  try {
    names = await fs.readdir(keepAwakeDir(deps));
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const sessions: KeepAwakeSession[] = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    const sessionIdFromName = name.slice(0, -".json".length);
    try {
      parseKeepAwakeSessionId(sessionIdFromName);
    } catch {
      continue;
    }
    const session = await readKeepAwakeSessionFile(path.join(keepAwakeDir(deps), name));
    if (session) sessions.push(session);
  }
  return sessions;
}

function summarizeKeepAwakeSession(
  session: KeepAwakeSession,
  deps: MacosAutomationDependencies = {}
): Record<string, unknown> {
  const alive = getProcessManager(deps).isAlive(session.pid);
  const expired = Date.parse(session.expires_at) <= Date.now();
  const active = alive && !expired;
  return {
    ...session,
    active,
    status: active ? "running" : alive ? "expired" : "exited",
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function plistString(value: string): string {
  return `<string>${escapeXml(value)}</string>`;
}

function plistStringArray(values: string[]): string {
  return [
    "<array>",
    ...values.map((value) => `  ${plistString(value)}`),
    "</array>",
  ].join("\n");
}

function plistStringDict(values: Record<string, string>): string {
  const lines = ["<dict>"];
  for (const key of Object.keys(values).sort()) {
    lines.push(`  <key>${escapeXml(key)}</key>`);
    lines.push(`  ${plistString(values[key])}`);
  }
  lines.push("</dict>");
  return lines.join("\n");
}

function parseLaunchAgentLabel(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("label must be a non-empty string");
  }
  const label = value.trim();
  if (
    !label.startsWith(LAUNCH_AGENT_LABEL_PREFIX) ||
    !/^dev\.rudi\.[a-z0-9][a-z0-9.-]{0,120}$/.test(label) ||
    label.includes("..") ||
    label.endsWith(".")
  ) {
    throw new Error(`label must start with ${LAUNCH_AGENT_LABEL_PREFIX} and contain only lowercase letters, numbers, dots, and hyphens`);
  }
  return label;
}

function parseKeepAwakeSessionId(value: unknown, name = "session_id"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  const sessionId = value.trim();
  if (
    !/^[a-z0-9][a-z0-9.-]{0,80}$/.test(sessionId) ||
    sessionId.includes("..") ||
    sessionId.endsWith(".")
  ) {
    throw new Error(`${name} must contain only lowercase letters, numbers, dots, and hyphens`);
  }
  return sessionId;
}

function optionalKeepAwakeSessionId(
  args: Record<string, unknown>,
  name = "session_id"
): string | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === "") return undefined;
  return parseKeepAwakeSessionId(value, name);
}

function parseKeepAwakeDurationMinutes(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_KEEP_AWAKE_MINUTES;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("duration_minutes must be an integer");
  }
  if (value < 1 || value > MAX_KEEP_AWAKE_MINUTES) {
    throw new Error(`duration_minutes must be between 1 and ${MAX_KEEP_AWAKE_MINUTES}`);
  }
  return value;
}

function requireAtLeastOneKeepAwakeAssertion(input: KeepAwakeStartInput): void {
  if (
    !input.prevent_display_sleep &&
    !input.prevent_idle_sleep &&
    !input.prevent_disk_sleep &&
    !input.prevent_system_sleep &&
    !input.assert_user_active
  ) {
    throw new Error("At least one keep-awake option must be enabled");
  }
}

function parseCommand(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("command must be a non-empty array of strings");
  }
  if (value.length > MAX_LAUNCH_AGENT_COMMAND_ARGS) {
    throw new Error(`command must include ${MAX_LAUNCH_AGENT_COMMAND_ARGS} arguments or fewer`);
  }
  const command = value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`command[${index}] must be a non-empty string`);
    }
    return validateText(item.trim(), `command[${index}]`, {
      maxLength: 2048,
      allowNewline: false,
    });
  });
  if (!path.isAbsolute(command[0])) {
    throw new Error("command[0] must be an absolute path");
  }
  return command;
}

function parseEnvironment(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("environment must be an object");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_LAUNCH_AGENT_ENV_VARS) {
    throw new Error(`environment must include ${MAX_LAUNCH_AGENT_ENV_VARS} variables or fewer`);
  }
  const out: Record<string, string> = {};
  for (const [key, rawValue] of entries) {
    if (!/^[A-Z_][A-Z0-9_]{0,80}$/.test(key)) {
      throw new Error("environment keys must be uppercase shell-style names");
    }
    if (typeof rawValue !== "string") {
      throw new Error(`environment.${key} must be a string`);
    }
    out[key] = validateText(rawValue, `environment.${key}`, {
      maxLength: 2048,
      allowNewline: false,
    });
  }
  return out;
}

function parseLaunchAgentSchedule(value: unknown): LaunchAgentSchedule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("schedule must be an object");
  }
  const schedule = value as Record<string, unknown>;
  if (schedule.type === "daily") {
    const hour = parseInteger(schedule.hour, "schedule.hour");
    const minute = parseInteger(schedule.minute, "schedule.minute");
    if (hour < 0 || hour > 23) throw new Error("schedule.hour must be between 0 and 23");
    if (minute < 0 || minute > 59) throw new Error("schedule.minute must be between 0 and 59");
    return { type: "daily", hour, minute };
  }
  if (schedule.type === "interval") {
    const seconds = parseInteger(schedule.seconds, "schedule.seconds");
    if (seconds < 60 || seconds > 86400) {
      throw new Error("schedule.seconds must be between 60 and 86400");
    }
    return { type: "interval", seconds };
  }
  if (schedule.type === "watch_paths") {
    if (!Array.isArray(schedule.paths) || schedule.paths.length === 0) {
      throw new Error("schedule.paths must be a non-empty array");
    }
    if (schedule.paths.length > MAX_WATCH_PATHS) {
      throw new Error(`schedule.paths must include ${MAX_WATCH_PATHS} paths or fewer`);
    }
    return {
      type: "watch_paths",
      paths: schedule.paths.map((item, index) => {
        if (typeof item !== "string") {
          throw new Error(`schedule.paths[${index}] must be a string`);
        }
        return validateAbsolutePathValue(item, `schedule.paths[${index}]`);
      }),
    };
  }
  throw new Error("schedule.type must be daily, interval, or watch_paths");
}

function checkCommand(result: CommandResult): CommandResult {
  if (result.exitCode !== 0) {
    throw new MacosAutomationError(classifyMacosError(result));
  }
  return result;
}

async function runCommand(
  file: string,
  args: string[],
  deps: MacosAutomationDependencies = {},
  options: CommandOptions = {}
): Promise<CommandResult> {
  ensureMacos(deps);
  const result = await getRunner(deps).execFile(file, args, {
    timeoutMs: options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    input: options.input,
  });
  return checkCommand(result);
}

export function parseOpenUrlArgs(args: ToolArgs): OpenUrlInput {
  const raw = requireString(requireArgs(args), "url", { maxLength: 2048 });
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("url must be a valid http or https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("url must be a valid http or https URL");
  }
  return { url: parsed.href };
}

export function parseAppArgs(args: ToolArgs): AppInput {
  return {
    app_name: requireString(requireArgs(args), "app_name", {
      maxLength: MAX_SHORTCUT_NAME_LENGTH,
    }),
  };
}

export function parseNotificationArgs(args: ToolArgs): NotificationInput {
  const parsedArgs = requireArgs(args);
  return {
    title: requireString(parsedArgs, "title", { maxLength: MAX_TITLE_LENGTH }),
    message: requireString(parsedArgs, "message", {
      maxLength: MAX_MESSAGE_LENGTH,
      allowNewline: true,
    }),
    subtitle: optionalString(parsedArgs, "subtitle", { maxLength: MAX_TITLE_LENGTH }),
    sound_name: optionalString(parsedArgs, "sound_name", { maxLength: 80 }),
  };
}

export function parseShortcutArgs(args: ToolArgs): ShortcutInput {
  const parsedArgs = requireArgs(args);
  return {
    name: requireString(parsedArgs, "name", { maxLength: MAX_SHORTCUT_NAME_LENGTH }),
    input_path: optionalAbsolutePath(parsedArgs, "input_path"),
    output_path: optionalAbsolutePath(parsedArgs, "output_path"),
    output_type: optionalString(parsedArgs, "output_type", { maxLength: 120 }),
    confirm_run: parsedArgs.confirm_run === true,
  };
}

export function parseReminderArgs(args: ToolArgs): ReminderInput {
  const parsedArgs = requireArgs(args);
  const dueAt = optionalString(parsedArgs, "due_at", { maxLength: 80 });
  return {
    title: requireString(parsedArgs, "title", { maxLength: MAX_TITLE_LENGTH }),
    notes: optionalString(parsedArgs, "notes", {
      maxLength: MAX_MESSAGE_LENGTH,
      allowNewline: true,
    }),
    list_name: optionalString(parsedArgs, "list_name", { maxLength: MAX_TITLE_LENGTH }),
    due_at: dueAt,
    due_date_parts: dueAt ? parseDueDateParts(dueAt) : undefined,
    confirm_create: parsedArgs.confirm_create === true,
  };
}

export function parsePathArgs(args: ToolArgs): PathInput {
  return {
    path: requireAbsolutePath(requireArgs(args), "path"),
  };
}

export function parseListWindowsArgs(args: ToolArgs): ListWindowsInput {
  const parsedArgs = requireArgs(args);
  return {
    app_name: optionalString(parsedArgs, "app_name", { maxLength: MAX_TITLE_LENGTH }),
    limit: parseLimit(parsedArgs.limit),
  };
}

export function parseInstallLaunchAgentArgs(args: ToolArgs): InstallLaunchAgentInput {
  const parsedArgs = requireArgs(args);
  return {
    label: parseLaunchAgentLabel(parsedArgs.label),
    command: parseCommand(parsedArgs.command),
    schedule: parseLaunchAgentSchedule(parsedArgs.schedule),
    run_at_load: parsedArgs.run_at_load === true,
    working_directory: optionalAbsolutePath(parsedArgs, "working_directory"),
    environment: parseEnvironment(parsedArgs.environment),
    stdout_path: optionalAbsolutePath(parsedArgs, "stdout_path"),
    stderr_path: optionalAbsolutePath(parsedArgs, "stderr_path"),
    load_now: parsedArgs.load_now === true,
    confirm_install: parsedArgs.confirm_install === true,
  };
}

export function parseLaunchAgentLabelArgs(args: ToolArgs): LaunchAgentLabelInput {
  const parsedArgs = requireArgs(args);
  return {
    label: parseLaunchAgentLabel(parsedArgs.label),
    confirm_remove: parsedArgs.confirm_remove === true,
    confirm_run: parsedArgs.confirm_run === true,
  };
}

export function parseKeepAwakeStartArgs(args: ToolArgs): KeepAwakeStartInput {
  const parsedArgs = requireArgs(args);
  const input = {
    session_id: optionalKeepAwakeSessionId(parsedArgs),
    duration_minutes: parseKeepAwakeDurationMinutes(parsedArgs.duration_minutes),
    prevent_display_sleep: optionalBoolean(parsedArgs.prevent_display_sleep, "prevent_display_sleep") ?? false,
    prevent_idle_sleep: optionalBoolean(parsedArgs.prevent_idle_sleep, "prevent_idle_sleep") ?? true,
    prevent_disk_sleep: optionalBoolean(parsedArgs.prevent_disk_sleep, "prevent_disk_sleep") ?? false,
    prevent_system_sleep: optionalBoolean(parsedArgs.prevent_system_sleep, "prevent_system_sleep") ?? true,
    assert_user_active: optionalBoolean(parsedArgs.assert_user_active, "assert_user_active") ?? false,
    reason: optionalString(parsedArgs, "reason", { maxLength: MAX_TITLE_LENGTH }),
    confirm_start: parsedArgs.confirm_start === true,
  };
  requireAtLeastOneKeepAwakeAssertion(input);
  return input;
}

export function parseKeepAwakeStopArgs(args: ToolArgs): KeepAwakeStopInput {
  const parsedArgs = requireArgs(args);
  return {
    session_id: optionalKeepAwakeSessionId(parsedArgs),
    confirm_stop: parsedArgs.confirm_stop === true,
  };
}

export function buildLaunchAgentPlist(input: InstallLaunchAgentInput): string {
  const lines = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    `  ${plistString(input.label)}`,
    "  <key>ProgramArguments</key>",
    plistStringArray(input.command).split("\n").map((line) => `  ${line}`).join("\n"),
  ];

  if (input.run_at_load) {
    lines.push("  <key>RunAtLoad</key>");
    lines.push("  <true/>");
  }

  if (input.schedule.type === "daily") {
    lines.push("  <key>StartCalendarInterval</key>");
    lines.push("  <dict>");
    lines.push("    <key>Hour</key>");
    lines.push(`    <integer>${input.schedule.hour}</integer>`);
    lines.push("    <key>Minute</key>");
    lines.push(`    <integer>${input.schedule.minute}</integer>`);
    lines.push("  </dict>");
  } else if (input.schedule.type === "interval") {
    lines.push("  <key>StartInterval</key>");
    lines.push(`  <integer>${input.schedule.seconds}</integer>`);
  } else {
    lines.push("  <key>WatchPaths</key>");
    lines.push(plistStringArray(input.schedule.paths).split("\n").map((line) => `  ${line}`).join("\n"));
  }

  if (input.working_directory) {
    lines.push("  <key>WorkingDirectory</key>");
    lines.push(`  ${plistString(input.working_directory)}`);
  }
  if (input.environment && Object.keys(input.environment).length > 0) {
    lines.push("  <key>EnvironmentVariables</key>");
    lines.push(plistStringDict(input.environment).split("\n").map((line) => `  ${line}`).join("\n"));
  }
  if (input.stdout_path) {
    lines.push("  <key>StandardOutPath</key>");
    lines.push(`  ${plistString(input.stdout_path)}`);
  }
  if (input.stderr_path) {
    lines.push("  <key>StandardErrorPath</key>");
    lines.push(`  ${plistString(input.stderr_path)}`);
  }

  lines.push("</dict>");
  lines.push("</plist>");
  lines.push("");
  return lines.join("\n");
}

export function classifyMacosError(error: unknown): ClassifiedMacosError {
  const maybeResult = error as Partial<CommandResult> | undefined;
  const rawMessage =
    maybeResult?.stderr ||
    maybeResult?.stdout ||
    (error instanceof Error ? error.message : String(error));
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes("assistive access") ||
    normalized.includes("-25211") ||
    (normalized.includes("system events") && normalized.includes("not allowed"))
  ) {
    return {
      kind: "permission",
      message: "macOS Accessibility permission is required for System Events automation.",
      remediation:
        "Open System Settings > Privacy & Security > Accessibility and allow the terminal or agent host running RUDI.",
      stderr: maybeResult?.stderr,
      exitCode: maybeResult?.exitCode,
    };
  }

  if (
    normalized.includes("not authorized to send apple events") ||
    normalized.includes("not authorised to send apple events") ||
    normalized.includes("automation") && normalized.includes("not allowed")
  ) {
    return {
      kind: "permission",
      message: "macOS Automation permission is required for this app control action.",
      remediation:
        "Open System Settings > Privacy & Security > Automation and allow the terminal or agent host to control the target app.",
      stderr: maybeResult?.stderr,
      exitCode: maybeResult?.exitCode,
    };
  }

  if (
    normalized.includes("can't get application") ||
    normalized.includes("application isn't running") ||
    normalized.includes("application process is not running") ||
    normalized.includes("no such file")
  ) {
    return {
      kind: "not_found",
      message: trimCommandOutput(rawMessage) || "The requested macOS resource was not found.",
      stderr: maybeResult?.stderr,
      exitCode: maybeResult?.exitCode,
    };
  }

  return {
    kind: "command_failed",
    message: trimCommandOutput(rawMessage) || "macOS automation command failed.",
    stderr: maybeResult?.stderr,
    exitCode: maybeResult?.exitCode,
  };
}

export async function getStatus(): Promise<Record<string, unknown>> {
  const isDarwin = process.platform === "darwin";
  async function executable(file: string): Promise<boolean> {
    if (!isDarwin) return false;
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  return {
    platform: process.platform,
    supported: isDarwin,
    binaries: {
      osascript: await executable("/usr/bin/osascript"),
      open: await executable("/usr/bin/open"),
      shortcuts: await executable("/usr/bin/shortcuts"),
      screencapture: await executable("/usr/sbin/screencapture"),
      caffeinate: await executable("/usr/bin/caffeinate"),
    },
    permissions: {
      accessibility:
        "Required for System Events tools such as frontmost app and window inspection.",
      automation:
        "Required when controlling Finder, Reminders, or a target application.",
      shortcuts:
        "Running a Shortcut may prompt for permissions configured inside that Shortcut.",
    },
  };
}

export async function checkAccessibility(
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  const result = await runCommand(
    "/usr/bin/osascript",
    osascriptArgs([
      "tell application \"System Events\"",
      "return UI elements enabled",
      "end tell",
    ]),
    deps
  );
  return {
    ui_elements_enabled: trimCommandOutput(result.stdout).toLowerCase() === "true",
  };
}

export async function getFrontmostApp(
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  const result = await runCommand(
    "/usr/bin/osascript",
    osascriptArgs([
      "tell application \"System Events\"",
      "set frontApp to first application process whose frontmost is true",
      "return name of frontApp",
      "end tell",
    ]),
    deps
  );
  return { app_name: trimCommandOutput(result.stdout) };
}

export async function listWindows(
  input: ListWindowsInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  const result = await runCommand(
    "/usr/bin/osascript",
    osascriptArgs(
      [
        "on run argv",
        "set appName to item 1 of argv",
        "set maxItems to item 2 of argv as integer",
        "tell application \"System Events\"",
        "if appName is \"\" then",
        "set targetProcess to first application process whose frontmost is true",
        "else",
        "if not (exists application process appName) then error \"Application process is not running: \" & appName",
        "set targetProcess to application process appName",
        "end if",
        "set windowNames to {}",
        "repeat with windowItem in windows of targetProcess",
        "if (count of windowNames) is less than maxItems then set end of windowNames to name of windowItem",
        "end repeat",
        "set AppleScript's text item delimiters to linefeed",
        "return windowNames as text",
        "end tell",
        "end run",
      ],
      [input.app_name ?? "", String(input.limit)]
    ),
    deps
  );
  return {
    app_name: input.app_name,
    windows: trimCommandOutput(result.stdout).split("\n").filter(Boolean),
  };
}

export async function openUrl(
  input: OpenUrlInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  await runCommand("/usr/bin/open", [input.url], deps);
  return { opened: true, url: input.url };
}

export async function openApp(
  input: AppInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  await runCommand("/usr/bin/open", ["-a", input.app_name], deps);
  return { opened: true, app_name: input.app_name };
}

export async function focusApp(
  input: AppInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  await runCommand(
    "/usr/bin/osascript",
    osascriptArgs(
      [
        "on run argv",
        "tell application (item 1 of argv) to activate",
        "return item 1 of argv",
        "end run",
      ],
      [input.app_name]
    ),
    deps
  );
  return { focused: true, app_name: input.app_name };
}

export async function showNotification(
  input: NotificationInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  await runCommand(
    "/usr/bin/osascript",
    osascriptArgs(
      [
        "on run argv",
        "set notificationTitle to item 1 of argv",
        "set notificationMessage to item 2 of argv",
        "set notificationSubtitle to item 3 of argv",
        "set notificationSound to item 4 of argv",
        "if notificationSubtitle is \"\" and notificationSound is \"\" then",
        "display notification notificationMessage with title notificationTitle",
        "else if notificationSound is \"\" then",
        "display notification notificationMessage with title notificationTitle subtitle notificationSubtitle",
        "else if notificationSubtitle is \"\" then",
        "display notification notificationMessage with title notificationTitle sound name notificationSound",
        "else",
        "display notification notificationMessage with title notificationTitle subtitle notificationSubtitle sound name notificationSound",
        "end if",
        "return \"ok\"",
        "end run",
      ],
      [input.title, input.message, input.subtitle ?? "", input.sound_name ?? ""]
    ),
    deps
  );
  return { shown: true, title: input.title };
}

export async function listShortcuts(
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  const result = await runCommand("/usr/bin/shortcuts", ["list"], deps);
  return {
    shortcuts: trimCommandOutput(result.stdout).split("\n").filter(Boolean),
  };
}

export async function runShortcut(
  input: ShortcutInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  const args = ["run", input.name];
  if (input.input_path) args.push("--input-path", input.input_path);
  if (input.output_path) args.push("--output-path", input.output_path);
  if (input.output_type) args.push("--output-type", input.output_type);

  if (!input.confirm_run) {
    return {
      ran: false,
      dry_run: true,
      shortcut: input.name,
      command: ["/usr/bin/shortcuts", ...args],
      input_path: input.input_path,
      output_path: input.output_path,
      output_type: input.output_type,
    };
  }

  const result = await runCommand("/usr/bin/shortcuts", args, deps, {
    timeoutMs: 60000,
  });
  return {
    ran: true,
    dry_run: false,
    shortcut: input.name,
    stdout: trimCommandOutput(result.stdout),
    stderr: trimCommandOutput(result.stderr) || undefined,
  };
}

export async function createReminder(
  input: ReminderInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  if (!input.confirm_create) {
    return {
      created: false,
      dry_run: true,
      title: input.title,
      list_name: input.list_name,
      due_at: input.due_at,
      due_date_parts: input.due_date_parts,
    };
  }

  const due = input.due_date_parts;
  const result = await runCommand(
    "/usr/bin/osascript",
    osascriptArgs(
      [
        "on run argv",
        "set reminderTitle to item 1 of argv",
        "set reminderBody to item 2 of argv",
        "set listName to item 3 of argv",
        "set hasDueDate to item 4 of argv",
        "tell application \"Reminders\"",
        "if listName is \"\" then",
        "set targetList to default list",
        "else",
        "if not (exists list listName) then error \"Reminder list not found: \" & listName",
        "set targetList to list listName",
        "end if",
        "set newReminder to make new reminder at end of reminders of targetList with properties {name:reminderTitle}",
        "if reminderBody is not \"\" then set body of newReminder to reminderBody",
        "if hasDueDate is \"true\" then",
        "set dueDate to current date",
        "set year of dueDate to (item 5 of argv as integer)",
        "set month of dueDate to (item 6 of argv as integer)",
        "set day of dueDate to (item 7 of argv as integer)",
        "set time of dueDate to (item 8 of argv as integer)",
        "set remind me date of newReminder to dueDate",
        "end if",
        "return id of newReminder",
        "end tell",
        "end run",
      ],
      [
        input.title,
        input.notes ?? "",
        input.list_name ?? "",
        due ? "true" : "false",
        due ? String(due.year) : "",
        due ? String(due.month) : "",
        due ? String(due.day) : "",
        due ? String(due.seconds_since_midnight) : "",
      ]
    ),
    deps
  );

  return {
    created: true,
    dry_run: false,
    id: trimCommandOutput(result.stdout),
    title: input.title,
    list_name: input.list_name,
  };
}

export async function getSelectedFinderItems(
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  const result = await runCommand(
    "/usr/bin/osascript",
    osascriptArgs([
      "tell application \"Finder\"",
      "set selectedItems to selection as alias list",
      "set outputPaths to {}",
      "repeat with selectedItem in selectedItems",
      "set end of outputPaths to POSIX path of selectedItem",
      "end repeat",
      "set AppleScript's text item delimiters to linefeed",
      "return outputPaths as text",
      "end tell",
    ]),
    deps
  );
  return {
    paths: trimCommandOutput(result.stdout).split("\n").filter(Boolean),
  };
}

export async function revealInFinder(
  input: PathInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  await fs.access(input.path);
  await runCommand("/usr/bin/open", ["-R", input.path], deps);
  return {
    revealed: true,
    path: input.path,
  };
}

export async function startKeepAwake(
  input: KeepAwakeStartInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  ensureMacos(deps);
  const sessionId = input.session_id ?? createKeepAwakeSessionId();
  const args = buildCaffeinateArgs(input);
  const command = ["/usr/bin/caffeinate", ...args];
  const durationSeconds = input.duration_minutes * 60;

  if (!input.confirm_start) {
    return {
      started: false,
      dry_run: true,
      session_id: sessionId,
      duration_seconds: durationSeconds,
      reason: input.reason,
      command,
    };
  }

  const existing = await readKeepAwakeSessionFile(keepAwakeSessionPath(sessionId, deps));
  if (existing && getProcessManager(deps).isAlive(existing.pid)) {
    throw new Error(`keep-awake session is already running: ${sessionId}`);
  }

  const runner = getRunner(deps);
  if (!runner.spawnDetached) {
    throw new Error("runner does not support detached processes");
  }

  await fs.mkdir(keepAwakeDir(deps), { recursive: true });
  const startedAt = new Date();
  const child = await runner.spawnDetached("/usr/bin/caffeinate", args);
  const session: KeepAwakeSession = {
    session_id: sessionId,
    pid: child.pid,
    started_at: startedAt.toISOString(),
    expires_at: new Date(startedAt.getTime() + durationSeconds * 1000).toISOString(),
    duration_seconds: durationSeconds,
    reason: input.reason,
    command,
    options: {
      prevent_display_sleep: input.prevent_display_sleep,
      prevent_idle_sleep: input.prevent_idle_sleep,
      prevent_disk_sleep: input.prevent_disk_sleep,
      prevent_system_sleep: input.prevent_system_sleep,
      assert_user_active: input.assert_user_active,
    },
  };

  const sessionPath = keepAwakeSessionPath(sessionId, deps);
  await fs.writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.chmod(sessionPath, 0o600);

  return {
    started: true,
    dry_run: false,
    session_id: sessionId,
    pid: child.pid,
    duration_seconds: durationSeconds,
    expires_at: session.expires_at,
    reason: input.reason,
    command,
    rollback: {
      tool: "macos_keep_awake_stop",
      arguments: {
        session_id: sessionId,
        confirm_stop: true,
      },
    },
  };
}

export async function listKeepAwakeSessions(
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  ensureMacos(deps);
  const sessions = (await readKeepAwakeSessions(deps)).map((session) =>
    summarizeKeepAwakeSession(session, deps)
  );
  return {
    sessions,
    active_count: sessions.filter((session) => session.active === true).length,
  };
}

export async function stopKeepAwake(
  input: KeepAwakeStopInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  ensureMacos(deps);
  const sessions = await readKeepAwakeSessions(deps, input.session_id);
  const summaries = sessions.map((session) => summarizeKeepAwakeSession(session, deps));

  if (!input.confirm_stop) {
    return {
      stopped: false,
      dry_run: true,
      sessions: summaries,
      signal: "SIGTERM",
    };
  }

  const processManager = getProcessManager(deps);
  let killedCount = 0;
  let removedCount = 0;

  for (const session of sessions) {
    if (processManager.isAlive(session.pid)) {
      try {
        processManager.kill(session.pid, "SIGTERM");
        killedCount += 1;
      } catch (error: any) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await fs.rm(keepAwakeSessionPath(session.session_id, deps), { force: true });
    removedCount += 1;
  }

  return {
    stopped: removedCount > 0 || killedCount > 0,
    dry_run: false,
    session_id: input.session_id,
    killed_count: killedCount,
    removed_count: removedCount,
  };
}

function defaultLaunchAgentLogPaths(
  label: string,
  deps: MacosAutomationDependencies
): { stdout_path: string; stderr_path: string } {
  const logDir = path.join(getHomeDir(deps), ".rudi", "state", "macos-automation", "launchd");
  return {
    stdout_path: path.join(logDir, `${label}.out.log`),
    stderr_path: path.join(logDir, `${label}.err.log`),
  };
}

function withDefaultLaunchAgentPaths(
  input: InstallLaunchAgentInput,
  deps: MacosAutomationDependencies
): InstallLaunchAgentInput {
  const defaults = defaultLaunchAgentLogPaths(input.label, deps);
  return {
    ...input,
    stdout_path: input.stdout_path ?? defaults.stdout_path,
    stderr_path: input.stderr_path ?? defaults.stderr_path,
  };
}

export async function installLaunchAgent(
  input: InstallLaunchAgentInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  ensureMacos(deps);
  const pathToPlist = launchAgentPath(input.label, deps);
  const effectiveInput = withDefaultLaunchAgentPaths(input, deps);
  const plist = buildLaunchAgentPlist(effectiveInput);

  if (!input.confirm_install) {
    return {
      installed: false,
      loaded: false,
      dry_run: true,
      label: input.label,
      path: pathToPlist,
      plist,
      rollback: {
        tool: "macos_remove_launch_agent",
        arguments: {
          label: input.label,
          confirm_remove: true,
        },
      },
    };
  }

  await fs.mkdir(path.dirname(pathToPlist), { recursive: true });
  if (effectiveInput.stdout_path) await fs.mkdir(path.dirname(effectiveInput.stdout_path), { recursive: true });
  if (effectiveInput.stderr_path) await fs.mkdir(path.dirname(effectiveInput.stderr_path), { recursive: true });
  await fs.writeFile(pathToPlist, plist, { mode: 0o644 });
  await fs.chmod(pathToPlist, 0o644);

  let loaded = false;
  if (input.load_now) {
    await runCommand(
      "/bin/launchctl",
      ["bootstrap", launchctlDomain(deps), pathToPlist],
      deps
    );
    loaded = true;
  }

  return {
    installed: true,
    loaded,
    dry_run: false,
    label: input.label,
    path: pathToPlist,
    rollback: {
      tool: "macos_remove_launch_agent",
      arguments: {
        label: input.label,
        confirm_remove: true,
      },
    },
  };
}

export async function removeLaunchAgent(
  input: LaunchAgentLabelInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  ensureMacos(deps);
  const pathToPlist = launchAgentPath(input.label, deps);

  if (!input.confirm_remove) {
    return {
      removed: false,
      dry_run: true,
      label: input.label,
      path: pathToPlist,
      command: ["/bin/launchctl", "bootout", launchctlDomain(deps), pathToPlist],
    };
  }

  try {
    await fs.access(pathToPlist);
  } catch {
    return {
      removed: false,
      dry_run: false,
      label: input.label,
      path: pathToPlist,
      existed: false,
    };
  }

  try {
    await runCommand(
      "/bin/launchctl",
      ["bootout", launchctlDomain(deps), pathToPlist],
      deps
    );
  } catch (error) {
    const details = error instanceof MacosAutomationError ? error.details : undefined;
    if (!details?.message.toLowerCase().includes("not bootstrapped")) {
      throw error;
    }
  }
  await fs.rm(pathToPlist, { force: true });

  return {
    removed: true,
    dry_run: false,
    label: input.label,
    path: pathToPlist,
  };
}

export async function runLaunchAgentNow(
  input: LaunchAgentLabelInput,
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  ensureMacos(deps);
  const target = launchctlTarget(input.label, deps);
  if (!input.confirm_run) {
    return {
      started: false,
      dry_run: true,
      label: input.label,
      command: ["/bin/launchctl", "kickstart", "-k", target],
    };
  }

  await runCommand("/bin/launchctl", ["kickstart", "-k", target], deps);
  return {
    started: true,
    dry_run: false,
    label: input.label,
  };
}

export async function listLaunchAgents(
  deps: MacosAutomationDependencies = {}
): Promise<Record<string, unknown>> {
  const dir = launchAgentsDir(deps);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { agents: [] };
    }
    throw error;
  }

  return {
    agents: names
      .filter((name) => name.startsWith(LAUNCH_AGENT_LABEL_PREFIX) && name.endsWith(".plist"))
      .sort()
      .map((name) => {
        const label = name.slice(0, -".plist".length);
        return {
          label,
          path: path.join(dir, name),
        };
      }),
  };
}
