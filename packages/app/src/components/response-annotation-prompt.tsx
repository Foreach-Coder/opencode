import { Show, type Accessor } from "solid-js"
import type { ResponseAnnotationDraft } from "@/context/prompt"
import {
  ResponseAnnotationComposerPopover,
  ResponseAnnotationDraftList,
} from "@opencode-ai/session-ui/response-annotation"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { annotationSourceMatches } from "@opencode-ai/core/session/response-annotation"

export function PromptResponseAnnotations(props: {
  annotations: Accessor<ResponseAnnotationDraft[]>
  onUpdate: (id: string, comment: string) => void
  onRemove: (id: string) => void
  onBackToSource?: (draft: ResponseAnnotationDraft) => void
}) {
  const sync = useSync()
  const language = useLanguage()
  const valid = (draft: ResponseAnnotationDraft) => {
    const parts = sync()?.data?.part
    if (!parts) return true
    const part = parts[draft.source.messageID]?.find((item) => item.id === draft.source.partID)
    if (!part || part.type !== "text") return false
    return annotationSourceMatches(
      { source: { ...draft.source, digest: draft.source.partDigest }, context: draft.context },
      part.text,
    )
  }
  const annotations = () =>
    props.annotations().map((draft, index) => ({
      ...draft,
      index: index + 1,
      invalid: !valid(draft),
      invalidLabel: language.t("common.requestFailed"),
    }))

  return (
    <Show when={annotations().length > 0}>
      <div data-component="prompt-response-annotations" class="px-3 pt-2">
        <ResponseAnnotationComposerPopover count={annotations().length}>
          <ResponseAnnotationDraftList
            annotations={annotations()}
            onSave={(id, comment) => {
              if (Array.from(comment).length <= 2_000) props.onUpdate(id, comment)
            }}
            onDelete={props.onRemove}
            onBackToSource={
              props.onBackToSource
                ? (annotation) => {
                    const draft = props.annotations().find((item) => item.id === annotation.id)
                    if (draft) props.onBackToSource?.(draft)
                  }
                : undefined
            }
          />
        </ResponseAnnotationComposerPopover>
      </div>
    </Show>
  )
}
