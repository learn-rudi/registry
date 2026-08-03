---
id: example-stack
name: Example Stack
version: 1.0.0
description: Short description of what this stack does
runtime: python  # python | node | shell
command:
  - python3
  - python/src/server.py
provides:
  tools:
    - example_tool
related:
  operatorSkill: skill:example-stack
  skills:
    - skill:example-stack
requires:
  binaries:
    - ffmpeg
  secrets:
    - name: API_KEY
      label: API Key
      required: false
      link: https://example.com/get-api-key
meta:
  author: Your Name
  license: MIT
  category: utilities
  tags: [example, template]
  icon: "🔧"
---

# Example Stack

Describe what this stack does and when to use it.

## Runtime

This stack requires **Python**. If not installed:
```bash
rudi install runtime:python
```

## Usage

```bash
rudi run stack:example-stack --input '{"param": "value"}'
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `param` | string | yes | Description of parameter |

## Example

```bash
rudi run stack:example-stack --input '{"param": "hello"}'
```

## Output

Describe what the stack outputs.

## Required Operator Skill

Add `catalog/skills/example-stack.md` with `requires.stacks` containing
`stack:example-stack`. The skill must translate user requests into calls to the
manifest-declared tools, use the live tool schema for parameters, confirm risky
mutations, validate results, and verify completed changes.
