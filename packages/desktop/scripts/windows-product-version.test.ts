import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { NtExecutable, NtExecutableResource, Resource } from "resedit"
import { setWindowsProductVersion } from "./windows-product-version"

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("writes the full release into the Windows ProductVersion string", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "product-version-test-"))
  temporary.push(directory)
  const target = path.join(directory, "product.exe")
  const executable = NtExecutable.createEmpty(false, false)
  const resources = NtExecutableResource.from(executable)
  const version = Resource.VersionInfo.createEmpty()
  const language = { lang: 0x0409, codepage: 1200 }
  version.setFileVersion("1.17.9.0")
  version.setProductVersion("1.17.9.0")
  version.setStringValues(language, { FileVersion: "1.17.9", ProductVersion: "1.17.9.0" })
  version.outputToResourceEntries(resources.entries)
  resources.outputResource(executable)
  await writeFile(target, Buffer.from(executable.generate()))

  await setWindowsProductVersion(target, "1.17.9-260814-02")

  const output = NtExecutable.from(await readFile(target))
  const outputResources = NtExecutableResource.from(output)
  const outputVersion = Resource.VersionInfo.fromEntries(outputResources.entries)[0]
  expect(outputVersion?.getStringValues(language).ProductVersion).toBe("1.17.9-260814-02")
})
