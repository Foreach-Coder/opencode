# Mermaid Diagram Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render completed Markdown `mermaid` fences as safe, theme-aware diagrams in BluedCode conversations and embed pre-rendered SVG snapshots in offline session HTML exports while preserving copyable source and original JSON.

**Architecture:** `packages/session-ui` owns Mermaid detection, lazy loading, trusted configuration, SVG sanitation, bounded caching, and application mounts. The HTML exporter calls the same service before download, stores exact-source-verified SVG snapshots beside the untouched session JSON, and renders those snapshots without shipping Mermaid in the exported file.

**Tech Stack:** SolidJS, Marked, Mermaid 11.17.2, DOMPurify, Bun tests, Playwright, Vite raw assets

**Spec:** `docs/superpowers/specs/2026-09-10-10-mermaid-diagram-rendering-design.md`

## Global Constraints

- Only a fenced Markdown block whose first info-string word lowercases to `mermaid` is a diagram.
- Keep an incomplete streaming fence as the existing highlighted code block; render only after the fence closes.
- Initialize Mermaid with `securityLevel: "strict"`, `startOnLoad: false`, `htmlLabels: false`, `maxTextSize: 50_000`, and `maxEdges: 500`; lock those values and all theme/CSS settings against diagram overrides.
- Sanitize and validate every SVG before DOM insertion. Never call `bindFunctions`; reject scripts, event attributes, `foreignObject`, embedded objects, interactive links, external URLs, `@import`, and non-fragment `url(...)` references.
- A successful card shows only the diagram and “Copy Mermaid source”; a failure keeps the complete ordinary code block and a localized failure label.
- Copy the same fence-interior code text as the ordinary code block, excluding fence markers.
- App diagrams follow the current light/dark mode. Exported diagrams use the fixed light export palette.
- Keep `session-data` byte-semantically equivalent to JSON export. Put derived Mermaid snapshots in a separate data block and never ship the Mermaid runtime in exported HTML.
- Do not change HTML export branding: the page says `CodeAgent`; application product naming remains `BluedCode`.
- Preserve all current uncommitted HTML export work and do not touch root `docs/design/`.
- Record the production timeline benchmark before source changes and compare it after implementation.
- Run the current `v1.18.18` BluedCode compatibility audit after source changes.
- Do not commit, push, tag, or publish during this plan; the current request authorizes implementation only.

---

### Task 1: Record the baseline and add the Mermaid dependency contract

**Files:**

- Modify: `package.json`
- Modify: `packages/session-ui/package.json`
- Modify: `bun.lock`
- Create: `.xcode/mermaid-baseline.log` (ignored evidence)

**Interfaces:**

- Consumes: the existing workspace catalog and `packages/session-ui` runtime dependency pattern.
- Produces: the exact `mermaid: "11.17.2"` catalog entry and `"mermaid": "catalog:"` session-ui dependency used by Task 2.

- [ ] **Step 1: Capture the clean V2 functional baseline before source changes**

Run from `packages/app`:

```powershell
bunx playwright test --config e2e/performance/playwright.config.ts e2e/performance/timeline/session-tab-switch-benchmark.spec.ts --project=chromium --workers=1 -g "benchmarks v2 session tab switching with and without the review pane"
```

Expected: exit 0 and record V2 closed/open cold/hot `stableObservedMs`, blank samples, wrong-target samples, and unknown samples. An earlier full-run preflight using the legacy V1 fixture failed because its expected title no longer matches the fixture; preserve that evidence, but do not use it as a Mermaid baseline gate. If the repository's known Windows declaration-file issue appears outside the benchmark, record it without changing unrelated files.

- [ ] **Step 2: Add the pinned dependency**

Add to the root workspace catalog:

```json
"mermaid": "11.17.2"
```

Add to `packages/session-ui/package.json` dependencies:

```json
"mermaid": "catalog:"
```

- [ ] **Step 3: Resolve the lockfile without upgrading unrelated packages**

Run from the repository root:

```powershell
bun install --frozen-lockfile
```

