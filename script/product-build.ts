import { resolveBrand, type BrandInput } from "../packages/brand/src/config"
import { resolveVisuals } from "../packages/brand/src/visual"
import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"

type ProductBuildEnvironment = {
  MODELS_DEV_API_JSON?: string
  PRODUCT_BRAND_CONFIG?: string
}

type ProductBuildOptions = {
  args?: string[]
  env?: ProductBuildEnvironment
  root?: string
}

type PreparedProductBuild = Awaited<ReturnType<typeof prepareProductBuild>>
type ProductBuildCommand = {
  args: string[]
  cwd: string
  env: Record<string, string>
}

type SourceTreeSnapshot = {
  status: string
  index: string
  worktree: ReadonlyArray<readonly [string, string]>
}

const channels = ["dev", "beta", "prod"] as const

export async function resolveProductBuild(options: ProductBuildOptions = {}) {
  const flags = parseFlags(options.args ?? Bun.argv.slice(2))
  const env = options.env ?? process.env
  const root = path.resolve(options.root ?? path.resolve(import.meta.dir, ".."))
  const configSource = flags["brand-config"] ?? env.PRODUCT_BRAND_CONFIG
  if (!configSource) throw new Error("Product build requires --brand-config <path>")
  const configPath = path.resolve(root, configSource)
  const file = Bun.file(configPath)
  if (!(await file.exists())) throw new Error(`Product brand config does not exist: ${configPath}`)
  const manifest = requireManifest(await file.json())
  const brand = resolveBrand({ cli: manifest })
  if (!channels.includes(brand.channel)) throw new Error(`Invalid product channel: ${brand.channel}`)
  const directory = path.dirname(configPath)

  return Object.freeze({
    brand,
    channel: brand.channel,
    configPath,
    visuals: Object.freeze({
      wordmarkSvg: path.resolve(directory, manifest.wordmarkSvg),
      appIconSvg: path.resolve(directory, manifest.appIconSvg),
      tuiWordmarkGrid: path.resolve(directory, manifest.tuiWordmarkGrid),
    }),
  })
}

