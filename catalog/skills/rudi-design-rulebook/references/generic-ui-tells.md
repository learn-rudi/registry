# Generic UI Tells

Twenty patterns that mark a page, deck, or app as machine-generated. Each one
became a tell because generation tools and template kits reach for it by
default, so it appears across thousands of unrelated products at once. None is
wrong in isolation. The test for every item is the same: does it do a job on
this screen, or is it decoration?

Scanner ids refer to `scripts/audit-ui-tells.mjs`. "Manual" means the tell
needs a look at the rendered page.

## 1. Purple-to-blue gradient

- **Rule:** avoid decorative purple-to-blue gradients.
- **Looks like:** a violet-to-blue wash behind the hero, on buttons, or as the
  page background.
- **Why it reads as generated:** it is the default "tech" palette in prompts
  and template libraries, so it carries no brand signal.
- **Detect:** a gradient whose color stops sit between violet and blue hues.
  Scanner: `purple-blue-gradient` (strong); any chromatic multi-stop gradient
  is `decorative-gradient` (review).
- **Fix:** one flat brand color, or a photograph with a functional scrim. A
  gradient that stays must aid legibility, not decorate.

## 2. Gradient hero text

- **Rule:** set hero text in a solid, contrast-safe color.
- **Looks like:** a headline filled with a gradient through background-clip.
- **Why:** it advertises the technique instead of the message and fails most
  contrast tools.
- **Detect:** `background-clip: text` in a rule with a gradient fill.
  Scanner: `gradient-text` (strong).
- **Fix:** solid ink. Emphasis through size, weight, or one accent color.

## 3. Emojis in headings

- **Rule:** keep stock emoji out of headings.
- **Looks like:** a rocket in an h2.
- **Why:** a stock glyph substitutes for a point of view and renders
  differently on every platform.
- **Detect:** emoji code points inside heading elements or Markdown headings.
  Scanner: `emoji-in-heading` (strong).
- **Fix:** remove. If an icon is needed, use one drawn for the product.

## 4. Inter everywhere

- **Rule:** do not use Inter as an unexamined default for the entire design.
- **Looks like:** Inter as the only typeface at default weights.
- **Why:** it is the default of nearly every UI kit, so the page inherits no
  character.
- **Detect:** Inter is the only family declared. Scanner: `inter-only`
  (review).
- **Fix:** Inter is fine for body text. Pair it with a display face chosen for
  the product, or choose a different family for a stated reason.

## 5. Color-left-border cards

- **Rule:** do not use a colored left border as generic callout shorthand.
- **Looks like:** a card with a three or four pixel colored left edge.
- **Why:** template shorthand for "callout," carried over from admin
  dashboards.
- **Detect:** `border-left` of three pixels or more with a color on a padded
  block. Scanner: `left-border-card` (review).
- **Fix:** white space, a heading, or a background tint. If a marker is
  needed, make it part of the type system.

## 6. Glassmorphism cards

- **Rule:** use opaque surfaces unless blur performs a functional job.
- **Looks like:** translucent panels with a background blur.
- **Why:** it reads as template flavor and costs contrast and rendering
  budget.
- **Detect:** `backdrop-filter: blur(`. Scanner: `glassmorphism` (review).
- **Fix:** opaque surfaces. Blur is acceptable on one functional floating
  control that sits over moving content.

## 7. Low-contrast dark mode

- **Rule:** preserve readable contrast in dark themes.
- **Looks like:** gray text on near-black, captions at half opacity.
- **Why:** dark default themes ship with muted text tokens that never get
  tuned.
- **Detect:** text and background pairs under 4.5 to 1 in the same rule.
  Scanner: `low-contrast` (review).
- **Fix:** raise text luminance. Build hierarchy through size and weight
  rather than dimming.

## 8. Three icon boxes in a row

- **Rule:** do not default feature content to three interchangeable icon cards.
- **Looks like:** a features section with three equal cards, each an icon, a
  title, and two lines.
- **Why:** the most reused landing-page block; the eye skips it.
- **Detect:** three siblings each containing an svg and a heading. Scanner:
  `icon-box-trio` (review). Manual for the rendered layout.
- **Fix:** if there are three real points, give each a real image or a full
  sentence. Vary the rhythm across sections.

## 9. A badge above the headline

- **Rule:** do not place a generic pill above the headline when the headline can
  carry the message.
- **Looks like:** a pill reading "New" or "AI-powered" above the h1.
- **Why:** copied from SaaS launch pages without the launch.
- **Detect:** an element with a badge, pill, or chip class immediately before
  an h1. Scanner: `badge-above-headline` (review).
- **Fix:** put the news in the headline or drop it. An editorial kicker (a
  short label set in the type system) is a different device and is fine.

## 10. Lucide icons everywhere

- **Rule:** use icons only where they clarify an action or concept, and do not
  let one default library become the product's visual voice.
- **Looks like:** the same thin outline set on every button and card.
- **Why:** it is the default icon set of the most common component library.
- **Detect:** actual Lucide imports, component use, class names, or data
  attributes. Dependency metadata alone is not evidence. Scanner:
  `lucide-icons` (review).
- **Fix:** fewer icons. Where they remain, use a set chosen for the product at
  one consistent weight.

## 11. Untouched shadcn defaults

