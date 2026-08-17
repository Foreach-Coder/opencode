import path from "node:path"

export type GitResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export interface Git {
  run(args: readonly string[]): Promise<GitResult>
}

export function hasDirtyBuildInputs(status: string) {
  return status
    .split("\0")
    .filter(Boolean)
    .some((record) => {
      if (record.slice(0, 2) !== "??" || record[2] !== " ") return true
      return !isOwnedBuildOutput(record.slice(3))
    })
}

export function createGit(root: string): Git {
  return {
    async run(args) {
      const process = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" })
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])
      return { exitCode, stdout, stderr }
    },
  }
}

function isOwnedBuildOutput(file: string) {
  if (!file || file.includes("\0")) return false
  const slashPath = file.replaceAll("\\", "/")
  const normalized = path.posix.normalize(slashPath)
  return normalized === slashPath && normalized.startsWith(".xcode/bluedcode/")
}
