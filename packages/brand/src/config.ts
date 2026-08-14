export type BrandChannel = "dev" | "beta" | "prod"

export type BrandInput = {
  name?: string
  slug?: string
  channel?: string
  desktopAppId?: string
}

export type ResolveBrandInput = {
  cli?: BrandInput
}

export type ResolvedBrand = Readonly<{
  name: string
  slug: string
  cli: string
  protocol: string
  directory: string
  database: string
  log: string
  desktopAppId: string
  channel: BrandChannel
  desktop: Readonly<Record<BrandChannel, Readonly<{ name: string; appId: string }>>>
}>

const slugPattern = /^[a-z][a-z0-9-]{1,30}$/
const desktopAppIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){2,}$/

export function resolveBrand(input: ResolveBrandInput = {}): ResolvedBrand {
  const name = requireName(input.cli?.name)
  const slug = requireSlug(input.cli?.slug ?? deriveSlug(name))
  const desktopAppId = requireDesktopAppId(input.cli?.desktopAppId ?? `ai.${slug}.desktop`)
  const channel = requireChannel(input.cli?.channel)

  return Object.freeze({
    name,
    slug,
    cli: slug,
    protocol: slug,
    directory: slug,
    database: `${slug}.db`,
    log: `${slug}.log`,
    desktopAppId,
    channel,
    desktop: Object.freeze({
      dev: Object.freeze({ name: `${name} Dev`, appId: `${desktopAppId}.dev` }),
      beta: Object.freeze({ name: `${name} Beta`, appId: `${desktopAppId}.beta` }),
      prod: Object.freeze({ name, appId: desktopAppId }),
    }),
  })
}

export function parseBrandDefinition(source: string): BrandInput {
  const value: unknown = JSON.parse(source)
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid PRODUCT_BRAND_JSON")
  return {
    name: optionalString(value, "name"),
    slug: optionalString(value, "slug"),
    channel: optionalString(value, "channel"),
    desktopAppId: optionalString(value, "desktopAppId"),
  }
}

export function resolveBrandDefinition(source?: string) {
  if (source === undefined) throw new Error("PRODUCT_BRAND_JSON is required")
  return resolveBrand({ cli: parseBrandDefinition(source) })
}

function optionalString(value: object, key: string) {
  const item = Reflect.get(value, key)
  if (item === undefined) return
  if (typeof item === "string") return item
  throw new Error(`Invalid PRODUCT_BRAND_JSON field: ${key}`)
}

function requireName(value: string | undefined) {
  if (!value || value !== value.trim() || /[\u0000-\u001f\u007f<>&"'\\]/.test(value)) {
    throw new Error(
      "An explicit product name is required and cannot contain surrounding whitespace, control characters, or markup delimiters",
    )
  }
  return value
}

function deriveSlug(name: string) {
  if (/^[A-Za-z0-9]+$/.test(name)) return name.toLowerCase()
  throw new Error(`Product slug is required when name cannot be losslessly derived: ${name}`)
}

function requireSlug(value: string) {
  if (!slugPattern.test(value)) throw new Error(`Invalid product slug: ${value}`)
  return value
}

function requireDesktopAppId(value: string) {
  if (!desktopAppIdPattern.test(value)) throw new Error(`Invalid desktop app ID: ${value}`)
  return value
}

function requireChannel(value: string | undefined) {
  if (value === "dev" || value === "beta" || value === "prod") return value
  if (value === undefined) throw new Error("An explicit product channel is required")
  throw new Error(`Invalid product channel: ${value}`)
}
