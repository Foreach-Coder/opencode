# LLM 隐私安全性能日志 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenCode 1.18.18 的 V2 与 legacy LLM 流边界输出隐私安全的本地性能日志。

**Architecture:** 先在 core 增加纯 `LLMPerformance` 计算器，并用测试锁定字段白名单、耗时、retry、首输出和终态语义。V2 runner 与 legacy runtime 只做薄接入：把真实流事件 tap 进计算器，再用 `Effect.logInfo` 输出结构化日志，不改变 Provider 请求或流顺序。

**Tech Stack:** Bun、TypeScript、Effect、`@opencode-ai/llm`、AI SDK middleware。

**Spec:** `docs/superpowers/specs/2026-08-17-07-llm-performance-logging-design.md`

## Global Constraints

- 对应跨版本需求：`ORIGIN-06`。
- 目标基线：OpenCode `v1.18.18`。
- 性能日志只允许本地 info 级结构化输出，消息必须以 `llm performance ` 开头。
- 禁止记录提示词、模型输出、工具内容、凭据、Provider 原始错误消息、stack、headers、URL 或响应 body。
- 不改变 LLM 请求参数、流事件顺序、重试策略、取消语义、tool settlement 或 overflow recovery。
- 所有 commit 摘要和正文必须使用中文；未经用户明确授权不得提交或推送。

---

## File Structure

- Create: `packages/core/src/session/runner/performance.ts`
  - 纯性能日志计算器，导出 `LLMPerformance.create()`。
- Modify: `packages/core/src/session/runner/llm.ts`
  - V2 runner Provider turn 接入性能日志。
- Modify: `packages/opencode/src/session/llm.ts`
  - legacy AI SDK/native runtime 接入同一性能日志。
- Create: `packages/core/test/session-runner-performance.test.ts`
  - 纯合同测试。
- Modify: `packages/core/test/session-runner.test.ts`
  - V2 runner 日志接入回归。
- Create: `packages/opencode/test/session/llm-performance.test.ts`
  - legacy runtime 回归。

---

### Task 1: 纯 LLMPerformance 合同

**Files:**

- Create: `packages/core/src/session/runner/performance.ts`
- Create: `packages/core/test/session-runner-performance.test.ts`

**Interfaces:**

- Produces: `LLMPerformance.create(input, options)`.
- Produces: `Entry { message: string; data: Record<string, string | number | boolean | undefined> }`.
- Consumes: `LLMEvent` from `@opencode-ai/llm`.

- [ ] **Step 1: Write RED tests**

Add tests that call `LLMPerformance.create()` directly and assert:

```ts
expect(entry.message).toBe("llm performance start")
expect(JSON.stringify(entry)).not.toContain("secret")
expect(finish.data["llm.output_tokens_per_second"]).toBe(50)
expect(abort.data["llm.interrupted"]).toBe(true)
```

- [ ] **Step 2: Run RED**

Run from `packages/core`:

```bash
bun test test/session-runner-performance.test.ts
```

Expected: FAIL because `@opencode-ai/core/session/runner/performance` does not exist.

- [ ] **Step 3: Implement GREEN**

Implement the pure calculator with `start()`, `attempt()`, `response()`, `attemptError()`, `observe()`, `fail()` and `end()`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test test/session-runner-performance.test.ts
```

Expected: all tests pass.

---

### Task 2: V2 runner 接入

**Files:**

- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/core/test/session-runner.test.ts`

**Interfaces:**

- Consumes: `LLMPerformance.create()`.
- Produces: V2 Provider turn logs `start`、`attempt`、`first output`、`finish/error/interrupted`。

- [ ] **Step 1: Write RED integration tests**

Add tests that run the existing fake `LLMClient.Service.stream` and capture Effect logs. Assert successful stream produces one logical request id shared across start/attempt/first output/finish; failing stream does not include a secret error message.

- [ ] **Step 2: Run RED**

Run from `packages/core`:

```bash
bun test test/session-runner.test.ts --test-name-pattern "performance"
```

Expected: FAIL because runner does not emit `llm performance` events.

- [ ] **Step 3: Implement GREEN**

Create tracker around the single provider turn and tap the `LLMEvent` stream. On failure call `tracker.fail(error)`; on scope close call `tracker.end()`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test test/session-runner.test.ts --test-name-pattern "performance"
```

Expected: performance integration tests pass.

---

### Task 3: Legacy runtime 接入

**Files:**

- Modify: `packages/opencode/src/session/llm.ts`
- Create: `packages/opencode/test/session/llm-performance.test.ts`

**Interfaces:**

- Consumes: `LLMPerformance.create()` from core.
- Produces: legacy AI SDK logs `attempt`、`response`、`attempt error` plus stream terminal events.

- [ ] **Step 1: Write RED tests**

Add tests for the pure contract through the opencode import boundary and for `onError` sanitization if the existing harness can exercise it cheaply.

- [ ] **Step 2: Run RED**

Run from `packages/opencode`:

```bash
bun test test/session/llm-performance.test.ts
```

Expected: FAIL because the new test file import or behavior is missing.

- [ ] **Step 3: Implement GREEN**

Import `LLMPerformance` from core and replace raw `stream error` logging with sanitized performance entries. Wrap AI SDK `doStream` attempts and monitor the normalized `LLMEvent` stream.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
bun test test/session/llm-performance.test.ts
```

Expected: tests pass.

---

### Task 4: 验证与兼容审计

**Files:**

- Modify only if required by audit: `xcode/build/bluedcode/version/1.18.18/*`

**Interfaces:**

- Consumes: completed source changes.
- Produces: verification evidence for spec handoff.

- [ ] **Step 1: Run targeted package checks**

Run:

```bash
cd packages/core && bun test test/session-runner-performance.test.ts test/session-runner.test.ts --test-name-pattern "performance|LLM performance"
cd ../opencode && bun test test/session/llm-performance.test.ts
```

- [ ] **Step 2: Run typechecks where meaningful**

Run:

```bash
cd packages/core && bun typecheck
cd ../opencode && bun typecheck
```

Record any pre-existing blockers separately.

- [ ] **Step 3: Run BluedCode audit**

Run from `xcode/build/bluedcode`:

```bash
bun run build.ts --channel dev --audit-only
```

- [ ] **Step 4: Update spec evidence**

Update `docs/superpowers/specs/2026-08-17-07-llm-performance-logging-design.md` with exact verification results. Do not update the root origin matrix until the user approves committing the final implementation.
