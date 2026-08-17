import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Product, deriveChannelIdentity } from "../../../../packages/product/src"
import { resolveBuildIdentity } from "../common/config"
import type { Git } from "../common/git"
import { adapter11818 } from "../version/1.18.18"
import { baseline } from "../version/1.18.18/baseline"

const commit = "0123456789abcdef0123456789abcdef01234567"

test("build identity and adapter digest are derived from the source Product Profile", async () => {
  const identity = await resolveBuildIdentity({ channel: "prod", release: "260816-01" }, gitFixture(), baseline)
  const product = deriveChannelIdentity(Product.profile, "prod")

  expect(identity).toMatchObject({
    name: product.displayName,
    appId: product.appId,
    protocol: product.protocol,
    version: "1.18.18-260816-01-0123456789",
  })
  expect(adapter11818.productProfileSha256).toBe(createHash("sha256").update(JSON.stringify(Product.profile)).digest("hex"))
  expect(await readFile(new URL("../common/config.ts", import.meta.url), "utf8")).toContain('packages/product/src')
  expect(await readFile(new URL("../version/1.18.18/index.ts", import.meta.url), "utf8")).toContain('packages/product/src')
})

function gitFixture(): Git {
  return {
    async run(args) {
      const command = args.join(" ")
      return {
        exitCode: 0,
        stdout:
          command === "rev-parse HEAD"
            ? `${commit}\n`
            : command === "rev-parse --short=10 HEAD"
              ? `${commit.slice(0, 10)}\n`
              : command === "show HEAD:packages/desktop/package.json"
                ? '{"version":"1.18.18"}\n'
                : "",
        stderr: "",
      }
    },
  }
}
