<div align="center">

<img src="og-cover.png" alt="OpenDesign" width="640" />

# OpenDesign

### The taste layer for AI-built software.

**1,486 real design systems. Grounded tokens, not vibes. One line to connect.**

[![MIT](https://img.shields.io/badge/code-MIT-1f1f1f?style=flat-square)](LICENSE)
[![Specs CC BY 4.0](https://img.shields.io/badge/specs-CC%20BY%204.0-1f1f1f?style=flat-square)](LICENSE)
[![Live](https://img.shields.io/badge/live-opendesign.cc-b4451c?style=flat-square)](https://opendesign.cc)
[![MCP](https://img.shields.io/badge/MCP-ready-b4451c?style=flat-square)](https://opendesign.cc/mcp/)

[Live site](https://opendesign.cc) · [MCP setup](https://opendesign.cc/mcp/) · [Agent protocol](https://opendesign.cc/skill.md) · [中文说明](README.zh-CN.md)

</div>

---

## The problem

Ask any AI to build you a landing page. You get Inter, a blue-violet gradient hero, `rounded-2xl` on everything, a soft shadow on every card.

That's not a bug. **It's the mathematical average of the training data** — and an average has no brand. Every AI-built page ends up looking like every other AI-built page.

You can't prompt your way out of it. "Make it look premium" isn't executable. Pasting a screenshot isn't verifiable. The model still falls back to the mean.

## The fix

Give the agent **one real design system's actual values** at the moment of generation.

```
"Build a fintech dashboard that feels trustworthy"
        ↓
  recommend_references()    → 1 primary + 2 alternates, deliberately different aesthetics
        ↓
  get_design_system("...")  → the REAL tokens from that site
        ↓
  { bg: "#08090A", ink: "#F7F8F8", muted: "#62666D",
    line: "rgba(255,255,255,0.08)", scale: [...], motion: {...} }
        ↓
  Every value traces to a design real humans shipped.
```

Not "Stripe-ish blue." The hex Stripe actually ships.

## Connect it

**Remote — nothing to install:**

```json
{ "mcpServers": { "opendesign": { "url": "https://opendesign.cc/mcp/http" } } }
```

**Local — zero-dependency Node:**

```json
{ "mcpServers": { "opendesign": { "command": "npx", "args": ["-y", "opendesign-mcp"] } } }
```

Works with Claude Desktop, Claude Code, Cursor, Windsurf — any MCP client. No account, no API key, no rate card.

**No MCP?** Everything is static and public. `GET https://opendesign.cc/skill.md` turns any agent into a design director; `catalog.json`, `packs/<slug>/spec.json` and `llms.txt` are plain fetches.

## The 7 tools

| Tool | What it does |
|---|---|
| `get_director_protocol` | **Read first.** The protocol: diagnose → form a POV → route → decompose |
| `recommend_references` | A brief in, 1 primary + 2 alternates from *different* aesthetic families — safe / bold / unexpected, enforced in code |
| `get_design_system` | **The core one.** A site's real grounded tokens |
| `search_designs` | Score-ranked search. Tells you which of your terms matched *nothing* instead of silently returning noise |
| `list_designs` | Browse the catalog |
| `fetch_design_spec_markdown` | The full spec as Markdown, 5 languages — drop straight into a prompt |
| `get_critique_rubric` | The 5-dimension review scorecard for "is this design any good?" |

## Why the tokens are trustworthy

Every entry is extracted by driving a real browser (Playwright), reading `getComputedStyle` off the actual DOM, aggregating by frequency, and grounding a vision model's read against those measurements. **The numbers are measured, not remembered.**

| | Typical inspiration gallery | OpenDesign |
|---|---|---|
| What you get | A screenshot | Machine-readable token spec |
| Colors | You eyedrop them | Actual hex, frequency-ranked |
| Type | "looks like a grotesk" | Real scale: size / line-height / weight / tracking |
| Motion | — | Duration buckets + easing curves |
| Anti-patterns | — | An explicit **don'ts** list per site |
| For an agent | Unusable | One fetch = full design context |

**1,486 sites** · **920** with full Playwright screenshot packs · **5 languages** · **~$0.10** marginal cost per site

## What's actually in a spec

Two artifacts, two shapes — and the counts below are what you will literally find in the files, not a roadmap.

**`spec.json` — all 1,486 sites, 6 measured token layers:**

`colors · typography · spacing · surfaces · layout · motion`

Every value is read off the live page with Playwright + `getComputedStyle`, then grounded against the measurements. Nothing here is a model's impression of the site.

**`DESIGN.md` — the 920 sites with full packs, 9 sections:**

`Overview · Colors · Typography · Layout · Elevation & Depth · Shapes · Components · Do's and Don'ts · System Prompt`

The extra sections are the interpretive ones — component recipes, the anti-pattern list, and a paste-ready system prompt — which need the screenshots the pack pipeline produces.

Same shape across every site, so an agent that learns to read one has learned to read all of them. → [layer definitions](docs/11-layer-spec.md)

```jsonc
// GET https://opendesign.cc/packs/linear/spec.json
{
  "colors": { "bg": "#08090A", "ink": "#F7F8F8", "muted": "#62666D",
              "line": "rgba(255,255,255,0.08)",
              "principle": "Extreme contrast for focus, subtle noise and semi-transparent layers for depth." },
  "typography": { "display": "grotesque-sans", "scale": [ /* size / lh / weight / ls */ ] },
  "spacing": { "base": 4, "scale": [4, 8, 16, 24, 32, 48, 64, 96] },
  "motion": { /* durations + easing */ },
  "surfaces": { /* radii, elevation strategy */ }
}
```

## Also usable by humans

Browse [opendesign.cc](https://opendesign.cc) — infinite canvas, 5-language detail pages, downloadable design packs (spec + tokens + real screenshots as a ZIP).

## Run your own

```bash
git clone https://github.com/qiuyiwu1989-star/opendesign
cd opendesign/extract && ./setup.sh
python3 extract.py https://your-site.com          # drive the browser, measure the DOM
python3 synthesize.py extracts/your-site-com      # → spec.json + DESIGN.md
./pack.sh extracts/your-site-com                  # → downloadable pack
```

Full pipeline, self-hostable: [architecture](docs/architecture.md) · [deployment](docs/deployment.md) · [data pipeline](docs/data-pipeline.md)

## Docs

**Concepts** — [positioning & first principles](docs/positioning.md) · [layer definitions](docs/11-layer-spec.md) · [design pack standard](docs/design-pack-standard.md)

**Agent integration** — [MCP setup](https://opendesign.cc/mcp/) · [agent integration](docs/ai-agent-integration.md) · [the director protocol](skill/SKILL.md)

**Operating it** — [curator workflow](docs/curator-workflow.md) · [quality gate](docs/quality-gate.md) · [lessons learned](docs/lessons-2026-08.md)

## Contributing

1. **Propose a site** — [open an issue](.github/ISSUE_TEMPLATE/propose-site.yml), takes a minute
2. **Fix a spec** — spot a wrong color or a weak don'ts list? PR the entry
3. **Anything else** — tools, docs, translations

Selection bar: a clear design DNA you can grasp in three pages, decomposable into tokens, with an opinion about what it *refuses* to do. Not: content farms, template SaaS, component-library soup. → [CONTRIBUTING.md](CONTRIBUTING.md)

## License

**Code** MIT · **Curated specs** CC BY 4.0 (commercial use fine, keep attribution) · **Original sites' assets** © respective owners

```bibtex
@misc{opendesign2026,
  title  = {OpenDesign: an open standard for extracting reusable web design
            tokens via browser instrumentation and vision models},
  author = {Qiu, Yiwu and OpenDesign contributors},
  year   = {2026},
  url    = {https://opendesign.cc}
}
```

<div align="center">

Made with ✦ by [Qiu Yiwu](https://qiuyiwu.com)

</div>
