# Laws of UX as Checkable Rules

Twenty-one reconciled UX principles, each turned into a rule, a mechanism, the
surfaces it applies to, one check question, and a fix. Twenty entries are named
in the source overlay, including one duplicated label; the final entry preserves
a distinct spoken principle that the overlay omits. "Slides" means presentation
decks. "Pages" means marketing, documentation, or editorial pages. "Apps" means
interactive screens.

## 1. Hick's law

- **Rule:** reduce choices per screen.
- **Mechanism:** decision time grows with the number of options. Fewer,
  clearer options are chosen faster and with fewer regrets.
- **Applies:** slides (one idea per slide), pages (one primary call to
  action), apps (short menus, progressive disclosure).
- **Check:** can a first-time viewer say what this screen wants them to do
  within one breath?
- **Fix:** keep one primary action, move secondary choices behind progressive
  disclosure, and split unrelated decisions into later steps.

## 2. Fitts's law

- **Rule:** make targets large.
- **Mechanism:** time to hit a target depends on its size and distance. Bigger
  and closer is faster and less error-prone.
- **Applies:** apps and pages (buttons, links, tap targets of at least 44 CSS
  pixels), slides (deck controls and clickable regions).
- **Check:** is every interactive target at least 44 by 44 CSS pixels with
  space between neighbors?
- **Fix:** enlarge the hit area, separate neighboring targets, and move the
  primary control closer to the person's current pointer or touch position.

## 3. Jakob's law

- **Rule:** follow familiar patterns.
- **Mechanism:** people spend most of their time on other products and carry
  those expectations with them. Novel navigation costs learning.
- **Applies:** all surfaces. Navigation, forms, and deck controls such as
  arrow keys and swipe.
- **Check:** does anything here need an explanation that a common product
  would not?
- **Fix:** replace novel navigation or control behavior with the established
  platform convention and reserve novelty for content or brand expression.

## 4. Law of proximity

- **Rule:** group related information.
- **Mechanism:** things close together are perceived as one group. Space is
  the cheapest grouping tool.
- **Applies:** all surfaces. Labels next to fields, captions next to images,
  related bullets tighter than unrelated ones.
- **Check:** is every gap either "same group" or "different group," with no
  in-between sizes?
- **Fix:** tighten gaps within a group, widen gaps between groups, and move
  labels or captions next to the elements they describe.

## 5. Miller's law

- **Rule:** break content into chunks.
- **Mechanism:** working memory holds only a handful of items, fewer under
  load. Chunking raises what a person can hold at once.
- **Applies:** slides (three to five bullets), pages (sections), apps (grouped
  settings, formatted numbers).
- **Check:** does any list or screen ask the viewer to hold more than five
  things at once?
- **Fix:** split long lists into named groups, summarize before detail, and
  move nonessential items to a later view.

## 6. Doherty threshold

- **Rule:** interactions respond within 400 milliseconds.
- **Mechanism:** under 400 milliseconds the system feels like a conversation.
  Over it, attention drifts and errors rise.
- **Applies:** apps (feedback on every action), pages (load and transitions),
  slides (instant navigation).
- **Check:** is there any action without feedback in under 400 milliseconds?
  If real work takes longer, is progress shown?
- **Fix:** acknowledge the action immediately, update optimistically when safe,
  or show determinate progress and a recoverable failure state.

## 7. Von Restorff effect

- **Rule:** highlight the primary action.
- **Mechanism:** the item that differs from its neighbors is remembered and
  chosen. Two highlighted items cancel each other out.
- **Applies:** pages and apps (one primary button per screen), slides (one
  emphasized element per slide).
- **Check:** is exactly one thing on this screen visually distinct?
- **Fix:** choose one primary element, reduce competing accents, and express
  secondary actions with quieter but still accessible styling.

## 8. Minimize target distance

- **Rule:** place key actions nearby.
- **Mechanism:** the distance half of Fitts's law. Put the next action near
  the last one, and controls near the content they act on.
- **Applies:** apps (inline actions, sticky primary buttons), pages (the call
  to action follows the argument), slides (controls at the edge the thumb
  rests on).
