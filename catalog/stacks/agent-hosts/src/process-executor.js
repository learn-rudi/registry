import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export class NodeProcessExecutor {
  execute(request) {
    validateProcessExecutionRequest(request);
    if (request.signal?.aborted === true) {
      return Promise.resolve({
        cancelled: true,
        exitCode: null,
        startError: false,
        stderrHadOutput: false,
        stdout: "",
        stdoutOverflow: false,
        terminationConfirmed: true,
        timedOut: false,
      });
    }

    return new Promise((resolve) => {
      const child = spawn(request.command, [...request.arguments], {
        cwd: request.workingDirectory,
        detached: process.platform !== "win32",
        env: { ...request.environment },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdoutChunks = [];
      let stdoutBytes = 0;
      let stdoutOverflow = false;
      let stderrHadOutput = false;
      let timedOut = false;
      let cancelled = false;
      let startError = false;
      let settled = false;
      let killTimer;

      const signalProcess = (signal) => {
        if (child.pid === undefined) return;
        try {
          if (process.platform === "win32") child.kill(signal);
          else process.kill(-child.pid, signal);
        } catch {
          // A missing process group is already terminated.
        }
      };
      const terminate = () => {
        if (child.exitCode === null && child.signalCode === null) {
          signalProcess("SIGTERM");
          killTimer = setTimeout(() => signalProcess("SIGKILL"), 1_000);
          killTimer.unref();
        }
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, request.timeoutMs);
      timeout.unref();
      const onAbort = () => {
        cancelled = true;
        terminate();
      };
      request.signal?.addEventListener("abort", onAbort, { once: true });

      const confirmTermination = async (terminationRequested) => {
        if (!terminationRequested || process.platform === "win32") return true;
        const deadline = Date.now() + 1_000;
        while (isProcessGroupAlive(child.pid) && Date.now() < deadline) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        }
        return !isProcessGroupAlive(child.pid);
      };
      const settle = (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (killTimer !== undefined) clearTimeout(killTimer);
        if (timedOut || cancelled || stdoutOverflow) signalProcess("SIGKILL");
        request.signal?.removeEventListener("abort", onAbort);
        const terminationRequested = timedOut
          || cancelled
          || stdoutOverflow
          || isProcessGroupAlive(child.pid);
        if (terminationRequested) signalProcess("SIGKILL");
        void confirmTermination(terminationRequested).then((terminationConfirmed) => {
          resolve({
            cancelled,
            exitCode,
            startError,
            stderrHadOutput,
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stdoutOverflow,
            terminationConfirmed,
            timedOut,
          });
        });
      };

      child.stdout.on("data", (chunk) => {
        if (stdoutOverflow) return;
        stdoutBytes += chunk.length;
        if (stdoutBytes > request.maxStdoutBytes) {
          stdoutOverflow = true;
          stdoutChunks.length = 0;
          terminate();
          return;
        }
        stdoutChunks.push(Buffer.from(chunk));
      });
      child.stderr.on("data", () => {
        stderrHadOutput = true;
      });
      child.on("error", () => {
        startError = true;
        settle(null);
      });
      child.on("close", (code) => settle(code));
      child.stdin.on("error", () => {
        // Some providers close stdin immediately; exit handling owns the result.
      });
      child.stdin.end(request.stdin, "utf8");
    });
  }
}

function canonicalPath(candidate) {
  const absolute = resolve(candidate);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function isInsidePath(root, candidate) {
  const child = relative(root, candidate);
  return child === "" || (
    child !== ".."
    && !child.startsWith(`..${sep}`)
    && !isAbsolute(child)
  );
}

function sanitizeAgentHostPath(source, binaryPath) {
  const home = source.HOME ?? homedir();
  const rudiRoots = [join(home, ".rudi"), source.RUDI_HOME, process.env.RUDI_HOME]
    .filter((root) => typeof root === "string" && isAbsolute(root))
    .flatMap((root) => [resolve(root), canonicalPath(root)]);
  const entries = [
    ...(typeof binaryPath === "string" && isAbsolute(binaryPath) ? [dirname(binaryPath)] : []),
    ...(source.PATH ?? "").split(delimiter),
  ].filter((entry) => {
    if (entry.length === 0 || !isAbsolute(entry)) return false;
    const lexicalEntry = resolve(entry);
    const canonicalEntry = canonicalPath(entry);
    return !rudiRoots.some((root) => (
      isInsidePath(root, lexicalEntry) || isInsidePath(root, canonicalEntry)
    ));
  });
  return [...new Set(entries)].join(delimiter);
}

export function createMinimalAgentHostEnvironment(source = process.env, options = {}) {
  const allowed = [
    "CODEX_HOME",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOGNAME",
    "NO_COLOR",
    "PATH",
    "SHELL",
    "TERM",
    "TMPDIR",
    "USER",
  ];
  const environment = { NO_COLOR: "1" };
  for (const name of allowed) {
    const value = source[name];
    if (typeof value === "string" && value.length > 0) {
      environment[name] = value;
    }
  }
  if (typeof source.PATH === "string") {
    environment.PATH = sanitizeAgentHostPath(source, options.binaryPath);
  }
  return environment;
}

function isProcessGroupAlive(processId) {
  if (processId === undefined || process.platform === "win32") return false;
  try {
    process.kill(-processId, 0);
    return true;
  } catch {
    return false;
  }
}

function validateProcessExecutionRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Agent Host process request is invalid.");
  }
  if (!isAbsolute(request.command)) {
    throw new Error("Agent Host process command must be absolute.");
  }
  if (!isAbsolute(request.workingDirectory)) {
    throw new Error("Agent Host process working directory must be absolute.");
  }
  if (
    !Array.isArray(request.arguments)
    || request.arguments.length > 100
    || request.arguments.some((argument) => (
      typeof argument !== "string" || argument.length > 4_096 || argument.includes("\0")
    ))
  ) {
    throw new Error("Agent Host process arguments are invalid.");
  }
  if (
    !Number.isInteger(request.timeoutMs)
    || request.timeoutMs < 100
    || request.timeoutMs > 900_000
  ) {
    throw new Error("Agent Host process timeout is invalid.");
  }
  if (
    !Number.isInteger(request.maxStdoutBytes)
    || request.maxStdoutBytes < 1_024
    || request.maxStdoutBytes > 8_388_608
  ) {
    throw new Error("Agent Host stdout bound is invalid.");
  }
  if (typeof request.stdin !== "string") {
    throw new Error("Agent Host stdin is invalid.");
  }
  if (
    !request.environment
    || typeof request.environment !== "object"
    || Array.isArray(request.environment)
    || Object.values(request.environment).some((value) => typeof value !== "string")
  ) {
    throw new Error("Agent Host process environment is invalid.");
  }
}
