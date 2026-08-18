# Conversation Response Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build BluedCode Desktop response annotations so users can select completed Assistant response text, attach optional comments, submit those annotations with the next request, and see model-produced annotation references in the reply history.

**Architecture:** Add a shared Markdown-readable-text projection and annotation contract, then centralize source validation and model serialization in `packages/opencode`. The Desktop App owns draft selection/editing/persistence and UI rendering, while Session UI stays presentational; no public SDK part type is added.

**Tech Stack:** Bun tests, TypeScript, SolidJS, Effect services, existing `TextPart.metadata`, existing prompt state persistence, existing BluedCode build audit.

**Spec:** `docs/superpowers/specs/2026-08-18-08-conversation-response-annotations-design.md`

## Global Constraints

- Corresponding origin requirement: `ORIGIN-08`, root spec `../docs/origin-specs/08-conversation-response-annotations.md`.
- Product scope: `BluedCode Windows x64 Desktop`, V1 and V2 layouts.
- Only completed Assistant body TextParts can be annotated; user messages, Reasoning, tool input/output, streaming content, cross-message selection, and cross-part selection are out of scope.
- Model-visible format must be `<response-annotations version="1">` followed by a JSON array and `<user-request>`.
- Stable Assistant output directive is `:bluedcode-annotation{index="N"}`.
- The model must be prompted to address every annotation, but runtime must not auto-retry, block, hide, or issue a second model call when the model misses or duplicates a directive.
- Limits: 20 annotations per request, selected text 4,000 Unicode code points, comment 2,000 Unicode code points, before/after 160 Unicode code points each.
- Server must regenerate source, selected text, and context from durable Assistant history; it must not trust client-provided selected text, context, digest, or final model text.
- No annotations means existing user request and system prompt behavior is unchanged.
- New visible UI strings in `packages/app` and `packages/session-ui` must use the existing i18n pattern; do not hardcode user-visible English in production components.
- No commit, push, tag, release, or force-push unless the user explicitly requests it after implementation.
- Any source changes must be checked against BluedCode build compatibility; do not update the ORIGIN-08 implementation matrix until real implementation and build validation finish.

---

## File Structure

- `packages/core/src/session/response-annotation.ts`: shared projection, Unicode code point utilities, digest, limits, metadata schemas, model serialization helpers that do not depend on App or Server.
- `packages/core/test/session-response-annotation.test.ts`: projection, digest, limits, XML+JSON serialization, and directive parser tests that can run outside Desktop.
- `packages/opencode/src/session/response-annotation.ts`: server-side admission validation, canonical metadata rewrite, and system prompt detection helpers.
- `packages/opencode/test/session/response-annotation.test.ts`: durable source validation, rejection, no-provider-call, model projection, and prompt-injection tests.
- `packages/opencode/src/session/prompt.ts`: call annotation admission before user message persistence/provider execution; append annotation prompt only when current request has annotations.
- `packages/opencode/src/session/message-v2.ts`: convert canonical annotation metadata into the model-visible XML wrapper plus JSON payload.
- `packages/app/src/context/prompt-state.ts`: add response annotation draft context items and actions.
- `packages/app/src/components/prompt-input/build-request-parts.ts`: attach annotation metadata carrier to TextPart without generating protocol text on the client.
- `packages/app/src/components/prompt-input/history.ts` and `history-store.ts`: preserve response annotation drafts in local prompt history.
- `packages/app/src/components/prompt-input.tsx` and `prompt-input-v2.tsx`: show annotation count/details and allow edit/delete in V1 and V2.
- `packages/app/src/pages/session/timeline/message-timeline.tsx` and related timeline files: wire selection controller, history annotation display, source scrolling, and temporary highlights.
- `packages/session-ui/src/components/response-annotation.tsx`: presentational popovers, editor, detail list, reference button, and read-only history components.
- `packages/session-ui/src/components/response-annotation.test.tsx`: keyboard and rendering tests for presentational components.
- `packages/session-ui/src/components/message-part.tsx` and `markdown.tsx`: integrate directive parsing/rendering while leaving code and inline-code directives as text.
- `xcode/build/bluedcode/version/1.18.18/**`: update only the necessary fingerprints/adapter allowlist if source changes touch currently controlled modules.

