# OpenCode 1.17.9 BluedCode 产品品牌落地设计

- 类型：版本级实施规格
- Origin spec：父级根仓 `docs/origin-specs/01-product-branding.md`（`ORIGIN-01`）
- 目标版本：OpenCode `1.17.9`
- 相关提交：`efc966ebb4`、`eaff84fc14`、`bb64a6551c`、`3654f46519`
- 状态：已实现，逆向确认

## 1. 实现目标

在 1.17.9 monorepo 中建立编译期品牌对象，通过隔离暂存构建把 BluedCode 身份注入 App、Desktop、CLI、TUI、SDK、Enterprise 和发行模板，避免在构建过程中修改源码树。

## 2. 构建入口

正式构建入口：

```text
bun run product:build --brand-config xcode/build/bluedcode/brand.json
```

只生成暂存内容：

```text
bun run product:build --brand-config xcode/build/bluedcode/brand.json --prepare-only
```

本地开发包装入口：

```text
bun run script/product-dev.ts <bluedcode-config> -- <development-command>
```

入口由 `script/product-build.ts` 和 `script/product-dev.ts` 实现。参数解析拒绝缺失、重复、未知和无值参数，不提供默认品牌回退。

## 3. 品牌配置和视觉解析

`packages/brand/src/config.ts` 负责解析 `name`、`slug`、`channel`、`desktopAppId`、`enterprise`、`release` 和视觉资源路径，并派生显示名、CLI、协议、数据身份和 Desktop app ID。

`packages/brand/src/visual.ts`、`assets-config.ts` 和 `pixel.ts` 负责：

- 校验 SVG 根节点、viewBox、外部引用和危险元素；
- 校验 App Icon 同目录 PNG 的签名与尺寸，并将其内嵌为 data URI；
- 解析 TUI 点阵并规范化为 `0/1`；
- 计算不包含绝对路径的稳定视觉摘要。

规范输入位于 `xcode/build/bluedcode/`。

## 4. 隔离暂存

`script/product-build.ts` 将解析结果物化到：

```text
dist/product-build/bluedcode/<channel>/<release>/
```

暂存内容包括解析后的品牌 JSON、HTML、package manifest、安装和容器模板、Web/ Desktop 视觉资源、CLI/server 产物配置。脚本在构建前后比较已跟踪、未跟踪、暂存和工作区状态，检测到自身造成的源码变化时失败。

models snapshot 必须来自可信本地 JSON；产品构建同时清空 Sentry DSN、token、组织和项目参数。

## 5. 消费者映射

| 消费区域 | 1.17.9 落点 |
| --- | --- |
| App/Web 编译注入 | `packages/app/product-identity-plugin.ts`、`packages/app/vite.config.ts` |
| Desktop main/renderer/builder | `packages/desktop/electron.vite.config.ts`、`electron-builder.config.ts`、`src/main/identity.ts` |
| CLI/server 构建 | `packages/opencode/script/build.ts`、`build-node.ts` |
| TUI | `packages/tui/src/logo.ts` 及品牌消费者 |
| SDK | `packages/sdk/js/src/brand.gen.ts` 及 bundle 注入 |
| Enterprise SSR | `packages/enterprise/vite.config.ts` |
| 安装和分发 | `install`、`nix/opencode.nix`、`packages/opencode/Dockerfile` |

所有运行时 bundle 使用构建期品牌 JSON，不能从源码中的平行常量重新派生身份。

## 6. 组合版本

`packages/desktop/product-version.ts` 生成 `<base-version>-<release>`。`packages/desktop/scripts/windows-product-version.ts` 在签名前更新 Windows `ProductVersion`，并保留其他语言资源。

组合版本被写入 CLI/package manifest、Desktop renderer、Sentry fallback、Electron extra metadata 和平台产物元数据。

## 7. 静态合同

`script/brand.ts` 检查普通运行时代码中不存在 BluedCode 名称、slug 或身份派生规则的硬编码，并检查安装、launcher、Docker 和 Nix 仍由受控模板生成。规范配置、规格和扫描器自身测试可排除。

## 8. 验证

- `packages/brand/test/*.test.ts`
- `packages/app/vite.config.test.ts`
- `packages/desktop/electron-vite.config.test.ts`
- `packages/desktop/electron-builder.config.test.ts`
- `packages/desktop/scripts/product-build.test.ts`
- `packages/opencode/test/build-product-brand.test.ts`
- `packages/opencode/test/build-node-brand.test.ts`
- `packages/sdk/js/test/product-brand-bundle.test.ts`
- `packages/tui/test/brand.test.ts`

版本验收必须额外执行 `--prepare-only`，确认暂存内容、组合版本和源码树不变合同。
