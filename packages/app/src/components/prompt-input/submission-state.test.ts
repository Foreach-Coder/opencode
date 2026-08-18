import { describe, expect, test } from "bun:test"
import { requestContextForMode } from "./submission-state"

describe("requestContextForMode", () => {
  test("removes response annotations before a shell submission", () => {
    const context = [
      {
        key: "annotation:draft_1",
        type: "response-annotation" as const,
        draft: {
          id: "draft_1",
          source: { sessionID: "ses_1", messageID: "msg_1", partID: "part_1", partDigest: "sha256:abc", start: 0, end: 4 },
          context: { before: "", selected: "text", after: "" },
          comment: "note",
          createdAt: 1,
        },
      },
      { key: "file:src/a.ts", type: "file" as const, path: "src/a.ts" },
    ]

    expect(requestContextForMode(context, "shell")).toEqual([{ key: "file:src/a.ts", type: "file", path: "src/a.ts" }])
  })
})
