---
name: "Social Media Publisher Operator"
description: "Post to Twitter, LinkedIn, Facebook, Instagram, TikTok, and YouTube with readiness checks and unified publisher validation"
version: 1.0.1
category: "communication"
tags:
  - rudi
  - operator
  - social-media-publisher
  - capability:publish
  - domain:content-production
requires:
  stacks:
    - stack:social-media-publisher
---

# Social Media Publisher Operator

Use this skill as the host-native operating layer for `stack:social-media-publisher`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Post to Twitter, LinkedIn, Facebook, Instagram, TikTok, and YouTube with readiness checks and unified publisher validation

Use the stack when the request needs these capabilities. Do not substitute
invented results when the stack, a required secret, or a supporting service is
unavailable.

## Workflow

1. Identify the user's requested outcome, inputs, constraints, and whether the
   action changes external state.
2. Inspect the active MCP tool schema before calling a tool. The runtime schema
   is authoritative for parameter names, required fields, and enums.
3. Start with discovery, inspection, validation, preview, or dry-run tools when
   the stack provides them.
4. Use the fewest tool calls that can complete the request. Reuse returned IDs
   and paths instead of guessing them.
5. Before a destructive, irreversible, public, paid, or externally visible
   action, obtain the user's confirmation unless they already authorized that
   exact action.
6. Validate tool results before using them as inputs to another call. Stop on
   malformed results, explicit errors, missing required data, or partial
   completion that makes the next action unsafe.
7. Verify mutations with a read-back, status, inspection, or artifact check
   when the stack supports one.
8. Report what was attempted, what succeeded, what failed, and any output IDs,
   URLs, or paths the user needs.

## Stack Tools

- `social_list_supported_platforms`
- `social_validate_post`
- `social_check_publish_ready`
- `social_publish_direct`
- `twitter_post`
- `twitter_thread`
- `linkedin_post`
- `facebook_post`
- `facebook_list_pages`
- `instagram_post`
- `instagram_reel_create_container`
- `instagram_container_status`
- `instagram_publish_container`
- `instagram_list_accounts`
- `tiktok_creator_info`
- `tiktok_direct_post`
- `tiktok_video_upload`
- `tiktok_fetch_status`
- `youtube_video_upload`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:social-media-publisher`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
