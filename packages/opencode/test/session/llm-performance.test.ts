import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { LLMEvent } from "@opencode-ai/llm"
import { LLMPerformance } from "@opencode-ai/core/session/runner/performance"

describe("legacy LLM performance diagnostics", () => {
  test("reuses the shared core privacy-safe performance contract", () => {
    const tracker = LLMPerformance.create(
      {
        requestID: "request-1",
        providerID: "internal",
        modelID: "model-1",
        sessionID: "session-1",
        agent: "build",
        mode: "primary",
        small: false,
        retries: 0,
        system: ["system-secret"],
        messages: [{ role: "user", content: "prompt-secret" }],
        tools: { secret_tool: { description: "tool-secret" } },
      },
      { now: () => 1_200, started: 1_000 },
    )

    const entries = [
      tracker.start(),
      tracker.attempt().entry,
      ...tracker.observe(LLMEvent.reasoningDelta({ id: "reasoning-1", text: "reasoning-secret" })),
      ...tracker.observe(LLMEvent.finish({ reason: "stop", usage: { outputTokens: 2 } })),
    ]

    expect(entries.map((entry) => entry.message)).toEqual([
      "llm performance start",
      "llm performance attempt",
      "llm performance first output",
      "llm performance finish",
    ])
    expect(JSON.stringify(entries)).not.toContain("secret")
  })

  test("legacy runtime source does not log raw provider stream errors", () => {
    const source = readFileSync(fileURLToPath(new URL("../../src/session/llm.ts", import.meta.url)), "utf8")

    expect(source).toContain("@opencode-ai/core/session/runner/performance")
    expect(source).not.toContain('Effect.logError("stream error"')
    expect(source).not.toContain("error,\n              })")
  })
})
