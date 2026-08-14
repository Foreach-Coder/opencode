#!/usr/bin/env bun
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const displayName = "Foreach" + "Code"
const brandDirectory = "xcode/build/"
const excluded = ["xcode/specs/", "xcode/plans/", ".test.", "/test/", "\\test\\"]
const files = Bun.spawnSync(["git", "ls-files"], { cwd: root, stdout: "pipe", stderr: "pipe" })
if (files.exitCode !== 0) throw new Error(files.stderr.toString())

const violations = (
  await Promise.all(
    files.stdout
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((file) => !file.startsWith(brandDirectory))
      .filter((file) => !excluded.some((part) => file.includes(part)))
      .map(async (file) => {
        const target = path.join(root, file)
        const source = await Bun.file(target)
          .text()
          .catch(() => "")
        return source.includes(displayName) ? file : undefined
      }),
  )
).filter((file): file is string => !!file)

if (violations.length)
  throw new Error(`Hardcoded product display name outside the explicit preset:\n${violations.join("\n")}`)

const requiredTemplates = [
  "install",
  "packages/opencode/bin/opencode",
  "packages/opencode/script/postinstall.mjs",
  "packages/opencode/Dockerfile",
  "nix/opencode.nix",
]
for (const file of requiredTemplates) {
  if ((await Bun.file(path.join(root, file)).text()).includes("__PRODUCT_")) continue
  throw new Error(`Distribution source is not a product template: ${file}`)
}

console.log("Brand contract is strict: explicit preset only, no source fallback")
