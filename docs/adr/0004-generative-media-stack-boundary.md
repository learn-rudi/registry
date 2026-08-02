# ADR 0004: Generative Media Stack Boundary

## Status

Accepted

## Context

RUDI exposes image, video, and speech generation through modality-scoped stacks, while provider suites such as `stack:openai` and `stack:google-ai` expose some of the same capabilities alongside other provider-specific tools. Treating every overlapping stack as an equal route would leave agents to choose among different validation, error, output, and provider contracts for the same user intent. Removing the provider suites would also discard useful compatibility paths and direct access to provider-specific capabilities.

## Decision

The canonical agent-facing boundaries for generative media are `stack:image-generator`, `stack:video-generator`, and `stack:speech-generator`.

Each modality stack owns its normalized public contract, including input validation, structured errors and results, output policy, and provider adapters. A caller may select a provider through that contract, but provider-specific request details remain behind the adapter boundary. New providers and overlapping generative-media capabilities belong in the relevant modality stack so that agents have one canonical route for image, video, or speech-generation intent.

Here, input validation means technical validation of request shape, bounds, supported capability combinations, and output policy; it does not imply semantic content moderation or intended-use compliance review.

Provider suites such as `stack:openai` and `stack:google-ai` may coexist as compatibility paths and direct-provider escape hatches. They are not equal canonical routes for capabilities that overlap a modality stack. A workflow should use a provider suite only when it intentionally needs a provider-specific operation or behavior that the normalized modality contract does not expose.

Transcription is separate from speech generation. Speech generation produces spoken audio, while transcription converts audio to text; the presence of transcription in a provider suite does not make transcription part of `stack:speech-generator`.

This is a contract-ownership and agent-routing convention. The registry catalogs packages and their exposed tools; it does not automatically choose among overlapping stacks. This decision does not set a deprecation or removal date for any provider suite.

## Consequences

Agents and workflow authors get one preferred boundary per generative-media modality, while callers that require direct provider behavior retain an explicit escape hatch. Provider suites and modality stacks may duplicate integrations, but normalized contracts and new overlapping capability work belong in the modality stack.

Image, video, and speech contracts remain independent even when they support the same provider. Each modality can evolve its validation, lifecycle, formats, and output semantics without creating a cross-modality provider suite as the canonical abstraction.
