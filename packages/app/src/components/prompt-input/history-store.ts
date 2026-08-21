import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import type { Prompt } from "@/context/prompt"
import { Persist, persisted } from "@/utils/persist"
import type { ServerScope } from "@/utils/server-scope"
import {
  clonePromptHistoryComments,
  clonePromptHistoryResponseAnnotations,
  clonePromptParts,
  prependHistoryEntry,
  normalizePromptHistoryEntry,
  promptHistoryEntryKey,
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

export type PromptInputHistoryScope = {
  server: ServerScope
  directory: string
  sessionID: string
}

export function mergeScopedResponseAnnotationHistory(
  entries: PromptHistoryStoredEntry[],
  scoped: PromptHistoryStoredEntry[],
) {
  const annotations = new Map<string, PromptHistoryResponseAnnotation[][]>()
  scoped.forEach((entry) => {
    const value = normalizePromptHistoryEntry(entry)
    const key = promptHistoryEntryKey(value)
    annotations.set(key, [...(annotations.get(key) ?? []), value.responseAnnotations])
  })
  return entries.map((entry) => {
    const value = normalizePromptHistoryEntry(entry)
    const restored = annotations.get(promptHistoryEntryKey(value))?.shift() ?? []
    return { ...value, responseAnnotations: clonePromptHistoryResponseAnnotations(restored) }
  })
}

export function stripResponseAnnotationsFromGlobalHistory(entries: PromptHistoryStoredEntry[]) {
  return entries.map((entry) => ({ ...normalizePromptHistoryEntry(entry), responseAnnotations: [] }))
}

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

export function createPersistedPromptInputHistory(scope?: PromptInputHistoryScope) {
  const [normal, setNormal, normalInit] = persisted(
    Persist.prompt(Persist.global("prompt-history", ["prompt-history.v1"])),
    createStore<PromptHistoryState>({ entries: [] }),
  )
  const [shell, setShell, shellInit] = persisted(
    Persist.prompt(Persist.global("prompt-history-shell", ["prompt-history-shell.v1"])),
    createStore<PromptHistoryState>({ entries: [] }),
  )
  const [scoped, setScoped, scopedInit] = scope
    ? persisted(
        Persist.prompt(
          Persist.serverSession(scope.server, scope.directory, scope.sessionID, "prompt-history-annotations"),
        ),
        createStore<PromptHistoryState>({ entries: [] }),
      )
    : ([...createStore<PromptHistoryState>({ entries: [] }), undefined] as const)
  const sanitizeGlobal = () => {
    if (!normal.entries.some((entry) => normalizePromptHistoryEntry(entry).responseAnnotations.length > 0)) return
    setNormal("entries", stripResponseAnnotationsFromGlobalHistory(normal.entries))
  }
  if (normalInit instanceof Promise) void normalInit.then(sanitizeGlobal)
  else sanitizeGlobal()
  const global = createPromptInputHistoryStore(normal, setNormal, shell, setShell)
  return {
    entries(mode: "normal" | "shell") {
      if (mode === "shell") return global.entries(mode)
      return mergeScopedResponseAnnotationHistory(global.entries(mode), scoped.entries)
    },
    add(
      prompt: Prompt,
      mode: "normal" | "shell",
      comments: PromptHistoryComment[],
      responseAnnotations: PromptHistoryResponseAnnotation[] = [],
    ) {
      const save = () => {
        global.add(prompt, mode, comments, [])
        if (mode === "shell" || responseAnnotations.length === 0 || !scope) return
        const next = prependHistoryEntry(scoped.entries, prompt, comments, responseAnnotations)
        if (next !== scoped.entries) setScoped("entries", next)
      }
      const ready = mode === "shell" ? shellInit : Promise.all([normalInit, scopedInit])
      if (!(ready instanceof Promise)) return save()
      const saved = clonePromptParts(prompt)
      const metadata = clonePromptHistoryComments(comments)
      const annotations = clonePromptHistoryResponseAnnotations(responseAnnotations)
      void ready.then(() => {
        global.add(saved, mode, metadata, [])
        if (mode === "shell" || annotations.length === 0 || !scope) return
        const next = prependHistoryEntry(scoped.entries, saved, metadata, annotations)
        if (next !== scoped.entries) setScoped("entries", next)
      })
    },
  }
}