- **Check:** does the next likely action sit within reach of where the hand or
  eye already is?
- **Fix:** move the action beside the content or prior control it follows, or
  keep a recurring primary action in a predictable reachable position.

## 9. Serial position effect

- **Rule:** put essentials first.
- **Mechanism:** people recall the first and last items best. The middle
  fades.
- **Applies:** slides (the point first, the ask last), pages (the value in the
  first line), apps (the most-used items at the ends of menus).
- **Check:** if the viewer only saw the first and last item, would they have
  what matters?
- **Fix:** reorder the sequence so the essential context comes first, supporting
  detail occupies the middle, and the decision or memorable line comes last.

## 10. Peak-end rule

- **Rule:** end flows memorably.
- **Mechanism:** an experience is judged by its most intense moment and its
  end, not its average.
- **Applies:** apps (a satisfying completion state), slides (a closing line
  worth repeating), pages (a clear final step).
- **Check:** what is the peak, and what is the last thing the person sees?
  Are both deliberate?
- **Fix:** design one meaningful high point and replace generic endings with a
  clear completion state, takeaway, or next action.

## 11. Zeigarnik effect

- **Rule:** show visible progress.
- **Mechanism:** unfinished tasks stay in mind. Visible progress uses that
  pull to carry people through.
- **Applies:** apps (progress bars, step counters, checklists), slides
  (section markers, slide counter), pages (reading progress on long content).
- **Check:** can the person see how far they are and how much remains?
- **Fix:** add a truthful step count, checklist, section marker, or progress
  indicator that updates as work completes.

## 12. Law of Prägnanz

- **Rule:** simplify complex interfaces.
- **Mechanism:** the eye reads ambiguous forms in the simplest way it can.
  Simple shapes read faster and cost less attention.
- **Applies:** all surfaces. Fewer shapes, aligned edges, one grid.
- **Check:** can the layout be described in one sentence?
- **Fix:** remove nonfunctional shapes, reduce competing alignments, and place
  the remaining content on one legible grid.

## 13. Law of similarity

- **Rule:** maintain pattern consistency.
- **Mechanism:** elements that look alike are read as the same kind of thing.
  Inconsistency forces re-learning.
- **Applies:** all surfaces. Same button style means same behavior; same
  heading style means same level.
- **Check:** does any element look like another but behave differently, or
  behave the same but look different?
- **Fix:** standardize the visual and interaction tokens for elements with the
  same role, and deliberately differentiate elements with different behavior.

## 14. Uniform connectedness

- **Rule:** connect related elements visually.
- **Mechanism:** a shared background, border, or line groups elements more
  strongly than proximity or color alone.
- **Applies:** apps (form sections, toolbars), pages (a shared surface behind
  a pair), slides (a shared bar behind related items).
- **Check:** are related items joined by one visual device, and unrelated
  items kept apart?
- **Fix:** place related items on one restrained surface or within one boundary;
  remove connectors that imply a relationship that does not exist.

## 15. Tesler's law

- **Rule:** reveal complexity gradually.
- **Mechanism:** every system has complexity that cannot be removed, only
  moved between the system and the person. Take it on the system side and
  expose it in stages.
- **Applies:** apps (sensible defaults, advanced sections), pages (summary,
  then detail), slides (one layer per slide).
- **Check:** what complexity did we push onto the person, and could the
  system carry it instead?
- **Fix:** provide safe defaults for the common path, reveal advanced choices
  on request, and let the system derive values it can know reliably.

## 16. Postel's law

- **Rule:** accept safe syntactic variation, then normalize and validate it.
- **Mechanism:** tolerance for harmless formatting variation reduces failed
  submissions, while canonical normalization and validation prevent ambiguous
  or unsafe input from silently changing meaning.
- **Applies:** apps (spaces in card numbers, clearly labeled dates, pasted text
  with formatting), pages (forgiving search), slides (supported navigation
  methods work consistently). Ambiguous date formats still require a locale,
  explicit format, or confirmation.
- **Check:** does harmless variation normalize successfully, while invalid or
  ambiguous input is rejected or confirmed before use?
- **Fix:** trim and normalize safe variations at the boundary, validate the
  canonical value, and ask for clarification instead of guessing ambiguity.

