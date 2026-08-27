---
name: nexus-token-map
description: |
  Map external design tokens (from Figma exports, scraped CSS, open-design design-systems,
  or competitor sites) onto the canonical Nexus DESIGN.md. Generates a deterministic
  mapping report that downstream skills (frontend-design, taste-skill, brand-extract)
  consume. Replaces the open-design token-map atom (which depended on the desktop runtime).
triggers:
  - "map tokens"
  - "import design system"
  - "translate design"
  - "match colors"
  - "token migration"
  - "design system mapping"
---

# Nexus Token Map

When external tokens arrive (from Figma, scraped CSS, open-design DS, competitor
brand-extract), this skill normalises them into the Nexus canonical token shape and
reports gaps, collisions, and overrides.

## The Nexus canonical token shape (from PRD §2.1, §2.2, §5.3, §5.4)

```yaml
color:
  bg: "#0A0A1A"            # Obsidian (primary background)
  surface: "#111126"       # elevated surface
  fg: "#F8F7FF"            # primary text
  fg-muted: "#9D8AD4"      # secondary text
  border: "#34265E"        # subtle dividers
  accent:
    primary: "#00D2FF"     # cyber teal (CTAs, focus)
    secondary: "#FF6B6B"   # neon coral (alerts, highlights)
    tertiary: "#FFB800"    # warning / accent gold
  gradient:
    primary: "linear-gradient(135deg, #4F46E5 0%, #00D2FF 100%)"   # indigo to teal
    accent:  "linear-gradient(135deg, #FF6B6B 0%, #FFB800 100%)"   # coral to gold
    glow:    "linear-gradient(135deg, #4F46E5 0%, #7C3AED 50%, #00D2FF 100%)"  # indigo to purple to teal
  success: "#39FF88"
  warning: "#FFF34D"
  danger: "#FF4D8D"

typography:
  display: "Space Grotesk 400-700"
  body:    "Space Grotesk 400-700"
  mono:    "JetBrains Mono 400-500"
  forbidden: "Inter"   # removed 2026-06-27 per user decision

motion:
  easings:
    - 200ms   # micro (hover, focus)
    - 300ms   # small (state change)
    - 500ms   # medium (enter/exit)
    - 600ms   # large (page transition)
  forbidden_default: "cubic-bezier(0.4, 0, 0.2, 1)"  # Tailwind default — too generic
  effects_3d_budget:
    fire: 3   # 🔥🔥🔥 — hero, above-fold
    medium: 2 # 🔥🔥 — section break
    warm: 1   # 🔥 — secondary
    cold: 0   # ❄ — disabled

spacing:
  scale: [4, 8, 12, 16, 20, 24, 32, 48, 64, 96, 128]  # px
  section-y:
    desktop: 96
    tablet: 68
    phone: 48
```

## What this skill does

Given an external token source (CSS file, JSON tokens, Figma export, DESIGN.md), this
skill:

1. **Parses** the source into a normalised dict
2. **Classifies** each token: color/typography/motion/spacing/effect
3. **Detects forbidden defaults** — purple-blue gradients, Inter, system-ui stacks, default easings
4. **Maps** matching tokens onto Nexus canonical slots (bg, accent.primary, display font, etc.)
5. **Flags gaps** — what the external source is missing that Nexus requires
6. **Flags collisions** — where external values would override Nexus PRD values
7. **Reports** in a structured form the agent can act on

## How to invoke

```python
# Pseudo-invocation when the agent has tokens in context
nexus_token_map(
  source_tokens={...},                    # parsed from external source
  nexus_design_md_path="path/to/DESIGN.md", # canonical Nexus design contract
  mode="audit" | "migrate" | "compare"
)
# Returns: TokenMapReport (mapping + gaps + collisions + recommendations)
```

## Output: TokenMapReport

```yaml
summary:
  external_source: "open-design/neon"
  external_token_count: 23
  nexus_token_count: 28
  match_rate: 0.82
  override_required: true

mappings:
  - external: { name: "bg", value: "#070711" }
    nexus: { slot: "color.bg", value: "#0A0A1A" }
    action: "override"  # external is close but PRD is authoritative
    note: "Obsidian #0A0A1A is 4% lighter; PRD wins"
  - external: { name: "accent", value: "#c084fc" }
    nexus: { slot: "color.accent.primary", value: "#00D2FF" }
    action: "override"
    note: "External uses purple (open-design/neon default); Nexus uses cyber teal"

gaps:
  - slot: "color.accent.secondary"
    external: null
    nexus_value: "#FF6B6B"
    severity: "critical"  # no fallback
  - slot: "motion.easings[600ms]"
    external: null
    severity: "warning"

collisions:
  - slot: "typography.display"
    external_value: "Inter"
    nexus_value: "Space Grotesk 400-700"
    action: "REMOVE Inter, ADD Space Grotesk"
    reason: "user decision 2026-06-27"

forbidden_patterns_detected:
  - pattern: "purple-blue gradient"
    locations: ["color.accent", "gradient.primary"]
    replacement: "use Nexus gradient.primary (indigo → cyber teal)"
  - pattern: "Inter font"
    locations: ["typography.display", "typography.body"]
    replacement: "Space Grotesk"

recommendations:
  - "Override color.bg to #0A0A1A (PRD authoritative)"
  - "Replace purple accent with cyber teal #00D2FF"
  - "Remove Inter, install Space Grotesk + JetBrains Mono"
  - "Add 600ms easing for page transitions (PRD §5.3)"
```

## Integration with other skills

- **`brand-extract`** — output feeds `nexus-token-map` for normalisation
- **`frontend-design`** — reads `nexus-token-map` report before applying brand
- **`taste-skill`** — uses `nexus-token-map` to detect forbidden patterns in incoming briefs
- **`claude-design`** (existing native) — both should defer to Nexus canonical when active

## Anti-patterns this skill enforces

- ❌ Never let external tokens override PRD-authoritative values silently
- ❌ Never accept Inter as a font (user removed 2026-06-27)
- ❌ Never accept purple-blue gradient as "accent" (anti-slop default)
- ❌ Never accept default Tailwind easing (`cubic-bezier(0.4, 0, 0.2, 1)`)
- ❌ Never accept system-ui as display font unless brief explicitly requests brutalist/raw
- ❌ Never let external tokens collapse the 14-color + 3-gradient palette into mono

## Source

Inspired by open-design token-map atom (Apache 2.0), rewritten natively for Hermes.
Does not require the open-design desktop runtime; can run with any tokens in context.
