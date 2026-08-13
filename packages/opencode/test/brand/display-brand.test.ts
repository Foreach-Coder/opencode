import { describe, expect, test } from "bun:test"
import path from "path"
import { Brand } from "@opencode-ai/brand"

describe("display brand contract", () => {
  test("does not hardcode the current product identity in runtime TypeScript", async () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const files = (
      await Promise.all(
        ["core", "opencode", "tui", "ui", "app", "desktop", "enterprise"].map((pkg) =>
          Array.fromAsync(
            new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: path.join(root, "packages", pkg, "src"), absolute: true }),
          ),
        ),
      )
    ).flat()
    files.push(
      ...(await Array.fromAsync(
        new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: path.join(root, "packages/sdk/js/src"), absolute: true }),
      )),
    )
    const hits = (
      await Promise.all(
        files.map(async (file) => {
          if (file.endsWith(".gen.ts")) return
          const source = await Bun.file(file).text()
          if ([Brand.name, Brand.slug, "ForeachCode", "foreachcode"].some((value) => source.includes(value)))
            return file
        }),
      )
    ).filter((file): file is string => !!file)

    expect(hits).toEqual([])
  })

  test("does not expose legacy product commands in runtime surfaces", async () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const files = (
      await Promise.all(
        ["opencode", "tui", "app", "desktop"].map((pkg) =>
          Array.fromAsync(
            new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: path.join(root, "packages", pkg, "src"), absolute: true }),
          ),
        ),
      )
    ).flat()
    const hits = (
      await Promise.all(
        files.map(async (file) => {
          const source = await Bun.file(file).text()
          if (
            /\bopencode (?:--continue|auth|mcp|models|agent|debug|upgrade)\b|~\/\.config\/opencode\/tui\.json|opencode-debug/.test(
              source,
            )
          )
            return file
        }),
      )
    ).filter((file): file is string => !!file)

    expect(hits).toEqual([])
  })

  test("does not expose historical product identity in user-facing and external surfaces", async () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const checks = [
      ["packages/opencode/src/cli/cmd/debug/index.ts", "opencode version"],
      ["packages/sdk/js/src/error-interceptor.ts", "opencode server"],
      ["packages/tui/src/attention.ts", 'DEFAULT_TITLE = "opencode"'],
      ["packages/tui/src/context/editor.ts", 'clientInfo: { name: "opencode"'],
      ["packages/app/src/context/highlights.tsx", "https://opencode.ai/changelog.json"],
      ["packages/opencode/src/server/shared/ui.ts", "https://app.opencode.ai"],
      ["packages/app/src/pages/home.tsx", "https://opencode.ai/desktop-feedback"],
      ["packages/app/src/pages/error.tsx", "https://opencode.ai/desktop-feedback"],
      ["packages/app/src/pages/layout.tsx", "https://opencode.ai/desktop-feedback"],
      ["packages/tui/src/component/error-component.tsx", "github.com/anomalyco/opencode/issues"],
    ] as const

    const hits = (
      await Promise.all(
        checks.map(async ([file, value]) => {
          if ((await Bun.file(path.join(root, file)).text()).includes(value)) return `${file}: ${value}`
        }),
      )
    ).filter((item): item is string => !!item)

    expect(hits).toEqual([])
  })

  test("keeps upstream partner identifiers stable while branding display headers", async () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const provider = await Bun.file(path.join(root, "packages/opencode/src/provider/provider.ts")).text()
    const nvidia = await Bun.file(path.join(root, "packages/core/src/plugin/provider/nvidia.ts")).text()
    const codex = await Bun.file(path.join(root, "packages/opencode/src/plugin/openai/codex.ts")).text()
    const copilot = await Bun.file(path.join(root, "packages/opencode/src/plugin/github-copilot/copilot.ts")).text()

    expect(provider).toContain('"X-Source": "opencode"')
    expect(provider).toContain('"X-BILLING-INVOKE-ORIGIN": "OpenCode"')
    expect(provider).toContain('"X-Cerebras-3rd-Party-Integration": "opencode"')
    expect(nvidia).toContain('["X-BILLING-INVOKE-ORIGIN"] ??= "OpenCode"')
    expect(codex).toContain('"User-Agent": `opencode/${InstallationVersion}`')
    expect(copilot).toContain('"User-Agent": `opencode/${InstallationVersion}`')
  })

  test("keeps upstream product services out of the enterprise runtime", async () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const index = await Bun.file(path.join(root, "packages/opencode/src/index.ts")).text()
    const menu = await Bun.file(path.join(root, "packages/app/src/desktop-menu.ts")).text()
    const share = await Bun.file(path.join(root, "packages/opencode/src/share/share-next.ts")).text()
    const sessionShare = await Bun.file(path.join(root, "packages/opencode/src/share/session.ts")).text()
    const run = await Bun.file(path.join(root, "packages/opencode/src/cli/cmd/run.ts")).text()
    const tips = await Bun.file(path.join(root, "packages/tui/src/feature-plugins/home/tips-view.tsx")).text()
    const appCommands = await Bun.file(
      path.join(root, "packages/app/src/pages/session/use-session-commands.tsx"),
    ).text()
    const appTimeline = await Bun.file(
      path.join(root, "packages/app/src/pages/session/timeline/message-timeline.tsx"),
    ).text()
    const tuiSession = await Bun.file(path.join(root, "packages/tui/src/routes/session/index.tsx")).text()
    const enterpriseShare = await Bun.file(path.join(root, "packages/enterprise/src/routes/share/[shareID].tsx")).text()

    expect(index).not.toContain(".command(GithubCommand)")
    expect(index).not.toContain(".command(ConsoleCommand)")
    expect(menu).not.toContain("discord.com/invite/opencode")
    expect(menu).not.toContain("github.com/anomalyco/opencode/issues")
    expect(menu).toContain("https://opencode.ai/docs")
    expect(share).not.toContain('?? "https://opncd.ai"')
    expect(sessionShare).not.toContain('conf.share === "auto"')
    expect(sessionShare).not.toContain("flags.autoShare")
    expect(run).not.toContain('.option("share"')
    expect(run).not.toContain("sdk.session.share")
    expect(appCommands).not.toContain("client.session.share")
    expect(appCommands).not.toContain("client.session.unshare")
    expect(appTimeline).not.toContain("client.session.share")
    expect(appTimeline).not.toContain("client.session.unshare")
    expect(tuiSession).not.toContain("client.session.share")
    expect(tuiSession).not.toContain("client.session.unshare")
    expect(enterpriseShare).not.toContain("social-cards.sst.dev")
    expect(enterpriseShare).not.toContain("github.com/anomalyco/opencode")
    expect(enterpriseShare).not.toContain("opencode.ai/discord")
    expect(tips).not.toContain("/share")
    expect(tips).not.toContain("/unshare")
    expect(tips).not.toContain("/opencode")
    expect(tips).not.toContain('"share": "auto"')
  })

  test("keeps generated SDK output free of previous ForeachCode identities after a future rename", async () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const legacy = ["ForeachCode", "foreachcode"].filter(
      (value) => value !== Brand.name && value !== Brand.slug && value !== Brand.cli,
    )
    const files = await Array.fromAsync(
      new Bun.Glob("**/*.gen.ts").scan({ cwd: path.join(root, "packages/sdk/js/src"), absolute: true }),
    )
    const hits = (
      await Promise.all(
        files.map(async (file) => {
          const source = await Bun.file(file).text()
          if (legacy.some((value) => source.includes(value))) return file
        }),
      )
    ).filter((file): file is string => !!file)

    expect(hits).toEqual([])
  })

  test("keeps removed product service URLs out of reachable command modules", async () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const checks = [
      ["packages/opencode/src/share/share-next.ts", "https://opncd.ai"],
      ["packages/opencode/src/cli/cmd/account.ts", "https://console.opencode.ai"],
      ["packages/opencode/src/server/shared/ui.ts", "https://app.opencode.ai"],
      ["packages/app/src/context/highlights.tsx", "https://opencode.ai/changelog.json"],
    ] as const

    const hits = (
      await Promise.all(
        checks.map(async ([file, value]) => {
          if ((await Bun.file(path.join(root, file)).text()).includes(value)) return `${file}: ${value}`
        }),
      )
    ).filter((item): item is string => !!item)

    expect(hits).toEqual([])
  })

  test("brands OpenAPI display metadata without renaming protocol types", async () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const files = [
      path.join(root, "packages/opencode/src/server/routes/instance/httpapi/public.ts"),
      path.join(root, "packages/core/src/v1/config/config.ts"),
      ...(await Array.fromAsync(
        new Bun.Glob("*.ts").scan({
          cwd: path.join(root, "packages/opencode/src/server/routes/instance/httpapi/groups"),
          absolute: true,
        }),
      )),
    ]
    const hits = (
      await Promise.all(
        files.map(async (file) => {
          const source = await Bun.file(file).text()
          if (/title:\s*"opencode|description:\s*"[^"\n]*opencode (?:serve|api|upgrade)/i.test(source)) return file
        }),
      )
    ).filter((file): file is string => !!file)

    expect(hits).toEqual([])
  })
})