- **Rule:** treat component-library defaults as a starting point, not a shipped
  design system.
- **Looks like:** default radius, default `hsl(var(--primary))` tokens,
  default component spacing.
- **Why:** the library is good. The tell is that nothing was changed.
- **Detect:** `@/components/ui/` imports with default token values such as
  `--radius: 0.5rem`. Scanner: `shadcn-defaults` (review). Manual for the
  rendered result.
- **Fix:** retune radius, ring, type, and the spacing scale. Change at least
  the primary and accent colors.

## 12. Sections fading in on scroll

- **Rule:** use motion to explain a state change, not to reveal ordinary content.
- **Looks like:** every section slides up and fades in as it enters the
  viewport.
- **Why:** motion applied to everything means nothing, and it slows reading
  on long pages.
- **Detect:** an IntersectionObserver that toggles classes, `data-aos`,
  `whileInView`, or fade-in keyframes. Scanner: `scroll-reveal` (strong for
  libraries, review for custom observers).
- **Fix:** no entrance animation by default. Motion only to show a state
  change.

## 13. Cursor-following glow

- **Rule:** do not add pointer-following decoration without information value.
- **Looks like:** a radial highlight that trails the mouse across cards or the
  hero.
- **Why:** a demo flourish with no information content, invisible on touch.
- **Detect:** a `mousemove` listener writing custom properties or element
  position; class names with glow or spotlight. Scanner: `cursor-glow`
  (strong).
- **Fix:** remove.

## 14. Buttons that fade on hover

- **Rule:** hover states must clarify interactivity without making controls look
  disabled.
- **Looks like:** a hover rule that only lowers opacity.
- **Why:** the laziest hover state, and it makes the control look disabled.
- **Detect:** a `:hover` rule whose only change is opacity. Scanner:
  `hover-fade` (review).
- **Fix:** a real hover state: background shift, border, or underline that
  raises contrast.

## 15. Perfectly uniform spacing

- **Rule:** vary spacing deliberately to express hierarchy and rhythm.
- **Looks like:** every gap the same token, every section the same padding.
- **Why:** rhythm needs variation. Uniform spacing flattens hierarchy.
- **Detect:** manual. Scanner: none.
- **Fix:** a spacing scale with at least three steps used on purpose, with
  more space around the thing that matters.

## 16. Em dashes everywhere

- **Rule:** avoid repeated em dashes in page-level copy; reserve at most one for
  a true aside.
- **Looks like:** the long dash (U+2014) splicing clauses in every paragraph.
- **Why:** the most recognized fingerprint of generated prose.
- **Detect:** more than one U+2014 in a scanned prose file. Scanner: `em-dash`
  (strong when repeated); a single occurrence does not fire.
- **Fix:** a period, a comma, or a colon. Reserve a dash for a true aside, at
  most one per page.

## 17. Generic buzzwords

- **Rule:** describe concrete behavior and audience value instead of using
  interchangeable promotional language.
- **Looks like:** seamless, cutting-edge, unlock, elevate, empower,
  supercharge, effortless, game-changing.
- **Why:** words that describe nothing. The reader has seen them on every
  other page.
- **Detect:** buzzword list in copy. Scanner: `buzzwords` (review).
- **Fix:** say what the thing does, for whom, in the words a customer would
  use.

## 18. Serif italics for accent words

- **Rule:** do not swap one headline word into an unrelated italic serif merely
  to signal premium styling.
- **Looks like:** a sans headline with one word swapped to an italic serif.
- **Why:** it became the "premium" default in template kits and now signals
  template.
- **Detect:** italic serif styling scoped to headings. Scanner:
  `serif-italic-accent` (review).
- **Fix:** emphasis through one weight or one color change in the same family.

## 19. Space Grotesk plus Instrument Serif

- **Rule:** choose type pairings for a documented product reason, not because a
  pairing is a common generation default.
- **Looks like:** that exact pairing.
- **Why:** the most common generated pairing. The fonts are good; the pairing
  is now a tell.
- **Detect:** both families declared. Scanner: `tell-font-pairing` (strong
  when both are present, review when one is).
- **Fix:** choose a pairing for a reason and record the reason.

## 20. Grain texture

- **Rule:** do not add synthetic grain unless texture is part of a deliberate
  visual system.
- **Looks like:** an SVG noise overlay across the page.
- **Why:** it adds "warmth" without content, and the same filter appears
  everywhere.
- **Detect:** `feTurbulence`, or noise and grain overlay classes. Scanner:
  `grain-texture` (strong).
- **Fix:** remove. If the brand needs texture, take it from real photography
  or print references.

## Reading the results

Strong findings are unambiguous in source. Review findings need eyes on the
rendered page. A design with two review findings and a stated reason for each
is finished. A design with zero findings and no point of view is not.

## Source note

The list comes from [@millee.md's short video](https://www.tiktok.com/t/ZP8c22okY/).
The extracted caption summary contained nineteen visible items; the source
caption "Inter typeface everywhere" supplies item four and completes the set of
twenty. Auto-caption corrections include Lucide, shadcn, Space Grotesk, and
Instrument Serif. These corrections identify the named patterns without making
them universal prohibitions; the rule, detection threshold, and fix above are
the operational interpretation used by this skill.
