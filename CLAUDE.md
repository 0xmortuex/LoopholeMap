# LoopholeMap Project Memory

LoopholeMap is used for an RP game to review proposed Congress bills against the game's legal framework. Treat all legal analysis as fictional, in-universe analysis for gameplay and legislative drafting.

## Core Purpose

The app maps loopholes, exemptions, gray areas, contradictions, missing definitions, weak enforcement, scope gaps, and sunset clauses in pasted bill or regulation text.

For this RP game, it must also reason against these standing legal sources:

- The RP Constitution: `docs/rp-law/constitution.md`
- The RP Code of Justice: `docs/rp-law/code-of-justice.md`
- The single all-legislation reference: `docs/rp-law/all-legislation.md`
- The RP legislation compendium: `docs/rp-law/legislation-compendium.md`
- The RP legislation corpus extracted from linked docs: `docs/rp-law/legislation-corpus.md`
- Individual imported legislation documents: `docs/rp-law/legislation/`

Before changing analysis logic, prompts, sample data, or output schemas, read the relevant reference files. If a file still contains placeholder text, ask the user for the real source text instead of inventing it.

## RP Legal Reasoning Rules

When reviewing a proposed RP Congress bill:

1. Check whether the bill conflicts with the Constitution.
2. Check whether the bill conflicts with, duplicates, weakens, or creates ambiguity in the Code of Justice.
3. Check whether the bill conflicts with, duplicates, supersedes, or creates ambiguity with existing legislation in the compendium.
4. Identify whether the bill can pass normally or would require a constitutional amendment.
5. Preserve exact article, section, clause, bill number, act title, and title references when citing RP legal sources.
6. Separate gameplay/policy preference from legal compatibility. A bill can be bad policy without being unconstitutional.
7. Treat the Ownership Team (OT) as supreme in-universe authority. OT-related powers, approvals, overrides, exemptions, discretion, or actions should not be counted as loopholes, constitutional conflicts, Code of Justice inconsistencies, or amendment requirements.
8. Exclude OT-only findings entirely. Only report OT-related content when the bill gives OT powers to a non-OT actor or allows someone to impersonate OT; frame that as the non-OT delegation or impersonation issue.
9. Do not fabricate missing constitutional, Code of Justice, or legislation provisions. If the reference text is absent or ambiguous, say that directly.

## Existing App Vocabulary

The frontend already supports these RP-specific issue types:

- `constitutional-conflict`: a bill contradicts the Constitution or exceeds constitutional authority.
- `coj-inconsistency`: a bill conflicts with, duplicates, weakens, or ambiguously modifies the Code of Justice.
- `requires-amendment`: a bill goal appears possible only through constitutional amendment or formal legal-code amendment.

Keep these values stable because `js/parser.js`, `js/board.js`, and `js/app.js` use them for validation, colors, glyphs, filters, and legend display.

## Expected Analysis Behavior

When the AI analyzes a bill with RP legal context available, nodes should include:

- The exact bill section being flagged.
- The relevant Constitution, Code of Justice, or legislation compendium section.
- `possibility`: how likely the issue is to happen in RP practice, using `very-low`, `low`, `medium`, `high`, or `very-high`.
- `difficulty`: how hard it would be to exploit or trigger, using `easy`, `moderate`, `hard`, or `very-hard`.
- Why the conflict, gap, or amendment requirement matters.
- How the language could be exploited in RP gameplay.
- A suggested fix that keeps the bill legally compatible where possible.

If a proposed fix changes constitutional structure or core rights, label it as `requires-amendment` rather than presenting it as an ordinary drafting fix.

## Runtime Note

The browser app sends analysis requests through the Cloudflare Worker in `js/api.js`. Before analysis, the frontend loads `docs/rp-law/constitution.md`, `docs/rp-law/code-of-justice.md`, and `docs/rp-law/all-legislation.md`, selects relevant excerpts, and includes them with the pasted bill text. The request also includes `rpLegalContext` metadata for backends that explicitly support it.

The repo does not currently contain the Worker source. If changing the backend prompt or corpus, keep the frontend JSON schema compatible with `js/parser.js`.

## Development Notes

- This is a static browser app: vanilla HTML, CSS, and JavaScript.
- There is no build step. Open `index.html` directly or serve the repo locally.
- Keep output JSON compatible with the parser.
- Avoid unrelated refactors when updating RP legal behavior.
