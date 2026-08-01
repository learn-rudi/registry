import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildLaunchAgentPlist,
  classifyMacosError,
  collectAutomationInventory,
  createReminder,
  getSelectedFinderItems,
  installLaunchAgent,
  listKeepAwakeSessions,
  listLaunchAgents,
  parseKeepAwakeStartArgs,
  parseKeepAwakeStopArgs,
  parseOpenUrlArgs,
  parseReminderArgs,
  parseInstallLaunchAgentArgs,
  parseLaunchAgentLabelArgs,
  removeLaunchAgent,
  renderAutomationDashboardHtml,
  runLaunchAgentNow,
  parseShortcutArgs,
  runShortcut,
  startKeepAwake,
  stopKeepAwake,
} from "../dist/core.js";

function makeRunner(result = { stdout: "", stderr: "", exitCode: 0 }, spawnResult = { pid: 4321 }) {
  const calls = [];
  const spawnCalls = [];
  return {
    calls,
    spawnCalls,
    runner: {
      execFile: async (file, args, options) => {
        calls.push({ file, args, options });
        return result;
      },
      spawnDetached: async (file, args) => {
        spawnCalls.push({ file, args });
        return spawnResult;
      },
    },
  };
}

function makeRoutingRunner(routes) {
  const calls = [];
  return {
    calls,
    runner: {
      execFile: async (file, args, options) => {
        calls.push({ file, args, options });
        const key = `${file} ${args.join(" ")}`;
        const route = routes[key] ?? routes[file];
        if (route) return route;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    },
  };
}

test("open URL args only allow http and https URLs", () => {
  assert.deepEqual(parseOpenUrlArgs({ url: "https://example.com/path" }), {
    url: "https://example.com/path",
  });

  assert.throws(() => parseOpenUrlArgs({ url: "javascript:alert(1)" }), /http or https/);
  assert.throws(() => parseOpenUrlArgs({ url: "x-apple.systempreferences:Security" }), /http or https/);
});

test("shortcut execution dry-runs unless explicitly confirmed", async () => {
  const input = parseShortcutArgs({
    name: "Prepare Content Workspace",
    input_path: "/tmp/source.mov",
  });
  const { calls, runner } = makeRunner();

  const result = await runShortcut(input, { runner });

  assert.equal(result.ran, false);
  assert.equal(result.dry_run, true);
  assert.equal(result.shortcut, "Prepare Content Workspace");
  assert.equal(calls.length, 0);
});

test("confirmed shortcut execution uses the shortcuts CLI without a shell", async () => {
  const input = parseShortcutArgs({
    name: "Prepare Content Workspace",
    input_path: "/tmp/source.mov",
    output_path: "/tmp/out.txt",
    confirm_run: true,
  });
  const { calls, runner } = makeRunner({ stdout: "done\n", stderr: "", exitCode: 0 });

  const result = await runShortcut(input, { runner });

  assert.equal(result.ran, true);
  assert.equal(result.stdout, "done");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "/usr/bin/shortcuts");
  assert.deepEqual(calls[0].args, [
    "run",
    "Prepare Content Workspace",
    "--input-path",
    "/tmp/source.mov",
    "--output-path",
    "/tmp/out.txt",
  ]);
});

test("reminder creation validates and normalizes due_at", async () => {
  const input = parseReminderArgs({
    title: "Shoot the product demo",
    notes: "Capture vertical and landscape takes.",
    list_name: "RUDI",
    due_at: "2026-06-27T14:30:00-04:00",
  });

  assert.equal(input.title, "Shoot the product demo");
  assert.deepEqual(input.due_date_parts, {
    year: 2026,
    month: 6,
    day: 27,
    seconds_since_midnight: 52200,
  });

  const { calls, runner } = makeRunner();
  const result = await createReminder(input, { runner });

  assert.equal(result.created, false);
  assert.equal(result.dry_run, true);
  assert.equal(calls.length, 0);
});

