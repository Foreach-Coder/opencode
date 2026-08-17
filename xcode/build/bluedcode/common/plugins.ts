import { createHash } from "node:crypto"
import path from "node:path"
import type { Plugin } from "vite"
import type { CacheIsolation } from "./cache"
import type { ModuleContract } from "./adapter"
import { withFailureContext } from "./failure"
import { writeUnifiedLedger, type UnifiedLedgerEvent } from "./ledger"
import type { BuildIdentity } from "./types"
import type { TransformResult } from "./transform/types"

export type BrandBuildTarget = "main" | "preload" | "renderer"

export type BrandAdapter = {
  modules: readonly ModuleContract[]
  fingerprints: Readonly<Record<string, string>>
  productProfileSha256?: string
  transform(file: string, code: string, identity: BuildIdentity, stage?: BrandBuildTarget): TransformResult
}

export type BrandTransformSession = {
  completedTargets: Set<BrandBuildTarget>
  expectedTargets: ReadonlySet<BrandBuildTarget>
  isolation?: CacheIsolation
  ledgerFile?: string
  ledgerRoot?: string
  modules: Map<string, number>
  results: Array<{ target: BrandBuildTarget; result: TransformResult }>
}

export type BrandPluginContext = {
  adapter: BrandAdapter
  identity: BuildIdentity
  isolation: CacheIsolation
  ledgerRoot: string
  repositoryRoot: string
  requiredBuildTargets: readonly string[]
  session: BrandTransformSession
  target: BrandBuildTarget
}

export function createBrandTransformSession(expectedTargets: readonly BrandBuildTarget[]): BrandTransformSession {
  const expected = new Set(expectedTargets)
  if (!expected.size || expected.size !== expectedTargets.length) {
    throw new Error("transform session expectedTargets 必须非空且唯一")
  }
  return { completedTargets: new Set(), expectedTargets: expected, modules: new Map(), results: [] }
}

export function createBrandPlugins(context: BrandPluginContext): Plugin[] {
  if (!context.session.expectedTargets.has(context.target)) {
    throw new Error(`transform session 未声明目标: ${context.target}`)
  }
  bindLedgerCapability(context)
  const required = new Set(context.requiredBuildTargets.map(normalizePath))
  if (required.size !== context.requiredBuildTargets.length) {
    throw new Error(`${context.target} requiredBuildTargets 存在重复路径`)
  }
  for (const file of required) {
    if (!findContract(context, file))
      throw new Error(`${context.target} requiredBuildTargets 未受 adapter 控制: ${file}`)
  }

  return [
    {
      name: "bluedcode:transform",
      enforce: "pre",
      transform(code, id) {
        if (id.includes("?") || id.includes("#")) return null
        const file = controlledFile(context, id)
        if (!file || file.endsWith(".html")) return null
        return applyTransform(context, file, code)
      },
      transformIndexHtml: {
        order: "pre",
        handler(html, htmlContext) {
          const file = htmlContext.filename ? controlledFile(context, htmlContext.filename) : undefined
          if (!file || !file.endsWith(".html")) return html
          return applyTransform(context, file, html).code
        },
      },
      async buildEnd(error) {
        if (error) return
        const modules = moduleEntries(context.session).filter((entry) => entry.target === context.target)
        const missing = [...required].filter((file) => !modules.some((entry) => entry.file === file))
        if (missing.length)
          throw new Error(`${context.target} 品牌转换缺少 requiredBuildTargets: ${missing.join(", ")}`)
        const duplicate = modules.filter((entry) => required.has(entry.file) && entry.transforms !== 1)
        if (duplicate.length) {
          throw new Error(
            `${context.target} requiredBuildTargets 必须恰好转换一次: ${duplicate
              .map((entry) => `${entry.file}=${entry.transforms}`)
              .join(", ")}`,
          )
        }
        const unexpected = modules.filter((entry) => !required.has(entry.file))
        if (unexpected.length) {
          throw new Error(`${context.target} 出现未声明的受控模块: ${unexpected.map((entry) => entry.file).join(", ")}`)
        }
        if (context.session.completedTargets.has(context.target)) {
          throw new Error(`transform session 目标重复完成: ${context.target}`)
        }
        context.session.completedTargets.add(context.target)
        if (context.session.completedTargets.size !== context.session.expectedTargets.size) return
        context.session.ledgerFile = await writeLedger(context)
      },
    },
  ]
}

