import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { Brand } from "@opencode-ai/brand"

const database = process.env.OPENCODE_DB
const disableChannel = process.env.OPENCODE_DISABLE_CHANNEL_DB

afterEach(() => {
  if (database === undefined) delete process.env.OPENCODE_DB
  else process.env.OPENCODE_DB = database
  if (disableChannel === undefined) delete process.env.OPENCODE_DISABLE_CHANNEL_DB
  else process.env.OPENCODE_DISABLE_CHANNEL_DB = disableChannel
})

describe("database path", () => {
  test("uses the product filename for the default database", () => {
    delete process.env.OPENCODE_DB
    process.env.OPENCODE_DISABLE_CHANNEL_DB = "1"
    expect(Database.path()).toBe(path.join(Global.Path.data, Brand.database))
  })

  test("uses the product prefix for channel databases", () => {
    delete process.env.OPENCODE_DB
    delete process.env.OPENCODE_DISABLE_CHANNEL_DB
    expect(path.basename(Database.path())).toMatch(new RegExp(`^${Brand.slug}-[a-zA-Z0-9._-]+\\.db$`))
  })
})
