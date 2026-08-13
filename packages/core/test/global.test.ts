import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { xdgCache, xdgConfig, xdgData, xdgState } from "xdg-basedir"
import { Global } from "@opencode-ai/core/global"
import { Brand } from "@opencode-ai/brand"

describe("global paths", () => {
  test("uses the product directory for global state", () => {
    expect(Global.Path.data).toBe(path.join(xdgData!, Brand.directory))
    expect(Global.Path.cache).toBe(path.join(xdgCache!, Brand.directory))
    expect(Global.Path.config).toBe(path.join(xdgConfig!, Brand.directory))
    expect(Global.Path.state).toBe(path.join(xdgState!, Brand.directory))
  })

  test("tmp path is under the system temp directory", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), Brand.directory))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })
})
