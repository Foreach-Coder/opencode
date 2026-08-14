import type { LLMEvent } from "@opencode-ai/llm"

type Input = {
  requestID: string
  providerID: string
  modelID: string
  sessionID: string
  agent: string
  mode: string
  small: boolean
  retries: number
  system: ReadonlyArray<string>
  messages: unknown
  tools: Readonly<Record<string, unknown>>
}

type Options = {
  now?: () => number
  started?: number
}

type Data = Record<string, string | number | boolean | undefined>

export type Entry = {
  message: string
  data: Data
}

export type Attempt = {
  number: number
  started: number
  entry: Entry
}

export function create(input: Input, options: Options = {}) {
  const now = options.now ?? Date.now
  const started = options.started ?? now()
  const base = {
    "llm.request_id": input.requestID,
    "llm.provider": input.providerID,
    "llm.model": input.modelID,
    "session.id": input.sessionID,
    "llm.agent": input.agent,
    "llm.mode": input.mode,
    "llm.small": input.small,
  }
  let attempts = 0
  let attemptStarted: number | undefined
  let responseReceived: number | undefined
  let firstOutput: number | undefined
  let terminal = false

  return {
    start(): Entry {
      return entry("start", {
        ...base,
        "llm.message_count": Array.isArray(input.messages) ? input.messages.length : 0,
        "llm.tool_count": Object.keys(input.tools).length,
        "llm.system_bytes": bytes(input.system),
        "llm.message_bytes": bytes(input.messages),
        "llm.retry_limit": input.retries,
        "llm.preparation_ms": elapsed(started, now()),
      })
    },
    attempt(): Attempt {
      const number = ++attempts
      attemptStarted = now()
      responseReceived = undefined
      const attempt = {
        number,
        started: attemptStarted,
        entry: entry("attempt", {
          ...base,
          "llm.attempt": number,
        }),
      }
      return attempt
    },
    response(attempt: Attempt, body: unknown): Entry {
      responseReceived = now()
      return entry("response", {
        ...base,
        "llm.attempt": attempt.number,
        "llm.response_headers_ms": elapsed(attempt.started, responseReceived),
        "llm.request_bytes": bytes(body),
      })
    },
    attemptError(attempt: Attempt, error: unknown): Entry {
      return entry("attempt error", {
        ...base,
        "llm.attempt": attempt.number,
        "llm.attempt_ms": elapsed(attempt.started, now()),
        ...errorData(error),
      })
    },
    observe(event: LLMEvent): ReadonlyArray<Entry> {
      if (terminal) return []
      const current = now()
      const result: Entry[] = []
      if (firstOutput === undefined && isOutput(event)) {
        firstOutput = current
        result.push(
          entry("first output", {
            ...base,
            "llm.ttft_ms": elapsed(started, current),
            "llm.provider_ttft_ms": attemptStarted === undefined ? undefined : elapsed(attemptStarted, current),
            "llm.first_output_after_headers_ms":
              responseReceived === undefined ? undefined : elapsed(responseReceived, current),
            "llm.attempt_count": attempts,
            "llm.retry_count": Math.max(0, attempts - 1),
          }),
        )
      }
      if (event.type !== "finish") return result

      terminal = true
      const generation = firstOutput === undefined ? undefined : elapsed(firstOutput, current)
      const output = event.usage?.outputTokens
      result.push(
        entry("finish", {
          ...base,
          "llm.total_ms": elapsed(started, current),
          "llm.generation_ms": generation,
          "llm.attempt_count": attempts,
          "llm.retry_count": Math.max(0, attempts - 1),
          "llm.input_tokens": event.usage?.inputTokens,
          "llm.output_tokens": output,
          "llm.reasoning_tokens": event.usage?.reasoningTokens,
          "llm.cache_read_tokens": event.usage?.cacheReadInputTokens,
          "llm.cache_write_tokens": event.usage?.cacheWriteInputTokens,
          "llm.output_tokens_per_second": rate(output, generation),
          "llm.finish_reason": event.reason,
        }),
      )
      return result
    },
    fail(error: unknown): Entry | undefined {
      if (terminal) return undefined
      terminal = true
      return entry("error", {
        ...base,
        "llm.total_ms": elapsed(started, now()),
        "llm.attempt_count": attempts,
        "llm.retry_count": Math.max(0, attempts - 1),
        ...errorData(error),
      })
    },
    end(): Entry | undefined {
      if (terminal) return undefined
      terminal = true
      return entry("interrupted", {
        ...base,
        "llm.total_ms": elapsed(started, now()),
        "llm.attempt_count": attempts,
        "llm.retry_count": Math.max(0, attempts - 1),
        "llm.interrupted": true,
      })
    },
  }
}

function entry(event: string, data: Data): Entry {
  return {
    message: `llm performance ${event}`,
    data,
  }
}

function elapsed(start: number, end: number) {
  return Math.max(0, Math.round(end - start))
}

function bytes(value: unknown) {
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value)
    if (serialized === undefined) return undefined
    return new TextEncoder().encode(serialized).byteLength
  } catch {
    return undefined
  }
}

function rate(tokens: number | undefined, duration: number | undefined) {
  if (tokens === undefined || duration === undefined || duration === 0) return undefined
  return Math.round((tokens / duration) * 100_000) / 100
}

function isOutput(event: LLMEvent) {
  return (
    event.type === "text-delta" ||
    event.type === "reasoning-delta" ||
    event.type === "tool-input-delta" ||
    event.type === "tool-call"
  )
}

function errorData(error: unknown): Data {
  if (!error || typeof error !== "object") return { "llm.error_name": typeof error }
  const cause = property(error, "error") ?? property(error, "cause")
  const nested = cause && cause !== error ? errorData(cause) : {}
  const status = [property(error, "statusCode"), property(error, "status"), nested["llm.http_status"]].find(
    (item): item is number => typeof item === "number",
  )
  const retryable = property(error, "retryable")
  const nestedRetryable = nested["llm.retryable"]
  const name = error instanceof Error ? error.name : (nested["llm.error_name"] ?? error.constructor?.name)
  return {
    "llm.error_name": name,
    "llm.http_status": status,
    "llm.retryable":
      typeof retryable === "boolean" ? retryable : typeof nestedRetryable === "boolean" ? nestedRetryable : undefined,
    "llm.interrupted": name === "AbortError",
  }
}

function property(value: object, key: string): unknown {
  return Reflect.get(value, key)
}

export * as LLMPerformance from "./performance"
