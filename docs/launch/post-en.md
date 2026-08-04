# Why every AI-generated interface looks the same

*(English launch post — for Hacker News / Reddit / X. Suggested HN title: "Show HN: OpenDesign – 1,486 design systems with real tokens, as an MCP server")*

---

Ask Claude, Cursor, v0 or Lovable to build you a landing page. You already know what you'll get:

- Inter
- a blue-to-violet gradient hero
- `rounded-2xl` on everything
- a soft shadow under every card
- three feature cards with lucide icons

Ask a different model. Same page. Ask again next month. Same page.

This gets dismissed as "AI slop," which I think misses what's actually happening. It isn't laziness or a bad prompt. It's arithmetic.

## Averages don't have brands

A model trained on a few hundred million web pages has learned the *distribution* of web design. When you ask for "a modern SaaS landing page" with no other constraint, the highest-probability output is, roughly, the centroid of that distribution.

The centroid is real. It's what most pages look like. It's also, by construction, the one thing that can't be anyone's brand — a brand is a *deviation* from the mean that a team chose on purpose and defended over time.

So the default output is simultaneously (a) statistically correct and (b) commercially useless. Every AI-built product looks like every other AI-built product, which means none of them look like themselves.

## Why prompting doesn't fix it

Three things people try:

**"Make it look premium / minimal / trustworthy."** These are labels, not instructions. The model maps "premium" back into the same distribution and returns the *average premium page*. You've narrowed the centroid, not escaped it.

**Pasting a screenshot.** Better — there's now real signal. But a vision model reading a screenshot gives you an *impression*: "dark background, sans-serif, generous spacing." Impressions aren't executable. Was that `#08090A` or `#0A0A0A`? Is the body 15px or 16px? What's the actual line-height at display size? The model will confidently produce plausible numbers, which are wrong in exactly the way that makes a design feel like a knockoff.

**"Use Linear's design system."** The model has *seen* Linear. It doesn't have Linear's values; it has a memory of them. Memory of a color is a color that's close. Close is what a knockoff is made of.

The common failure: **the model is asked to recall, when it should be reading.**

## What actually works

Give the agent one real design system's *measured* values at generation time.

That's the whole idea. The implementation is mundane:

1. Drive a real browser (Playwright) to the real site.
2. Walk the DOM, read `getComputedStyle` on every element.
3. Aggregate by frequency — the background color that appears on 40% of surface area is the background color; the 5 font sizes that cover 90% of text nodes are the type scale.
4. Use a vision model **only to interpret** — naming the aesthetic, writing the "don'ts" — with the measured numbers as ground truth it isn't allowed to contradict.

Step 4 is the part people usually invert. If you let the model produce the numbers, you're back to recall. The model should explain measurements, not invent them.

The output per site is an 11-layer spec: identity, color, typography, spacing, surfaces, layout, components, interaction, motion, voice, and — the one I'd argue matters most — **anti-patterns**. What this design deliberately refuses to do.

```jsonc
// GET https://opendesign.cc/packs/linear/spec.json
{
  "colors": {
    "bg": "#08090A", "ink": "#F7F8F8", "muted": "#62666D",
    "line": "rgba(255,255,255,0.08)",
    "principle": "Extreme contrast for focus, subtle noise and semi-transparent layers for depth."
  },
  "typography": { "display": "grotesque-sans", "scale": [ /* size / lh / weight / ls */ ] },
  "spacing": { "base": 4, "scale": [4, 8, 16, 24, 32, 48, 64, 96] },
  "motion": { /* duration buckets + easing curves */ }
}
```

Not "Linear-ish dark." The values Linear ships.

## The don'ts list is the underrated part

Most design documentation describes what a system does. The interesting information is what it won't do.

Linear won't use bouncy springs. Aesop won't use more than two type sizes above the fold. Stripe Press won't put a shadow on anything. These constraints are what makes each one recognizable — and they're exactly what a model reconstructing from memory will violate first, because the average page *does* have bouncy springs and shadows.

Giving the agent an explicit "here is what would break this taste" list turns out to be more corrective than any amount of positive description.

## Making it available where agents work

Static files would have been enough for me, but agents in practice live behind URL allowlists, sandboxes and CORS. So the library is exposed three ways:

- **Plain HTTP** — `catalog.json`, `packs/<slug>/spec.json`, `llms.txt`. No JS, no auth.
- **A protocol file** — `GET https://opendesign.cc/skill.md` gives an agent a design-director workflow: diagnose the need, take a position, route to references, decompose into tokens.
- **MCP** — 7 tools, remote endpoint (nothing to install) or a zero-dependency local Node server.

```json
{ "mcpServers": { "opendesign": { "url": "https://opendesign.cc/mcp/http" } } }
```

Two design decisions in the tools that I'd defend:

**`recommend_references` returns three picks from deliberately different aesthetic families.** Not the top 3 by relevance — top-3-by-relevance is three variations of the same idea, which gives you nothing to react to. Safe / bold / unexpected forces an actual choice. Family diversity is enforced in code, because "remember to diversify" in a prompt is not a guarantee.

**`search_designs` tells you which of your query terms matched nothing.** This one came out of a bug. Searching "japanese minimal aesthetic" used to return French minimalist studios with total confidence — "japanese" hit zero entries, and nothing said so. An agent has no way to detect that failure; it presents the results as an answer. Silent partial failure is worse than an error, so the response now names the terms that found nothing.

## Where it is

1,486 sites. 920 of them with full Playwright screenshot packs. Five languages. Marginal cost around $0.10 per site, so it keeps growing.

Free, public, no account, no key. Code MIT, specs CC BY 4.0.

- Site: https://opendesign.cc
- MCP: https://opendesign.cc/mcp/
- Code: https://github.com/qiuyiwu1989-star/opendesign

## What I'd still call unsolved

Being honest about the gaps, since they're the interesting part:

**Retrieval is keyword scoring, not semantics.** "Trustworthy" is not a word that appears in design metadata, and matching it lexically is nearly meaningless. The right fix is offline embeddings computed at build time. Not done yet.

**The aesthetic families are hand-written tag rules.** They work well enough to force diversity, but the honest version computes families from the tokens themselves — contrast ratios, hue counts, type-scale range, corner radii, motion durations. That data is already sitting in every spec. Clustering on measured properties instead of human tags is the thing this dataset uniquely makes possible, and it's the next real piece of work.

**Token completeness varies.** Some entries are a full system; some are two colors and a font category. An agent can't currently tell which before fetching. A `spec_completeness` field belongs in the catalog.

If the "make it look good" step of your AI workflow currently produces the same page every time — this is the layer I think is missing, and I'd genuinely like to hear where it breaks for you.