---

### Task 1: Shared Annotation Contract And Projection

**Files:**
- Create: `packages/core/src/session/response-annotation.ts`
- Create: `packages/core/test/session-response-annotation.test.ts`
- Modify only if needed for exports: `packages/core/src/session/*.ts`

**Interfaces:**
- Produces: `ANNOTATION_METADATA_KEY = "bluedcodeResponseAnnotations"`
- Produces: `projectAnnotationText(markdown: string): AnnotationProjection`
- Produces: `digestProjection(markdown: string): string`
- Produces: `sliceAnnotationContext(projection, start, end): AnnotationContext`
- Produces: `serializeResponseAnnotations(input): string`
- Produces: `parseAnnotationDirectives(markdown, availableIndexes): DirectiveParseResult`

- [ ] **Step 1: Write RED tests for projection and Unicode offsets**

Add tests covering Markdown projection, repeated text offsets, CRLF normalization, emoji/code-point limits, inline code, fenced code, lists, links, and tables:

```ts
import { describe, expect, test } from "bun:test"
import {
  digestProjection,
  projectAnnotationText,
  sliceAnnotationContext,
} from "../src/session/response-annotation"

describe("response annotation projection", () => {
  test("projects visible markdown text with stable code point offsets", () => {
    const projection = projectAnnotationText("## Title\r\n\r\nHello **Blue** [docs](https://example.com)\n\n`x = 1`")
    expect(projection.text).toBe("Title\n\nHello Blue docs\n\nx = 1")
    expect(sliceAnnotationContext(projection, 13, 17).selected).toBe("Blue")
  })

  test("uses offsets instead of first string match for repeated text", () => {
    const projection = projectAnnotationText("alpha beta alpha")
    expect(sliceAnnotationContext(projection, 11, 16).selected).toBe("alpha")
  })

  test("keeps emoji boundaries intact", () => {
    const projection = projectAnnotationText("A 😀 B")
    expect(sliceAnnotationContext(projection, 2, 3).selected).toBe("😀")
  })

  test("digest is stable across CRLF and LF", () => {
    expect(digestProjection("A\r\nB")).toBe(digestProjection("A\nB"))
  })
})
```

- [ ] **Step 2: Verify RED**

Run from `packages/core`: `bun test test/session-response-annotation.test.ts`

Expected: fail because `src/session/response-annotation.ts` does not exist.

- [ ] **Step 3: Implement minimal projection and limits**

Create the module with exported types. Use a real Markdown parser already available in the repo if one is used by existing Markdown code; otherwise implement a small deterministic token walk only for the syntax covered by tests and document its scope in code. Use `Array.from(text)` for code-point operations and never UTF-16 slicing for limits.

- [ ] **Step 4: Add RED tests for model serialization and directive parsing**

Add tests proving the XML wrapper, JSON field order, escaped user request, no annotation no-op, code-block directive safety, unknown index safety, duplicate index safety, and split-stream candidate handling:

```ts
import {
  ANNOTATION_METADATA_KEY,
  parseAnnotationDirectives,
  serializeResponseAnnotations,
} from "../src/session/response-annotation"

test("serializes annotations with XML shell and JSON array", () => {
  const result = serializeResponseAnnotations({
    annotations: [
      {
        index: 1,
        source: { messageID: "msg_1", partID: "part_1", start: 1, end: 4, digest: "sha256:abc" },
        context: { before: "a", selected: "b", after: "c" },
        comment: "",
      },
    ],
    userRequest: "Explain </user-request>",
  })
  expect(result).toContain('<response-annotations version="1">')
  expect(result).toContain('"index": 1')
  expect(result).toContain("<user-request>")
  expect(result).toContain("Explain &lt;/user-request&gt;")
})

test("parses directives only outside code and once per index", () => {
  const parsed = parseAnnotationDirectives(
    "Use :bluedcode-annotation{index=\"1\"} and `:bluedcode-annotation{index=\"2\"}` again :bluedcode-annotation{index=\"1\"}.",
    new Set([1, 2]),
  )
  expect(parsed.references.map((item) => item.index)).toEqual([1])
  expect(parsed.text).toContain(":bluedcode-annotation")
})
```

- [ ] **Step 5: Verify GREEN**

Run from `packages/core`: `bun test test/session-response-annotation.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Run package typecheck**

