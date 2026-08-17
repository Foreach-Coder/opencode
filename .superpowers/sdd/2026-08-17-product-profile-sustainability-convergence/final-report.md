# BluedCode 产品 Profile 收敛最终验收报告

- 目标基线：OpenCode `v1.18.18`
- 实现分支：`dev-foreachcode-1.18.18`
- 当前实现提交：`e96d35abe23d09234ebfec1391331f08757e2890`
- 规格：`docs/superpowers/specs/2026-08-16-03-product-profile-architecture-design.md`
- 验收日期：2026-08-17

## 1. 验收结论

当前线性历史上的实现已经满足产品 Profile 可持续收敛的运行与构建合同：

- `@foreachcode/product` 成为产品身份、操作矩阵、错误和 channel identity 的事实源；
- 运行时产品身份、配置边界、管理员集成、Provider/MCP/插件、分享、更新、遥测和 UI surface 已迁入源码根边界；
- 构建层保留版本适配、静态品牌资源、多语言静态文案、缓存、打包、manifest 和最终产物审计；
- 根仓只保留品牌源资源，构建代码只保留在 `opencode/xcode/build/bluedcode/`；
- dev/prod Portable 均执行最终 EXE 启动验收，不再只依赖源码 fixture。

历史重整与远端 force push 尚未执行；执行后应以重整后的最终提交更新 origin 矩阵。

## 2. 测试结果

已通过：

```text
packages/product:
  bun test test
  bun typecheck

packages/opencode:
  bun test src/config/product-policy.test.ts src/config/admin-config.test.ts src/provider/product-provider.test.ts src/product/network-policy.test.ts

packages/app:
  bun test --conditions=solid --preload ./happydom.ts src/product src/components src/pages/layout/helpers.test.ts
  165 pass / 0 fail

xcode/build/bluedcode:
  bun test test
  206 pass / 0 fail

xcode/build/bluedcode:
  bun run build.ts --channel dev --audit-only
  兼容审计完成
```

已知非本轮阻塞项：

- `packages/opencode bun typecheck` 仍受既有 `script/build-config.ts(2,40): Cannot find module '@opencode-ai/brand/config'` 影响；
- `packages/app bun typecheck` 与 `packages/desktop bun typecheck` 仍受既有 `src/custom-elements.d.ts(1,1)/(1,2): TS1128` 影响；
- `packages/desktop bun test src/main src/renderer` 的完整目录运行会触发当前 Bun/Node 环境缺少 `node:sqlite`，单独运行 `src/main/updater-subscriptions.test.ts` 通过。

这些问题没有改变当前 BluedCode 产品 Profile、企业边界或 Portable 构建验收结论。

## 3. 产物

### dev Portable

- 文件：`.xcode/bluedcode/workspaces/dev-70329dfcc2046049/artifacts/c69dcb1479ad5646690b0a7bb1a06c5a7046fd6dabaf8c0dd5c37e3f10b41392/BluedCode-Dev-1.18.18-dev-e96d35abe2-windows-x64-portable.exe`
- 大小：`166189765`
- SHA-256：`cbc205d70769e9f9776d168ada5a2d62342dc00211f600a3ee133a405cc40a04`
- 可见版本：`1.18.18-dev-e96d35abe2`
- 产品名：`BluedCode Dev`
- App ID：`ai.bluedcode.desktop.dev`
- Deep Link：`bluedcode-dev`

### prod Portable

- 文件：`.xcode/bluedcode/workspaces/prod-9f654edab99d2cd2/artifacts/e2ab81551fa9edf67e758046d395e54f2137df4b646bbaa6c97bfb8a1c6131cd/BluedCode-1.18.18-260816-01-e96d35abe2-windows-x64-portable.exe`
- 大小：`166187989`
- SHA-256：`ac87126ce2c158ea95b6698e800d1f328508227829293ba4a2f73ae996309c4f`
- 可见版本：`1.18.18-260816-01-e96d35abe2`
- 产品名：`BluedCode`
- App ID：`ai.bluedcode.desktop`
- Deep Link：`bluedcode`
- 候选 tag：`bluedcode-v1.18.18-260816-01`

## 4. Runtime acceptance 摘要

dev 和 prod manifest 均记录：

- `executableStarted: true`
- `serverHealthReady: true`
- `preloadReady: true`
- `rendererReady: true`
- `adminModelLoaded: true`
- `exitedCleanly: true`
- `lingeringProcesses: []`
- `configDirectory: ".config/bluedcode"`
- `publicNetworkCalls: []`
- 默认 session core：`v1`
- 可切换到：`v2`
- 禁用入口：`auth`、`connect-provider`、`share`、`update`
- stale session 恢复为受控 `SESSION_NOT_FOUND`，不再导致应用壳崩溃。

## 5. 架构审查结论

本轮最终修复没有把业务语义重新搬回构建期 AST 改写：

- 前端遥测收敛为 `packages/app/src/product/telemetry.ts`，BluedCode Profile 下为 no-op；
- 上游 `@sentry/solid` 不再被 renderer 静态导入；
- 内置项目头像使用本地产品 favicon，不再依赖远程 favicon 服务；
- Electron Vite 真实编译 smoke 会审计最终输出，不允许未分类 Sentry、远程 favicon、更新器或裸运行时依赖进入产物；
- `release-manifest.json` 从 Product Profile 和构建身份派生企业、运行时和产物审计信息。

## 6. 后续动作

1. 若需要干净发布历史，先创建安全引用，再把当前线性历史重整为约定的中文语义提交。
2. 重整完成并重新验收后，用重整后的最终提交更新根仓 `docs/origin-specs/01-product-branding.md`、`02-enterprise-product-policy.md` 和 `07-product-profile-architecture.md` 的版本实现矩阵。
3. 最终推送前，根仓需提交新的 `opencode` 子模块指针。
