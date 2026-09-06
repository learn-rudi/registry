---
name: Inline Editorial Markup
description: Create static or interactive editorial markup documents with visible deletions, insertions, notes, accept/reject review controls, and clean-copy export. Use when a user asks for track-changes-style editing in HTML, Word-like review markup, inline redline proposals, transcript cleanup review, or an interactive editor for accepting changes.
version: 1.0.1
category: documents
tags:
  - writing
  - editing
  - markup
  - review
  - redline
  - html
  - transcripts
  - capability:edit
requires:
  stacks:
    - stack:editorial-markup
---

# Inline Editorial Markup

## Goal

Create reviewable editorial drafts where proposed edits remain visible until the user approves them. Preserve the source structure unless the user asks for a clean rewrite.

## Capability Boundary

This is a **skill**, not a RUDI stack. The skill defines editorial judgment, artifact shape, interaction requirements, and verification expectations.

This skill is the primary operator for `stack:editorial-markup`, which is a
required dependency for its artifact and interaction contract. Verify that the
stack is installed and available before creating or changing editorial artifacts.
If it is unavailable, report the missing dependency and the install/recovery
step; do not silently substitute an independently generated editor.

Use `stack:web-export` or equivalent browser tooling when the requested artifact
needs render/export QA. Use extraction or audio tools when the source requires
transcription or extraction. These supporting operations are optional; they do
not replace the editorial stack's artifact contract.

## Modes

Choose the smallest mode that fits the request:

1. **Static markup HTML**: use for one-pass review, print/PDF-style proofing, or when the user wants visible edits but no controls.
2. **Interactive review HTML**: use when the user wants to accept/reject edits, show notes in a sidebar, inspect the source model, or copy clean text after review.
3. **Clean export**: use only after the user explicitly approves the edits or requests accepted output.

Default to **Interactive review HTML** when the user asks for an editorial editor, references an existing interactive markup artifact, asks for accept/reject behavior, asks to copy clean text, or provides a spoken/transcript draft that will likely need review decisions.

## Static Markup Rules

Use semantic HTML:

- Wrap deleted text in `<del>`.
- Wrap inserted text in `<ins>`.
- Style deletions red with strikethrough.
- Style insertions green with underline.
- Place judgment-call notes exactly where they apply.
- Use orange note styling for ambiguity, uncertain names, unverifiable terms, or structural edits.
- Keep notes short and specific.
- Do not silently remove source text.
- Do not produce a clean final version until the user confirms.

For Word-like review pages:

- Use a constrained white document surface on a neutral background.
- Keep line length readable.
- Support print behavior if the document may be exported.
- Keep raw local file paths out of reader-facing copy unless they are intentional working notes.

## Interactive Review Rules

Use a single self-contained HTML file unless the user requests an app or persistent server.

Represent the edit model as structured JavaScript data:

```js
const documentSource = [
  {
    type: "paragraph",
    parts: [
      "Original text before ",
      {
        id: "c001",
        del: "old phrase",
        ins: "new phrase",
        noteTitle: "Confirm term",
        note: "Explain the uncertainty in one sentence."
      },
      " after."
    ]
  }
];
```

Implement these controls when interactive review is requested:

- Select an individual change from the document.
- Show selected deletion, insertion, status, and note in a sidebar.
- Show all notes in a sidebar list.
- Accept selected change.
- Reject selected change.
- Accept all changes.
- Reset all changes to pending.
- Copy clean text only after all changes are resolved.
- If clipboard write is blocked, show a clean text panel and select the output for manual copy.
- Optional: show the source model panel when useful for developer review.

State model:

- `pending`: render `<del>` + `<ins>` and note marker.
- `accepted`: render only inserted text.
- `rejected`: render only deleted text.

Clean export behavior:

- Accepted edits output `ins`.
- Rejected edits output `del`.
- Pending edits should not copy silently; require resolution first.
- Normalize excess whitespace when building clean text.

## Editorial Judgment

For unambiguous cleanup, edit inline without a note:

- grammar
- punctuation
- obvious typo correction
- filler removal
- repeated words
- dropped-word repair when the missing word is obvious

Add an orange note when:

- the transcript seems garbled
- a name, title, product, or factual claim needs confirmation
- a structural cut changes rhythm or emphasis
- the edit corrects the user's conceptual framing
- the original could mean more than one thing

## Verification

Before finishing:

- Confirm the output file exists and is nonempty.
- Search for `<del>`, `<ins>`, and note markers in static markup.
- For interactive files, run a JavaScript syntax check by extracting the script and passing it to `new Function(...)`.
- If browser tooling is available, smoke-test accept all, reset, selected accept/reject, notes sidebar, and copy-clean behavior.
- Report whether clipboard access was blocked during browser testing.

For interactive or visually rich HTML, also perform render QA:

- Capture screenshots at desktop, tablet, and mobile viewports.
- Inspect at least the desktop and mobile screenshots before finalizing.
- Check that text and controls do not overlap or clip incoherently.
- Check that intended vertical scroll containers work. Desktop review UIs should normally keep the app viewport fixed and scroll the document pane and notes/sidebar independently.
- Check that intended horizontal scroll containers work, including source-model `<pre>` panels and narrow mobile toolbars.
- Check that the page does not create unintended body-level horizontal overflow.
- Save QA screenshots beside the deliverable or in an `outputs/qa/` folder when working in a projectless or artifact-output session.
- If screenshot or browser tooling is unavailable, state that limitation and report the DOM/layout checks that were performed instead.

## Final Response

Return:

- the generated file path
- which mode was used
- the unresolved notes or confirmation items
- verification performed
- a reminder that clean export requires user approval when edits remain pending