test("confirmed reminder creation passes user values as osascript argv", async () => {
  const input = parseReminderArgs({
    title: "Follow up with prospect",
    notes: "Send the short proposal.",
    list_name: "Business",
    due_at: "2026-06-27T10:00:00-04:00",
    confirm_create: true,
  });
  const { calls, runner } = makeRunner({ stdout: "x-apple-reminder://123\n", stderr: "", exitCode: 0 });

  const result = await createReminder(input, { runner });

  assert.equal(result.created, true);
  assert.equal(result.id, "x-apple-reminder://123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "/usr/bin/osascript");
  assert.ok(calls[0].args.includes("tell application \"Reminders\""));
  assert.deepEqual(calls[0].args.slice(-8), [
    "Follow up with prospect",
    "Send the short proposal.",
    "Business",
    "true",
    "2026",
    "6",
    "27",
    "36000",
  ]);
});

test("Finder selection parser returns newline-delimited POSIX paths", async () => {
  const { runner } = makeRunner({
    stdout: "/tmp/rudi-a.mov\n/tmp/rudi-b.mov\n",
    stderr: "",
    exitCode: 0,
  });

  const result = await getSelectedFinderItems({ runner });

  assert.deepEqual(result.paths, [
    "/tmp/rudi-a.mov",
    "/tmp/rudi-b.mov",
  ]);
});

test("macOS permission errors are classified with a usable remediation", () => {
  const classified = classifyMacosError({
    stderr: "System Events got an error: osascript is not allowed assistive access. (-25211)",
    exitCode: 1,
  });

  assert.equal(classified.kind, "permission");
  assert.match(classified.message, /Accessibility/);
  assert.match(classified.remediation, /System Settings/);
});

test("LaunchAgent install args validate label scope, command, and daily schedule", () => {
  const input = parseInstallLaunchAgentArgs({
    label: "dev.rudi.daily-brief",
    command: ["/usr/bin/shortcuts", "run", "Daily Brief"],
    schedule: { type: "daily", hour: 8, minute: 30 },
    run_at_load: true,
  });

  assert.equal(input.label, "dev.rudi.daily-brief");
  assert.deepEqual(input.command, ["/usr/bin/shortcuts", "run", "Daily Brief"]);
  assert.deepEqual(input.schedule, { type: "daily", hour: 8, minute: 30 });
  assert.equal(input.run_at_load, true);
  assert.equal(input.confirm_install, false);

  assert.throws(
    () => parseInstallLaunchAgentArgs({
      label: "com.apple.bad-idea",
      command: ["/bin/echo", "hello"],
      schedule: { type: "interval", seconds: 300 },
    }),
    /dev\.rudi/
  );

  assert.throws(
    () => parseInstallLaunchAgentArgs({
      label: "dev.rudi.shell",
      command: ["sh", "-c", "echo unsafe"],
      schedule: { type: "interval", seconds: 300 },
    }),
    /absolute path/
  );
});

test("LaunchAgent plist escapes user values and models interval schedules", () => {
  const input = parseInstallLaunchAgentArgs({
    label: "dev.rudi.content-sync",
    command: ["/bin/echo", "a & b", "<done>"],
    schedule: { type: "interval", seconds: 900 },
    stdout_path: "/tmp/rudi launchd/out.log",
    stderr_path: "/tmp/rudi launchd/err.log",
  });

  const plist = buildLaunchAgentPlist(input);

  assert.match(plist, /<key>Label<\/key>\s*<string>dev\.rudi\.content-sync<\/string>/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
  assert.match(plist, /a &amp; b/);
  assert.match(plist, /&lt;done&gt;/);
  assert.match(plist, /<key>StandardOutPath<\/key>/);
});

test("LaunchAgent install dry-runs without writing or loading", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-launchd-home-"));
  const { calls, runner } = makeRunner();
  const input = parseInstallLaunchAgentArgs({
    label: "dev.rudi.dry-run",
    command: ["/bin/echo", "hello"],
    schedule: { type: "interval", seconds: 600 },
  });

  const result = await installLaunchAgent(input, { runner, homeDir });

  assert.equal(result.installed, false);
  assert.equal(result.dry_run, true);
  assert.match(result.plist, /dev\.rudi\.dry-run/);
  assert.equal(calls.length, 0);

  await assert.rejects(
    () => fs.stat(path.join(homeDir, "Library/LaunchAgents/dev.rudi.dry-run.plist")),
    /ENOENT/
  );
});

test("confirmed LaunchAgent install writes plist and can bootstrap", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-launchd-home-"));
  const { calls, runner } = makeRunner();
  const input = parseInstallLaunchAgentArgs({
    label: "dev.rudi.installed",
    command: ["/bin/echo", "hello"],
    schedule: { type: "daily", hour: 9, minute: 15 },
    load_now: true,
    confirm_install: true,
  });

  const result = await installLaunchAgent(input, { runner, homeDir, uid: 501 });

  assert.equal(result.installed, true);
  assert.equal(result.loaded, true);
  assert.equal(result.path, path.join(homeDir, "Library/LaunchAgents/dev.rudi.installed.plist"));
  assert.deepEqual(calls[0], {
    file: "/bin/launchctl",
    args: ["bootstrap", "gui/501", result.path],
    options: { timeoutMs: 15000, input: undefined },
  });
  assert.match(await fs.readFile(result.path, "utf8"), /dev\.rudi\.installed/);
});

