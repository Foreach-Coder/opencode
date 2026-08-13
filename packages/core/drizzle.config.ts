import { Brand } from "@opencode-ai/brand"
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"],
  out: "./migration",
  dbCredentials: {
    url: `/home/thdxr/.local/share/${Brand.directory}/${Brand.database}`,
  },
})
