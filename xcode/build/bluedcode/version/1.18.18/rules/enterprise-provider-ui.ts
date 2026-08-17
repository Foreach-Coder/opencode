import ts from "typescript"
import { applyVersionEdits, collect, parse, replaceNode, requireCount } from "./ast"

export const enterpriseProviderUiTargets = [
  "packages/app/src/components/settings-providers.tsx",
  "packages/app/src/components/settings-v2/providers.tsx",
  "packages/app/src/hooks/use-providers.ts",
  "packages/app/src/hooks/provider-catalog.ts",
  "packages/app/src/components/dialog-connect-provider.tsx",
  "packages/app/src/components/dialog-custom-provider.tsx",
  "packages/app/src/components/dialog-manage-models.tsx",
] as const

export function transformEnterpriseProviderUi(file: string, code: string) {
  if (!enterpriseProviderUiTargets.includes(file as (typeof enterpriseProviderUiTargets)[number])) {
    return { code, records: [] }
  }
  const source = parse(file, code)
  if (source.statements.length === 0) throw new Error("1.18.18 结构 企业 Provider UI 入口缺失")
  if (file.endsWith("use-providers.ts")) {
    const popular = requireCount(
      "企业 Provider popular catalog",
      collect(source, ts.isVariableDeclaration).filter((node) => node.name.getText(source) === "popularProviders"),
    )[0]
    return applyVersionEdits(
      file,
      code,
      [
        replaceNode(
          source,
          popular.parent.parent,
          "export const popularProviders: readonly string[] = []",
          "企业 Provider popular catalog disabled",
        ),
      ],
      "enterprise.provider.popular-disabled",
    )
  }
  if (file.endsWith("dialog-connect-provider.tsx")) {
    return applyVersionEdits(
      file,
      code,
      [
        replaceNode(
          source,
          source,
          `import type { Accessor, Component } from "solid-js"

export function useProviderConnectController(options: { onBack?: () => void } = {}) {
  return {
    selected: () => undefined as string | undefined,
    select: (_provider?: string) => {},
    back: options.onBack ?? (() => {}),
  }
}

export const DialogConnectProvider: Component<{
  directory?: Accessor<string | undefined>
  controller?: ReturnType<typeof useProviderConnectController>
}> = () => (
  <div data-component="enterprise-provider-connect-disabled">
    BluedCode enterprise providers are managed by local configuration.
  </div>
)
`,
          "企业 Provider connect dialog disabled",
        ),
      ],
      "enterprise.provider.connect-dialog-disabled",
    )
  }
  if (
    file.endsWith("provider-catalog.ts") ||
    file.endsWith("dialog-custom-provider.tsx") ||
    file.endsWith("dialog-manage-models.tsx")
  ) {
    const first = source.statements[0]
    if (!first) throw new Error("1.18.18 结构 企业 Provider UI 入口缺失")
    return applyVersionEdits(
      file,
      code,
      [
        replaceNode(
          source,
          first,
          `// BluedCode enterprise policy: this UI is unreachable from enterprise settings.\n${first.getText(source)}`,
          "企业 Provider unreachable dialog",
        ),
      ],
      "enterprise.provider.unreachable-ui",
    )
  }
  return applyVersionEdits(
    file,
    code,
    [replaceNode(source, source, uiReplacement(file), "企业 Provider UI disabled")],
    "enterprise.provider.ui-disabled",
  )
}

function uiReplacement(file: string) {
  if (file.endsWith("settings-providers.tsx"))
    return 'import { ProviderIcon } from "@opencode-ai/ui/provider-icon"\nimport { useProviders } from "@/hooks/use-providers"\nimport { createMemo, For, Show, type Component } from "solid-js"\nimport { useLanguage } from "@/context/language"\nexport const SettingsProviders: Component<{ onBack?: () => void }> = () => { const language = useLanguage(); const providers = useProviders(() => undefined); const connected = createMemo(() => providers.connected().filter((provider) => provider.source === "config")); return <div data-component="connected-providers-section"><h2>{language.t("settings.providers.title")}</h2><Show when={connected().length > 0} fallback={<div>{language.t("settings.providers.connected.empty")}</div>}><For each={connected()}>{(provider) => <div><ProviderIcon id={provider.id} /><span>{provider.name}</span></div>}</For></Show></div> }\n'
  if (file.endsWith("settings-v2/providers.tsx"))
    return 'import { ProviderIcon } from "@opencode-ai/ui/provider-icon"\nimport { useProviders } from "@/hooks/use-providers"\nimport { createMemo, For, Show, type Accessor, type Component } from "solid-js"\nimport { useLanguage } from "@/context/language"\nexport const SettingsProvidersV2: Component<{ directory: Accessor<string | undefined>; onBack?: () => void }> = (props) => { const language = useLanguage(); const providers = useProviders(props.directory); const connected = createMemo(() => providers.connected().filter((provider) => provider.source === "config")); return <div data-component="connected-providers-section"><h2>{language.t("settings.providers.title")}</h2><Show when={connected().length > 0} fallback={<div>{language.t("settings.providers.connected.empty")}</div>}><For each={connected()}>{(provider) => <div><ProviderIcon id={provider.id} /><span>{provider.name}</span></div>}</For></Show></div> }\n'
  return `// BluedCode enterprise.provider.${file.split("/").pop()} is controlled; OAuth routes fail in the handler.\nexport {}\n`
}
