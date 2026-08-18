import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import type { Prompt } from "@/context/prompt"
import { Persist, persisted } from "@/utils/persist"
import {
  clonePromptHistoryComments,
  clonePromptHistoryResponseAnnotations,
  clonePromptParts,
  prependHistoryEntry,
  type PromptHistoryComment,
  type PromptHistoryResponseAnnotation,
  type PromptHistoryStoredEntry,
} from "./history"

export type PromptInputHistory = {
  entries: (mode: "normal" | "shell") => PromptHistoryStoredEntry[]
  add: (
    prompt: Prompt,
    mode: "normal" | "shell",
    comments: PromptHistoryComment[],
    responseAnnotations?: PromptHistoryResponseAnnotation[],
  ) => void
}

type PromptHistoryState = { entries: PromptHistoryStoredEntry[] }

function createPromptInputHistoryStore(
  normal: Store<PromptHistoryState>,
  setNormal: SetStoreFunction<PromptHistoryState>,
  shell: Store<PromptHistoryState>,
  setShell: SetStoreFunction<PromptHistoryState>,
): PromptInputHistory {
  return {
    entries: (mode) => (mode === "shell" ? shell.entries : normal.entries),
    add(prompt, mode, comments, responseAnnotations = []) {
      const current = mode === "shell" ? shell : normal
      const setCurrent = mode === "shell" ? setShell : setNormal
      const next = prependHistoryEntry(current.entries, prompt, comments, mode === "shell" ? [] : responseAnnotations)
      if (next === current.entries) return
      setCurrent("entries", next)
    },
  }
}

export function createPromptInputHistory(): PromptInputHistory {
  const [normal, setNormal] = createStore<PromptHistoryState>({ entries: [] })
  const [shell, setShell] = createStore<PromptHistoryState>({ entries: [] })
  return createPromptInputHistoryStore(normal, setNormal, shell, setShell)
}

export function createPersistedPromptInputHistory() {
  const [normal, setNormal, normalInit] = persisted(
    Persist.prompt(Persist.global("prompt-history", ["prompt-history.v1"])),
    createStore<PromptHistoryState>({ entries: [] }),
  )
  const [shell, setShell, shellInit] = persisted(
    Persist.prompt(Persist.global("prompt-history-shell", ["prompt-history-shell.v1"])),
    createStore<PromptHistoryState>({ entries: [] }),
  )
  const history = createPromptInputHistoryStore(normal, setNormal, shell, setShell)
  return {
    ...history,
    add(
      prompt: Prompt,
      mode: "normal" | "shell",
      comments: PromptHistoryComment[],
      responseAnnotations: PromptHistoryResponseAnnotation[] = [],
    ) {
      const ready = mode === "shell" ? shellInit : normalInit
      if (!(ready instanceof Promise)) return history.add(prompt, mode, comments, responseAnnotations)
      const saved = clonePromptParts(prompt)
      const metadata = clonePromptHistoryComments(comments)
      const annotations = clonePromptHistoryResponseAnnotations(responseAnnotations)
      void ready.then(() => history.add(saved, mode, metadata, annotations))
    },
  }
}
