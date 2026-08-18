import { useI18n } from "@opencode-ai/ui/context/i18n"
import { Popover } from "@opencode-ai/ui/popover"
import { createEffect, createSignal, createUniqueId, For, Show } from "solid-js"
import {
  responseAnnotationCopy,
  responseAnnotationDraftActions,
  responseAnnotationEditorKeyDown,
  type ResponseAnnotationView,
} from "./response-annotation-logic"

export {
  responseAnnotationCopy,
  responseAnnotationDraftActions,
  responseAnnotationEditorKeyDown,
  type ResponseAnnotationView,
} from "./response-annotation-logic"

export function ResponseAnnotationComposerButton(props: { count: number; onClick: VoidFunction }) {
  const i18n = useI18n()
  const copy = () => responseAnnotationCopy(i18n.t, props.count, 1)
  return (
    <button
      type="button"
      data-component="response-annotation-composer-button"
      aria-label={copy().openCount}
      onClick={props.onClick}
    >
      {copy().count}
    </button>
  )
}

export function ResponseAnnotationDraftList(props: {
  annotations: ResponseAnnotationView[]
  onSave: (id: string, comment: string) => void
  onDelete: (id: string) => void
  onBackToSource?: (annotation: ResponseAnnotationView) => void
}) {
  return (
    <div data-component="response-annotation-draft-list">
      <For each={props.annotations}>
        {(annotation) => (
          <ResponseAnnotationDraft annotation={annotation} {...responseAnnotationDraftActions(annotation, props)} />
        )}
      </For>
    </div>
  )
}

function ResponseAnnotationDraft(props: {
  annotation: ResponseAnnotationView
  onSave: (comment: string) => void
  onDelete: VoidFunction
  onBackToSource?: VoidFunction
}) {
  const i18n = useI18n()
  const [editing, setEditing] = createSignal(false)
  const [comment, setComment] = createSignal(props.annotation.comment)
  const copy = () => responseAnnotationCopy(i18n.t, 1, props.annotation.index)
  const cancel = () => {
    setComment(props.annotation.comment)
    setEditing(false)
  }
  const save = () => {
    props.onSave(comment())
    setEditing(false)
  }

  return (
    <article data-component="response-annotation-draft" data-annotation-index={props.annotation.index}>
      <blockquote>{props.annotation.context.selected}</blockquote>
      <Show
        when={editing()}
        fallback={<p data-slot="response-annotation-comment">{props.annotation.comment || copy().empty}</p>}
      >
        <textarea
          ref={(element) => queueMicrotask(() => element.focus())}
          aria-label={copy().comment}
          value={comment()}
          onInput={(event) => setComment(event.currentTarget.value)}
          onKeyDown={(event) => responseAnnotationEditorKeyDown(event, save, cancel)}
        />
        <button type="button" onClick={cancel}>{i18n.t("ui.common.cancel")}</button>
        <button type="button" onClick={save}>{i18n.t("ui.common.confirm")}</button>
      </Show>
      <div data-slot="response-annotation-actions">
        <button type="button" aria-label={copy().edit} onClick={() => setEditing(true)}>
          {i18n.t("ui.responseAnnotation.editAction")}
        </button>
        <button type="button" aria-label={copy().delete} onClick={props.onDelete}>
          {i18n.t("ui.responseAnnotation.deleteAction")}
        </button>
        <Show when={props.onBackToSource}>
          <button type="button" aria-label={copy().source} onClick={props.onBackToSource}>
            {i18n.t("ui.responseAnnotation.sourceAction")}
          </button>
        </Show>
      </div>
    </article>
  )
}

export function ResponseAnnotationHistoryList(props: {
  annotations: ResponseAnnotationView[]
  onBackToSource?: (annotation: ResponseAnnotationView) => void
}) {
  const i18n = useI18n()
  return (
    <div data-component="response-annotation-history-list">
      <For each={props.annotations}>
        {(annotation) => (
          <article data-annotation-index={annotation.index}>
            <blockquote>{annotation.context.selected}</blockquote>
            <p>{annotation.comment || i18n.t("ui.responseAnnotation.empty")}</p>
            <Show when={props.onBackToSource}>
              <button
                type="button"
                aria-label={i18n.t("ui.responseAnnotation.source", { index: annotation.index })}
                onClick={() => props.onBackToSource?.(annotation)}
              >
                {i18n.t("ui.responseAnnotation.sourceAction")}
              </button>
            </Show>
          </article>
        )}
      </For>
    </div>
  )
}

export function ResponseAnnotationReference(props: {
  annotation: ResponseAnnotationView
  onBackToSource?: (annotation: ResponseAnnotationView) => void
}) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const [hovered, setHovered] = createSignal(false)
  const hoverID = createUniqueId()
  let root: HTMLSpanElement | undefined
  let details: HTMLDivElement | undefined
  createEffect(() => {
    if (!open()) return
    queueMicrotask(() => details?.focus())
  })
  const summary = () => (
    <>
      <div>{props.annotation.context.selected}</div>
      <div>{props.annotation.comment || i18n.t("ui.responseAnnotation.empty")}</div>
    </>
  )
  return (
    <span ref={root} data-component="response-annotation-reference">
      <Popover
        open={open()}
        onOpenChange={(value) => {
          if (value) setHovered(false)
          const restoreFocus = !value && !!details?.contains(document.activeElement)
          setOpen(value)
          if (restoreFocus) {
            queueMicrotask(() => root?.querySelector<HTMLButtonElement>('[data-slot="popover-trigger"]')?.focus())
          }
        }}
        portal={false}
        triggerAs="button"
        triggerProps={{
          type: "button",
          "aria-label": i18n.t("ui.responseAnnotation.open", { index: props.annotation.index }),
          "aria-describedby": hovered() && !open() ? hoverID : undefined,
          onMouseEnter: () => {
            if (!open()) setHovered(true)
          },
          onMouseLeave: () => setHovered(false),
        }}
        trigger={i18n.t("ui.responseAnnotation.reference", { index: props.annotation.index })}
      >
        <div
          ref={details}
          role="dialog"
          tabIndex={-1}
          aria-label={i18n.t("ui.responseAnnotation.details", { index: props.annotation.index })}
        >
          {summary()}
          <Show when={props.onBackToSource}>
            <button type="button" onClick={() => props.onBackToSource?.(props.annotation)}>
              {i18n.t("ui.responseAnnotation.sourceAction")}
            </button>
          </Show>
          <button type="button" onClick={() => setOpen(false)}>{i18n.t("ui.common.close")}</button>
        </div>
      </Popover>
      <Show when={hovered() && !open()}>
        <span
          id={hoverID}
          role="tooltip"
          data-slot="response-annotation-hover-details"
          onMouseLeave={() => setHovered(false)}
        >
          {summary()}
        </span>
      </Show>
    </span>
  )
}
