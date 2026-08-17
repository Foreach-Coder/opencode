# File Tree Preference Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ORIGIN-03 for OpenCode 1.18.18 so restored and runtime file-tree visibility preferences synchronize to the session layout without treating pre-ready defaults as user intent.

**Architecture:** Add one pure state-transition helper plus one small Solid wiring helper in `packages/app/src/pages/session/helpers.ts`, then call the wiring helper once from `packages/app/src/pages/session.tsx`. The pure helper owns the preference-to-layout contract; rendering continues to use the existing `shouldShowFileTree` and layout code.

**Tech Stack:** SolidJS signals/effects, Bun test, existing `packages/app` test helpers, BluedCode build compatibility audit.

**Spec:** `docs/superpowers/specs/2026-08-17-04-file-tree-preference-sync-design.md`

## Global Constraints

- Do not commit, push, tag, release, or rewrite history unless the user explicitly asks in the current conversation.
- Keep the fix focused on file-tree preference synchronization; do not redesign session layout.
- Do not change settings persistence format or file-tree width/tab behavior.
- Do not write settings from the synchronization helper.
- Run BluedCode compatibility audit after changing `packages/app` source.

---

### Task 1: Add file-tree preference synchronization helper

**Files:**

- Modify: `packages/app/src/pages/session/helpers.ts`
- Modify: `packages/app/src/pages/session/helpers.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export function fileTreePreferenceAction(input: {
    ready: boolean
    visible: boolean
    previous: boolean | undefined
  }): { previous: boolean | undefined; action: "open" | "close" | undefined }
  ```
  ```ts
  export function createFileTreePreferenceSync(input: {
    ready: Accessor<boolean>
    visible: Accessor<boolean>
    open: () => void
    close: () => void
  }): void
  ```
- Consumes: Solid `createComputed` and `Accessor`.

- [ ] **Step 1: Write the failing tests**

Add tests to `packages/app/src/pages/session/helpers.test.ts`:

```ts
describe("fileTreePreferenceAction", () => {
  test("syncs runtime changes after settings are ready", () => {
    const initial = fileTreePreferenceAction({ ready: true, visible: false, previous: undefined })
    const opened = fileTreePreferenceAction({ ready: true, visible: true, previous: initial.previous })
    const repeatedOpen = fileTreePreferenceAction({ ready: true, visible: true, previous: opened.previous })
    const closed = fileTreePreferenceAction({ ready: true, visible: false, previous: repeatedOpen.previous })

    expect([initial.action, opened.action, repeatedOpen.action, closed.action]).toEqual([
      undefined,
      "open",
      undefined,
      "close",
    ])
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/pages/session/helpers.test.ts
```

Expected: fail because `fileTreePreferenceAction` and `createFileTreePreferenceSync` are not exported.

- [ ] **Step 3: Implement the helper**

Add to `packages/app/src/pages/session/helpers.ts`:

```ts
export function fileTreePreferenceAction(input: { ready: boolean; visible: boolean; previous: boolean | undefined }) {
  if (!input.ready) return { previous: input.previous, action: undefined as "open" | "close" | undefined }
  if (input.previous === undefined) {
    return { previous: input.visible, action: input.visible ? ("open" as const) : undefined }
  }
  if (input.previous === input.visible)
    return { previous: input.previous, action: undefined as "open" | "close" | undefined }
  return { previous: input.visible, action: input.visible ? ("open" as const) : ("close" as const) }
}

export function createFileTreePreferenceSync(input: {
  ready: Accessor<boolean>
  visible: Accessor<boolean>
  open: () => void
  close: () => void
}) {
  let previous: boolean | undefined
  createComputed(() => {
    const next = fileTreePreferenceAction({ ready: input.ready(), visible: input.visible(), previous })
    previous = next.previous
    if (next.action === "open") input.open()
    if (next.action === "close") input.close()
  })
}
```

- [ ] **Step 4: Run helper tests to verify GREEN**

Run:

```bash
bun test --conditions=solid --preload ./happydom.ts src/pages/session/helpers.test.ts
```

Expected: all helper tests pass.

---

### Task 2: Wire helper into Session

**Files:**

- Modify: `packages/app/src/pages/session.tsx`
- Test: `packages/app/src/pages/session/helpers.test.ts`

**Interfaces:**

- Consumes: `createFileTreePreferenceSync` from `@/pages/session/helpers`.
- Uses existing `settings.ready`, `settings.visibility.fileTree`, `layout.fileTree.open`, and `layout.fileTree.close`.

- [ ] **Step 1: Update import**

Change the session helpers import in `packages/app/src/pages/session.tsx` to include `createFileTreePreferenceSync`.

- [ ] **Step 2: Call the helper once after `settings` and `layout` exist**

Add:

```ts
createFileTreePreferenceSync({
  ready: settings.ready,
  visible: settings.visibility.fileTree,
  open: layout.fileTree.open,
  close: layout.fileTree.close,
})
```

Place it near the existing file-tree visibility memos, before `desktopFileTreeOpen`, so the relationship is local and easy to audit.

- [ ] **Step 3: Run focused app tests**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/pages/session/helpers.test.ts src/pages/session/session-panel-layout.test.ts src/pages/session/session-panel-width.test.ts src/pages/session/file-tab-scroll.test.ts
```

Expected: all selected tests pass.

---

### Task 3: Verify BluedCode compatibility

**Files:**

- Read/execute only: `xcode/build/bluedcode/build.ts`
- No build-framework changes expected.

**Interfaces:**

- Consumes current BluedCode build compatibility audit.
- Produces evidence for final handoff.

- [ ] **Step 1: Run relevant app tests**

Run from `packages/app`:

```bash
bun test --conditions=solid --preload ./happydom.ts src/pages/session/helpers.test.ts src/pages/session/session-panel-layout.test.ts src/pages/session/session-panel-width.test.ts src/pages/session/file-tab-scroll.test.ts
```

Expected: pass.

- [ ] **Step 2: Run BluedCode audit-only build**

Run from `xcode/build/bluedcode`:

```bash
bun run build.ts --channel dev --audit-only
```

Expected: compatibility audit completes, or reports a precise existing blocker.

- [ ] **Step 3: Check worktree status**

Run from root and subrepo:

```bash
git status --short --branch
```

Expected: changed files are only the requested docs, `AGENTS.md`, and ORIGIN-03 source/test changes. Do not commit or push.
