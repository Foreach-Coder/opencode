import { expect, test } from "bun:test"
import { sessionExportDictionary } from "./session-export"

test("HTML export uses complete Chinese phrases and explicit English fallback", () => {
  expect(sessionExportDictionary("zh")["command.session.exportHtml"]).toBe("导出 HTML")
  expect(sessionExportDictionary("zh")["session.export.html.download"]).toBe("下载原始 JSON")
  expect(sessionExportDictionary("de")["session.export.html.download"]).toBe("Download original JSON")
  expect(Object.keys(sessionExportDictionary("zh")).sort()).toEqual(Object.keys(sessionExportDictionary("en")).sort())
})
