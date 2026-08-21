import { useI18n } from "@opencode-ai/ui/context/i18n"
import { Popover } from "@opencode-ai/ui/popover"
import { Icon } from "@opencode-ai/ui/icon"
import { HoverCard } from "@kobalte/core/hover-card"
import { createSignal, createUniqueId, For, Show, type JSX } from "solid-js"
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
      class="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-raised-base px-2.5 text-12-medium text-text-base shadow-sm transition-colors hover:bg-surface-raised-base-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
      onClick={props.onClick}
    >
      <Icon name="comment" size="small" />
      <span>{copy().count}</span>
    </button>
  )
}

export function ResponseAnnotationComposerPopover(props: { count: number; children: JSX.Element }) {
  const i18n = useI18n()
  const copy = () => responseAnnotationCopy(i18n.t, props.count, 1)
  return (
    <Popover
      placement="top-start"
      gutter={8}
      class="!max-w-none !rounded-xl !border-0 !bg-surface-raised-base"
      triggerAs="button"
      triggerProps={
        {
          type: "button",
          "data-component": "response-annotation-composer-button",
          "aria-label": copy().openCount,
          class:
            "inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-raised-base px-2.5 text-12-medium text-text-base shadow-sm transition-colors hover:bg-surface-raised-base-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus",
        } as JSX.ButtonHTMLAttributes<HTMLButtonElement> & { "data-component": string }
      }
      trigger={
        <>
          <Icon name="comment" size="small" class="text-icon-weak" />
          <span>{copy().count}</span>
        </>
      }
    >
      <div
        data-component="response-annotation-composer-popover"
        role="dialog"
        aria-label={copy().openCount}
        class="max-h-[min(360px,50vh)] w-[min(360px,calc(100vw-56px))] overflow-y-auto bg-surface-raised-base"
      >
        {props.children}
      </div>
    </Popover>
  )
}

export function ResponseAnnotationDraftList(props: {
  annotations: ResponseAnnotationView[]
  onSave: (id: string, comment: string) => void
  onDelete: (id: string) => void
  onBackToSource?: (annotation: ResponseAnnotationView) => void
}) {
  return (
    <div data-component="response-annotation-draft-list" class="flex min-w-0 flex-col gap-1">
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
    if (Array.from(comment()).length > 2_000) return
    props.onSave(comment())
    setEditing(false)
  }

  return (
    <article
      data-component="response-annotation-draft"
      data-annotation-index={props.annotation.index}
      class="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] gap-2.5 py-3 first:pt-0 last:pb-0"
      data-invalid={props.annotation.invalid || undefined}
    >
      <span class="pt-0.5 text-right text-12-medium text-text-weak">
        {props.annotation.invalid ? (
          <span class="text-text-critical" aria-label={props.annotation.invalidLabel}>
            !
          </span>
        ) : (
          <>{props.annotation.index}.</>
        )}
      </span>
      <div class="min-w-0">
        <blockquote class="mb-2 whitespace-pre-wrap break-words rounded-lg bg-background-base px-3 py-2 text-13-regular text-text-base">
          {props.annotation.context.selected}
        </blockquote>
        <Show
          when={editing()}
          fallback={
            <p
              data-slot="response-annotation-comment"
              class="whitespace-pre-wrap break-words text-13-regular text-text-strong"
            >
              {props.annotation.comment || copy().empty}
            </p>
          }
        >
          <div
            class="rounded-xl bg-surface-base p-2 shadow-sm"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.preventDefault()
              event.stopPropagation()
              cancel()
            }}
          >
            <textarea
              ref={(element) => queueMicrotask(() => element.focus())}
              aria-label={copy().comment}
              class="min-h-20 w-full resize-y bg-transparent px-1 py-1 text-13-regular text-text-strong outline-none placeholder:text-text-weaker"
              value={comment()}
              onInput={(event) => setComment(event.currentTarget.value)}
              onKeyDown={(event) => responseAnnotationEditorKeyDown(event, save, cancel)}
            />
            <Show when={Array.from(comment()).length > 2_000}>
              <div role="alert" class="text-right text-11-regular text-text-critical">
                {Array.from(comment()).length} / 2000
              </div>
            </Show>
            <div class="mt-2 flex justify-end gap-2">
              <button
                type="button"
                class="rounded-md px-2.5 py-1 text-12-medium text-text-base hover:bg-background-stronger"
                onClick={cancel}
              >
                {i18n.t("ui.common.cancel")}
              </button>
              <button
                type="button"
                class="rounded-md bg-text-strong px-2.5 py-1 text-12-medium text-background-base disabled:opacity-50"
                onClick={save}
                disabled={Array.from(comment()).length > 2_000}
              >
                {i18n.t("ui.common.confirm")}
              </button>
            </div>
          </div>
        </Show>
        <div data-slot="response-annotation-actions" class="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-background-stronger hover:text-text-strong"
            aria-label={copy().edit}
            onClick={() => setEditing(true)}
          >
            <Icon name="pencil-line" size="small" />
            {i18n.t("ui.responseAnnotation.editAction")}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-background-stronger hover:text-text-strong"
            aria-label={copy().delete}
            onClick={props.onDelete}
          >
            <Icon name="trash" size="small" />
            {i18n.t("ui.responseAnnotation.deleteAction")}
          </button>
          <Show when={props.onBackToSource}>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-12-medium text-text-weak hover:bg-background-stronger hover:text-text-strong"
              aria-label={copy().source}
              onClick={props.onBackToSource}
            >
              <Icon name="open-file" size="small" />
              {i18n.t("ui.responseAnnotation.sourceAction")}
            </button>
          </Show>
        </div>
      </div>
    </article>
  )
}