Expected first result: failure because the frozen lockfile does not contain Mermaid. Then run:

```powershell
bun install
```

Inspect `git diff -- bun.lock package.json packages/session-ui/package.json`; the lockfile may add Mermaid and transitive packages but must not change unrelated direct dependency versions.

- [ ] **Step 4: Verify package resolution**

```powershell
bun list --all | Select-String "mermaid@11.17.2"
bun pm why mermaid
```

Expected: one resolved Mermaid 11.17.2 dependency, attributed to `@opencode-ai/session-ui` through `catalog:`. Record a working-tree checkpoint in the SDD ledger; do not commit.

---

### Task 2: Build the shared safe Mermaid renderer with TDD

**Files:**

- Create: `packages/session-ui/src/components/markdown-mermaid.ts`
- Create: `packages/session-ui/src/components/markdown-mermaid.test.ts`
- Create: `packages/app/test-browser/markdown-mermaid.test.ts`
- Modify: `packages/session-ui/package.json`

**Interfaces:**

- Consumes: `mermaid@11.17.2`, DOMPurify, `checksum` from `@opencode-ai/core/util/encode`.
- Produces:

```ts
export type MermaidTheme = "light" | "dark"
export type MermaidFailure = "syntax" | "limit" | "unsafe" | "runtime"
export type MermaidRenderResult =
  | { ok: true; key: string; source: string; svg: string; title?: string }
  | { ok: false; key: string; source: string; reason: MermaidFailure }

export function isMermaidLanguage(language: string | undefined): boolean
export function mermaidSourceKey(source: string): string
export function sanitizeMermaidSvg(svg: string): { svg: string; title?: string } | undefined
export async function renderMermaid(source: string, theme: MermaidTheme): Promise<MermaidRenderResult>
export function clearMermaidCache(): void
```

- [ ] **Step 1: Write failing detection, key, and sanitizer tests**

Create tests that name the production break explicitly:

```ts
import { describe, expect, test } from "bun:test"
import { clearMermaidCache, isMermaidLanguage, mermaidSourceKey } from "./markdown-mermaid"

describe("Mermaid Markdown contract", () => {
  test("recognizes only mermaid as the first info-string word", () => {
    expect(isMermaidLanguage("mermaid")).toBe(true)
    expect(isMermaidLanguage(" Mermaid title=Flow ")).toBe(true)
    expect(isMermaidLanguage("typescript mermaid")).toBe(false)
    expect(isMermaidLanguage("mermaidish")).toBe(false)
  })

  test("keys include exact UTF-16 length and checksum", () => {
    expect(mermaidSourceKey("flowchart LR\nA-->B")).toMatch(/^18:[a-z0-9]+$/)
    expect(mermaidSourceKey("flowchart LR\nA-->B")).not.toBe(mermaidSourceKey("flowchart LR\nA-->C"))
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

```powershell
bun test src/components/markdown-mermaid.test.ts
```

Expected: FAIL because `markdown-mermaid.ts` or its exported functions do not exist. A syntax/setup error is not an acceptable RED; fix the test harness until the failure is the missing behavior.

- [ ] **Step 3: Implement detection, exact-source keying, and SVG validation**

Implement `isMermaidLanguage` by trimming, taking the first whitespace-delimited word, and lowercasing. Implement the key as `${source.length}:${checksum(source) ?? "0"}`. Configure DOMPurify with the SVG profile, then parse the result as `image/svg+xml` and walk every element and attribute. Return `undefined` if the root is not one SVG, any forbidden node/attribute existed in the original, or any URL is not a local `#fragment`. Validate style text before returning serialized SVG.

- [ ] **Step 4: Verify the pure tests GREEN**

```powershell
bun test src/components/markdown-mermaid.test.ts
```

Expected: both pure tests pass with no warning.

- [ ] **Step 5: Write failing real-render and cache tests**

Add `packages/app/test-browser/markdown-mermaid.test.ts` for SVG sanitation, a real Mermaid flowchart, invalid syntax, limits, theme-specific cache keys, and 100-entry eviction. Include the hostile `<script>`, external `<image>`, CSS `@import`, and valid local marker cases from the design. The valid render assertion must inspect the sanitized SVG output, not a mock call:

