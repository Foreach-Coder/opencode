import { describe, expect, test } from "bun:test"
import { Duration, Effect, Fiber, Layer, Schema } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { WebFetchTool } from "@opencode-ai/core/tool/webfetch"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_webfetch_test")
const requests: Array<{ readonly url: string; readonly headers: Record<string, string> }> = []
const assertions: PermissionV2.AssertInput[] = []
let respond = (_request: HttpClientRequest.HttpClientRequest) =>
  Effect.succeed(new Response("hello", { headers: { "content-type": "text/plain" } }))

const http = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() => requests.push({ url: request.url, headers: request.headers })).pipe(
      Effect.andThen(respond(request)),
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
    ),
  ),
)
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
const webfetch = WebFetchTool.layer.pipe(Layer.provide(registry), Layer.provide(permission), Layer.provide(http))
const it = testEffect(Layer.mergeAll(registry, permission, http, webfetch))
const fetchWebfetch = WebFetchTool.layer.pipe(
  Layer.provide(registry),
  Layer.provide(permission),
  Layer.provide(FetchHttpClient.layer),
)
const live = testEffect(Layer.mergeAll(registry, permission, FetchHttpClient.layer, fetchWebfetch))

const reset = () => {
  requests.length = 0
  assertions.length = 0
  respond = () => Effect.succeed(new Response("hello", { headers: { "content-type": "text/plain" } }))
}

const call = (input: typeof WebFetchTool.Input.Type, id = "call-webfetch") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "webfetch", input },
})

describe("WebFetchTool helpers", () => {
  test("defaults format and rejects invalid timeout controls", () => {
    const decode = Schema.decodeUnknownSync(WebFetchTool.Input)
    expect(decode({ url: "https://example.com" })).toEqual({ url: "https://example.com", format: "markdown" })
    expect(() => decode({ url: "https://example.com", timeout: 0 })).toThrow()
    expect(() => decode({ url: "https://example.com", timeout: WebFetchTool.MAX_TIMEOUT_SECONDS + 1 })).toThrow()
  })

  test("ports HTML text and markdown conversions without active content", () => {
    const html =
      "<h1>Hello</h1><script>bad()</script><p>world <strong>wide</strong> <product-name>today</product-name></p><style>.bad {}</style>"
    expect(WebFetchTool.extractTextFromHTML(html)).toBe("Helloworld wide today")
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe("# Hello\n\nworld **wide** today")
  })

  test("renders headings, inline semantics, links, images, breaks, and thematic breaks", () => {
    const html = `<h2>Read <em>this</em></h2><p><a href="https://example.com/a (b)" title="Example">docs</a><br><img src="diagram.png" alt="a ] b"></p><hr><p><del>old</del></p>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `## Read *this*\n\n[docs](https://example.com/a%20\\(b\\) "Example")  \n![a \\] b](diagram.png)\n\n---\n\n~~old~~`,
    )
  })

  test("preserves inline and preformatted code verbatim with safe fences", () => {
    const html = `<p>Use <code>say(\`hello\`)</code> now.</p><pre><code class="language-ts">const fence = \`\`\`\n&amp; stays decoded</code></pre>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `Use \`\`say(\`hello\`)\`\` now.\n\n\`\`\`\`ts\nconst fence = \`\`\`\n& stays decoded\n\`\`\`\``,
    )
  })

  test("keeps nested ordered and unordered lists structurally readable", () => {
    const html = `<ol start="3"><li>alpha<ul><li>nested <strong>item</strong></li></ul></li><li><p>beta first</p><p>beta second</p></li></ol>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `3. alpha\n\n  - nested **item**\n\n4. beta first\n\nbeta second`,
    )
  })

  test("renders blockquotes and tables as readable Markdown", () => {
    const html = `<blockquote><p>quoted <em>text</em></p><ul><li>point</li></ul></blockquote><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>one</td><td><code>1</code></td></tr></tbody></table>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `> quoted *text*\n\n> - point\n\n| Name | Value |\n| --- | --- |\n| one | \`1\` |`,
    )
  })

  test("decodes entities and normalizes prose whitespace without joining words", () => {
    const html = `<p>alpha\n  <span>&amp; beta</span> <unknown>caf&eacute;</unknown>&nbsp;gamma 😀</p><p>delta</p>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(`alpha & beta café gamma 😀\n\ndelta`)
  })

  test("omits active and fallback content while retaining surrounding prose", () => {
    const html = `<p>before <script><b>bad</b></script><style>bad</style><noscript>bad</noscript><iframe>bad</iframe><object>bad</object><embed src="bad"><meta content="bad"><link href="bad"><template>bad</template> after</p>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe("before after")
  })

  test("is deterministic and bounded for malformed maximum-size input", () => {
    const html = `<main><p>${"visible &amp; text ".repeat(250_000)}</main></p></unknown>`
    const first = WebFetchTool.convertHTMLToMarkdown(html)
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(first)
    expect(first.startsWith("visible & text visible & text")).toBe(true)
    expect(first.length).toBeLessThanOrEqual(html.length)
  })

  test("bounds deeply nested list output and fragmented code fences", () => {
    const lists = `${"<ul><li>item".repeat(2_000)}${"</li></ul>".repeat(2_000)}`
    const quotes = `${"<blockquote><p>item".repeat(2_000)}${"</p></blockquote>".repeat(2_000)}`
    const code = `<pre>${"` x ".repeat(250_000)}</pre>`
    expect(WebFetchTool.convertHTMLToMarkdown(lists).length).toBeLessThan(lists.length * 4)
    expect(WebFetchTool.convertHTMLToMarkdown(quotes).length).toBeLessThan(quotes.length * 4)
    expect(() => WebFetchTool.convertHTMLToMarkdown(code)).not.toThrow()
    expect(
      WebFetchTool.convertHTMLToMarkdown(
        "<div>".repeat(20_000) + "safe<script><b>bad</b>&amp;</script><p>tail &amp;</p>",
      ),
    ).toBe("safe tail &")
  })

  test("escapes prose that would otherwise become Markdown structure", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<p># heading</p><p>1. item</p><p>---</p><p>a | b</p>`)).toBe(
      `\\# heading\n\n1\\. item\n\n\\---\n\na \\| b`,
    )
  })

  test("preserves code whitespace and quotes every line of multiline blocks", () => {
    const html = `<blockquote><pre>line  \n\n\nnext</pre><table><tr><td>a|b</td><td>c</td></tr></table></blockquote>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `> \`\`\`\n> line  \n> \n> \n> next\n> \`\`\`\n\n> | a\\|b | c |\n> | --- | --- |`,
    )
  })

  test("keeps visible whitespace around inline emphasis", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<p>a<strong> b</strong> c a <em>b </em>c</p>`)).toBe(
      `a **b** c a *b* c`,
    )
  })

  test("normalizes multiline table cells without changing their columns", () => {
    const html = `<table><tr><td>x<br>y</td><td><code>a|b</code></td><td><p>first</p><p>second</p></td></tr></table>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `| x y | \`a\\|b\` | first second |\n| --- | --- | --- |`,
    )
  })

  test("flattens nested tables without corrupting the outer table", () => {
    const html = `<table><tr><th>Parent</th><th>Sibling</th></tr><tr><td>Before<table><tr><th>Key</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table>After</td><td>Tail</td></tr></table>`
    expect(WebFetchTool.convertHTMLToMarkdown(html)).toBe(
      `| Parent | Sibling |\n| --- | --- |\n| Before Key Value A 1 After | Tail |`,
    )
  })

  test("escapes tilde fences and removes empty emphasis markers", () => {
    expect(WebFetchTool.convertHTMLToMarkdown(`<p>~~~</p><p><strong></strong>content</p><p>~~~</p>`)).toBe(
      `\\~\\~\\~\n\ncontent\n\n\\~\\~\\~`,
    )
  })
})