export async function prepareProductBuild(options: ProductBuildOptions = {}) {
  const root = path.resolve(options.root ?? path.resolve(import.meta.dir, ".."))
  const resolved = await resolveProductBuild(options)
  const stage = path.join(root, "dist", "product-build", resolved.brand.slug, resolved.channel)
  const buildRoot = path.join(root, "dist", "product-build")
  if (path.relative(buildRoot, stage).startsWith("..")) throw new Error(`Unsafe product build staging path: ${stage}`)
  const modelsSnapshot = path.resolve(
    options.env?.MODELS_DEV_API_JSON ??
      process.env.MODELS_DEV_API_JSON ??
      path.join(root, "packages", "opencode", "test", "tool", "fixtures", "models-api.json"),
  )
  const modelsFile = Bun.file(modelsSnapshot)
  if (!(await modelsFile.exists())) {
    throw new Error(
      `Product build requires an offline models snapshot. Set MODELS_DEV_API_JSON to a trusted api.json file; no public network fallback is used. Missing: ${modelsSnapshot}`,
    )
  }
  const models: unknown = await modelsFile.json().catch(() => undefined)
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    throw new Error(`Offline models snapshot must contain a JSON object: ${modelsSnapshot}`)
  }

  await rm(stage, { recursive: true, force: true })
  await mkdir(path.join(stage, "renderer"), { recursive: true })
  const visuals = await resolveVisuals(
    {
      wordmarkSvg: resolved.visuals.wordmarkSvg,
      appIconSvg: resolved.visuals.appIconSvg,
      tuiWordmarkGrid: resolved.visuals.tuiWordmarkGrid,
    },
    {
      name: resolved.brand.name,
      stagingDirectory: path.join(stage, "visuals"),
      defaultProfile: "manifest",
      profiles: {
        manifest: {
          wordmarkSvg: resolved.visuals.wordmarkSvg,
          appIconSvg: resolved.visuals.appIconSvg,
          tuiWordmarkGrid: resolved.visuals.tuiWordmarkGrid,
        },
      },
    },
  )
  await mkdir(path.join(stage, "resources", "icons"), { recursive: true })
  await Bun.write(path.join(stage, "resources", "icons", "app-icon.svg"), Bun.file(visuals.appIcon.path))
  const publicSource = path.join(root, "packages", "app", "public")
  const publicTarget = path.join(stage, "public")
  if (await Bun.file(path.join(publicSource, "oc-theme-preload.js")).exists()) {
    await cp(publicSource, publicTarget, { recursive: true })
    await Promise.all(
      [
        "favicon.svg",
        "favicon-v3.svg",
        "favicon.ico",
        "favicon-v3.ico",
        "favicon-96x96.png",
        "favicon-96x96-v3.png",
        "apple-touch-icon.png",
        "apple-touch-icon-v3.png",
        "web-app-manifest-192x192.png",
        "web-app-manifest-512x512.png",
      ].map((file) => rm(path.join(publicTarget, file), { force: true })),
    )
  } else {
    await mkdir(publicTarget, { recursive: true })
  }
  const themePreload = path.join(publicTarget, "oc-theme-preload.js")
  if (await Bun.file(themePreload).exists()) {
    await Bun.write(
      themePreload,
      (await Bun.file(themePreload).text()).replace(
        /\/\/ brand:start[\s\S]*?\/\/ brand:end/,
        `// brand:start\n  var productSlug = ${JSON.stringify(resolved.brand.slug)}\n  // brand:end`,
      ),
    )
  }
  await Bun.write(path.join(publicTarget, "app-icon.svg"), Bun.file(visuals.appIcon.path))
  await Bun.write(
    path.join(publicTarget, "site.webmanifest"),
    JSON.stringify({
      name: resolved.brand.name,
      short_name: resolved.brand.name,
      icons: [{ src: "./app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable any" }],
      theme_color: "#ffffff",
      background_color: "#ffffff",
      display: "standalone",
    }),
  )
  await Bun.write(path.join(stage, "brand.json"), JSON.stringify({ brand: resolved.brand, visuals }, null, 2) + "\n")

  const html = await Bun.file(path.join(root, "packages", "desktop", "src", "renderer", "index.html")).text()
  await Bun.write(
    path.join(stage, "renderer", "index.html"),
    html.replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(resolved.brand.name)}</title>`),
  )

  const manifest = await Bun.file(path.join(root, "packages", "opencode", "package.json")).json()
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error("packages/opencode/package.json must declare a valid product version")
  }
  await Bun.write(
    path.join(stage, "package.json"),
    JSON.stringify({ ...manifest, bin: { [resolved.brand.cli]: "./bin/opencode" } }, null, 2) + "\n",
  )
  await Promise.all(
    [
      [path.join(root, "packages", "opencode", "bin", "opencode"), path.join(stage, "bin", "opencode")],
      [path.join(root, "packages", "opencode", "script", "postinstall.mjs"), path.join(stage, "postinstall.mjs")],
      [path.join(root, "install"), path.join(stage, "install")],
      [path.join(root, "packages", "opencode", "Dockerfile"), path.join(stage, "Dockerfile")],
      [path.join(root, "nix", "opencode.nix"), path.join(stage, "nix", "product.nix")],
    ].map(async ([source, target]) => {
      await mkdir(path.dirname(target), { recursive: true })
      await Bun.write(target, renderDistributionTemplate(await Bun.file(source).text(), resolved.brand))
    }),
  )

  return Object.freeze({
    ...resolved,
    visuals,
    visualPayload: Object.freeze({
      wordmarkSvg: await Bun.file(visuals.wordmark.path).text(),
      appIconSvg: await Bun.file(visuals.appIcon.path).text(),
      tuiWordmarkGrid: Object.freeze({
        width: visuals.tuiWordmark.width,
        height: visuals.tuiWordmark.height,
        cells: visuals.tuiWordmark.cells,
      }),
    }),
    root,
    stage,
    modelsSnapshot,
    version: manifest.version,
  })
}

export function createProductBuildCommands(build: PreparedProductBuild): ProductBuildCommand[] {
  const env = {
    PRODUCT_BRAND_JSON: JSON.stringify(build.brand),
    PRODUCT_VISUAL_JSON: JSON.stringify(build.visualPayload),
    PRODUCT_BUILD_STAGE: build.stage,
    MODELS_DEV_API_JSON: build.modelsSnapshot,
    OPENCODE_CHANNEL: build.channel,
    OPENCODE_VERSION: build.version,
    VITE_SENTRY_DSN: "",
    SENTRY_AUTH_TOKEN: "",
    SENTRY_ORG: "",
    SENTRY_PROJECT: "",
  }
  return [
    {
      args: [process.execPath, "run", "script/build.ts", "--single", "--skip-install", "--skip-embed-web-ui"],
      cwd: path.join(build.root, "packages", "opencode"),
      env,
    },
    { args: [process.execPath, "run", "build"], cwd: path.join(build.root, "packages", "desktop"), env },
    {
      args: [process.execPath, "run", "package", "--", "--dir"],
      cwd: path.join(build.root, "packages", "desktop"),
      env,
    },
  ]
}

export async function executeProductBuild(
  options: ProductBuildOptions = {},
  runner: (command: ProductBuildCommand) => Promise<void> = run,
) {
  const root = path.resolve(options.root ?? path.resolve(import.meta.dir, ".."))
  const before = await captureSourceTree(root)
  const build = await prepareProductBuild({ ...options, root })
  const prepareOnly = parseFlags(options.args ?? Bun.argv.slice(2))["prepare-only"] === "true"
  if (!prepareOnly) {
    for (const command of createProductBuildCommands(build)) await runner(command)
  }
  await verifySourceTreeUnchanged(root, before)
  return build
}

export async function captureSourceTree(root: string): Promise<SourceTreeSnapshot> {
  const status = git(root, "status", "--porcelain=v2", "--untracked-files=all")
  const index = git(root, "ls-files", "--stage")
  const files = git(root, "ls-files", "--modified", "--others", "--exclude-standard", "-z")
    .split("\0")
    .filter(Boolean)
    .sort()
  const worktree = await Promise.all(
    files.map(async (file) => {
      const source = Bun.file(path.join(root, file))
      return [
        file,
        (await source.exists()) ? Bun.CryptoHasher.hash("sha256", await source.arrayBuffer(), "hex") : "<deleted>",
      ] as const
    }),
  )
  return Object.freeze({ status, index, worktree: Object.freeze(worktree) })
}

export async function verifySourceTreeUnchanged(root: string, before: SourceTreeSnapshot) {
  const after = await captureSourceTree(root)
  if (JSON.stringify(after) === JSON.stringify(before)) return
  throw new Error("Product build modified the source tree")
}

function parseFlags(args: string[]) {
  const result: Record<string, string | undefined> = {}
  for (let index = 0; index < args.length; index++) {
    const current = args[index]
    if (!current?.startsWith("--")) throw new Error(`Unexpected product build argument: ${current}`)
    const [raw, inline] = current.slice(2).split("=", 2)
    if (!raw) throw new Error("Product build option name cannot be empty")
    if (raw !== "brand-config" && raw !== "prepare-only") throw new Error(`Unknown product build option: --${raw}`)
    if (result[raw] !== undefined) throw new Error(`Duplicate product build option: --${raw}`)
    if (raw === "prepare-only" && inline === undefined) {
      result[raw] = "true"
      continue
    }
    const value = inline ?? args[++index]
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${raw}`)
    result[raw] = value
  }
  return result
}

