#!/usr/bin/env bun

import { Brand } from "../packages/brand/src"

export function publish() {
  throw new Error(`${Brand.name} internal publish destination is not configured`)
}

if (import.meta.main) {
  try {
    publish()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