## 17. Error prevention and recovery (derived rule)

- **Rule:** prevent likely errors and make recoverable errors easy to undo.
- **Mechanism:** constraints and previews stop predictable mistakes; confirmation
  protects irreversible actions; undo and preserved input reduce the cost of
  mistakes that still occur.
- **Applies:** apps (undo, confirmation on delete, inline validation), pages
  (form errors next to the field), slides (no destructive controls).
- **Check:** is anything irreversible one click away? Is undo available?
- **Fix:** constrain invalid choices, validate beside the affected field,
  confirm destructive actions, preserve entered data, and provide undo when
  the action can be reversed.
- **Note:** the source overlay duplicated Postel's law. The spoken guidance
  separately says to prevent errors and make them recoverable. This entry keeps
  that useful composite rule without claiming the creator named a missing law.

## 18. Parkinson's law

- **Rule:** reduce task completion time by bounding it.
- **Mechanism:** work expands to fill the time available. A visible limit, or
  a shorter path, keeps tasks short.
- **Applies:** apps (fewer steps, autofill, defaults), pages (short forms),
  slides (a fixed slide count and a timer).
- **Check:** what is the fewest steps this could take, and why is it not that?
- **Fix:** remove unnecessary steps, prefill known values, show the remaining
  length, and set a realistic completion boundary.

## 19. Occam's razor

- **Rule:** use sensible defaults and remove what does not serve.
- **Mechanism:** among equally good solutions, the one with the fewest
  assumptions wins. Every extra element must justify itself.
- **Applies:** all surfaces. Ship with the choice most people want already
  made.
- **Check:** for each element, what breaks if it is removed? If nothing,
  remove it.
- **Fix:** choose the safest common default, remove elements with no observable
  job, and keep exceptional controls behind progressive disclosure.

## 20. Pareto principle

- **Rule:** spend design effort on the small share of features that carry
  most of the use.
- **Mechanism:** use is unevenly distributed. The common path deserves most
  of the polish.
- **Applies:** apps (primary flows first), pages (the one question most
  visitors have), slides (the three slides people will remember).
- **Check:** which part is the common path, and is it the most finished part?
- **Fix:** use product evidence to identify the common path, move it forward,
  and spend polish and reliability effort there before rare options.

## 21. Goal-gradient effect

- **Rule:** make completion feel closer.
- **Mechanism:** effort rises as the goal nears. Progress that starts above
  zero and ends visibly speeds completion.
- **Applies:** apps (a pre-filled first step, "2 of 4"), pages (short
  remaining-steps lists), slides (section-of-total markers).
- **Check:** does the person see they are closer than they thought?
- **Fix:** show truthful completed work, remaining steps, and movement toward
  the goal; never manufacture progress or hide the real remaining effort.
- **Note:** the source video's spoken list included this rule while its
  on-screen list showed the Pareto principle. Both are kept.

## Source reconciliation

The numbered overlay comes from [@adam_ha_yes's short
video](https://www.tiktok.com/t/ZP8cYccuT/). Its twenty rows and the spoken
plain-English guidance disagree in two places. The skill preserves the evidence
instead of silently selecting one version.

| Source evidence | Ambiguity | Rulebook resolution |
|---|---|---|
| Overlay rows 16 and 17 both say Postel's law | The duplicated Postel label cannot identify the creator's intended second named law; the spoken guidance separately covers prevention and recovery | Keep Postel once and preserve error prevention and recovery as an explicitly derived practical rule |
| Overlay row 20 says Pareto principle; the spoken list says make completion feel closer | Pareto and goal-gradient are different principles | Keep Pareto as item 20 and add goal-gradient as item 21 |

This reconciliation yields twenty-one unique operational entries from a
twenty-row overlay. Mechanisms and fixes are operational interpretations, not
claims that the short video supplied every detail.

## Using the laws

Do not score. Walk each screen against the check questions and record only the
misses, each with the specific change that would fix it. When two laws pull
against each other (Hick's law wants fewer options; the Pareto principle wants
the common path fastest), name the tension and choose, rather than splitting
the difference.
