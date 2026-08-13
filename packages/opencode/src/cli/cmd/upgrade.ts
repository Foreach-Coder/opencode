import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Brand } from "@opencode-ai/brand"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: `upgrade ${Brand.name} when an internal release source is configured`,
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew", "choco", "scoop"],
      })
  },
  handler: async (args: { target?: string; method?: string }) => {
    void args
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro(`Upgrade ${Brand.name}`)
    prompts.log.warn(`${Brand.name} internal update source is not configured.`)
    prompts.outro("Upgrade unavailable")
    process.exitCode = 1
  },
}