Run from `packages/core`: `bun typecheck`

Expected: exit 0 or report only pre-existing unrelated package failures with exact file paths.

- [ ] **Step 7: Report checkpoint**

Do not commit. Report changed files, RED/GREEN evidence, typecheck result, and any pre-existing failures in `.superpowers/sdd/2026-08-18-conversation-response-annotations/task-1-report.md`.

---

### Task 2: Server Admission, Canonical Metadata, And Model Projection

**Files:**
- Create: `packages/opencode/src/session/response-annotation.ts`
- Create: `packages/opencode/test/session/response-annotation.test.ts`
- Modify: `packages/opencode/src/session/prompt.ts`
- Modify: `packages/opencode/src/session/message-v2.ts`
- Modify: package imports only as required by Task 1 exports

**Interfaces:**
- Consumes: `ANNOTATION_METADATA_KEY`, `digestProjection`, `projectAnnotationText`, `sliceAnnotationContext`, `serializeResponseAnnotations`
- Produces: `normalizeResponseAnnotationCarrier(input): Effect<CanonicalMetadata, ResponseAnnotationError>`
- Produces: `hasResponseAnnotations(message): boolean`
- Produces: `RESPONSE_ANNOTATION_SYSTEM_PROMPT`

- [ ] **Step 1: Write RED tests for admission rejection and canonical rewrite**

Add tests in `packages/opencode/test/session/response-annotation.test.ts` that create a completed Assistant message with one TextPart, then submit a User TextPart carrier whose client selected/context values are intentionally wrong. Assert the stored metadata is rewritten from durable source, not client text. Add rejection tests for cross-session source, incomplete Assistant source, wrong part type, digest drift, empty range, over-limit selected text, over-limit comment, multiple carriers, and unknown version.

- [ ] **Step 2: Verify RED**

Run from `packages/opencode`: `bun test test/session/response-annotation.test.ts`

Expected: fail because server annotation module/admission does not exist.

- [ ] **Step 3: Implement canonical validation before persistence**

Implement one narrow module in `src/session/response-annotation.ts`. In `SessionPrompt.createUserMessage`, call validation before any message/part write for annotation-bearing input. On failure throw `RESPONSE_ANNOTATION_INVALID` with a reason code and without source/comment text.

- [ ] **Step 4: Add RED tests for model projection and prompt injection**

Extend `test/session/message-v2.test.ts` or the new test file:

```ts
test("projects canonical annotations into XML shell only for annotated user messages", async () => {
  const modelMessage = await projectAnnotatedUserMessage()
  expect(modelMessage.content[0].text).toContain('<response-annotations version="1">')
  expect(modelMessage.content[0].text).toContain("<user-request>")
})

test("keeps ordinary user messages byte-stable without annotations", async () => {
  expect(await projectPlainUserMessage()).toEqual(await projectPlainUserMessageBaseline())
})
```

Also test empty user text plus annotations and escaping `</user-request>` in normal user input.

- [ ] **Step 5: Implement model projection and system prompt gate**

In `MessageV2.toModelMessagesEffect`, replace only the TextPart that carries canonical response annotation metadata. In `SessionPrompt.run`, append `RESPONSE_ANNOTATION_SYSTEM_PROMPT` only when the current user message has annotations.

- [ ] **Step 6: Verify GREEN**

Run from `packages/opencode`: `bun test test/session/response-annotation.test.ts test/session/message-v2.test.ts test/session/prompt.test.ts`

Expected: annotation tests pass, with unrelated failures recorded exactly if present.

- [ ] **Step 7: Run package typecheck**

Run from `packages/opencode`: `bun typecheck`

Expected: exit 0 or report only known unrelated failures with exact file paths.

- [ ] **Step 8: Report checkpoint**

Do not commit. Report RED/GREEN evidence, files changed, and whether zero-persistence-on-failure was verified in `.superpowers/sdd/2026-08-18-conversation-response-annotations/task-2-report.md`.

