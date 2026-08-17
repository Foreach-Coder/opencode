import type { TransformResult, TransformRule } from "./transform/types"
import type { BuildIdentity } from "./types"

export type BuildStage = "server" | "main" | "preload" | "renderer"

export type ModuleContract = {
  id: string
  file: string
  stage: BuildStage
  fingerprint: string
  rules: readonly TransformRule[]
}

export type BuildTarget = Pick<ModuleContract, "id" | "file" | "stage"> & { moduleId: string }

export type ContractAdapter = {
  modules: readonly ModuleContract[]
  transform(file: string, code: string, identity: BuildIdentity, stage?: BuildStage): TransformResult
}

export function deriveBuildTargets(adapter: Pick<ContractAdapter, "modules">): readonly BuildTarget[] {
  const ids = new Set<string>()
  const files = new Set<string>()
  return adapter.modules.map((module) => {
    if (ids.has(module.id)) throw new Error(`ModuleContract id 重复: ${module.id}`)
    if (files.has(`${module.stage}:${module.file}`)) throw new Error(`ModuleContract stage/file 重复: ${module.stage}:${module.file}`)
    if (!/^[a-f0-9]{64}$/.test(module.fingerprint)) throw new Error(`ModuleContract fingerprint 无效: ${module.id}`)
    ids.add(module.id)
    files.add(`${module.stage}:${module.file}`)
    return { id: module.id, moduleId: module.id, file: module.file, stage: module.stage }
  })
}

export function deriveFingerprints(adapter: Pick<ContractAdapter, "modules">): Readonly<Record<string, string>> {
  return Object.fromEntries(adapter.modules.map((module) => [module.file, module.fingerprint]))
}

export function deriveRequiredBuildTargets(adapter: Pick<ContractAdapter, "modules">) {
  const targets = deriveBuildTargets(adapter)
  return {
    main: targets.filter((target) => target.stage === "main").map((target) => target.file),
    preload: targets.filter((target) => target.stage === "preload").map((target) => target.file),
    renderer: targets.filter((target) => target.stage === "renderer").map((target) => target.file),
  } as const
}

export function findModule(adapter: Pick<ContractAdapter, "modules">, file: string, stage?: BuildStage) {
  return adapter.modules.find((module) => module.file === file && (!stage || module.stage === stage))
}
