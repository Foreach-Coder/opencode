import ts from "typescript"
import { applyVersionEdits, collect, parse, removeNode, requireCount } from "./ast"

const timelineFile = "packages/app/src/pages/session/timeline/message-timeline.tsx"

export const enterpriseShareUiTargets = [timelineFile] as const

export function transformEnterpriseShareUi(file: string, code: string) {
  if (file !== timelineFile) return { code, records: [] }
  const source = parse(timelineFile, code)
  const menu = requireCount(
    "企业分享菜单入口",
    collect(source, ts.isJsxElement).filter(
      (node) =>
        node.openingElement.tagName.getText(source) === "MenuV2.Item" &&
        node.getText(source).includes("session.share.action.share"),
    ),
  )[0]
  const popover = requireCount(
    "企业分享弹层入口",
    collect(source, ts.isJsxElement).filter(
      (node) =>
        node.openingElement.tagName.getText(source) === "KobaltePopover" &&
        node.getText(source).includes("session.share.popover.title"),
    ),
  )[0]
  return applyVersionEdits(
    timelineFile,
    code,
    [removeNode(source, menu, "企业分享菜单入口"), removeNode(source, popover, "企业分享弹层入口")],
    "enterprise.share.timeline-controls-disabled",
  )
}
