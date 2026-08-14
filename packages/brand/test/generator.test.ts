import { expect, test } from "bun:test"
import path from "node:path"

test("brand check is read-only and rejects source-level product defaults", () => {
  const root = path.resolve(import.meta.dir, "../../..")
  const before = Bun.spawnSync(["git", "status", "--porcelain=v2", "--untracked-files=all"], {
    cwd: root,
    stdout: "pipe",
  }).stdout.toString()
  const result = Bun.spawnSync([process.execPath, "run", "script/brand.ts", "--check"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const after = Bun.spawnSync(["git", "status", "--porcelain=v2", "--untracked-files=all"], {
    cwd: root,
    stdout: "pipe",
  }).stdout.toString()

  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString()).toContain("explicit preset only")
  expect(after).toBe(before)
})
