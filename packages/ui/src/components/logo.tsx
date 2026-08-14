import { Brand } from "@opencode-ai/brand"
import { VisualAssets } from "@opencode-ai/brand/assets"
import { createUniqueId, Show, type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => (
  <svg
    data-component="logo-mark"
    classList={{ [props.class ?? ""]: !!props.class }}
    viewBox={VisualAssets.appIcon.viewBox.join(" ")}
    role="img"
    aria-label={Brand.name}
    xmlns="http://www.w3.org/2000/svg"
  >
    <image href={VisualAssets.appIcon.dataUri} width="100%" height="100%" />
  </svg>
)

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => (
  <svg
    ref={props.ref}
    data-component="logo-splash"
    classList={{ [props.class ?? ""]: !!props.class }}
    viewBox={VisualAssets.appIcon.viewBox.join(" ")}
    role="img"
    aria-label={Brand.name}
    xmlns="http://www.w3.org/2000/svg"
  >
    <image href={VisualAssets.appIcon.dataUri} width="100%" height="100%" />
  </svg>
)

export const Logo = (props: { class?: string }) => {
  const mask = createUniqueId()
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={VisualAssets.wordmark.viewBox.join(" ")}
      classList={{ [props.class ?? ""]: !!props.class }}
      role="img"
      aria-label={Brand.name}
    >
      <Show
        when={VisualAssets.wordmark.usesCurrentColor}
        fallback={<image href={VisualAssets.wordmark.dataUri} width="100%" height="100%" />}
      >
        <defs>
          <mask id={mask} style={{ "mask-type": "alpha" }}>
            <image href={VisualAssets.wordmark.dataUri} width="100%" height="100%" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="currentColor" mask={`url(#${mask})`} />
      </Show>
    </svg>
  )
}
