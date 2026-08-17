import { expect, test } from "bun:test"
import path from "node:path"

test("公共构建模块通过受信 TypeScript typecheck", async () => {
  const root = path.resolve(import.meta.dir, "../../../../")
  const process = Bun.spawn(
    [
      "bunx",
      "--no-install",
      "--bun",
      "tsgo",
      "-p",
      path.join(root, "xcode/build/bluedcode/test/tsconfig.typecheck.json"),
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])

  expect(`${stdout}${stderr}`).not.toContain("Cannot find name")
  expect(exitCode, `${stdout}${stderr}`).toBe(0)
})
