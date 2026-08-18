import { createStore } from "solid-js/store"
import { Show, type Accessor } from "solid-js"
import type { ResponseAnnotationDraft } from "@/context/prompt"
import {
  ResponseAnnotationComposerButton,
  ResponseAnnotationDraftList,
} from "@opencode-ai/session-ui/response-annotation"

export function PromptResponseAnnotations(props: {
  annotations: Accessor<ResponseAnnotationDraft[]>
  onUpdate: (id: string, comment: string) => void
  onRemove: (id: string) => void
  onBackToSource?: (draft: ResponseAnnotationDraft) => void
}) {
  const [state, setState] = createStore({ open: false })
  const annotations = () =>
    props.annotations().map((draft, index) => ({
      ...draft,
      index: index + 1,
    }))

  return (
    <Show when={annotations().length > 0}>
      <div data-component="prompt-response-annotations" class="px-3 pt-2">
        <ResponseAnnotationComposerButton count={annotations().length} onClick={() => setState("open", !state.open)} />
        <Show when={state.open}>
          <div class="mt-2 max-h-48 overflow-y-auto rounded-md border border-border-weak-base bg-background-base p-2">
            <ResponseAnnotationDraftList
              annotations={annotations()}
              onSave={(id, comment) => props.onUpdate(id, comment.slice(0, 2_000))}
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
          </div>
        </Show>
      </div>
    </Show>
  )
}