export function ResponseAnnotationHistoryList(props: { annotations: ResponseAnnotationView[] }) {
  const i18n = useI18n()
  const copy = () => responseAnnotationCopy(i18n.t, props.annotations.length, 1)
  return (
    <div data-component="response-annotation-history-list" class="my-2 inline-flex flex-col items-end">
      <HoverCard openDelay={0} closeDelay={120} placement="top-end" gutter={8} overflowPadding={16} fitViewport>
        <HoverCard.Trigger
          as="button"
          type="button"
          data-component="response-annotation-history-trigger"
          class="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-raised-base px-2.5 text-12-medium text-text-base shadow-sm transition-colors hover:bg-surface-raised-base-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
          aria-label={copy().openCount}
        >
          <Icon name="comment" size="small" class="text-icon-weak" />
          <span>{copy().count}</span>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            data-component="response-annotation-history-details"
            aria-label={copy().openCount}
            class={responseAnnotationDetailsClass}
          >
            <For each={props.annotations}>{(annotation) => <ResponseAnnotationDetail annotation={annotation} />}</For>
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard>
    </div>
  )
}

export function ResponseAnnotationReference(props: {
  annotation: ResponseAnnotationView
  onBackToSource?: (annotation: ResponseAnnotationView) => void
}) {
  const i18n = useI18n()
  const hoverID = createUniqueId()
  return (
    <span
      data-component="response-annotation-reference"
      data-response-annotation-directive={`:bluedcode-annotation{index="${props.annotation.index}"}`}
      style={{ color: "var(--v2-text-text-accent, var(--blue-dark-10, #389eff))" }}
    >
      <HoverCard openDelay={0} closeDelay={120} placement="top" gutter={8} overflowPadding={16} fitViewport>
        <HoverCard.Trigger
          as="span"
          tabIndex={0}
          data-slot="response-annotation-hover-trigger"
          aria-label={i18n.t("ui.responseAnnotation.open", { index: props.annotation.index })}
          aria-describedby={hoverID}
          class="inline-flex items-center rounded-sm px-0.5 font-medium text-inherit underline decoration-current underline-offset-2 hover:bg-background-stronger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
        >
          {i18n.t("ui.responseAnnotation.reference", { index: props.annotation.index })}
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            id={hoverID}
            data-slot="response-annotation-hover-details"
            class={responseAnnotationDetailsClass}
          >
            <ResponseAnnotationDetail annotation={props.annotation} />
          </HoverCard.Content>
        </HoverCard.Portal>
      </HoverCard>
    </span>
  )
}

const responseAnnotationDetailsClass =
  "z-50 flex max-h-[min(360px,50vh)] w-[min(380px,calc(100vw-56px))] flex-col gap-1 overflow-y-auto rounded-xl bg-surface-raised-base px-3 shadow-lg outline-none"

function ResponseAnnotationDetail(props: { annotation: ResponseAnnotationView }) {
  const i18n = useI18n()
  return (
    <article
      data-component="response-annotation-detail"
      data-annotation-index={props.annotation.index}
      class="grid grid-cols-[20px_minmax(0,1fr)] gap-2 py-3"
    >
      <span data-slot="response-annotation-detail-index" class="text-right text-12-medium text-text-weak">
        {props.annotation.index}.
      </span>
      <div class="min-w-0">
        <blockquote class="whitespace-pre-wrap break-words text-13-regular text-text-base">
          {props.annotation.context.selected}
        </blockquote>
        <p class="mt-1 whitespace-pre-wrap break-words text-13-regular text-text-strong">
          {props.annotation.comment || i18n.t("ui.responseAnnotation.empty")}
        </p>
      </div>
    </article>
  )
}