test("LaunchAgent remove dry-runs and confirmed remove unloads then deletes", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-launchd-home-"));
  const launchAgents = path.join(homeDir, "Library/LaunchAgents");
  await fs.mkdir(launchAgents, { recursive: true });
  const plistPath = path.join(launchAgents, "dev.rudi.cleanup.plist");
  await fs.writeFile(plistPath, "<plist />");
  const { calls, runner } = makeRunner({ stdout: "", stderr: "", exitCode: 0 });

  const dryRun = await removeLaunchAgent(
    parseLaunchAgentLabelArgs({ label: "dev.rudi.cleanup" }),
    { runner, homeDir, uid: 501 }
  );
  assert.equal(dryRun.removed, false);
  assert.equal(await fs.readFile(plistPath, "utf8"), "<plist />");

  const removed = await removeLaunchAgent(
    parseLaunchAgentLabelArgs({ label: "dev.rudi.cleanup", confirm_remove: true }),
    { runner, homeDir, uid: 501 }
  );
  assert.equal(removed.removed, true);
  assert.deepEqual(calls[0].args, ["bootout", "gui/501", plistPath]);
  await assert.rejects(() => fs.stat(plistPath), /ENOENT/);
});

test("LaunchAgent run-now dry-runs unless explicitly confirmed", async () => {
  const { calls, runner } = makeRunner();
  const dryRun = await runLaunchAgentNow(
    parseLaunchAgentLabelArgs({ label: "dev.rudi.daily-brief" }),
    { runner, uid: 501 }
  );
  assert.equal(dryRun.started, false);
  assert.equal(calls.length, 0);

  const started = await runLaunchAgentNow(
    parseLaunchAgentLabelArgs({ label: "dev.rudi.daily-brief", confirm_run: true }),
    { runner, uid: 501 }
  );
  assert.equal(started.started, true);
  assert.deepEqual(calls[0].args, ["kickstart", "-k", "gui/501/dev.rudi.daily-brief"]);
});

test("LaunchAgent list only returns dev.rudi plist files", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-launchd-home-"));
  const launchAgents = path.join(homeDir, "Library/LaunchAgents");
  await fs.mkdir(launchAgents, { recursive: true });
  await fs.writeFile(path.join(launchAgents, "dev.rudi.one.plist"), "<plist />");
  await fs.writeFile(path.join(launchAgents, "com.other.agent.plist"), "<plist />");

  const result = await listLaunchAgents({ homeDir });

  assert.deepEqual(result.agents, [
    {
      label: "dev.rudi.one",
      path: path.join(launchAgents, "dev.rudi.one.plist"),
    },
  ]);
});