function requireManifest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Product brand config must be an object")
  const allowed = new Set(["name", "slug", "channel", "desktopAppId", "wordmarkSvg", "appIconSvg", "tuiWordmarkGrid"])
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`Unknown product brand config field: ${unknown.join(", ")}`)
  const string = (key: string, required = false) => {
    const item = Reflect.get(value, key)
    if (item === undefined && !required) return
    if (typeof item === "string" && item.length > 0) return item
    throw new Error(`Product brand config field ${key} must be a non-empty string`)
  }
  return Object.freeze({
    name: string("name", true),
    slug: string("slug"),
    channel: string("channel", true),
    desktopAppId: string("desktopAppId"),
    wordmarkSvg: string("wordmarkSvg", true)!,
    appIconSvg: string("appIconSvg", true)!,
    tuiWordmarkGrid: string("tuiWordmarkGrid", true)!,
  }) satisfies BrandInput & { appIconSvg: string; wordmarkSvg: string; tuiWordmarkGrid: string }
}

function git(root: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode === 0) return result.stdout.toString()
  throw new Error(result.stderr.toString())
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function renderDistributionTemplate(source: string, brand: Awaited<ReturnType<typeof resolveProductBuild>>["brand"]) {
  const output = source
    .replaceAll("__PRODUCT_NAME__", brand.name)
    .replaceAll("__PRODUCT_SLUG__", brand.slug)
    .replaceAll("__PRODUCT_CLI__", brand.cli)
    .replaceAll("__PRODUCT_DIRECTORY__", brand.directory)
  if (/__PRODUCT_[A-Z_]+__/.test(output)) throw new Error("Distribution template contains an unresolved product token")
  return output
}

async function run(command: ProductBuildCommand) {
  const child = Bun.spawn(command.args, {
    cwd: command.cwd,
    env: { ...globalThis.process.env, ...command.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exit = await child.exited
  if (exit === 0) return
  throw new Error(`Product build command failed (${exit}): ${command.args.join(" ")}`)
}

async function main() {
  const build = await executeProductBuild()
  console.log(JSON.stringify({ brand: build.brand, channel: build.channel, stage: build.stage }, null, 2))
}

if (import.meta.main) await main()