```ts
test("renders a real strict flowchart to safe SVG", async () => {
  clearMermaidCache()
  const result = await renderMermaid("flowchart LR\nA-->B", "light")
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.svg).toContain("<svg")
  expect(result.svg).not.toMatch(/<script|foreignObject|on\w+=|https?:/i)
})
```

- [ ] **Step 6: Run the new tests and verify RED**

Run the DOM-capable test from `packages/app`:

```powershell
bun test --conditions=browser --preload ./happydom.ts ./test-browser/markdown-mermaid.test.ts
```

Expected: FAIL because `renderMermaid` and bounded caching are absent.

- [ ] **Step 7: Implement lazy rendering and bounded cache**

Use one module-level dynamic import promise. Serialize each “apply trusted site config + `mermaid.render`” operation on a promise queue. Use trusted light/dark theme variables only; extend `secure` to lock `htmlLabels`, `theme`, `themeVariables`, `themeCSS`, `fontFamily`, `securityLevel`, `startOnLoad`, `maxTextSize`, and `maxEdges`. Do not call `bindFunctions`. Cache only successful sanitized SVG by `${Mermaid version}:${theme}:${mermaidSourceKey(source)}` and verify `source` equality on hits. Cap at 100 entries using delete-then-set LRU order.

- [ ] **Step 8: Verify Task 2**

```powershell
bun test src/components/markdown-mermaid.test.ts
Set-Location ..\app
bun test --conditions=browser --preload ./happydom.ts ./test-browser/markdown-mermaid.test.ts
Set-Location ..\session-ui
bun typecheck
```

Expected: renderer tests pass; session-ui typecheck exits 0. Record RED and GREEN command output in the task report and a working-tree checkpoint in the ledger; do not commit.

---

### Task 3: Integrate Mermaid cards into application Markdown with TDD

**Files:**

- Create: `packages/session-ui/src/components/markdown-mermaid-mounts.ts`
- Create: `packages/app/test-browser/markdown-mermaid-mounts.test.ts`
- Create: `packages/app/test-browser/markdown-mermaid-integration.test.tsx`
- Modify: `packages/session-ui/src/components/markdown.tsx`
- Modify: `packages/session-ui/src/components/markdown.css`
- Modify: `packages/session-ui/src/components/markdown.stories.tsx`
- Modify: `packages/ui/src/i18n/en.ts`
- Modify: `packages/ui/src/i18n/zh.ts`

**Interfaces:**

- Consumes: all Task 2 exports and `useTheme().mode()`.
- Produces:

```ts
export type MermaidLabels = { diagram: string; copySource: string; copied: string; failed: string }

export class MarkdownMermaidMounts {
  mount(input: {
    host: HTMLElement
    source: string
    theme: MermaidTheme
    labels: MermaidLabels
    render?: typeof renderMermaid
  }): void
  clear(root?: Element, afterRestore?: (root: Element) => void): void
}
```

- [ ] **Step 1: Write failing lifecycle tests**

Cover successful replacement, keeping code visible while pending, ignoring a late result after source/theme changes, failure fallback, exact source copy, and cleanup. Inject a deferred `render` function only for timing control; assertions target the mounted DOM and clipboard text.

```ts
test("keeps code until the matching safe diagram is ready", async () => {
  const host = codeHost("flowchart LR\nA-->B")
  const pending = deferred<MermaidRenderResult>()
  const mounts = new MarkdownMermaidMounts()
  mounts.mount({ host, source: "flowchart LR\nA-->B", theme: "light", labels, render: () => pending.promise })
  expect(host.querySelector("pre")).not.toBeNull()
  pending.resolve(success("flowchart LR\nA-->B"))
  await pending.promise
  expect(host.querySelector('[data-component="markdown-mermaid"] svg')).not.toBeNull()
})
```

- [ ] **Step 2: Verify lifecycle RED**

