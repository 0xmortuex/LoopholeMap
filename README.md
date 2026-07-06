# LoopholeMap — Find the cracks in any regulation

An interactive visual tool that finds loopholes, exemptions, and gray areas in any regulation or law. Paste legal text, AI analyzes it, and the results are displayed as an interactive force-directed node graph where each node is a vulnerability and connections show how they relate.

![LoopholeMap Screenshot](assets/screenshot.png)

## Features

- **AI-Powered Analysis** — Paste any regulation and get an instant breakdown of loopholes, exemptions, gray areas, contradictions, and more
- **Interactive Node Graph** — D3.js force-directed graph with color-coded nodes by vulnerability type and animated connections showing relationships
- **Deep Dive** — Click any node for detailed analysis including exploitation methods, real-world parallels, stakeholder impact, and closing strategies
- **Severity Mapping** — Issues ranked by severity (critical, high, medium, low) with visual sizing
- **Side Panel** — Overview assessment, full legend, sortable node list, and statistics
- **Responsive** — Works on desktop, tablet, and mobile with touch-friendly interactions
- **Dark Theme** — Investigative noir aesthetic designed for focused analysis

## How to Use

1. Visit the [live demo](https://0xmortuex.github.io/LoopholeMap/)
2. Paste any regulation, law, or policy text into the input area
3. Click **Scan for Loopholes** (or press Ctrl+Enter)
4. Explore the interactive graph — click nodes for details, drag to reposition, scroll to zoom
5. Use **Deep Dive** on any node for comprehensive analysis

Or clone and run locally:

```bash
git clone https://github.com/0xmortuex/LoopholeMap.git
cd LoopholeMap
npx serve -l 3000 -s .
```

Then open `http://localhost:3000`. Serving locally lets the browser load the bundled RP legal reference files during scans.

## RP Legal Reference

This project can be used for RP Congress bill review. Project memory for future AI-assisted development lives in [`CLAUDE.md`](CLAUDE.md), and the RP legal source references are:

- [`docs/rp-law/constitution.md`](docs/rp-law/constitution.md)
- [`docs/rp-law/code-of-justice.md`](docs/rp-law/code-of-justice.md)
- [`docs/rp-law/all-legislation.md`](docs/rp-law/all-legislation.md)
- [`docs/rp-law/legislation-corpus.md`](docs/rp-law/legislation-corpus.md)
- [`docs/rp-law/legislation-compendium.md`](docs/rp-law/legislation-compendium.md)
- [`docs/rp-law/legislation/`](docs/rp-law/legislation/)

The app uses `all-legislation.md` as the single legislation source during scans. It contains the compendium summary plus the extracted full text from imported linked legislation docs.

When scanning a bill, the frontend loads these references, selects relevant excerpts, and sends them with the pasted bill to the analysis proxy.

## Tech Stack

- Vanilla HTML, CSS, JavaScript (no frameworks)
- [D3.js v7](https://d3js.org/) for force-directed graph visualization
- [Syne](https://fonts.google.com/specimen/Syne) + [Outfit](https://fonts.google.com/specimen/Outfit) + [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) fonts
- Cloudflare Worker proxy for AI analysis
- Runs entirely in the browser

## License

MIT
