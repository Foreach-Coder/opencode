# OpenCode 1.17.9 BluedCode 企业策略落地设计

- 类型：版本级实施规格
- Origin spec：父级根仓 `docs/origin-specs/02-enterprise-product-policy.md`（`ORIGIN-02`）
- 目标版本：OpenCode `1.17.9`
- 相关提交：`efc966ebb4`、`4f9f129a61`、`3654f46519`
- 状态：已实现，逆向确认

## 1. 策略注入

`xcode/build/bluedcode/brand.json` 提供 `enterprise: true`。`packages/brand/src/config.ts` 校验该布尔值，并把不可变策略注入 Web、Electron、CLI、ACP、server 和 core bundle。各进程不再通过运行时环境变量推断企业模式。

## 2. Provider 和认证

`packages/opencode/src/provider/provider.ts` 在企业模式只加载 `config.provider` 中显式声明的 Provider，并忽略环境 key、全局 auth、well-known token、账户注入和插件 auth hook。

`packages/opencode/src/auth/index.ts`、`provider/auth.ts`、`cli/cmd/providers.ts` 和 `acp/service.ts` 实现以下限制：

- auth 写入失败且不修改凭据文件；
- auth methods 和 ACP `authMethods` 为空；
- OAuth authorize/callback 返回 `ProviderAuthConnectionsDisabled`；
- CLI 不注册 `providers login`，旧 handler 被调用时也失败；
- logout 可以保留用于清理历史数据。

## 3. HTTP 和 UI 边界

实例级及全局 config PATCH 在 payload 含 `provider`、`enabled_providers` 或 `disabled_providers` 时返回 HTTP 400，且不写文件、不重启实例。`model` 和 `small_model` 仍可更新。

相关 handler 位于 `packages/opencode/src/server/routes/instance/httpapi/handlers/`。

App 通过编译期 enterprise 标志隐藏 Provider settings、连接命令、模型选择器新增按钮、自定义 Provider 对话框和 getting-started 引导。落点集中在 `packages/app/src/components/dialog-*.tsx`、settings 组件和 `src/pages/layout.tsx`。

## 4. 模型目录

`packages/core/src/models-dev.ts` 在企业模式禁止公共 models API 下载和定时刷新，强制刷新也直接返回。`models --refresh` 返回产品构建禁用错误。构建使用本地 models snapshot，缺失或无效时由 `script/product-build.ts` 在编译前失败。

## 5. 分享、遥测和更新

- `packages/opencode/src/share/share-next.ts` 在 request/create 边界失败，即使存在 enterprise URL 也不发请求。
- App、CLI 和 TUI 的 share/unshare 入口不注册或不渲染。
- `packages/core/src/observability/otlp.ts` 不创建 exporter 或 trace layer。
- `packages/opencode/src/control-plane/workspace.ts` 不向 workspace/adapter 子进程转发 OTLP 环境变量。
- `packages/desktop/src/features.ts` 和 `src/main/updater.ts` 关闭 Desktop updater。
- `packages/opencode/src/installation/index.ts` 让 update source 返回当前版本，upgrade 返回内部更新源未配置错误。
- 产品构建清除 Sentry 发布配置。

## 6. Fail-closed 验证

测试必须直接调用服务和 handler，不能只验证 UI 隐藏：

- `packages/core/test/models.test.ts`
- `packages/core/test/effect/observability.test.ts`
- `packages/opencode/test/auth/auth.test.ts`
- `packages/opencode/test/provider/provider.test.ts`
- `packages/opencode/test/server/httpapi-config.test.ts`
- `packages/opencode/test/server/httpapi-global.test.ts`
- `packages/opencode/test/share/share-next.test.ts`
- `packages/opencode/test/control-plane/workspace.test.ts`

测试需注入假 HTTP client 证明拒绝发生前没有请求，并覆盖 `enterprise: false`，避免策略被误写为全局删除。
