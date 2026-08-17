import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { transformModule, writeTransformLedger } from "../common/transform/engine"
import type { TransformInput, TransformRule } from "../common/transform/types"

function input(code: string, file = "src/config.ts"): TransformInput {
  return { file, code }
}

function rule(overrides: Partial<TransformRule> = {}): TransformRule {
  return {
    id: "brand-name",
    file: "src/config.ts",
    kind: "ts-string",
    selector: "variable:config.property:name",
    from: "OpenCode",
    to: "BluedCode",
    expected: 1,
    classification: "product",
    reason: "替换用户可见产品名",
    ...overrides,
  }
}

test("TS selector 精确转换变量属性、任意属性和调用参数字符串", () => {
  const source = [
    'const config = { name: "OpenCode", channel: "stable" }',
    'const nested = { channel: "stable" }',
    'register("opencode://open", true)',
  ].join("\n")
  const result = transformModule(input(source), [
    rule(),
    rule({
      id: "channel",
      selector: "property:channel",
      from: "stable",
      to: "preview",
      expected: 2,
      classification: "preserved",
    }),
    rule({
      id: "protocol",
      selector: "call:register.argument:0",
      from: "opencode://open",
      to: "bluedcode://open",
      classification: "entrypoint",
    }),
  ])

  expect(result.code).toBe(
    [
      'const config = { name: "BluedCode", channel: "preview" }',
      'const nested = { channel: "preview" }',
      'register("bluedcode://open", true)',
    ].join("\n"),
  )
  expect(result.records).toHaveLength(3)
  expect(result.records.map((record) => ({ id: record.id, hits: record.hits }))).toEqual([
    { id: "brand-name", hits: 1 },
    { id: "channel", hits: 2 },
    { id: "protocol", hits: 1 },
  ])
  expect(result.records.every((record) => /^[a-f0-9]{64}$/.test(record.before))).toBe(true)
  expect(result.records.every((record) => /^[a-f0-9]{64}$/.test(record.after))).toBe(true)
})

test("TS selector 只删除完整对象属性或独立调用语句", () => {
  const source = ['const config = { name: "OpenCode", cli: true, keep: true }', 'publish("desktop")'].join("\n")
  const result = transformModule(input(source), [
    rule({
      id: "remove-cli",
      kind: "ts-remove-property",
      selector: "variable:config.property:cli",
      from: "true",
      to: undefined,
      classification: "entrypoint",
    }),
    rule({
      id: "remove-publish",
      kind: "ts-remove-call",
      selector: "call:publish",
      from: 'publish("desktop")',
      to: undefined,
      classification: "entrypoint",
    }),
  ])

  expect(result.code).toContain('const config = { name: "OpenCode", keep: true }')
  expect(result.code).not.toContain('publish("desktop")')
  expect(() =>
    transformModule(input('const retained = publish("desktop")'), [
      rule({
        id: "unsafe-call",
        kind: "ts-remove-call",
        selector: "call:publish",
        from: 'publish("desktop")',
        to: undefined,
        classification: "entrypoint",
      }),
    ]),
  ).toThrow("完整 ExpressionStatement")
})

test("删除独立调用语句时保留前导注释", () => {
  const source = '// 保留发布说明\npublish("desktop")\nconst keep = true'
  const result = transformModule(input(source), [
    rule({
      id: "remove-publish",
      kind: "ts-remove-call",
      selector: "call:publish",
      from: 'publish("desktop")',
      to: undefined,
      classification: "entrypoint",
    }),
  ])

  expect(result.code).toContain("// 保留发布说明")
  expect(result.code).not.toContain('publish("desktop")')
  expect(result.code).toContain("const keep = true")
})

