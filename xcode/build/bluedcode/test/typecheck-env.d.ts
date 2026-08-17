declare module "node:crypto" {
  export const createHash: any
}

declare module "node:fs/promises" {
  export const cp: any
  export const lstat: any
  export const mkdir: any
  export const readdir: any
  export const readFile: any
  export const realpath: any
  export const rename: any
  export const rm: any
  export const unlink: any
  export const writeFile: any
}

declare module "node:path" {
  const path: any
  export default path
}

declare module "node:zlib" {
  export const constants: any
  export const deflateSync: any
  export const inflateSync: any
}

declare const Bun: any
declare const Buffer: any
declare const crypto: { randomUUID(): string }
declare const process: any
type Buffer = Uint8Array

declare namespace Bun {
  type BuildArtifact = any
  type BuildMessage = any
  type BuildOutput = any
}

declare namespace NodeJS {
  interface ErrnoException extends Error {
    code?: string
  }
}

interface ImportMeta {
  dir: string
}
