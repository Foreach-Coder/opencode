import { describe, expect, test } from "bun:test"
import { readPartText } from "./message-part-text"
import {
  annotationDirectiveMarkdown,
  responseAnnotationForPlaceholder,
  responseAnnotationsForAssistant,
  responseAnnotationsForTextPart,
} from "./message-annotation"

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})

describe("response annotation directives", () => {
  const annotations = [
    {
      index: 1,
      source: { messageID: "assistant-source", partID: "part-source", start: 0, end: 4, digest: "sha256:x" },
      context: { before: "", selected: "text", after: "" },
      comment: "note",
    },
  ]

  test("turns a valid directive into an annotation reference", () => {
    const result = annotationDirectiveMarkdown(
      'Answer :bluedcode-annotation{index="1"}.',
      annotations,
      (index) => `注释 ${index}`,
      false,
      "capability",
    )

    expect(result.markdown).toBe("Answer [注释 1](#bluedcode-response-annotation-capability-1).")
    expect(result.references.map((item) => item.index)).toEqual([1])
  })

  test("keeps code, unknown, malformed, and duplicate directives literal", () => {
    const directive = ':bluedcode-annotation{index="1"}'
    const unknown = ':bluedcode-annotation{index="2"}'
    const malformed = ':bluedcode-annotation{index="1"'
    const markdown = `\`${directive}\`\n\n\`\`\`text\n${directive}\n\`\`\`\n\n${unknown} ${malformed} ${directive} ${directive}`
    const result = annotationDirectiveMarkdown(markdown, annotations, (index) => `注释 ${index}`, false)

    expect(result.markdown).toContain(`\`${directive}\``)
    expect(result.markdown).toContain(`\`\`\`text\n${directive}\n\`\`\``)
    expect(result.markdown).toContain(unknown)
    expect(result.markdown).toContain(malformed)
    expect(result.markdown.match(/\[注释 1\]/g)).toHaveLength(1)
    expect(result.markdown.endsWith(directive)).toBe(true)
  })

  test("hides a streaming partial directive tail until it is complete", () => {
    const partial = "Answer :bluedcode-annotation{index=\""

    expect(annotationDirectiveMarkdown(partial, annotations, (index) => `注释 ${index}`, true).markdown).toBe("Answer ")
    expect(annotationDirectiveMarkdown(partial, annotations, (index) => `注释 ${index}`, false).markdown).toBe(partial)
  })

  test("keeps a streaming partial marker literal when no annotation can be referenced", () => {
    const partial = "Answer :bluedcode-annotation{index=\""

    expect(annotationDirectiveMarkdown(partial, [], (index) => `注释 ${index}`, true).markdown).toBe(partial)
  })

  test("does not rewrite ordinary fragment links or raw anchors", () => {
    const markdown =
      '[look](#bluedcode-response-annotation-1) <a href="#bluedcode-response-annotation-1">raw</a>'

    expect(annotationDirectiveMarkdown(markdown, annotations, (index) => `注释 ${index}`, false, "capability").markdown)
      .toBe(markdown)
    expect(responseAnnotationForPlaceholder("#bluedcode-response-annotation-1", annotations, "capability"))
      .toBeUndefined()
    expect(responseAnnotationForPlaceholder("#bluedcode-response-annotation-capability-1", annotations, "capability")?.index)
      .toBe(1)
  })

  test("uses annotations from only the assistant parent user message", () => {
    const other = { ...annotations[0]!, index: 2 }
    const messages = [
      { id: "user-1", sessionID: "session", role: "user" },
      { id: "assistant-1", sessionID: "session", role: "assistant", parentID: "user-1" },
      { id: "user-2", sessionID: "session", role: "user" },
      { id: "assistant-2", sessionID: "session", role: "assistant", parentID: "user-2" },
    ]
    const parts = {
      "user-1": [
        { type: "text", metadata: { bluedcodeResponseAnnotations: { version: 1, annotations } } },
      ],
      "user-2": [
        { type: "text", metadata: { bluedcodeResponseAnnotations: { version: 1, annotations: [other] } } },
      ],
    }

    expect(responseAnnotationsForAssistant(messages[3]!, messages, parts).map((item) => item.index)).toEqual([2])
    expect(responseAnnotationsForAssistant(messages[1]!, messages, parts).map((item) => item.index)).toEqual([1])
  })

  test("claims a directive index only in the first text part that references it", () => {
    const parts = [
      { id: "part-1", type: "text", text: ':bluedcode-annotation{index="1"}' },
      { id: "part-2", type: "text", text: ':bluedcode-annotation{index="1"}' },
    ]

    expect(responseAnnotationsForTextPart("part-1", parts, annotations).map((item) => item.index)).toEqual([1])
    expect(responseAnnotationsForTextPart("part-2", parts, annotations).map((item) => item.index)).toEqual([])
  })
})
