import { Brand, layoutPixelText } from "@opencode-ai/brand"
import { createUniqueId, For, type ComponentProps } from "solid-js"

const wordmark = layoutPixelText(Brand.name)
const unit = 18

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const filter = createUniqueId()
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${wordmark.width * unit} ${(wordmark.height + 2) * unit}`}
      fill="none"
      preserveAspectRatio="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.16" filter={`url(#${filter})`} mask={`url(#${mask})`} fill="currentColor">
        <For each={wordmark.cells}>
          {(cell) => <rect opacity="0.7" x={cell.x * unit} y={(cell.y + 1) * unit} width={unit} height={unit} />}
        </For>
      </g>
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width={wordmark.width * unit} height={7 * unit}>
          <rect width={wordmark.width * unit} height={7 * unit} fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="0" y1="0" x2="0" y2={7 * unit} gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
        <filter
          id={filter}
          x="0"
          y="0"
          width={wordmark.width * unit}
          height={7 * unit}
          filterUnits="userSpaceOnUse"
          color-interpolation-filters="sRGB"
        >
          <feFlood flood-opacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" />
          <feBlend mode="normal" in2="shape" result="effect1_innerShadow" />
        </filter>
      </defs>
    </svg>
  )
}