---

### Task 3: Prompt State, Request Carrier, And Draft History

**Files:**
- Modify: `packages/app/src/context/prompt-state.ts`
- Modify: `packages/app/src/context/prompt-state.test.ts`
- Modify: `packages/app/src/components/prompt-input/build-request-parts.ts`
- Modify: `packages/app/src/components/prompt-input/build-request-parts.test.ts`
- Modify: `packages/app/src/components/prompt-input/history.ts`
- Modify: `packages/app/src/components/prompt-input/history-store.ts`
- Modify: `packages/app/src/components/prompt-input/history.test.ts`

**Interfaces:**
- Consumes: `ANNOTATION_METADATA_KEY` and Task 1 draft types
- Produces: `addResponseAnnotation(draft)`, `updateResponseAnnotation(id, patch)`, `removeResponseAnnotation(id)`, `replaceResponseAnnotations(drafts)`, `responseAnnotations()`
- Produces: request TextPart metadata carrier with `bluedcodeResponseAnnotations`

- [ ] **Step 1: Write RED tests for prompt state operations**

Add tests for add/update/remove/replace, stable created order, session isolation, success reset clearing annotations, failure preserving annotations, and V1/V2 sharing the same store.

- [ ] **Step 2: Verify RED**

Run from `packages/app`: `bun test src/context/prompt-state.test.ts`

Expected: fail because response annotation actions do not exist.

- [ ] **Step 3: Implement prompt state actions**

Extend the existing context item union with a response annotation variant. Keep file comments unchanged. Use existing persisted prompt scope and do not create a new storage backend.

- [ ] **Step 4: Write RED tests for request carrier**

In `build-request-parts.test.ts`, assert no-annotation output is unchanged, annotated non-empty text gets exactly one carrier, empty text plus annotations still creates a carrier TextPart, and the client does not include `<response-annotations` in normal text.

- [ ] **Step 5: Implement request carrier**

Update `build-request-parts.ts` so the client only sends structured metadata. The server remains the only layer that serializes final model text.

- [ ] **Step 6: Write RED tests for prompt history**

Add history tests proving response annotation drafts are saved/restored with text history and omitted in Shell mode.

- [ ] **Step 7: Implement history persistence**

Extend history entry metadata with response annotations. Keep file comments and attachments behavior unchanged.

- [ ] **Step 8: Verify GREEN**

Run from `packages/app`: `bun test src/context/prompt-state.test.ts src/components/prompt-input/build-request-parts.test.ts src/components/prompt-input/history.test.ts`

Expected: all modified tests pass.

- [ ] **Step 9: Report checkpoint**

Do not commit. Report test evidence and changed files in `.superpowers/sdd/2026-08-18-conversation-response-annotations/task-3-report.md`.

---

### Task 4: Session UI Components And Directive Rendering

**Files:**
- Create: `packages/session-ui/src/components/response-annotation.tsx`
- Create: `packages/session-ui/src/components/response-annotation.test.tsx`
- Modify: `packages/session-ui/src/components/message-part.tsx`
- Modify: `packages/session-ui/src/components/message-part.test.ts`
- Modify: `packages/session-ui/src/components/markdown.tsx`
- Modify: `packages/session-ui/src/components/markdown-stream.test.ts` if streaming parser coverage belongs there
- Modify locale files used by `packages/session-ui` for visible strings

**Interfaces:**
- Consumes: `parseAnnotationDirectives(markdown, availableIndexes)`
- Produces presentational components: `ResponseAnnotationComposerButton`, `ResponseAnnotationDraftList`, `ResponseAnnotationHistoryList`, `ResponseAnnotationReference`

- [ ] **Step 1: Write RED component tests for details and editor**

Test count label, empty comment display, edit/save/cancel/delete callbacks, `Enter`, `Shift+Enter`, `Esc`, and accessible labels.

- [ ] **Step 2: Verify RED**

Run from `packages/session-ui`: `bun test src/components/response-annotation.test.tsx`

Expected: fail because components do not exist.

- [ ] **Step 3: Implement presentational components**

Use existing line-comment focus and popover patterns. Do not read App context in `session-ui`.

- [ ] **Step 4: Write RED tests for directive rendering**