```powershell
Set-Location ..\app
bun test --conditions=browser --preload ./happydom.ts ./test-browser/markdown-mermaid-mounts.test.ts
```

Expected: FAIL because the mounts class does not exist.

- [ ] **Step 3: Implement mounts and app card DOM**

Use a WeakMap keyed by host for request identity and Solid `render` only for the localized copy button/tooltip. Preserve the existing wrapper until a matching result resolves. Insert the already sanitized SVG through `DOMParser` and `document.importNode`, never by assigning Mermaid output directly to `innerHTML`. On failure, mark the existing code wrapper with `data-mermaid-failed` and add a status element; on cleanup dispose Solid roots and invalidate pending requests.

- [ ] **Step 4: Verify lifecycle GREEN**

```powershell
bun test --conditions=browser --preload ./happydom.ts ./test-browser/markdown-mermaid-mounts.test.ts
```

Expected: all lifecycle tests pass.

- [ ] **Step 5: Write failing Markdown integration tests**

Add tests showing that an incomplete streaming `mermaid` fence remains `markdown-code`, a completed streaming fence invokes the mount once, a fully loaded completed response discovers only source-mapped closed `pre > code.language-mermaid`, and `typescript mermaid` stays ordinary code. Name the exact production branch that would make each fail. These Happy DOM tests exercise the production projection seam because Bun does not apply the repository's Vite Solid transform to a directly imported `Markdown.tsx`; Task 5 must therefore verify the real component wiring with Vite and Playwright.

- [ ] **Step 6: Verify integration RED**

```powershell
Set-Location ..\session-ui
bun test src/components/markdown-stream.test.ts
Set-Location ..\app
bun test --conditions=browser --preload ./happydom.ts ./test-browser/markdown-mermaid-integration.test.tsx
```

Expected: Mermaid-specific assertions fail while existing Markdown assertions remain green.

- [ ] **Step 7: Wire the existing two projection paths**

In `Markdown`, read `useTheme()` once. For streaming `mode: "code"`, call the mount only when the source fence is closed and `isMermaidLanguage(block.language)`. Keep this fence state separate from the general highlighting-complete state so stopping a stream does not render an unclosed fence. For completed/full HTML, map sanitized code nodes back to the original Markdown code tokens and discover only closed Mermaid fences after sanitation and before ordinary code decoration. In both paths pass the original code text, current light/dark mode, and typed i18n labels. When blocks are replaced or the Markdown root unmounts, restore Mermaid wrappers before disposing ordinary code-copy roots.

- [ ] **Step 8: Add card styling and story coverage**

Add `[data-component="markdown-mermaid"]` styles using existing theme tokens: 0.5px border, 6px radius, the current code-block surface, internal horizontal overflow, centered SVG, and a top-right copy action. The successful card has no source disclosure. The failure state retains existing `.shiki` styling and adds a muted localized status. Add one story containing a flowchart and one invalid block for visual inspection.

- [ ] **Step 9: Verify Task 3**

```powershell
Set-Location ..\session-ui
bun test src/components/markdown-stream.test.ts
bun test src --only-failures
bun typecheck
Set-Location ..\app
bun test --conditions=browser --preload ./happydom.ts ./test-browser/markdown-mermaid.test.ts ./test-browser/markdown-mermaid-mounts.test.ts ./test-browser/markdown-mermaid-integration.test.tsx
```

Expected: focused and full session-ui tests pass, typecheck exits 0, and no existing code-copy behavior regresses. Record the checkpoint; do not commit.

---

### Task 4: Pre-render and embed Mermaid snapshots in session HTML with TDD

**Files:**

- Create: `packages/app/src/utils/session-html-mermaid.ts`
- Create: `packages/app/src/utils/session-html-mermaid.test.ts`
- Modify: `packages/app/src/utils/session-export.ts`
- Modify: `packages/app/src/utils/session-html-download.ts`
- Modify: `packages/app/src/utils/session-html.ts`
- Modify: `packages/app/src/utils/session-html.test.ts`
- Modify: `packages/app/src/utils/session-html/runtime.js`
- Modify: `packages/app/src/utils/session-html/style.css`
- Modify: `packages/app/src/utils/session-html-labels.ts`
- Modify: `packages/app/src/i18n/session-export.ts`
- Modify: `packages/app/e2e/export/session-html.spec.ts`

