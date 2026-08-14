import path from "node:path"

export async function loadModelsSnapshot(source: string | undefined) {
  if (!source) throw new Error("MODELS_DEV_API_JSON must point to a trusted offline models snapshot")
  const target = path.resolve(source)
  const file = Bun.file(target)
  if (!(await file.exists())) throw new Error(`Models snapshot does not exist: ${target}`)
  const content = await file.text()
  const value: unknown = await file.json().catch(() => undefined)
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Models snapshot must be a valid JSON object: ${target}`)
  }
  return content
}
