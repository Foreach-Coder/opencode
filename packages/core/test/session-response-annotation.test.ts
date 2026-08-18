import { describe, expect, test } from "bun:test"
import {
  digestProjection,
  parseAnnotationDirectives,
  projectAnnotationText,
  serializeResponseAnnotations,
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

  test("keeps code, list, and table cells while dropping structural syntax", () => {
    const projection = projectAnnotationText("```ts\nconst answer = 42\n```\n\n- first\n- second\n\n| Name | Value |\n| --- | --- |\n| Blue | 42 |")

    expect(projection.text).toBe("const answer = 42\n\nfirst\nsecond\n\nName\tValue\nBlue\t42")
  })

  test("digest is stable across CRLF and LF", () => {
    expect(digestProjection("A\r\nB")).toBe(digestProjection("A\nB"))
  })
})

describe("response annotation model contract", () => {
  test("serializes annotations with XML shell and escaped user request", () => {
    const result = serializeResponseAnnotations({
      annotations: [
        {
          index: 1,
          source: { messageID: "msg_1", partID: "part_1", start: 1, end: 4, digest: "sha256:abc" },
          context: { before: "a", selected: "b", after: "c" },
          comment: "",
        },
      ],
      userRequest: "Explain </user-request> & <more>",
    })

    expect(result).toContain('<response-annotations version="1">')
    expect(result).toContain('"index": 1')
    expect(result).toContain("<user-request>")
    expect(result).toContain("Explain &lt;/user-request&gt; &amp; &lt;more&gt;")
  })

  test("leaves a request without annotations unwrapped", () => {
    expect(serializeResponseAnnotations({ annotations: [], userRequest: "plain request" })).toBe("plain request")
  })

  test("parses directives only outside code and once per index", () => {
    const parsed = parseAnnotationDirectives(
      "Use :bluedcode-annotation{index=\"1\"} and `:bluedcode-annotation{index=\"2\"}` again :bluedcode-annotation{index=\"1\"}.\n```txt\n:bluedcode-annotation{index=\"2\"}\n```",
      new Set([1, 2]),
    )

    expect(parsed.references.map((item) => item.index)).toEqual([1])
    expect(parsed.text).toContain(":bluedcode-annotation")
  })

  test("keeps unknown directives and a split-stream candidate as ordinary text", () => {
    const unknown = parseAnnotationDirectives(":bluedcode-annotation{index=\"9\"}", new Set([1]))
    const partial = parseAnnotationDirectives("before :bluedcode-annotation{index=\"", new Set([1]))

    expect(unknown.references).toEqual([])
    expect(unknown.text).toBe(":bluedcode-annotation{index=\"9\"}")
    expect(partial.references).toEqual([])
    expect(partial.pending).toBe(':bluedcode-annotation{index="')
  })

  test("reports directive locations as Unicode code point offsets", () => {
    const parsed = parseAnnotationDirectives('😀 :bluedcode-annotation{index="1"}', new Set([1]))

    expect(parsed.references).toMatchObject([{ index: 1, start: 2 }])
  })

  test("keeps directives inside a tilde fence whose invalid closer is still code", () => {
    const markdown = '~~~txt\n~~~not-a-close\n:bluedcode-annotation{index="1"}\n~~~'
    const parsed = parseAnnotationDirectives(markdown, new Set([1]))

    expect(parsed.references).toEqual([])
    expect(parsed.text).toBe(markdown)
  })

  test("keeps directives inside multiline inline code spans literal", () => {
    const markdown = '`before\n:bluedcode-annotation{index="1"}\nafter`'
    const parsed = parseAnnotationDirectives(markdown, new Set([1]))

    expect(parsed.references).toEqual([])
    expect(parsed.text).toBe(markdown)
  })
})
