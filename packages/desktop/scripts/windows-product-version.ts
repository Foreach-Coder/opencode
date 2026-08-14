import { readFile, writeFile } from "node:fs/promises"
import { NtExecutable, NtExecutableResource, Resource } from "resedit"

export async function setWindowsProductVersion(file: string, version: string) {
  const executable = NtExecutable.from(await readFile(file))
  const resources = NtExecutableResource.from(executable)
  const info = Resource.VersionInfo.fromEntries(resources.entries)[0] ?? Resource.VersionInfo.createEmpty()
  const languages = info.getAllLanguagesForStringValues()
  const targetLanguages = languages.length ? languages : [{ lang: 0x0409, codepage: 1200 }]
  targetLanguages.forEach((language) => info.setStringValues(language, { ProductVersion: version }))
  info.outputToResourceEntries(resources.entries)
  resources.outputResource(executable)
  await writeFile(file, Buffer.from(executable.generate()))
}