**Interfaces:**

- Consumes: Task 2 `renderMermaid`, `isMermaidLanguage`, `mermaidSourceKey`, `MermaidRenderResult`.
- Produces:

```ts
export type SessionHtmlMermaidSnapshot = {
  key: string
  source: string
  svg?: string
  title?: string
  failure?: MermaidFailure
}

export async function sessionHtmlMermaidSnapshots(data: SessionExportData): Promise<SessionHtmlMermaidSnapshot[]>
```

`createSessionHtml` gains `mermaid: SessionHtmlMermaidSnapshot[]` in its options and writes `formatVersion: 1` plus the installed Mermaid version into `mermaid-snapshots` metadata.

- [ ] **Step 1: Write failing extraction and deduplication tests**

Use real `SessionExportData` fixtures with assistant text containing valid Mermaid, repeated Mermaid, ordinary code, an incomplete fence, and a task Markdown output. Assert only completed Markdown-rendered blocks are extracted, duplicates render once, and every record retains exact source for collision confirmation.

- [ ] **Step 2: Verify extraction RED**

```powershell
bun test src/utils/session-html-mermaid.test.ts
```

Expected: FAIL because the extractor does not exist.

- [ ] **Step 3: Implement snapshot extraction and pre-rendering**

Use Marked lexer data rather than regex so fence length, tildes, indentation, and info strings follow the same Markdown rules. Extract only assistant/text and the existing tool-output fields that `runtime.js` sends through `markdown(...)`. Deduplicate by key plus exact source. Call `renderMermaid(source, "light")` serially and preserve a structured failure record.

- [ ] **Step 4: Verify extraction GREEN**

```powershell
bun test src/utils/session-html-mermaid.test.ts
```

Expected: extraction, deduplication, source preservation, and failure-record tests pass.

- [ ] **Step 5: Write failing HTML shell and browser behavior tests**

Extend `session-html.test.ts` to assert original `session-data` round-trips unchanged, `mermaid-snapshots` is separate, renderer version increases, and no Mermaid runtime text is embedded. Extend the real `file://` Playwright fixture with one valid flowchart and one invalid diagram. Assert the valid card contains SVG, its copy button yields exact source, the invalid block remains visible, and no network request occurs.

- [ ] **Step 6: Verify HTML RED**

```powershell
bun test src/utils/session-html.test.ts src/utils/session-html-mermaid.test.ts
bunx playwright test --config e2e/export/playwright.config.ts --grep "Mermaid"
```

Expected: unit assertions fail for the absent sidecar and browser assertions fail because both fences are ordinary code.

- [ ] **Step 7: Make HTML download asynchronous and embed the sidecar**

Await `sessionHtmlMermaidSnapshots(data)` inside `downloadSessionHtml`; make `downloadSessionHtml` return `Promise<void>` and await it from `saveSessionExport`. Pass snapshots into `createSessionHtml`, emit the separate escaped JSON script, and increment `rendererVersion`. Keep `session-data` construction and JSON download untouched.

- [ ] **Step 8: Render only exact matching safe snapshots offline**

In `runtime.js`, build a map from `key` to records but accept a hit only when `record.source === code.textContent`. Parse `record.svg` as `image/svg+xml`, rerun the narrow structural/URL validation, import the SVG node, and build the same card/copy DOM as the app. A missing, mismatched, failed, or invalid record marks the existing code block as failed. Never import or evaluate Mermaid in the exported page.

- [ ] **Step 9: Add export styles and localized labels**

Use the export page's fixed light tokens for the card, overflow canvas, copy action, and failure label. Add typed Chinese/English labels for `mermaidDiagram`, `copyMermaidSource`, and `mermaidFailed`; reuse the existing copied feedback.

- [ ] **Step 10: Verify Task 4 GREEN**

