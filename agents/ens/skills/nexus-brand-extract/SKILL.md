---
name: nexus-brand-extract
description: |
  Native Hermes wrapper for brand extraction. Uses the built-in browser_navigate,
  browser_snapshot, browser_console, browser_get_images, and vision_analyze tools
  (already shipped with Hermes) instead of the open-design agent-browser CLI.
  Produces a Brand Kit (colors, typography, voice, assets) from any live URL.
  Replaces brand-extract + agent-browser for Hermes-native workflows.
triggers:
  - "extract brand from url"
  - "get colors from site"
  - "get fonts from site"
  - "brand kit from"
  - "analyze this site"
  - "what font does X use"
  - "what colors does X use"
---

# Nexus Brand Extract (native)

This skill is a **native replacement** for the imported `brand-extract` +
`agent-browser` pair, which depend on the open-design desktop runtime. It uses
the browser tools already shipped with Hermes.

## Required tools (all native to Hermes)

- `browser_navigate(url)` - open the target URL
- `browser_snapshot()` - get DOM accessibility tree
- `browser_console(expression)` - evaluate JS in page context
- `browser_get_images()` - list all images on page
- `browser_vision(question)` - visual analysis with screenshot
- `vision_analyze(image_url, question)` - analyze screenshot or local image

## The 5-step chain

### Step 1: Navigate + identify

```
browser_navigate(url)
browser_snapshot()  -> confirm what page is
```

If anti-bot wall appears, **stop and ask user** (do not bypass).

### Step 2: Harvest design tokens via browser_console

Run this JS to extract the real tokens (in browser_console tool):

```javascript
const styles = getComputedStyle(document.documentElement);
const body = getComputedStyle(document.body);
const tokens = {
  colors: (() => {
    const colorFreq = new Map();
    document.querySelectorAll("*").forEach(el => {
      const s = getComputedStyle(el);
      [s.color, s.backgroundColor, s.borderColor].forEach(c => {
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") {
          colorFreq.set(c, (colorFreq.get(c) || 0) + 1);
        }
      });
    });
    return [...colorFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([color, count]) => ({ color, count }));
  })(),
  typography: (() => {
    const headings = [...document.querySelectorAll("h1, h2, h3")];
    return headings.slice(0, 5).map(h => ({
      tag: h.tagName,
      fontFamily: getComputedStyle(h).fontFamily,
      fontSize: getComputedStyle(h).fontSize,
      fontWeight: getComputedStyle(h).fontWeight,
      letterSpacing: getComputedStyle(h).letterSpacing,
      lineHeight: getComputedStyle(h).lineHeight,
      textTransform: getComputedStyle(h).textTransform
    }));
  })(),
  body: {
    fontFamily: body.fontFamily,
    fontSize: body.fontSize,
    color: body.color,
    backgroundColor: body.backgroundColor
  },
  fonts: [...document.styleSheets].flatMap(s => {
    try { return [...s.cssRules].filter(r => r instanceof CSSFontFaceRule)
      .map(r => ({ family: r.style.fontFamily, src: r.style.src })); }
    catch { return []; }
  })
};
JSON.stringify(tokens, null, 2);
```

Save the result as `brand-tokens.json` in the project.

### Step 3: Capture visuals

```
browser_vision("Describe the visual style: dark/light, density, hierarchy, motion cues, brand voice cues")
```

### Step 4: Extract images + logos

```
browser_get_images() -> save logos to /logos/, hero images to /assets/
```

### Step 5: Normalize via nexus-token-map

Pass `brand-tokens.json` to `nexus-token-map` to produce the final mapping
report (gaps, collisions, recommendations).

## Output: Brand Kit schema

```yaml
brand_kit:
  source_url: "https://..."
  extracted_at: "2026-06-27T..."
  identity:
    name: "..."
    tagline: "..."
    voice: ["operator", "technical", "sovereign"]
  colors:
    background: "#0A0A1A"
    surface: "#111126"
    foreground: "#F8F7FF"
    accent:
      primary: "#00D2FF"
      secondary: "#FF6B6B"
    gradient:
      primary: "linear-gradient(135deg, #4F46E5, #00D2FF)"
  typography:
    display: "Space Grotesk 700"
    body: "Space Grotesk 400"
    mono: "JetBrains Mono 400"
  voice_samples:
    - "Isolated RAG index per client"
    - "You control the keys"
  assets:
    logos:
      - "/logos/header.svg"
      - "/logos/footer.svg"
    hero:
      - "/assets/hero-1.jpg"
  nexus_compatibility:
    prd_aligned: true
    overrides_applied: 0
    gaps: ["color.accent.secondary missing"]
```

## Integration

After extraction, ALWAYS chain to `nexus-token-map` for canonical normalisation.
The agent-browser + brand-extract skills remain imported as fallback if a more
sophisticated extraction is needed (they require the open-design desktop app).

## Why this skill exists

The imported `brand-extract` expects `agent-browser` CLI + open-design daemon
to populate template tokens like `__OD_BRAND_TITLE__`. Neither ships with Hermes.
This skill uses browser_navigate (already in Hermes) to achieve the same goal
without external dependencies.

## Source

Pattern from open-design brand-extract (Apache 2.0), rewritten natively using
Hermes browser_* tools. Does not require the open-design desktop app.