function applyTransform(context: BrandPluginContext, file: string, code: string) {
  const contract = findContract(context, file)
  const failure = (error: unknown) =>
    withFailureContext(error, {
      stage: context.target,
      code: "CONTROLLED_TRANSFORM_FAILED",
      lastModule: contract?.id ?? null,
      ledgerPath: context.session.ledgerFile ?? null,
      symbolBundlePath: null,
    })
  if (!contract) throw failure(new Error(`${context.target} 未声明受控模块: ${file}`))
  let result: TransformResult
  try {
    result = context.adapter.transform(file, code, context.identity, context.target)
  } catch (error) {
    throw failure(error)
  }
  const key = `${context.target}\0${contract.id}\0${file}`
  context.session.modules.set(key, (context.session.modules.get(key) ?? 0) + 1)
  context.session.results.push({ target: context.target, result })
  return { code: result.code, map: null }
}

function controlledFile(context: BrandPluginContext, id: string) {
  if (!id || id.includes("\0")) return undefined
  const vitePath = process.platform === "win32" && /^\/[A-Za-z]:\//.test(id) ? id.slice(1) : id
  if (!path.isAbsolute(vitePath)) return undefined
  const relative = path.relative(path.resolve(context.repositoryRoot), path.resolve(vitePath))
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined
  }
  const file = normalizePath(relative)
  return findContract(context, file) ? file : undefined
}

function moduleEntries(session: BrandTransformSession) {
  return [...session.modules].map(([key, transforms]) => {
    const [target, moduleId, file] = key.split("\0")
    if (!isBrandBuildTarget(target)) throw new Error(`transform session 目标无效: ${target}`)
    if (!moduleId || !file) throw new Error("transform session 模块键无效")
    return {
      target,
      moduleId,
      file,
      transforms,
    }
  })
}

async function writeLedger(context: BrandPluginContext) {
  const records = context.session.results
    .flatMap(({ target, result }) => result.records.map((record) => ({ target, ...record })))
    .sort((left, right) =>
      `${left.target}:${left.file}:${left.id}`.localeCompare(`${right.target}:${right.file}:${right.id}`),
    )
  const modules = moduleEntries(context.session).sort((left, right) =>
    `${left.target}:${left.file}`.localeCompare(`${right.target}:${right.file}`),
  )
  const events: UnifiedLedgerEvent[] = []
  for (const stage of ["main", "preload", "renderer"] as const) {
    const stageModules = modules.filter((module) => module.target === stage)
    for (const module of stageModules) {
      const matching = records.filter((record) => record.target === stage && record.file === module.file)
      events.push({
        stage,
        moduleId: module.moduleId,
        file: module.file,
        inputSha256: matching[0]?.before ?? createHash("sha256").update(module.file).digest("hex"),
        outputSha256: matching.at(-1)?.after ?? matching[0]?.before ?? createHash("sha256").update(module.file).digest("hex"),
        rules: matching.map((record) => ({ id: record.id, hits: record.hits })),
        productProfileSha256: profileDigest(context),
      })
    }
  }
  return (await writeUnifiedLedger({ isolation: context.isolation, root: context.ledgerRoot, events })).file
}

function findContract(context: BrandPluginContext, file: string) {
  return context.adapter.modules.find((module) => module.stage === context.target && module.file === file)
}

function profileDigest(context: BrandPluginContext) {
  return context.adapter.productProfileSha256 ?? createHash("sha256").update("unconfigured-product-profile").digest("hex")
}

function bindLedgerCapability(context: BrandPluginContext) {
  const ledgerRoot = path.resolve(context.ledgerRoot)
  const isolation = {
    lexicalRoot: path.resolve(context.isolation.lexicalRoot),
    canonicalRoot: path.resolve(context.isolation.canonicalRoot),
  }
  if (context.session.ledgerRoot && context.session.ledgerRoot !== ledgerRoot) {
    throw new Error("transform session ledgerRoot 不一致")
  }
  if (
    context.session.isolation &&
    (context.session.isolation.lexicalRoot !== isolation.lexicalRoot ||
      context.session.isolation.canonicalRoot !== isolation.canonicalRoot)
  ) {
    throw new Error("transform session isolation capability 不一致")
  }
  context.session.ledgerRoot = ledgerRoot
  context.session.isolation = isolation
}

function isBrandBuildTarget(value: string): value is BrandBuildTarget {
  return value === "main" || value === "preload" || value === "renderer"
}

function normalizePath(file: string) {
  return file.replaceAll("\\", "/")
}
