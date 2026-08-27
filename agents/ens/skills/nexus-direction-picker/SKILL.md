---
name: nexus-direction-picker
description: |
  Show 3-5 visual/architectural direction options before generating a frontend artifact.
  Native Nexus replacement for the open-design direction-picker atom (which depends on
  the open-design desktop runtime). Use when the brief is ambiguous about visual style,
  framework choice, or composition pattern. Pairs with the existing Hermes `clarify` tool
  for structured intent capture, but produces richer, design-focused option sets.
triggers:
  - "pick a direction"
  - "show me options"
  - "what style"
  - "which approach"
  - "design direction"
  - "visual style options"
  - "framework choice"
---

# Nexus Direction Picker

When the user asks for frontend work but the visual direction is ambiguous, generate 3-5
distinct directions before writing code. Each direction is a complete stance, not a
color swap.

## When to use

- User asks for a landing page, dashboard, or hero without specifying aesthetic
- User says "make it look like X" but X is broad (Stripe-like, Apple-like, dark cyber)
- Brief is clear on what but unclear on how it should feel
- Two equally valid framework approaches exist (Next.js vs Vite, Tailwind vs vanilla CSS)

## When NOT to use

- User specified exact brand, design system, or design tokens
- User provided a screenshot or DESIGN.md to match
- Work is bug-fix or refactor, not greenfield
- Single obvious choice exists

## The 5-direction taxonomy

Generate ONE direction per quadrant, plus optionally a wildcard:

1. **Editorial / Magazine** — typographic, asymmetric, content-first, generous whitespace
2. **Operational / Dashboard** — dense, monospace, data-forward, scannable
3. **Cinematic / Spatial** — full-bleed, motion-led, immersive, low chrome
4. **Brutalist / Honest** — raw, structural, type-as-decoration, no shadows
5. **Wildcard** — pull from a different family entirely (skeuomorphic, retro, organic)

## For each direction, provide

- **Visual stance** (2-3 sentences on feel, hierarchy, density)
- **Type system** (display + body family, scale ratio)
- **Color posture** (light/dark, mono/polychrome, accent strategy)
- **Motion language** (static / restrained / cinematic)
- **Best fit** (when to pick this over the others)
- **Trade-off** (what you lose by picking this)

## Nexus PRD overrides

When presenting directions, ALWAYS mention the Nexus constraints:
- bg #0A0A1A Obsidian, cyber teal #00D2FF, neon coral #FF6B6B
- Space Grotesk 400-700 + JetBrains Mono 400-500 (Inter removed)
- 4 easings: 200/300/500/600ms

A direction that uses Inter, default blue gradients, or system fonts should be
auto-rejected before presentation.

## How to present

Use the Hermes `clarify` tool with the directions as choices. Each choice should be
short (1 line label) so the user can scan. The full stance lives in the description
field, opened only if the user asks.

After the user picks, fall through to `frontend-design` for execution.

## Source

Inspired by open-design direction-picker atom (Apache 2.0), but rewritten natively
for Hermes using the `clarify` tool. Does not depend on the open-design desktop app.
