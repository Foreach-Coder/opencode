import type { UiI18nKey, UiI18nParams } from "@opencode-ai/ui/context/i18n"

export type ResponseAnnotationView = {
  id?: string
  index: number
  context: {
    selected: string
  }
  comment: string
}

type Translate = (key: UiI18nKey, params?: UiI18nParams) => string

export function responseAnnotationCopy(t: Translate, count: number, index: number) {
  const category = count === 1 ? "one" : "other"
  return {
    count: t(`ui.responseAnnotation.count.${category}`, { count }),
    openCount: t(`ui.responseAnnotation.openCount.${category}`, { count }),
    reference: t("ui.responseAnnotation.reference", { index }),
    open: t("ui.responseAnnotation.open", { index }),
    details: t("ui.responseAnnotation.details", { index }),
    comment: t("ui.responseAnnotation.comment", { index }),
    empty: t("ui.responseAnnotation.empty"),
    edit: t("ui.responseAnnotation.edit", { index }),
    delete: t("ui.responseAnnotation.delete", { index }),
    source: t("ui.responseAnnotation.source", { index }),
  }
}

export function responseAnnotationDraftActions(
  annotation: ResponseAnnotationView,
  callbacks: {
    onSave: (id: string, comment: string) => void
    onDelete: (id: string) => void
    onBackToSource?: (annotation: ResponseAnnotationView) => void
  },
) {
  const id = annotation.id ?? String(annotation.index)
  return {
    onSave: (comment: string) => callbacks.onSave(id, comment),
    onDelete: () => callbacks.onDelete(id),
    onBackToSource: callbacks.onBackToSource ? () => callbacks.onBackToSource?.(annotation) : undefined,
  }
}

export function responseAnnotationEditorKeyDown(
  event: KeyboardEvent,
  onSave: VoidFunction,
  onCancel: VoidFunction,
) {
  if (event.isComposing || event.keyCode === 229) return
  event.stopPropagation()
  if (event.key === "Escape") {
    event.preventDefault()
    onCancel()
    return
  }
  if (event.key !== "Enter" || event.shiftKey) return
  event.preventDefault()
  onSave()
}