test("HTML selector 只转换指定元素的直接文本和过滤后的属性", () => {
  const source = '<main><title>OpenCode</title><a rel="app" href="opencode://open">OpenCode</a></main>'
  const result = transformModule(input(source, "index.html"), [
    rule({
      id: "title",
      file: "index.html",
      kind: "html-text",
      selector: "tag:title.text",
      from: "OpenCode",
      to: "BluedCode",
    }),
    rule({
      id: "link",
      file: "index.html",
      kind: "html-attribute",
      selector: "tag:a[rel=app].attribute:href",
      from: "opencode://open",
      to: "bluedcode://open",
      classification: "entrypoint",
    }),
  ])

  expect(result.code).toBe('<main><title>BluedCode</title><a rel="app" href="bluedcode://open">OpenCode</a></main>')
})

test("void 元素后的文本仍归属于外层元素", () => {
  const result = transformModule(input("<main><br>OpenCode</main>", "index.html"), [
    rule({
      id: "main-text",
      file: "index.html",
      kind: "html-text",
      selector: "tag:main.text",
      from: "OpenCode",
      to: "BluedCode",
    }),
  ])

  expect(result.code).toBe("<main><br>BluedCode</main>")
})

test("exact-text 仅接受 document selector 并按完整 literal 转换", () => {
  const result = transformModule(input("OpenCode\nOpenCode", "NOTICE.txt"), [
    rule({
      id: "notice",
      file: "NOTICE.txt",
      kind: "exact-text",
      selector: "document",
      from: "OpenCode",
      to: "BluedCode",
      expected: 2,
    }),
  ])
  expect(result.code).toBe("BluedCode\nBluedCode")

  expect(() =>
    transformModule(input("OpenCode", "NOTICE.txt"), [
      rule({ file: "NOTICE.txt", kind: "exact-text", selector: "line", expected: 1 }),
    ]),
  ).toThrow("不支持的 selector")
})

test("exact-text 显式拒绝空 from", () => {
  expect(() =>
    transformModule(input("OpenCode", "NOTICE.txt"), [
      rule({
        id: "empty-original",
        file: "NOTICE.txt",
        kind: "exact-text",
        selector: "document",
        from: "",
        to: "BluedCode",
      }),
    ]),
  ).toThrow("from 不能为空")
})

test("删除、复制或改写 TS 目标时均 fail closed", () => {
  expect(() => transformModule(input("const config = {}"), [rule()])).toThrow("命中 0，期望 1")
  expect(() => transformModule(input('const config = { name: "OpenCode", name: "OpenCode" }'), [rule()])).toThrow(
    "命中 2，期望 1",
  )
  expect(() => transformModule(input('const config = { name: "Changed" }'), [rule()])).toThrow("原值不匹配")
})

test("拒绝未知 selector、文件不匹配和非独立删除调用", () => {
  expect(() => transformModule(input('const config = { name: "OpenCode" }'), [rule({ selector: "name" })])).toThrow(
    "不支持的 selector",
  )
  expect(() => transformModule(input('const config = { name: "OpenCode" }', "other.ts"), [rule()])).toThrow(
    "文件不匹配",
  )
  expect(() =>
    transformModule(input('<a rel="app" href="opencode://open"></a>', "index.html"), [
      rule({
        file: "index.html",
        kind: "html-text",
        selector: "tag:a[rel=app].attribute:href",
        from: "opencode://open",
        to: "bluedcode://open",
        classification: "entrypoint",
      }),
    ]),
  ).toThrow("不支持的 selector")
})

test("转换账本按调用顺序写入规则记录", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bluedcode-ledger-"))
  try {
    const first = transformModule(input('const config = { name: "OpenCode" }'), [rule()])
    const second = transformModule(input("OpenCode", "NOTICE.txt"), [
      rule({ id: "notice", file: "NOTICE.txt", kind: "exact-text", selector: "document" }),
    ])
    const ledger = path.join(root, "transform-ledger.json")
    await writeTransformLedger(ledger, [first, second])
    expect(JSON.parse(await readFile(ledger, "utf8"))).toEqual({
      version: 1,
      records: [...first.records, ...second.records],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
