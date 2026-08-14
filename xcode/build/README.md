# Product build inputs

构建品牌所需的配置和视觉输入统一保存在本目录，不依赖项目外路径。每个二级目录代表一个品牌，并直接包含该品牌的配置和资源：

- `foreachcode/brand.json`（prod）、`dev.json`、`app-icon.svg`、`wordmark.svg`、`tui.json`；
- `fkgcode/brand.json`、`app-icon.svg`、`wordmark.svg`、`tui.json`。
- `bluedcode/brand.json`、`app-icon.svg`、`app-icon.png`、`wordmark.svg`、`tui.json`。

构建清单可以显式提供 `release`，格式为 `YYMMDD-NN`，例如 `260814-01`。字段缺失或为空字符串时，构建脚本自动使用构建机器的本地日期和当前 Git `HEAD` 的短提交号生成 `YYMMDD-<shortCommitId>`。构建会将发行号与仓库基础版本组合，例如 `1.17.9-260814-01` 或 `1.17.9-260814-a1b2c3d`。

构建 FKGCODE：

```text
bun run product:build --brand-config xcode/build/fkgcode/brand.json
```

构建 ForeachCode prod：

```text
bun run product:build --brand-config xcode/build/foreachcode/brand.json
```

构建 BluedCode prod：

```text
bun run product:build --brand-config xcode/build/bluedcode/brand.json
```

本目录只保存构建输入。生成的临时文件和可运行产物写入 Git 忽略的 `dist/product-build/<slug>/<channel>/<release>/`，不同发行不会互相覆盖。
