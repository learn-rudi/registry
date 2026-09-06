# Skill catalog organization

Each skill has one stable package ID and one folder:

```text
catalog/skills/<id>/
├── SKILL.md
├── agents/openai.yaml     # optional host UI and invocation policy
├── scripts/               # optional executable support
├── references/            # optional detailed guidance
└── assets/                # optional reusable assets
```

Keep categories in metadata, not directories. Nested category folders are not
skill entrypoints. Put catalog documentation here, not in a top-level
`catalog/skills/README.md`, which the legacy reader would interpret as a skill.
Create support files only when the workflow needs them.

## Categories describe the object of the work

| Category | Primary object | Examples |
|---|---|---|
| `web` | Websites, hosting and deployments | Vercel deployment, a site's design system |
| `code` | Repositories, software and engineering changes | Code review, change mapping, repository stewardship |
| `data` | Structured records, extraction, databases and analysis | PostgreSQL queries, parcels, finance records |
| `documents` | Written artifacts and presentations | Scripts, policies, editorial drafts, slide decks |
| `media` | Images, audio, video and reusable media assets | Cloudinary assets, transcription, video editing |
| `communication` | Messages, meetings and publication copy | Mail, meeting context, social publishing |
| `agents` | Agent hosts, instructions, context and coordination | Host tasks, goals, coordinated agent work |

Choose one primary category. Cross-object skills retain relevant search tags;
they do not need duplicate folders. Vercel belongs in Web, Cloudinary in Media.
Finance, real estate and client services are domains. Deployment, extraction,
review and coordination are capabilities. Provider names are another facet.

## Source metadata and naming

```yaml
---
name: Vercel Operator
description: Deploy websites to Vercel and verify deployment status.
version: 1.0.1
category: web
tags:
  - deployments
  - capability:deploy
  - provider:vercel
requires:
  stacks:
    - stack:vercel
---
```

Keep existing kebab-case package IDs and folder names stable. A human display
name can be improved independently; native adapters derive the native skill
slug from the package ID. Operator display names normally identify the product;
workflow names identify the task. Names alone never establish operator status.

Descriptions should state the actual work and when it applies. Put detailed
tool lists, procedures and failure cases in the body. Avoid generic router
boilerplate in every description, and keep invocation restrictions intact.

Author one category and at least one `capability:<slug>` tag. Optional
`domain:<slug>` and `provider:<slug>` tags use lowercase kebab-case values.
Ordinary search keywords remain supported. Capability values are extensible;
they are not another closed category hierarchy. Preserve existing supported
host policy and UI metadata in `agents/openai.yaml`.

The compiler and public validator enforce this authoring contract. The parser
still accepts legacy flat source for compatibility fixtures and older packages.
Generated schema-v2 packages retain category and tags under `meta`; no new
package kind or duplicate authored role is introduced.

## Stack operators and workflows

Three existing relationships have different meanings:

- `skill.requires.stacks`: tools genuinely required to perform the skill.
- `stack.related.operatorSkill`: the stack's primary operator skill.
- `stack.related.skills`: that primary operator plus optional companions.

An operator must require its own stack and appear in that stack's related list.
Installing a stack includes its primary operator; companions are opt-in with
`--with-related-skills`. A workflow can require several stacks and still be a
workflow. Task-oriented skills such as editorial markup and the SWE checklist
can be primary operators even when their names do not end in “Operator.”

Drafting a script or publication copy from supplied text does not require
installing video, upload or publishing tools. The three shortform drafting
skills remain related to Video Editor for discovery and describe when those
optional tools become necessary. Actual uploads and publication retain their
separate authorization boundaries.

CLI discovery derives `skillRole` and `operatorFor` from the stack graph.
Installed listings use available local/cached catalog context without a network
request; external or unidentified installs report `unknown`. `facets` contains
capabilities, domains and providers parsed from tags. Skill workflow role is
distinct from the separate `workflow` package kind selected by `--workflows`.

## Finding useful skills

```bash
rudi search --all --skills --category=web --role=operator
rudi search --all --skills --domain=real-estate
rudi search --all --skills --capability=review --role=workflow
rudi list skills --provider=vercel
rudi info skill:vercel
rudi which video-editor
```

Use current search results for inventory. These starting points are editorial
recommendations based on distinct output and scope, not measured popularity:

| Need | Starting point |
|---|---|
| Map a proposed change before implementation | `skill:map-change-impact` |
| Trace a feature and its data across repositories | `skill:trace-feature-lineage` |
| Reduce bloated or conflicting agent instructions | `skill:rudi-context-gardener` |
| Extract a website's visual system | `skill:design-system-extractor` |
| Make a decision reviewable through a visual artifact | `skill:rudi-decision-canvas` |
| Review visible editorial changes | `skill:inline-editorial-markup` |
| Structure and refine a presentation | `skill:presentation-design` |
| Edit and verify video | `skill:rudi-video-editor` |
| Preserve an author's words in a shortform script | `skill:shortform-your-words-script` |
| Remove vague synthetic prose patterns | `skill:synthetic-cadence-editor` |
| Assess an organizational AI use policy | `skill:rudi-ai-policy-assessor` |

Keep public skills generic. Resolve repository owners, workspace roots and
account context from the user's request or configured workspace. Personal names,
private state and brand defaults belong in local/private configuration. Never
change an existing repository's visibility merely because the workflow prefers
a private destination.

## Delivery and compatibility

Catalog source, installed packages and native host projections are separate:

1. Registry compilation produces explicit folder install paths and complete
   resource hashes. Regenerate indexes; do not hand-edit them.
2. The CLI installs under `~/.rudi/skills/<id>/SKILL.md`. An upgrade stages the
   complete replacement and checks ownership before retiring the old file.
3. Native sync derives the host skill tree and records ownership receipts.
   Complete trigger descriptions and bundled Codex metadata survive projection;
   edited or unowned host copies are preserved by default.

Release the compatible CLI before publishing the migrated registry. Old flat
installs remain supported until upgraded. Duplicate source formats, missing
ownership evidence and edited canonical files require reconciliation; a forced
update is not permission to discard them. A failed recoverable update restores
the previous skill and lock. Successful replacements retain the prior inode/tree
in a reported recovery backup; reconcile it before separately authorized cleanup.
Update dry runs report ownership conflicts and the source/destination format.
If concurrent edits prevent recovery, retain the
reported transaction folder and resolve it before retrying. Native hosts may
need to reload after a successful projection.