test("keep-awake start dry-runs a bounded caffeinate command", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-awake-home-"));
  const { spawnCalls, runner } = makeRunner();
  const input = parseKeepAwakeStartArgs({
    session_id: "render-session",
    duration_minutes: 90,
    prevent_display_sleep: true,
    reason: "Rendering short-form video exports",
  });

  const result = await startKeepAwake(input, { runner, homeDir });

  assert.equal(result.started, false);
  assert.equal(result.dry_run, true);
  assert.equal(result.session_id, "render-session");
  assert.deepEqual(result.command, ["/usr/bin/caffeinate", "-d", "-i", "-s", "-t", "5400"]);
  assert.equal(spawnCalls.length, 0);
  await assert.rejects(
    () => fs.stat(path.join(homeDir, ".rudi/state/macos-automation/keep-awake/render-session.json")),
    /ENOENT/
  );

  assert.throws(
    () => parseKeepAwakeStartArgs({ duration_minutes: 0 }),
    /duration_minutes/
  );
});

test("confirmed keep-awake start spawns caffeinate and persists session state", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-awake-home-"));
  const { spawnCalls, runner } = makeRunner(undefined, { pid: 9876 });
  const processManager = {
    isAlive: (pid) => pid === 9876,
    kill: () => undefined,
  };
  const input = parseKeepAwakeStartArgs({
    session_id: "meeting-block",
    duration_minutes: 30,
    prevent_system_sleep: false,
    reason: "Client call recording",
    confirm_start: true,
  });

  const result = await startKeepAwake(input, { runner, homeDir });

  assert.equal(result.started, true);
  assert.equal(result.pid, 9876);
  assert.deepEqual(spawnCalls[0], {
    file: "/usr/bin/caffeinate",
    args: ["-i", "-t", "1800"],
  });

  const sessionPath = path.join(homeDir, ".rudi/state/macos-automation/keep-awake/meeting-block.json");
  const saved = JSON.parse(await fs.readFile(sessionPath, "utf8"));
  assert.equal(saved.pid, 9876);
  assert.equal(saved.reason, "Client call recording");

  const status = await listKeepAwakeSessions({ homeDir, processManager });
  assert.equal(status.active_count, 1);
  assert.equal(status.sessions[0].session_id, "meeting-block");
  assert.equal(status.sessions[0].active, true);
});

test("keep-awake stop dry-runs then kills managed caffeinate sessions", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-awake-home-"));
  const { runner } = makeRunner(undefined, { pid: 2468 });
  const killed = [];
  const processManager = {
    isAlive: (pid) => pid === 2468,
    kill: (pid, signal) => killed.push({ pid, signal }),
  };

  await startKeepAwake(
    parseKeepAwakeStartArgs({
      session_id: "long-export",
      duration_minutes: 45,
      confirm_start: true,
    }),
    { runner, homeDir }
  );

  const dryRun = await stopKeepAwake(
    parseKeepAwakeStopArgs({ session_id: "long-export" }),
    { homeDir, processManager }
  );
  assert.equal(dryRun.stopped, false);
  assert.equal(killed.length, 0);

  const stopped = await stopKeepAwake(
    parseKeepAwakeStopArgs({ session_id: "long-export", confirm_stop: true }),
    { homeDir, processManager }
  );
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.killed_count, 1);
  assert.deepEqual(killed, [{ pid: 2468, signal: "SIGTERM" }]);
  await assert.rejects(
    () => fs.stat(path.join(homeDir, ".rudi/state/macos-automation/keep-awake/long-export.json")),
    /ENOENT/
  );
});