describe("WebFetchTool registration", () => {
  it.effect("registers and fetches an ordinary hostname HTTP URL without rewriting it", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      const url = "http://example.com/public"

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["webfetch"])
      expect(yield* settleTool(registry, call({ url, format: "text", timeout: 4 }))).toEqual({
        result: { type: "text", value: "hello" },
        output: {
          structured: { url, contentType: "text/plain", format: "text", output: "hello" },
          content: [{ type: "text", text: "hello" }],
        },
      })
      expect(assertions).toMatchObject([
        { sessionID, action: "webfetch", resources: [url], save: ["*"], metadata: { url, format: "text", timeout: 4 } },
      ])
      expect(requests).toMatchObject([{ url, headers: { accept: expect.stringContaining("text/plain;q=1.0") } }])
    }),
  )

  it.effect("accepts localhost URLs with the same requested-URL permission check", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      const url = "http://localhost/private"

      expect(yield* executeTool(registry, call({ url, format: "text" }))).toEqual({
        type: "text",
        value: "hello",
      })
      expect(assertions).toMatchObject([
        { sessionID, action: "webfetch", resources: [url], save: ["*"], metadata: { url, format: "text" } },
      ])
      expect(requests.map((request) => request.url)).toEqual([url])
    }),
  )

  live.effect("follows redirects while approving only the requested URL", () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          fetch: (request) =>
            new URL(request.url).pathname === "/redirect"
              ? new Response("", { status: 302, headers: { location: "/target" } })
              : new Response("redirected", { headers: { "content-type": "text/plain" } }),
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          reset()
          const registry = yield* ToolRegistry.Service
          const url = new URL("/redirect", server.url).toString()

          expect(yield* executeTool(registry, call({ url, format: "text" }))).toEqual({
            type: "text",
            value: "redirected",
          })
          expect(assertions).toMatchObject([
            { sessionID, action: "webfetch", resources: [url], save: ["*"], metadata: { url, format: "text" } },
          ])
        }),
      (server) => Effect.promise(() => server.stop(true)),
    ),
  )

  it.effect("rejects non-HTTP schemes before permission or transport", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call({ url: "file:///etc/passwd", format: "text" }))).toEqual({
        type: "error",
        value: "Unable to fetch file:///etc/passwd",
      })
      expect(assertions).toEqual([])
      expect(requests).toEqual([])
    }),
  )

  it.effect("converts HTML to requested markdown and text", () =>
    Effect.gen(function* () {
      reset()
      respond = () =>
        Effect.succeed(
          new Response("<h1>Hello</h1><p>world</p><script>bad()</script>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        )
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call({ url: "https://1.1.1.1", format: "markdown" }))).toEqual({
        type: "text",
        value: "# Hello\n\nworld",
      })
      expect(yield* executeTool(registry, call({ url: "https://1.1.1.1", format: "text" }))).toEqual({
        type: "text",
        value: "Helloworld",
      })
    }),
  )

  it.effect("converts deeply nested HTML without overflowing", () =>
    Effect.gen(function* () {
      reset()
      respond = () =>
        Effect.succeed(
          new Response("<div>".repeat(10_000) + "content" + "</div>".repeat(10_000), {
            headers: { "content-type": "text/html" },
          }),
        )
      const registry = yield* ToolRegistry.Service
      const url = "https://1.1.1.1/deep-html"

      expect(yield* executeTool(registry, call({ url, format: "markdown" }))).toEqual({
        type: "text",
        value: "content",
      })
    }),
  )

  it.effect("rejects declared and streamed oversized bodies", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      respond = () =>
        Effect.succeed(
          new Response("small", {
            headers: { "content-type": "text/plain", "content-length": String(WebFetchTool.MAX_RESPONSE_BYTES + 1) },
          }),
        )
      expect(yield* executeTool(registry, call({ url: "https://1.1.1.1/declared", format: "text" }))).toEqual({
        type: "error",
        value: "Unable to fetch https://1.1.1.1/declared",
      })

      respond = () =>
        Effect.succeed(
          new Response("x".repeat(WebFetchTool.MAX_RESPONSE_BYTES + 1), { headers: { "content-type": "text/plain" } }),
        )
      expect(yield* executeTool(registry, call({ url: "https://1.1.1.1/streamed", format: "text" }))).toEqual({
        type: "error",
        value: "Unable to fetch https://1.1.1.1/streamed",
      })
    }),
  )

  it.effect("keeps images and files unsupported until typed settlement can carry attachments", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      respond = () => Effect.succeed(new Response("png", { headers: { "content-type": "image/png" } }))
      expect(yield* executeTool(registry, call({ url: "https://1.1.1.1/image", format: "html" }))).toEqual({
        type: "error",
        value: "Unable to fetch https://1.1.1.1/image",
      })

      respond = () => Effect.succeed(new Response("pdf", { headers: { "content-type": "application/pdf" } }))
      expect(yield* executeTool(registry, call({ url: "https://1.1.1.1/file", format: "html" }))).toEqual({
        type: "error",
        value: "Unable to fetch https://1.1.1.1/file",
      })
    }),
  )

  it.effect("retries Cloudflare challenges with an honest user agent", () =>
    Effect.gen(function* () {
      reset()
      let count = 0
      respond = () =>
        Effect.succeed(
          ++count === 1
            ? new Response("challenge", { status: 403, headers: { "cf-mitigated": "challenge" } })
            : new Response("ok", { headers: { "content-type": "text/plain" } }),
        )
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call({ url: "https://1.1.1.1", format: "text" }))).toEqual({
        type: "text",
        value: "ok",
      })
      expect(requests).toHaveLength(2)
      expect(requests[0]?.headers["user-agent"]).toContain("Mozilla/5.0")
      expect(requests[1]?.headers["user-agent"]).toBe("opencode")
    }),
  )

  it.effect("times out stalled requests", () =>
    Effect.gen(function* () {
      reset()
      respond = () => Effect.never
      const registry = yield* ToolRegistry.Service
      const fiber = yield* executeTool(
        registry,
        call({ url: "https://1.1.1.1/slow", format: "text", timeout: 1 }),
      ).pipe(Effect.forkChild)
      yield* TestClock.adjust(Duration.seconds(1))

      expect(yield* Fiber.join(fiber)).toEqual({ type: "error", value: "Unable to fetch https://1.1.1.1/slow" })
    }),
  )
})
