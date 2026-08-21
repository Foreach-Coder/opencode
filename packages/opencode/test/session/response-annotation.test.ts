import { describe, expect, test } from "bun:test"
import {
  ANNOTATION_METADATA_KEY,
  digestProjection,
  projectAnnotationText,
  sliceAnnotationContext,
} from "@opencode-ai/core/session/response-annotation"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import {
  ResponseAnnotationError,
  normalizeResponseAnnotationCarrier,
  responseAnnotationSystemPrompts,
} from "../../src/session/response-annotation"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const sessionID = SessionID.make("ses_annotations")
const sourceMessageID = MessageID.make("msg_annotation_source")
const sourcePartID = PartID.make("prt_annotation_source")
const sourceText = "Before **selected text** after"
const projection = projectAnnotationText(sourceText)
const selected = "selected text"
const start = Array.from(projection.text).join("").indexOf(selected)
const end = start + Array.from(selected).length

function sourceMessage(input?: {
  sessionID?: SessionID
  completed?: number
  role?: "user" | "assistant"
  part?: SessionV1.Part
  text?: string
  created?: number
}): SessionV1.WithParts {
  const sourceSessionID = input?.sessionID ?? sessionID
  const text = input?.text ?? sourceText
  const part =
    input?.part ??
    ({
      id: sourcePartID,
      sessionID: sourceSessionID,
      messageID: sourceMessageID,
      type: "text",
      text,
    } satisfies SessionV1.TextPart)
  if (input?.role === "user") {
    return {
      info: {
        id: sourceMessageID,
        sessionID: sourceSessionID,
        role: "user",
        time: { created: input.created ?? 10 },
        agent: "build",
        model: { providerID: "test", modelID: "test" },
      },
      parts: [part],
    } as SessionV1.WithParts
  }
  return {
    info: {
      id: sourceMessageID,
      sessionID: sourceSessionID,
      role: "assistant",
      parentID: MessageID.make("msg_annotation_parent"),
      time: { created: input?.created ?? 10, completed: input?.completed },
      mode: "build",
      agent: "build",
      modelID: "test",
      providerID: "test",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [part],
  } as SessionV1.WithParts
}

function carrier(overrides?: Record<string, unknown>): SessionV1.TextPart {
  return {
    id: PartID.make("prt_annotation_carrier"),
    sessionID,
    messageID: MessageID.make("msg_annotation_request"),
    type: "text",
    text: "Please revise it",
    metadata: {
      [ANNOTATION_METADATA_KEY]: {
        version: 1,
        annotations: [
          {
            index: 99,
            source: {
              sessionID,
              messageID: sourceMessageID,
              partID: sourcePartID,
              start,
              end,
              digest: digestProjection(sourceText),
            },
            context: { before: "forged before", selected: "forged selection", after: "forged after" },
            comment: "Make this clearer",
          },
        ],
        ...overrides,
      },
    },
  }
}

function normalize(input?: { parts?: SessionV1.Part[]; source?: SessionV1.WithParts; messageTime?: number }) {
  const source = input?.source ?? sourceMessage({ completed: 20 })
  return normalizeResponseAnnotationCarrier({
    sessionID,
    messageTime: input?.messageTime ?? 30,
    parts: input?.parts ?? [carrier()],
    findSource: (messageID) => Effect.succeed(messageID === source.info.id ? source : undefined),
  })
}

async function reason(effect: ReturnType<typeof normalize>) {
  const error = await Effect.runPromise(Effect.flip(effect))
  expect(error).toBeInstanceOf(ResponseAnnotationError)
  return error.reason
}

describe("response annotation admission", () => {
  test("rewrites index and context from the durable assistant text", async () => {
    const result = await Effect.runPromise(normalize())
    const context = sliceAnnotationContext(projection, start, end)

    expect(result).toEqual({
      partID: PartID.make("prt_annotation_carrier"),
      metadata: {
        version: 1,
        annotations: [
          {
            index: 1,
            source: {
              sessionID,
              messageID: sourceMessageID,
              partID: sourcePartID,
              start,
              end,
              digest: digestProjection(sourceText),
            },
            context,
            comment: "Make this clearer",
          },
        ],
      },
    })
  })

  test("rejects a source from another session", async () => {
    const other = SessionID.make("ses_other")
    const part = carrier()
    const metadata = part.metadata?.[ANNOTATION_METADATA_KEY] as {
      annotations: Array<{ source: { sessionID: string } }>
    }
    metadata.annotations[0]!.source.sessionID = other
    expect(await reason(normalize({ parts: [part] }))).toBe("source_session_mismatch")
  })

  test("rejects an incomplete assistant source", async () => {
    expect(await reason(normalize({ source: sourceMessage() }))).toBe("source_incomplete")
  })

  test("rejects a non-assistant source", async () => {
    expect(await reason(normalize({ source: sourceMessage({ role: "user" }) }))).toBe("source_not_assistant")
  })

  test("rejects a source that is not earlier than the user message", async () => {
    expect(await reason(normalize({ source: sourceMessage({ created: 40, completed: 50 }) }))).toBe(
      "source_not_earlier",
    )
  })

  test("rejects a non-text source part", async () => {
    const part = {
      id: sourcePartID,
      sessionID,
      messageID: sourceMessageID,
      type: "reasoning",
      text: sourceText,
      time: { start: 10, end: 20 },
    } satisfies SessionV1.ReasoningPart
    expect(await reason(normalize({ source: sourceMessage({ completed: 20, part }) }))).toBe("source_part_type")
  })

  test("rejects digest drift", async () => {
    expect(await reason(normalize({ source: sourceMessage({ completed: 20, text: sourceText + " changed" }) }))).toBe(
      "digest_changed",
    )
  })

  test("rejects an empty range", async () => {
    const part = carrier()
    const metadata = part.metadata?.[ANNOTATION_METADATA_KEY] as {
      annotations: Array<{ source: { start: number; end: number } }>
    }
    metadata.annotations[0]!.source.end = metadata.annotations[0]!.source.start
    expect(await reason(normalize({ parts: [part] }))).toBe("range_invalid")
  })

  test("rejects selected text over 4000 code points", async () => {
    const text = "x".repeat(4001)
    const part = carrier()
    const metadata = part.metadata?.[ANNOTATION_METADATA_KEY] as {
      annotations: Array<{ source: { start: number; end: number; digest: string } }>
    }
    metadata.annotations[0]!.source.start = 0
    metadata.annotations[0]!.source.end = 4001
    metadata.annotations[0]!.source.digest = digestProjection(text)
    expect(await reason(normalize({ parts: [part], source: sourceMessage({ completed: 20, text }) }))).toBe(
      "limit_exceeded",
    )
  })

  test("rejects comments over 2000 code points", async () => {
    const part = carrier()
    const metadata = part.metadata?.[ANNOTATION_METADATA_KEY] as { annotations: Array<{ comment: string }> }
    metadata.annotations[0]!.comment = "x".repeat(2001)
    expect(await reason(normalize({ parts: [part] }))).toBe("limit_exceeded")
  })

  test("rejects multiple carriers", async () => {
    const second = { ...carrier(), id: PartID.make("prt_annotation_carrier_two") }
    expect(await reason(normalize({ parts: [carrier(), second] }))).toBe("multiple_carriers")
  })

  test("rejects an ignored annotation carrier", async () => {
    const part = carrier()
    part.ignored = true
    expect(await reason(normalize({ parts: [part] }))).toBe("carrier_not_ordinary")
  })

  test("rejects a synthetic annotation carrier", async () => {
    const part = carrier()
    part.synthetic = true
    expect(await reason(normalize({ parts: [part] }))).toBe("carrier_not_ordinary")
  })

  test("rejects an unknown metadata version", async () => {
    expect(await reason(normalize({ parts: [carrier({ version: 2 })] }))).toBe("version_unsupported")
  })
})

describe("response annotation system prompt gate", () => {
  test("returns instructions only for an annotated user message", () => {
    const annotated: SessionV1.WithParts = {
      info: {
        id: MessageID.make("msg_annotation_user"),
        sessionID,
        role: "user",
        time: { created: 30 },
        agent: "build",
        model: { providerID: "test", modelID: "test" },
      } as SessionV1.User,
      parts: [carrier()],
    }
    const plain: SessionV1.WithParts = {
      ...annotated,
      parts: [{ ...carrier(), metadata: undefined }],
    }
    const ignored: SessionV1.WithParts = {
      ...annotated,
      parts: [{ ...carrier(), ignored: true }],
    }
    const synthetic: SessionV1.WithParts = {
      ...annotated,
      parts: [{ ...carrier(), synthetic: true }],
    }

    expect(responseAnnotationSystemPrompts(annotated)).toEqual([
      expect.stringContaining("The user message contains a <response-annotations> JSON array"),
    ])
    expect(responseAnnotationSystemPrompts(plain)).toEqual([])
    expect(responseAnnotationSystemPrompts(ignored)).toEqual([])
    expect(responseAnnotationSystemPrompts(synthetic)).toEqual([])
  })

  test("defines quoted context, actionable instructions, and the required inline output contract", () => {
    const annotated: SessionV1.WithParts = {
      info: {
        id: MessageID.make("msg_annotation_prompt_contract"),
        sessionID,
        role: "user",
        time: { created: 30 },
        agent: "build",
        model: { providerID: "test", modelID: "test" },
      } as SessionV1.User,
      parts: [carrier()],
    }

    const prompt = responseAnnotationSystemPrompts(annotated).join("\n")
    expect(prompt).toContain("context.before, context.selected, and context.after")
    expect(prompt).toContain("comment is the user's instruction")
    expect(prompt).toContain("user-request contains any additional user instruction")
    expect(prompt).toContain('output this exact plain-text marker: :bluedcode-annotation{index="N"}')
    expect(prompt.toLowerCase()).toContain("immediately before the sentence or paragraph")
    expect(prompt.indexOf(':bluedcode-annotation{index="1"}')).toBeLessThan(
      prompt.indexOf("Here is the answer to the selected text."),
    )
    expect(prompt).toContain("outside code fences, inline code, links, and quotations")
    expect(prompt).toContain("must appear exactly once")
    expect(prompt).toContain("set of emitted marker indexes exactly matches")
    expect(prompt).toContain("is not considered disclosure")
  })
})
