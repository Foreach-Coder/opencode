import { render } from "solid-js/web"
import { PromptInput } from "./prompt-input"
import { PromptInputV2Composer, type PromptInputV2ComposerController } from "./prompt-input-v2"
import { createPromptState, type ResponseAnnotationDraft } from "@/context/prompt"
import { createPromptInputV2State } from "@opencode-ai/session-ui/v2/prompt-input/interaction"

const initial: ResponseAnnotationDraft = {
  id: "draft_1",
  source: {
    sessionID: "ses_1",
    messageID: "msg_1",
    partID: "part_1",
    partDigest: "sha256:digest",
    start: 0,
    end: 8,
  },
  context: { before: "", selected: "selected", after: "" },
  comment: "",
  createdAt: 1,
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function tick() {
  await Promise.resolve()
  await Promise.resolve()
}

export async function promptIntegrationCheck() {
  const prompt = createPromptState()
  prompt.context.addResponseAnnotation(initial)
  const controls = {
    agents: { available: [], options: [], current: "", loading: false, visible: false, select: () => undefined },
    model: {
      selection: { current: () => undefined, variant: { current: () => undefined, list: () => [], set: () => undefined } },
      paid: true,
      loading: false,
    },
    session: {
      id: "ses_1",
      tabs: { active: () => undefined, all: () => [], open: () => undefined, setActive: () => undefined },
      reviewPanel: { opened: () => false, open: () => undefined },
    },
  }
  const interaction = createPromptInputV2State()
  const controller = {
    state: interaction[0],
    model: controls.model,
    view: {
      placeholder: () => "",
      agent: undefined,
      model: undefined,
      variant: undefined,
      submit: { stopping: () => false, working: () => false, onSubmit: () => undefined, onStop: () => undefined },
    },
    responseAnnotations: {
      items: prompt.context.responseAnnotations,
      update: (id: string, comment: string) => prompt.context.updateResponseAnnotation(id, { comment }),
      remove: prompt.context.removeResponseAnnotation,
    },
    parts: () => prompt.current(),
    suggestions: () => [],
    attachments: () => [],
    comments: () => [],
    value: () => "",
    canSubmit: () => false,
    dispatch: () => undefined,
    onCursor: () => undefined,
    setFileInput: () => undefined,
    addAttachments: () => undefined,
    setQuery: () => undefined,
    onKeyDown: () => false,
    submit: () => undefined,
    onDragEnter: () => undefined,
    onDragOver: () => undefined,
    onDragLeave: () => undefined,
    onDrop: () => undefined,
    openAttachment: () => undefined,
    removeAttachment: () => undefined,
    toggleContext: () => undefined,
    removeContext: () => undefined,
    setEditor: () => undefined,
    onInput: () => undefined,
    onPaste: () => undefined,
    attach: () => undefined,
    openCommands: () => undefined,
    openContext: () => undefined,
    openShell: () => undefined,
    stop: () => undefined,
  } as unknown as PromptInputV2ComposerController
  const root = document.createElement("div")
  root.innerHTML = '<div id="v1"></div><div id="v2"></div>'
  document.body.appendChild(root)
  const disposeV1 = render(
    () => (
      <PromptInput
        state={prompt}
        controls={controls}
        history={{ entries: () => [], add: () => undefined } as never}
        submission={{ abort: () => undefined, handleSubmit: async () => undefined }}
      />
    ),
    root.querySelector("#v1")!,
  )
  const disposeV2 = render(() => <PromptInputV2Composer controller={controller} />, root.querySelector("#v2")!)
  try {
    const buttons = root.querySelectorAll<HTMLButtonElement>('[data-component="response-annotation-composer-button"]')
    check(buttons.length === 2, "both prompt layouts must show the annotation count")
    check([...buttons].every((button) => button.textContent === "1 annotation"), "both layouts must show the same count")
    buttons.forEach((button) => button.click())
    check(root.querySelectorAll('[data-component="response-annotation-draft-list"]').length === 2, "both layouts must show details")

    const v1 = root.querySelector("#v1")!
    const v2 = root.querySelector("#v2")!
    v1.querySelectorAll<HTMLButtonElement>('[data-slot="response-annotation-actions"] button')[0]!.click()
    const editor = v1.querySelector<HTMLTextAreaElement>("textarea")!
    editor.value = "updated"
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }))
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await tick()
    check(v2.querySelector('[data-slot="response-annotation-comment"]')?.textContent === "updated", "edits must update both layouts")

    v2.querySelectorAll<HTMLButtonElement>('[data-slot="response-annotation-actions"] button')[1]!.click()
    await tick()
    check(root.querySelectorAll('[data-component="response-annotation-composer-button"]').length === 0, "deletes must update both layouts")
  } finally {
    disposeV1()
    disposeV2()
    root.remove()
  }
}