In `message-part.test.ts`, test valid directive becomes a `注释 N` reference, inline code/fenced code remains literal text, unknown/malformed/duplicate directives remain literal, and parent user message isolation is respected.

- [ ] **Step 5: Implement directive rendering**

Integrate the Task 1 parser at Markdown token/render level. Avoid global HTML replacement. Streaming partial directive tails should not flash raw marker text before complete parsing.

- [ ] **Step 6: Verify GREEN**

Run from `packages/session-ui`: `bun test src/components/response-annotation.test.tsx src/components/message-part.test.ts src/components/markdown-stream.test.ts`

Expected: all relevant tests pass.

- [ ] **Step 7: Run package typecheck**

Run from `packages/session-ui`: `bun typecheck`

Expected: exit 0 or exact unrelated failures.

- [ ] **Step 8: Report checkpoint**

Do not commit. Report test/typecheck evidence and changed files in `.superpowers/sdd/2026-08-18-conversation-response-annotations/task-4-report.md`.

---

### Task 5: Desktop Selection Controller, V1/V2 Integration, And History Navigation

**Files:**
- Create: `packages/app/src/components/response-annotation-selection.tsx`
- Create: `packages/app/src/components/response-annotation-selection.test.tsx`
- Modify: `packages/app/src/components/prompt-input.tsx`
- Modify: `packages/app/src/components/prompt-input-v2.tsx`
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`
- Modify: `packages/app/src/pages/session/timeline/rows.ts`
- Modify locale files used by `packages/app` for visible strings

**Interfaces:**
- Consumes Task 3 prompt state actions
- Consumes Task 4 presentational components
- Produces selection-to-draft flow and source scroll/highlight callbacks

- [ ] **Step 1: Write RED selection controller tests**

Use DOM fixtures with `data-timeline-message-id`, `data-timeline-part-id`, and completed/streaming markers. Test valid same-TextPart selection, cross-node selection, inline-code/code-block selection, cross-part rejection, user/reasoning/tool/streaming rejection, and Unicode offsets.

- [ ] **Step 2: Verify RED**

Run from `packages/app`: `bun test src/components/response-annotation-selection.test.tsx`

Expected: fail because selection controller does not exist.

- [ ] **Step 3: Implement selection controller**

Create a shared controller used by the timeline. It should compute projection offsets, create draft data, and expose floating action state. Do not persist screen coordinates.

- [ ] **Step 4: Write RED tests for V1/V2 prompt integration**

Test both prompt inputs show response annotation count/details, allow edit/delete, preserve state while switching layout, and submit clears drafts only on success.

- [ ] **Step 5: Implement V1/V2 integration**

Wire `prompt-input.tsx` and `prompt-input-v2.tsx` to the same prompt state actions and `session-ui` components. Add i18n keys for all visible strings.

- [ ] **Step 6: Write RED tests for history annotation navigation**

Test historical user messages show annotation details, clicking “return to source” scrolls to the source message/part, missing source disables the action, and source highlight expires.

- [ ] **Step 7: Implement timeline source navigation**

Wire parent user message annotation metadata into Assistant reference rendering and history display. Use source `messageID`, `partID`, `start`, and `end` to reconstruct temporary highlight.

- [ ] **Step 8: Verify GREEN**

Run from `packages/app`: `bun test src/components/response-annotation-selection.test.tsx src/context/prompt-state.test.ts src/components/prompt-input/build-request-parts.test.ts src/components/prompt-input/history.test.ts`

Expected: all relevant tests pass.

- [ ] **Step 9: Capture performance baseline note**

Because `packages/app/AGENTS.md` requires a benchmark baseline before timeline changes, record the available baseline command or note the exact reason it cannot be run in `.superpowers/sdd/2026-08-18-conversation-response-annotations/task-5-report.md`.

- [ ] **Step 10: Report checkpoint**

Do not commit. Report UI test evidence, typecheck result if run, benchmark note, and changed files.

---

### Task 6: End-To-End Runtime Acceptance And BluedCode Build Compatibility

**Files:**
- Create: `packages/app/e2e/response-annotation.spec.ts` if the existing E2E harness supports this path
- Modify: `xcode/build/bluedcode/version/1.18.18/**` only if adapter-diff or audit proves controlled file fingerprints changed
- Modify: `docs/origin-specs/08-conversation-response-annotations.md` matrix only after all validation and with the final complete commit ID available; if there is no commit, leave matrix unchanged
- Modify: `docs/superpowers/specs/2026-08-18-08-conversation-response-annotations-design.md` validation notes only if implementation changes the spec contract

**Interfaces:**
- Consumes all Tasks 1-5
- Produces runtime acceptance evidence and BluedCode audit compatibility updates

- [ ] **Step 1: Write RED acceptance harness or smoke test**

Add a Desktop-capable smoke test or documented manual fixture that proves V1/V2 selection, draft restore, annotated submission, model request shape, directive rendering, and no auto-retry. If the repo E2E harness is unavailable locally, create a deterministic test harness that exercises the App and Server boundaries without claiming GUI coverage.

- [ ] **Step 2: Verify RED**

Run the selected acceptance command and capture the expected missing-feature failure.

- [ ] **Step 3: Implement final integration fixes**

Only fix gaps revealed by the acceptance test. If a failure is an upstream OpenCode defect unrelated to annotations, record it and do not patch around it through the BluedCode build pipeline.

- [ ] **Step 4: Run package verification**

Run these from their package directories:

```bash
cd packages/core && bun test test/session-response-annotation.test.ts && bun typecheck
cd packages/opencode && bun test test/session/response-annotation.test.ts test/session/message-v2.test.ts test/session/prompt.test.ts && bun typecheck
cd packages/session-ui && bun test src/components/response-annotation.test.tsx src/components/message-part.test.ts src/components/markdown-stream.test.ts && bun typecheck
cd packages/app && bun test src/components/response-annotation-selection.test.tsx src/context/prompt-state.test.ts src/components/prompt-input/build-request-parts.test.ts src/components/prompt-input/history.test.ts && bun typecheck
```

Record exact pass/fail counts. Do not summarize typecheck failures without file paths.

- [ ] **Step 5: Run BluedCode compatibility audit**

From `xcode/build/bluedcode`, run the existing adapter-diff/fingerprint candidate tool, then run:

```bash
bun test
bun run build.ts --channel dev --audit-only
```

If controlled source files changed, update only the required `version/1.18.18` adapter fingerprints/allowlists and rerun the failing audit before proceeding.

- [ ] **Step 6: Build Windows x64 prod directory ZIP only after audit passes**

Run the existing BluedCode prod directory ZIP build command used by the current build framework. The package must use top-level directory name `BluedCode-1.18.18-260817-01-<commit>` or the next release id defined by the current release ledger if it has advanced.

- [ ] **Step 7: Run real Desktop acceptance**

Open the generated Windows x64 directory build and manually or automatically validate:

1. V1 and V2 can add empty and non-empty response annotations.
2. Drafts restore after session switch, layout switch, and Desktop restart.
3. Submitting annotations sends XML+JSON model input with sanitized logging.
4. A controlled response containing valid, missing, duplicate, and malformed directives renders only valid first references.
5. History details and source scroll/highlight work.
6. Missing model directives do not create a hidden second provider request.

- [ ] **Step 8: Report final state**

Do not commit. Write `.superpowers/sdd/2026-08-18-conversation-response-annotations/final-report.md` with changed files, tests, build/audit status, artifact path if produced, and whether the ORIGIN matrix is still unchanged because no commit exists.

---

## Plan Self-Review

- Spec coverage: Tasks cover projection, state, selection UI, V1/V2, server admission, model projection, directive rendering, history, limits, persistence, security, no-auto-retry, and BluedCode audit.
- Placeholder scan: No unresolved marker words or unspecified “add tests” steps remain; each task names concrete files, commands, and expected outcomes.
- Type consistency: The metadata key, directive string, limits, carrier approach, and XML+JSON format match the origin and version specs.
- Constraint conflict ruling: The `writing-plans` skill template normally asks for per-task commits, but root `AGENTS.md` forbids unsolicited commits. This plan replaces commit steps with report checkpoints; implementation may only commit after explicit user instruction.
