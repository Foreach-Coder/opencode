export type TransformRule = {
  id: string
  file: string
  kind: "ts-string" | "ts-remove-property" | "ts-remove-call" | "html-attribute" | "html-text" | "exact-text"
  selector: string
  from: string
  to?: string
  expected: number
  classification: "product" | "entrypoint" | "preserved"
  reason: string
}

export type TransformInput = {
  file: string
  code: string
}

export type TransformRecord = {
  id: string
  file: string
  hits: number
  before: string
  after: string
}

export type TransformResult = {
  code: string
  records: TransformRecord[]
}

export type Replacement = {
  start: number
  end: number
  text: string
}

export type RuleTransform = {
  hits: number
  replacements: Replacement[]
}
