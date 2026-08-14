# Product build inputs

构建品牌所需的配置和视觉输入统一保存在本目录，不依赖项目外路径。每个二级目录代表一个品牌，并直接包含该品牌的配置和资源：

- `foreachcode/brand.json`（prod）、`dev.json`、`app-icon.svg`、`wordmark.svg`、`tui.json`；
- `fkgcode/brand.json`、`app-icon.svg`、`wordmark.svg`、`tui.json`。
- `bluedcode/brand.json`、`app-icon.svg`、`app-icon.png`、`wordmark.svg`、`tui.json`。

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

本目录只保存构建输入。生成的临时文件和可运行产物仍写入 Git 忽略的 `dist/product-build/`。
