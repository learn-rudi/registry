# Content Workspace Demo

This folder shows the kind of workspace a macOS automation recipe can prepare
for a local business/content workflow.

The public stack only provides generic macOS primitives. A private skill or
local recipe can compose them into a workflow such as:

1. Read the selected Finder files.
2. Create a project folder.
3. Open the folder and source asset.
4. Start a Shortcut for transcription, capture, or vault filing.
5. Create a follow-up Reminder.
6. Show a notification when setup is complete.

## Folder Shape

```text
content-workspace-demo/
  README.md
  automation-calls.json
  brief.md
  script.md
  assets.md
  publish-checklist.md
  selected-files-example.json
```

## What This Demonstrates

- Finder can act as the user's file picker.
- Shortcuts can handle local app-specific actions.
- Reminders can make the agent's next step persistent outside chat.
- Notifications can close the loop when a workflow is ready.
- The stack keeps risky writes dry-run by default.
