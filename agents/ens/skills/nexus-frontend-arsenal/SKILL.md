---
name: nexus-frontend-arsenal
description: |
  Router for the Soluções Nexus AI frontend arsenal — 17 skills that turn Hermes
  into a Claude-Design/Codex-level frontend agent. Single entry point: load this
  skill and use the decision tree to dispatch to the right sub-skill.
triggers:
  - frontend
  - landing page
  - design
  - polish
  - ui
  - ux
  - animation
  - gsap
  - scrolltrigger
  - brand
  - extract colors
  - extract brand
  - marketing
  - paywall
  - copy
  - hero
  - dashboard
  - tokens
  - direction
---

# Nexus Frontend Arsenal — Router

The single entry point for frontend work. Load me first, then dispatch to one of
the 17 sub-skills based on the decision tree below.

## The 17 sub-skills (grouped by role)

### Workflow / process (4)
- `nexus-direction-picker` — pick visual direction BEFORE coding (3-5 options)
- `frontend-design` — Anthropic 6-step workflow (brief → design → production code)
- `impeccable-design-polish` — post-gen pass: audit/critique/polish/animate/harden/live
- `taste-skill` — anti-slop dials, brief inference, design read

### Token / system (2)
- `nexus-token-map` — map external tokens onto Nexus canonical
- `design-md` — author Nexus DESIGN.md (Google token spec format)

### Animation (2)
- `gsap-react` — useGSAP hook patterns, SSR-safe
- `gsap-scrolltrigger` — scroll-driven animation, pinning, scrubbing

### Brand extraction (2)
- `agent-browser` — drive live browser via Playwright/CDP
- `brand-extract` — measure site → Brand Kit (HTML/colors/typography/voice)

### Marketing / copy (3)
- `marketing-psychology` — persuasive copy heuristics
- `paywall-upgrade-cro` — conversion-optimized paywalls
- `competitive-ads-extractor` — pull patterns from competitor ads

### Asset / decoration (3)
- `theme-factory` — 10 pre-set themes for slides/docs/reports/HTML
- `canvas-design` — visual art in PNG/PDF
- `ui-skills` — ibelick opinionated UI constraints

### Existing native (kept for backward compat, NOT in arsenal trigger list)
- `claude-design`, `popular-web-designs`, `sketch`, `p5js`, `excalidraw`

## Decision tree (intent → sub-skill)

```
USER ASKED FOR FRONTEND WORK
│
├─ Brief is ambiguous (no style specified, multiple options)
│  └─→ nexus-direction-picker (show 3-5 directions)
│      └─ User picks one
│          └─→ frontend-design (execute 6-step workflow)
│
├─ Brief is clear, build new artifact
│  └─→ frontend-design
│      └─ After initial code, ALWAYS
│          └─→ impeccable-design-polish (audit → live)
│
├─ Brief is clear, premium feel required
│  └─→ frontend-design + taste-skill (dials)
│      └─ MUST load taste-skill/references/NEXUS-OVERRIDES.md FIRST
│      └─→ impeccable-design-polish
│
├─ User wants existing artifact polished / audited
│  └─→ impeccable-design-polish (start at audit, skip to live)
│
├─ User wants React with animations
│  └─→ gsap-react (always, regardless of animation type)
│      └─ IF scroll-driven → gsap-scrolltrigger
│
├─ User wants to extract brand from live site
│  └─→ agent-browser (set up browser tab)
│      └─→ brand-extract (measure + synthesize + register)
│      └─→ nexus-token-map (normalize onto Nexus canonical)
│
├─ User wants to migrate external design system
│  └─→ nexus-token-map (audit + override + report)
│
├─ User wants marketing copy / headlines
│  └─→ marketing-psychology (heuristics)
│      └─ IF conversion page → + paywall-upgrade-cro
│
├─ User wants to analyze competitor
│  └─→ agent-browser (visit competitor)
│      └─→ competitive-ads-extractor (pull patterns)
│      └─→ brand-extract (save as brand kit)
│
├─ User wants slide deck / report
│  └─→ theme-factory (pick theme)
│      └─→ canvas-design (if visual art needed)
│
└─ User wants one-off mockup to compare
   └─→ sketch (native Hermes skill, 2-3 variants)
```

## Workflow (canonical order for a new project)

1. **Discover** — `nexus-direction-picker` (3-5 directions)
2. **Pick** — user selects direction (always via `clarify` tool)
3. **Build** — `frontend-design` (6-step workflow)
4. **Animate** — `gsap-react` + `gsap-scrolltrigger` (if React)
5. **Taste** — `taste-skill` + `NEXUS-OVERRIDES.md` (premium polish)
6. **Token-map** — `nexus-token-map` (if external tokens involved)
7. **Polish** — `impeccable-design-polish` (audit → live)
8. **Document** — `design-md` (capture final state in DESIGN.md)

## Mandatory Nexus PRD overrides (apply to ALL sub-skills)

When any sub-skill runs, it MUST honor these:

- **Color:** bg `#0A0A1A` Obsidian, accent primary `#00D2FF` cyber teal, accent secondary `#FF6B6B` neon coral
- **Typography:** Space Grotesk 400-700 (display + body) + JetBrains Mono 400-500 (mono); **Inter forbidden**
- **Motion:** 4 easings 200/300/500/600ms (NOT Tailwind default)
- **Effects:** 3D budget 🔥🔥🔥/🔥🔥/🔥/❄° per PRD §5.4
- **Voice:** operator language, multi-tenant sovereignty, no hype words

If a sub-skill suggests a default that violates these, **reject and apply PRD**.

## Anti-patterns this arsenal prevents

- ❌ Purple-blue gradient as accent (anti-slop default)
- ❌ Inter as display font (forbidden 2026-06-27)
- ❌ system-ui fallback as final stack
- ❌ Generic 3-card feature row with identical icons
- ❌ Tailwind default `cubic-bezier(0.4, 0, 0.2, 1)` easing
- ❌ Decorations without product purpose (blobs, gradients-on-gradients)
- ❌ Empty marketing adjectives ("revolutionary", "cutting-edge", "magical")
- ❌ Hardcoded colors outside Nexus palette
- ❌ Type scale drift (mixing px/rem/em)

## Source

Built by Soluções Nexus AI from open-design (https://github.com/nexu-io/open-design, Apache 2.0) + native extensions. See REPORT.md in `/home/nexusai/Nexus-white-label/services/audit-tmp/` for full import log and architecture decisions.