```powershell
bun test src/utils/session-html.test.ts src/utils/session-html-mermaid.test.ts
bunx playwright test --config e2e/export/playwright.config.ts
bun run typecheck:e2e
```

Expected: unit and all export browser tests pass, original JSON comparison remains exact, and E2E typecheck exits 0. Record the checkpoint; do not commit.

---

### Task 5: Add real application Playwright and security coverage

**Files:**

- Create: `packages/app/e2e/regression/session-timeline-mermaid.spec.ts`
- Modify: the smallest existing session timeline fixture that can expose deterministic assistant Markdown
- Modify: `packages/app/e2e/export/session-html.spec.ts`
- Create: `.xcode/mermaid-app-light.png` (ignored evidence)
- Create: `.xcode/mermaid-app-dark.png` (ignored evidence)
- Create: `.xcode/mermaid-export-desktop.png` (ignored evidence)
- Create: `.xcode/mermaid-export-mobile.png` (ignored evidence)

**Interfaces:**

- Consumes: Task 3 application card selectors and Task 4 export card selectors.
- Produces: real-browser proof for rendering, streaming completion, theme changes, clipboard source, layout, fallback, and no diagram-triggered network.

- [ ] **Step 1: Read the required E2E guidance**

Read `packages/app/e2e/AGENTS.md` and the linked Playwright Best Practices, Auto-waiting, Assertions, Locators, Network, and Isolation pages. Do not use sleeps, `.first()`/`.last()` to suppress strictness, or visibility alone as async readiness.

- [ ] **Step 2: Write the failing application scenario**

Create deterministic fixture messages containing surrounding paragraphs, a valid flowchart, a wide flowchart, an invalid diagram, and ordinary code. Use role/label/test-contract locators. Assert exact diagram count, copied source, failure source, surrounding text, and card/page bounding boxes. Add a theme action and assert the SVG content changes only after the new themed card is ready.

- [ ] **Step 3: Verify application E2E RED before any E2E-only fix**

```powershell
$env:PLAYWRIGHT_PORT = "4472"
$env:PLAYWRIGHT_SERVER_PORT = "4472"
bunx playwright test e2e/regression/session-timeline-mermaid.spec.ts
```

Expected: any uncovered integration behavior fails for that exact missing behavior. If Tasks 2–3 already satisfy a case, retain it as regression coverage; do not manufacture a false RED by weakening production setup.

- [ ] **Step 4: Fix only observed integration gaps**

For every failure caused by production behavior, add or refine a focused unit/browser test first, rerun it to see RED, then make the minimal production change and rerun GREEN. Fixture or locator mistakes may be corrected without product changes.

- [ ] **Step 5: Add hostile-source and offline tamper cases**

Cover Mermaid `click`, HTML labels, frontmatter theme/CSS overrides, `javascript:` URLs, external image/font/icon URLs, `@import`, and a manually tampered snapshot sidecar. Register Playwright request listeners before navigation/action and assert zero requests to external origins.

- [ ] **Step 6: Capture and inspect four required visuals**

Use Playwright screenshots only after asserting the exact SVG/card ready state. Capture application light/dark and export desktop/390px. Inspect each image for clipped labels, nested backgrounds, missing borders, illegible colors, or page-level horizontal overflow; any correction starts with a failing box-model or style assertion.

- [ ] **Step 7: Verify Task 5**

```powershell
$env:PLAYWRIGHT_PORT = "4472"
$env:PLAYWRIGHT_SERVER_PORT = "4472"
bunx playwright test e2e/regression/session-timeline-mermaid.spec.ts
bunx playwright test --config e2e/export/playwright.config.ts
```

Expected: both suites exit 0, exact diagram/security/layout assertions pass, and screenshots match the approved card design. Record the checkpoint; do not commit.

---

### Task 6: Full verification, performance comparison, compatibility audit, and spec record

**Files:**

- Modify: `docs/superpowers/specs/2026-09-10-10-mermaid-diagram-rendering-design.md`
- Modify only if audit requires: `xcode/build/bluedcode/version/1.18.18/baseline.json`
- Modify only if baseline changes: the corresponding BluedCode resource digest file
- Create: `.xcode/mermaid-*.log` (ignored evidence)