test("automation inventory combines launchd, cron, shortcuts, and sleep assertions", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-dashboard-home-"));
  const launchAgents = path.join(homeDir, "Library/LaunchAgents");
  await fs.mkdir(launchAgents, { recursive: true });
  await fs.writeFile(
    path.join(launchAgents, "dev.rudi.daily.plist"),
    buildLaunchAgentPlist(parseInstallLaunchAgentArgs({
      label: "dev.rudi.daily",
      command: ["/bin/echo", "hello"],
      schedule: { type: "daily", hour: 8, minute: 30 },
      run_at_load: true,
    }))
  );

  const { runner } = makeRoutingRunner({
    "/bin/launchctl list": {
      stdout: "123\t0\tdev.rudi.daily\n-\t78\tcom.example.failed\n",
      stderr: "",
      exitCode: 0,
    },
    "/usr/bin/crontab -l": {
      stdout: "30 7 * * * echo morning # sample\n",
      stderr: "",
      exitCode: 0,
    },
    "/usr/bin/atq": { stdout: "", stderr: "", exitCode: 0 },
    "/usr/bin/shortcuts list": {
      stdout: "Ask Claude\nTurn Text Into Audio\n",
      stderr: "",
      exitCode: 0,
    },
    "/usr/bin/pmset -g assertions": {
      stdout: [
        "Assertion status system-wide:",
        "   PreventSystemSleep             1",
        "Listed by owning process:",
        "   pid 39339(caffeinate): [0x1] PreventSystemSleep named: \"caffeinate command-line tool\"",
        "\tDetails: caffeinate asserting for 86400 secs",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    },
    "/usr/bin/pgrep -afil caffeinate": {
      stdout: "39339 /usr/bin/caffeinate -dimsu -t 86400\n",
      stderr: "",
      exitCode: 0,
    },
  });

  const inventory = await collectAutomationInventory({
    runner,
    homeDir,
    platform: "darwin",
    uid: 501,
    launchdRoots: [{ domain: "user", dir: launchAgents }],
  });

  assert.equal(inventory.launchd.summary.total, 1);
  assert.equal(inventory.launchd.summary.loaded, 1);
  assert.equal(inventory.cron.entries.length, 1);
  assert.equal(inventory.shortcuts.count, 2);
  assert.equal(inventory.sleep.preventing_sleep, true);
  assert.equal(inventory.sleep.caffeinate_processes.length, 1);
});

test("automation dashboard HTML escapes inventory values", () => {
  const html = renderAutomationDashboardHtml({
    generated_at: "2026-07-13T22:00:00.000Z",
    platform: "darwin",
    launchd: {
      summary: { total: 1, loaded: 0, scheduled: 1, triggers: 0, keep_alive: 0, broken: 0, stale: 0 },
      items: [
        {
          label: "dev.rudi.<script>alert(1)</script>",
          domain: "user",
          path: "/tmp/dev.rudi.bad.plist",
          loaded: false,
          pid: null,
          last_exit_status: null,
          schedules: ["daily 08:30"],
          triggers: [],
          keep_alive: false,
          run_at_load: false,
          command: ["/bin/echo", "<unsafe>"],
          warnings: [],
        },
      ],
    },
    cron: { entries: [], available: true },
    at: { jobs: [], available: true },
    shortcuts: { shortcuts: [], count: 0, available: true },
    keep_awake: { sessions: [], active_count: 0 },
    sleep: {
      preventing_sleep: false,
      assertion_status: {},
      assertions: [],
      caffeinate_processes: [],
      raw: "",
    },
  });

  assert.match(html, /Mac Automation/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.match(html, /<wbr>/);
  assert.match(html, /data-label="Command"/);
  assert.match(html, /class="launchd-table"/);
  assert.match(html, /\.launchd-table th:nth-child\(5\) \{ width: 32%; \}/);
  assert.match(html, /\.launchd-table th:nth-child\(6\) \{ width: 15%; \}/);
  assert.match(html, /class="command-table"/);
  assert.match(html, /table-layout: fixed/);
  assert.match(html, /overflow-wrap: anywhere/);
  assert.match(html, /max-width: 1180px/);
  assert.match(html, /main > \*, \.metrics, \.metric, section\.panel, table, tbody, tr, td, code \{ min-width: 0; \}/);
  assert.match(html, /\.warning-cell \.pill \{ display: block; max-width: 100%; width: fit-content; border-radius: 6px;/);
  assert.match(html, /td::before/);
  assert.match(html, /content: attr\(data-label\)/);
  assert.match(html, /\.command-cell \{ width: 100%; \}/);
  assert.match(html, /max-width: calc\(100vw - 60px\)/);
  assert.match(html, /\.metrics \{ grid-template-columns: 1fr; \}/);
  assert.match(html, /word-break: break-all/);
  assert.doesNotMatch(html, /min-width: 760px/);
});
