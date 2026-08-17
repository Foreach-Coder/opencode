import { Component, createSignal, Show, startTransition } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsServers } from "./settings-servers"
import { Product } from "@foreachcode/product"
import { ProductUiRegistry } from "@/product/ui-registry"

export const DialogSettings: Component<{ defaultValue?: string }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const settingsTabs = ProductUiRegistry.settingsTabs(Product.profile)
  const initialTab = props.defaultValue && settingsTabs[props.defaultValue as keyof typeof settingsTabs] ? props.defaultValue : "general"
  const [tab, setTab] = createSignal(initialTab)

  const showProviders = () => {
    if (!settingsTabs.providers) return
    void dialog.show(() => <DialogSettings defaultValue="providers" />)
  }

  return (
    <Dialog size="x-large" transition>
      <Tabs
        orientation="vertical"
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value))}
        class="h-full settings-dialog"
      >
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full gap-4">
            <div class="flex flex-col gap-3 w-full pt-3">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Show when={settingsTabs.general}>
                      <Tabs.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                      </Tabs.Trigger>
                    </Show>
                    <Show when={settingsTabs.shortcuts}>
                      <Tabs.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                      </Tabs.Trigger>
                    </Show>
                    <Show when={settingsTabs.servers}>
                      <Tabs.Trigger value="servers">
                      <Icon name="server" />
                      {language.t("status.popover.tab.servers")}
                      </Tabs.Trigger>
                    </Show>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Show when={settingsTabs.providers}>
                      <Tabs.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                      </Tabs.Trigger>
                    </Show>
                    <Show when={settingsTabs.models}>
                      <Tabs.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                      </Tabs.Trigger>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
              <span>{language.t("app.name.desktop")}</span>
              <span class="text-11-regular">v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>
        <Show when={settingsTabs.general}><Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content></Show>
        <Show when={settingsTabs.shortcuts}><Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content></Show>
        <Show when={settingsTabs.servers}><Tabs.Content value="servers" class="no-scrollbar">
          <SettingsServers />
        </Tabs.Content></Show>
        <Show when={settingsTabs.providers}><Tabs.Content value="providers" class="no-scrollbar">
          <SettingsProviders onBack={showProviders} />
        </Tabs.Content></Show>
        <Show when={settingsTabs.models}><Tabs.Content value="models" class="no-scrollbar">
          <SettingsModels />
        </Tabs.Content></Show>
      </Tabs>
    </Dialog>
  )
}
