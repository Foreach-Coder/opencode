import type { ResponseAnnotation } from "@opencode-ai/core/session/response-annotation"
import { render } from "solid-js/web"
import { ResponseAnnotationReference } from "./response-annotation"
import { responseAnnotationForPlaceholder } from "./message-annotation"

export class AnnotationReferenceMounts {
  private owners = new Map<HTMLElement, VoidFunction>()

  mount(
    root: Element,
    annotations: ResponseAnnotation[],
    token: string,
    onBackToSource?: (annotation: ResponseAnnotation) => void,
    sourceAvailable?: (annotation: ResponseAnnotation) => boolean,
  ) {
    root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
      const annotation = responseAnnotationForPlaceholder(anchor.getAttribute("href") ?? "", annotations, token)
      if (!annotation) return
      const host = document.createElement("span")
      host.dataset.annotationReferenceHost = ""
      host.style.display = "inline"
      anchor.replaceWith(host)
      this.owners.set(
        host,
        render(
          () => (
            <ResponseAnnotationReference
              annotation={annotation}
              onBackToSource={
                onBackToSource && (sourceAvailable?.(annotation) ?? true)
                  ? () => onBackToSource(annotation)
                  : undefined
              }
            />
          ),
          host,
        ),
      )
    })
  }

  clear(root: Element) {
    const hosts = [
      ...(root instanceof HTMLElement && root.dataset.annotationReferenceHost !== undefined ? [root] : []),
      ...root.querySelectorAll<HTMLElement>("[data-annotation-reference-host]"),
    ]
    hosts.forEach((host) => {
      this.owners.get(host)?.()
      this.owners.delete(host)
    })
  }
}
