import { Brand } from "@opencode-ai/brand"
import { VisualAssets } from "@opencode-ai/brand/assets"
import { createUniqueId, Show, type ComponentProps } from "solid-js"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
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
