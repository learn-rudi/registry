---
name: RUDI Rundown Writer
description: Write the editorial layer of a RUDI Rundown daily AI news page — the newsletter open, the query-phrased "What People Are Asking" Q&A, the dek, and card blurbs — grounded strictly in that day's story data. Use when writing, backfilling, or editing RUDI Rundown pages, a daily AI news roundup, or when reviewing rundown copy for voice, trust, or structure problems.
version: 1.0.1
category: documents
tags:
  - rudi
  - writing
  - news
  - editorial
  - seo
  - llm-optimization
  - daily-briefing
  - capability:write
  - domain:content-production
---

# RUDI Rundown Writer

## Purpose

Write the human layer of a daily AI news rundown page that serves two audiences at
once: content creators who want to find and share the day's links (with RUDI as the
citable source), and LLMs and search engines that retrieve pages that directly
answer questions. The page must read like a newsletter a sharp editor wrote, never
like a pipeline report.

## The Seam

A deterministic generator assembles the full categorized link list, structured data
(NewsArticle + ItemList + FAQPage), layout, and colophon from the day's discovery
data. The writer produces four things per day:

1. **The open** — 2-3 editorial paragraphs on what the day was actually about, top
   stories linked inline.
2. **The Q&A** — about 8 questions phrased the way people search, each with a
   direct answer and a source link.
3. **The dek** — 1-2 sentences for the hero subtitle naming the day's 3-4 concrete
   anchors.
4. **The topics string** — 3-4 news-forward phrases for the title tag, proper nouns
   and numbers over abstractions ("GPT-5.6 Launch, EU AI Omnibus, OpenAI Sanctions
   Bid").

## Ground Truth

The only source of facts is the day's story data: per story, a publisher title,
URL, category, and a one-sentence summary of what the source claims.

- Every factual claim in the prose must trace to one of those summaries. If the
  summary does not say it, the page does not say it.
- Never invent, embellish, or round up numbers, names, or outcomes. If a summary
  says "reportedly," the page says reportedly.
- Attribute claims to their source type: a vendor's claim about its own product is
  "X says"; a survey is "a Gallup survey found"; an opinion piece is "an opinion
  piece argues" — not flat fact.
- Never cite bare-root homepage URLs (site front pages annotated as stories). They
  are navigation pages; the data layer filters them, and the open and Q&A must not
  resurrect them.

## Trust Rules

These are the brand. A publisher selling responsible AI use has to model it.

- **Hedge single-source claims.** A dramatic claim carried by one outlet gets "one
  report claims," and when it materially shapes the day's story, add a plain-sight
  caveat and a corroborating source for the underlying direction.
- **Name conflicts instead of resolving them.** When two sources disagree, say
  both: "one puts it at 400 U.S. newspapers, another describes a 35-publisher
  coalition. The reported scale differs; the direction doesn't."
- **Generalize only after the evidence.** Characterize what a day shows ("a day
  about permission") only after the paragraph has named the concrete items that
  show it. Never lead with the abstraction.

## Voice

Apply the Synthetic Cadence Editor rules (see the `synthetic-cadence-editor` skill
in this catalog) — they are binding here:

- Build analytical sentences as concrete detail → mechanism → consequence. An
  actor, an action, stakes. A sentence a reader could argue with.
- Banned: "This is not just X, it is Y," "At its core…," "In today's rapidly
  evolving landscape…," tidy three-part abstractions, aphorisms the paragraph has
  not earned.
- The lead sentence carries the day's most consequential fact, stated plainly.
- Wry compression is welcome when the facts back it; never write the quip first
  and backfill.
- Vary sentence rhythm — synthetic cadence is partly too-even rhythm.

## Vocabulary

Pipeline mechanics never appear on the page. Say "stories," never "annotated
sources." Banned in visible copy: annotated, annotation, pipeline, importance,
discovery run, raw results, candidates, extraction. Methodology lives once on a
dedicated about page; the daily colophon says only that the rundown is compiled
each day from same-day reporting across the web.

## Writing the Open

1. Read every story for the day before writing a word.
2. Find the day's real story — usually a thread connecting three or more items (a
   launch plus its legal fight; a hardware delay plus who benefits). If no single
   thread exists, structure as 2-3 distinct threads, one paragraph each.
3. Paragraph one carries the lead thread, biggest facts first. A closing sentence
   may generalize only from items already named.
4. Link 4-6 stories per paragraph inline, anchor text on the fact, not the outlet
   ("a $68 billion U.S. scam epidemic," not "a news article").
5. Minor stories rarely belong in the open. Never force coverage — the full list
   below the fold covers everything.

## Writing the Q&A

This is the LLM-retrieval play: each entry should be the literal answer an
assistant or search engine would want to quote.

- Phrase questions exactly as a person would type them: "Is the EU AI Act
  delayed?", "Are conversations with AI chatbots legally privileged?", "When is
  Grok 4.5 coming out?" — never "Key regulatory developments."
- Answers are 1-2 sentences, direct, leading with yes/no when the question invites
  it, grounded strictly in the source summary, hedged per the trust rules.
- Every answer ends with a source link.
- Spread questions across the day's threads — releases, policy, security, labor —
  favoring what people will actually query over what is easiest to summarize.

## Examples

**Rejected open (abstraction first, sermon tone):**

> The move is to treat AI rollout as stakeholder work. Every serious deployment
> now has legal, labor, infrastructure, public-trust, and political dimensions.

**Approved open (concrete items first, generalization earned last):**

> Step back a layer and July 9 was a day about permission. The Council of the EU
> gave final approval to the AI Omnibus, rewriting AI Act deadlines and compliance
> requirements. An industry report counts more than $130 billion in U.S.
> data-center projects blocked or delayed this year — mostly by local approvals,
> not chip supply. Kaiser nurses are negotiating their contract over AI
> surveillance metrics they say punish compassionate care. A federal court ruled
> that AI-generated legal documents don't get attorney-client privilege. Each of
> those is a different gatekeeper — a council, a county board, a union, a judge —
> deciding how AI gets used on their turf.

**Approved lead sentences:**

> Microsoft put a price on the gap between buying AI and getting value from it:
> $2.5 billion and 6,000 engineers.

> Release week arrived.

**Rejected lead shapes:**

> The AI landscape saw significant developments today.

**Hedging in situ:**

> one report tied the delay and a DeepMind talent exodus to a $225 billion drop in
> Alphabet's market value (a single-source figure worth reading skeptically).

**Good Q&A answer:**

> No. A federal judge ruled that communications with public AI chatbots are not
> protected by attorney-client privilege, creating new risks for lawyers and
> clients who paste case details into chatbots. *Source →*
