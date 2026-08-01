# macOS Automation Stack

Guarded local macOS automation tools for RUDI agents.

This stack uses macOS system tools such as `osascript`, `open`, and `shortcuts`
behind typed MCP tools. It does not expose arbitrary AppleScript execution.

## Permissions

Some tools require macOS permissions for the terminal or agent host running
RUDI:

- Accessibility: System Events tools such as frontmost app and window listing.
- Automation: controlling Finder, Reminders, or target applications.
- Shortcuts: each Shortcut may request its own app, file, or network permissions.

Use `macos_status` first, then `macos_check_accessibility` to verify System
Events access.

## Tools

- `macos_status`
- `macos_automation_inventory`
- `macos_automation_dashboard`
- `macos_check_accessibility`
- `macos_get_frontmost_app`
- `macos_list_windows`
- `macos_open_url`
- `macos_open_app`
- `macos_focus_app`
- `macos_show_notification`
- `macos_list_shortcuts`
- `macos_run_shortcut`
- `macos_create_reminder`
- `macos_get_selected_finder_items`
- `macos_reveal_in_finder`
- `macos_keep_awake_start`
- `macos_keep_awake_status`
- `macos_keep_awake_stop`
- `macos_install_launch_agent`
- `macos_list_launch_agents`
- `macos_remove_launch_agent`
- `macos_run_launch_agent_now`

## Automation Dashboard

`macos_automation_inventory` returns a read-only inventory of the main macOS
automation surfaces: LaunchAgents, LaunchDaemons, cron, the `at` queue,
Shortcuts, RUDI keep-awake sessions, active `caffeinate` processes, and current
`pmset` sleep assertions.

`macos_automation_dashboard` writes a local HTML snapshot under
`~/.rudi/state/macos-automation/dashboard/index.html` by default. Pass
`open_dashboard: true` to open it in the default browser. The dashboard does not
remove jobs, stop processes, or mutate scheduler state.

From the installed stack directory:

```bash
npm run dashboard -- --open
```

`macos_run_shortcut` and `macos_create_reminder` default to dry-run mode.
Pass `confirm_run: true` or `confirm_create: true` only after reviewing the
planned action.

Keep-awake tools use macOS `caffeinate` and do not require Accessibility
permission. `macos_keep_awake_start` defaults to a 60-minute dry-run that
prevents idle sleep and system sleep while allowing the display to sleep. Pass
`confirm_start: true` to start the timed session, then use
`macos_keep_awake_status` or `macos_keep_awake_stop` to inspect or stop RUDI
managed sessions.

LaunchAgent tools create persistent local background behavior and are also
guarded. Labels must stay under the `dev.rudi.*` namespace, commands are passed
as arrays without a shell, and install/remove/run-now actions default to dry-run.

Supported schedules:

- Daily timer: `{ "type": "daily", "hour": 8, "minute": 30 }`
- Interval timer: `{ "type": "interval", "seconds": 3600 }`
- Folder/file trigger: `{ "type": "watch_paths", "paths": ["/absolute/path"] }`

## Development

```bash
npm install
npm test
```

See `examples/content-workspace-demo/` for a concrete sample folder showing how
these primitives can support a local content workspace.