**Interfaces:**

- Consumes: all earlier tasks and `.xcode/mermaid-baseline.log`.
- Produces: verified implementation evidence and an accurate version-spec record; it does not update the root origin implementation matrix until an authorized complete implementation commit exists.

- [ ] **Step 1: Run focused and package suites**

From `packages/session-ui`:

```powershell
bun test src --only-failures 2>&1 | Tee-Object ..\..\.xcode\mermaid-session-ui-test.log
bun typecheck 2>&1 | Tee-Object ..\..\.xcode\mermaid-session-ui-typecheck.log
```

From `packages/app`:

```powershell
bun run test:unit 2>&1 | Tee-Object ..\..\.xcode\mermaid-app-unit.log
bun run test:browser 2>&1 | Tee-Object ..\..\.xcode\mermaid-app-browser.log
bun run typecheck:e2e 2>&1 | Tee-Object ..\..\.xcode\mermaid-e2e-typecheck.log
```

Expected: all commands exit 0. If full app typecheck is also run and hits the documented unrelated Windows/materialized-link errors, report exact files and preserve them byte-for-byte.

- [ ] **Step 2: Run both Playwright suites fresh**

```powershell
$env:PLAYWRIGHT_PORT = "4472"
$env:PLAYWRIGHT_SERVER_PORT = "4472"
bunx playwright test e2e/regression/session-timeline-mermaid.spec.ts 2>&1 | Tee-Object ..\..\.xcode\mermaid-app-e2e.log
bunx playwright test --config e2e/export/playwright.config.ts 2>&1 | Tee-Object ..\..\.xcode\mermaid-export-e2e.log
```

- [ ] **Step 3: Build the application**

```powershell
bun run build 2>&1 | Tee-Object ..\..\.xcode\mermaid-app-build.log
```

Expected: exit 0. Inspect the Vite manifest/output: Mermaid is in a lazy chunk and is absent from the initial application entry; exported HTML fixture contains no Mermaid runtime signature.

- [ ] **Step 4: Repeat the production benchmark under the baseline conditions**

```powershell
$env:SESSION_TAB_SWITCH_RUNS = "1"
$env:PLAYWRIGHT_PORT = "4471"
$env:PLAYWRIGHT_SERVER_PORT = "4471"
bunx playwright test --config e2e/performance/playwright.config.ts e2e/performance/timeline/session-tab-switch-benchmark.spec.ts 2>&1 | Tee-Object ..\..\.xcode\mermaid-after.log
```

Compare the same cold/hot fields and blank/wrong-target/unknown counts with `.xcode/mermaid-baseline.log`. Record raw values and describe single-run timing as observational, not statistically conclusive.

- [ ] **Step 5: Run brand compatibility audit**

From `xcode/build/bluedcode`:

```powershell
bun run build.ts --channel dev --audit-only 2>&1 | Tee-Object ..\..\..\.xcode\mermaid-brand-audit.log
```

Expected: exit 0. If a controlled-source fingerprint fails, update only the `v1.18.18` declarative baseline and its resource digest, first run its focused adapter test, then rerun the audit. Do not change common build framework code unless the audit proves a new reusable capability is required.

- [ ] **Step 6: Verify the working diff and update the version spec truthfully**

```powershell
git diff --check
git status --short
```

Append exact RED/GREEN commands, passing counts, screenshot paths, benchmark values, build result, and brand-audit result to the version spec. Keep status “workspace implementation verified, awaiting authorized commit” and leave the root `ORIGIN-10` version matrix empty.

- [ ] **Step 7: Perform final independent review**

Review every `ORIGIN-10` acceptance criterion against a test or artifact. Inspect the full diff for unsafe SVG insertion, unbounded cache, Mermaid eager import, modified original JSON, hardcoded visible strings, `BluedCode` in exported chrome, and unrelated files. Resolve all load-bearing findings through a fresh failing test and one minimal fix cycle. Do not commit.
