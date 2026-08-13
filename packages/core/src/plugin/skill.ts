/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { Effect } from "effect"
import { PluginV2 } from "../plugin"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOpencodeContent from "./skill/customize-opencode.md" with { type: "text" }
import { Brand } from "@opencode-ai/brand"

export const CustomizeOpencodeContent = customizeOpencodeContent
  .replaceAll("{{PRODUCT_NAME}}", Brand.name)
  .replaceAll("{{PRODUCT_DIRECTORY}}", Brand.directory)

export const Plugin = PluginV2.define({
  id: PluginV2.ID.make("skill"),
  effect: Effect.gen(function* () {
    const skill = yield* SkillV2.Service
    const transform = yield* skill.transform()

    yield* transform((editor) => {
      editor.source(
        new SkillV2.EmbeddedSource({
          type: "embedded",
          skill: new SkillV2.Info({
            name: "customize-opencode",
            description: `Use ONLY when the user is editing or creating ${Brand.name}'s own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/${Brand.directory}/. Also use when creating or fixing ${Brand.name} agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring ${Brand.name} itself.`,
            location: AbsolutePath.make("/builtin/customize-opencode.md"),
            content: CustomizeOpencodeContent,
          }),
        }),
      )
    })
  }),
})
