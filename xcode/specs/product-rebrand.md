# ForeachCode 产品展示层改名规格

- 状态：已确认
- 基线版本：OpenCode `1.17.9`
- 目标产品名：`ForeachCode`
- 源码仓库：`D:\Develop\foreachcode\opencode`
- 最后更新：2026-08-13

## 1. 背景

ForeachCode 是基于 OpenCode 1.17.9 构建的企业内部产品。第一阶段修改用户可见品牌，并建立独立于 OpenCode 的安装身份和全局工作目录；内部源码目录、workspace 包和代码标识仍保持不变。

本阶段需要让 Desktop、Web UI、CLI/TUI 和 OAuth 回调页面对用户统一展示 `ForeachCode`，同时尽量保持与 OpenCode 上游代码的可合并性。

## 2. 目标

1. 所有纳入本阶段范围的通用产品展示名称统一为 `ForeachCode`。
2. Desktop、Web UI、CLI/TUI 和 OAuth 页面不再把当前应用展示为 `OpenCode`。
3. 提供新的 ForeachCode SVG 横向字标和 TUI 字符画。
4. 禁用指向 OpenCode 官方仓库的桌面自动更新。
5. 建立 ForeachCode 独立的安装目录、Desktop 身份和全局工作目录。
6. 将用户执行的 CLI 命令改为 `foreachcode`，同时保持 CLI 功能、项目配置和内部包兼容性。
7. 保留 OpenCode 官方服务和官方文档的原始名称。

## 3. 非目标

本阶段不处理以下内容：

- 不重命名源码目录或文件路径。
- 不重命名 npm workspace 包。
- 不重命名 TypeScript 类型、函数、变量、服务标识或 API 类型。
- 不重命名项目级 `.opencode` 和 `opencode.json`；ForeachCode 全局目录另见第 4.6 节。
- 不更改 `OPENCODE_*` 环境变量。
- 不探测、读取、复制、移动或删除旧 OpenCode 全局数据。
- 不更改 OpenCode Zen、OpenCode Go 或 `opencode` provider ID。
- 不更改 OpenCode 官方文档链接及其名称。
- 不建设 ForeachCode 自有更新服务。
- 不修改 VS Code 扩展、官网营销站和发布渠道。
- 不把 Web、Enterprise 页面或专项视觉回归作为本次交付的阻断验收项。

## 4. 已确认决策

### 4.1 品牌写法

- 正式展示名称使用 `ForeachCode`。
- 不使用全小写 `foreachcode` 作为界面标题。
- 内部兼容名称继续使用原有小写 `opencode`。

### 4.2 覆盖范围

本阶段覆盖：

- Desktop
- Web UI
- CLI/TUI
- OAuth 回调和外部认证提示页

### 4.3 官方服务

以下名称属于 OpenCode 官方服务，必须保持不变：

- `OpenCode Zen`
- `OpenCode Go`

不得替换成 `ForeachCode Zen` 或 `ForeachCode Go`。

### 4.4 官方文档

菜单中的 OpenCode 官方文档入口暂时不动，包括：

- 展示名称 `OpenCode Documentation`
- URL `https://opencode.ai/docs`

### 4.5 自动更新

Desktop 自动更新必须禁用。禁用后：

- 应用启动时不检查 OpenCode 官方版本。
- 用户操作不能触发官方更新检查或安装。
- “检查更新”菜单和更新设置应隐藏。
- 不删除现有 updater 实现，为后续接入企业内部更新源保留结构。

### 4.5.1 企业数据出网边界

ForeachCode 不得把企业会话、消息、代码差异、模型信息或诊断内容上传到 OpenCode 公共产品服务：

- 删除 `opncd.ai` 公共会话分享兜底；未配置 `enterprise.url` 时分享请求必须失败且不得发出 HTTP 请求。
- 禁用自动分享，移除 Desktop/Web UI、CLI 和 TUI 的分享、取消分享及公开链接入口。
- 不注册默认连接 `console.opencode.ai` 的 Console 命令；未来仅允许显式配置真实的企业内部地址。
- GitHub Agent、上游 changelog、反馈入口和未内嵌 Web UI 的上游代理均保持禁用。
- Enterprise 分享页不得加载公共社交卡片，也不得提供 OpenCode 官网、GitHub 或 Discord 导航。
- 用户主动配置的模型 Provider、MCP、企业内部服务和 OTLP 地址不属于产品自身的隐式出网；它们仍按用户或管理员的显式配置工作。
- 从用户显式提供的分享 URL 导入数据属于入站能力，可以保留，但不得附带本地会话或企业凭据到非配置域名。

### 4.6 独立安装身份和工作目录

ForeachCode 不再与 OpenCode 共用安装身份和全局运行目录：

- Desktop 产品安装目录使用 ForeachCode 名称。
- Desktop app ID 改为 `ai.foreachcode.desktop*`。
- Deep Link scheme 改为 `foreachcode://`。
- curl 安装目录改为 `~/.foreachcode/bin`，安装的可执行文件为 `~/.foreachcode/bin/foreachcode`。
- XDG data、config、cache 和 state 的应用目录改为 `foreachcode`。
- 全局数据库和日志文件使用 `foreachcode` 名称。
- ForeachCode 始终以全新产品初始化，不提供旧 OpenCode 数据迁移或兼容读取逻辑。
- ForeachCode 的安装、启动和卸载均不得修改旧 OpenCode 目录中的任何内容。

项目级 `.opencode` 和 `opencode.json` 暂时保留，以控制本阶段兼容性范围。用户执行的 CLI 命令统一改为 `foreachcode`，不安装 `opencode` 兼容别名。

### 4.7 Enterprise 页面

`packages/enterprise` 纳入本次品牌范围。服务端页面标题、分享页标题和用户可见产品文案统一使用 ForeachCode。

### 4.8 包元数据

- `author.name` 使用 `ForeachCode`。
- 移除 OpenCode 官方联系邮箱；确定企业内部邮箱后另行补充。
- 没有 ForeachCode 内部官网前移除产品 `homepage`。
- 保留 MIT License、上游仓库地址和原始版权归属。

### 4.9 应用图标

本阶段设计并替换 ForeachCode 应用图标。SVG 母版已经确认，实施时据此生成各平台 raster、ICO 和 ICNS 资源。

### 4.10 品牌单一数据源

ForeachCode 的可变产品身份必须集中定义，不能继续把产品名、slug、CLI 名称和 Desktop 身份散落为互不关联的字符串常量。

- 新增浏览器安全、零运行时依赖的内部包 `@opencode-ai/brand`，源码位于 `packages/brand`。
- 品牌源至少集中定义正式展示名、slug 和 Desktop 基础 app ID；CLI 名称、协议、目录名、数据库名、日志名和各 channel 身份优先由这些字段派生。
- TypeScript、TSX、Bun 构建脚本和 Electron 配置必须直接引用品牌源，不得重新声明 `ForeachCode` 或 `foreachcode` 常量。
- `package.json`、Shell 安装器、Linux desktop file 和静态 manifest 等不能直接引用 TypeScript 的文件，由品牌生成脚本更新。
- 根目录提供 `brand:generate` 和 `brand:check` 命令；`brand:check` 必须能够发现生成内容与品牌源不一致的情况。
- 生成器只能更新明确声明的字段、标记区块或完整生成文件，禁止对全仓库执行无边界字符串替换。
- `.opencode`、`opencode.json(c)`、`OPENCODE_*`、`@opencode-ai/*`、provider ID 和官方服务名属于兼容或上游标识，不从品牌 slug 派生。
- SVG 横向字标和 TUI 字符画中的文字应由品牌名驱动，或作为品牌生成脚本的受控输出，避免未来仍要手工逐字重画。
- 定制应用图标属于独立视觉资产，不能由产品名字串可靠生成；仅改文字品牌时可继续使用，视觉标识变化时单独替换 SVG 母版并重新生成平台图标。

未来再次改名时，文字和产品身份原则上只允许修改品牌源中的少量字段并运行生成命令，不应逐文件人工搜索替换。

## 5. 命名规则

### 5.1 应替换的名称

| 原名称              | 新名称                 |
| ------------------- | ---------------------- |
| `OpenCode`          | `ForeachCode`          |
| `OpenCode Desktop`  | `ForeachCode Desktop`  |
| `OpenCode Dev`      | `ForeachCode Dev`      |
| `OpenCode Beta`     | `ForeachCode Beta`     |
| `OpenCode server`   | `ForeachCode server`   |
| `OpenCode team`     | `ForeachCode team`     |
| CLI 命令 `opencode` | CLI 命令 `foreachcode` |

替换只适用于用户可见文本、操作系统产品名和外部认证客户端显示名。

### 5.2 必须保留的名称

| 类别         | 保留值                                               |
| ------------ | ---------------------------------------------------- |
| 源码目录     | `packages/opencode`                                  |
| workspace 包 | `@opencode-ai/*`                                     |
| 项目配置目录 | `.opencode`                                          |
| 配置文件     | `opencode.json`、`opencode.jsonc`                    |
| 环境变量     | `OPENCODE_*`                                         |
| Provider     | `opencode`                                           |
| 官方服务     | `OpenCode Zen`、`OpenCode Go`                        |
| 官方文档     | `OpenCode Documentation`、`https://opencode.ai/docs` |
| 内部代码标识 | `OpenCodeHttpApi`、`OpenCodeTheme` 等                |

## 6. 修改范围

### 6.1 Desktop 产品壳

主要文件：

- `packages/desktop/electron-builder.config.ts`
- `packages/desktop/package.json`
- `packages/desktop/src/main/index.ts`
- `packages/desktop/src/main/windows.ts`
- `packages/desktop/src/renderer/index.html`
- `packages/desktop/src/renderer/i18n/*.ts`
- `packages/desktop/src/main/wsl/*.ts` 中的用户可见错误信息
- `packages/desktop/resources/linux/opencode-desktop.desktop`，文件自身将在实现阶段按新 app ID 重命名

要求：

- Electron `productName` 使用 `ForeachCode`、`ForeachCode Dev` 或 `ForeachCode Beta`。
- `app.setName()` 使用 ForeachCode 展示名。
- 窗口标题、崩溃提示、无响应提示和 WSL 安装提示使用 ForeachCode。
- `appId`、Linux executable ID、desktop file 名和 Deep Link scheme 使用 ForeachCode 身份。
- 操作系统安装目录、bundle 展示名称和全局工作目录使用 ForeachCode；源码路径和内部包名不变。

### 6.2 Web UI

主要文件：

- `packages/app/index.html`
- `packages/app/src/desktop-menu.ts`
- `packages/app/src/components/windows-app-menu.tsx`
- `packages/app/src/i18n/*.ts`
- `packages/app/src/wsl/settings-model.ts`
- `packages/ui/src/components/favicon.tsx`
- `packages/ui/src/assets/favicon/site.webmanifest`
- `packages/ui/src/theme/context.tsx`
- `packages/ui/src/theme/themes/opencode.json`
- `packages/ui/src/theme/desktop-theme.schema.json`
- `packages/enterprise/src/entry-server.tsx`
- `packages/enterprise/src/routes/share/[shareID].tsx`

要求：

- 页面标题、菜单、设置、错误提示、更新提示和 WSL 引导使用 ForeachCode。
- 所有已支持语言都需要更新品牌 token。
- 翻译 key、文件名和内部 theme ID 不变。
- Shiki 内部主题标识 `OpenCode` 不变。
- OpenCode Documentation 菜单项不变。

### 6.3 CLI/TUI

主要文件：

- `packages/opencode/src/cli/ui.ts`
- `packages/opencode/src/cli/cmd/run/splash.ts`
- `packages/opencode/src/cli/cmd/run/footer.permission.tsx`
- `packages/opencode/src/cli/cmd/run/footer.prompt.tsx`
- `packages/opencode/src/cli/cmd/run/permission.shared.ts`
- `packages/opencode/src/cli/cmd/uninstall.ts`
- `packages/tui/src/logo.ts`
- `packages/tui/src/app.tsx`
- `packages/tui/src/attention.ts`
- `packages/tui/src/routes/session/permission.tsx`
- `packages/tui/src/feature-plugins/home/tips-view.tsx`
- `packages/tui/src/feature-plugins/sidebar/footer.tsx`

要求：

- 终端标题、启动画面、权限提示、卸载提示和通用帮助文案使用 ForeachCode。
- CLI 可执行文件名、shell PATH 配置、安装提示和命令示例统一使用 `foreachcode`，例如 `foreachcode serve`。
- 不安装名为 `opencode` 的可执行文件、符号链接或兼容脚本。
- OpenCode Zen 和 OpenCode Go 相关 TUI 文案保持原名。

### 6.4 OAuth 和外部认证页面

主要文件：

- `packages/opencode/src/mcp/oauth-provider.ts`
- `packages/opencode/src/mcp/oauth-callback.ts`
- `packages/opencode/src/plugin/openai/codex.ts`
- `packages/opencode/src/plugin/xai.ts`
- `packages/opencode/src/plugin/digitalocean.ts`
- `packages/opencode/src/plugin/snowflake-cortex.ts`
- `packages/opencode/src/acp/service.ts`

要求：

- OAuth client display name 使用 ForeachCode。
- 成功、失败和“返回应用”页面使用 ForeachCode。
- ACP agent display name 和登录展示名使用 ForeachCode。
- OAuth client ID、回调路径、协议字段和内部 method ID 不变。

## 7. 品牌图形规格

### 7.1 SVG 横向字标

目标文件：`packages/ui/src/components/logo.tsx`

要求：

- 横向字标清晰拼写 `FOREACHCODE`。
- 保持现有像素化几何风格。
- `Foreach` 和 `Code` 可以使用现有弱/强颜色层级区分。
- 不引入外部字体、图片或网络资源。
- 使用纯 SVG path，支持现有 CSS color variables。
- 更新 viewBox，避免字符裁切。
- 现有 `Mark` 和 `Splash` 图形保持不变。

### 7.2 TUI 字符画

目标文件：

- `packages/tui/src/logo.ts`
- `packages/opencode/src/cli/ui.ts`

要求：

- 字符画清晰拼写 `FOREACHCODE`。
- 保持四行高度和现有 block/shadow marker 机制。
- TTY 彩色版本和非 TTY 纯文本版本都必须更新。
- 不改变 OpenCode Go 的独立 `go` 标识。

### 7.3 应用图标

目标源文件：`xcode/build/foreachcode/app-icon.svg`

要求：

- 图标使用独立 ForeachCode 几何标识，不复用 OpenCode 的 O 形开关标识。
- 使用深色圆角底、圆润金属质感 F 和命令行 `>` 箭头的构图。
- 保持开发工具和深色界面的视觉语言，并与 ForeachCode 字标形成清晰区分。
- 在 16px、32px、64px 和高分辨率下保持清晰。
- 先确认 SVG 母版，再派生 Desktop、favicon 和平台商店所需尺寸。
- 已确认的 SVG 母版作为所有生产图标资源的唯一生成源。

## 8. 自动更新规格

主要目标文件：

- `packages/desktop/src/main/constants.ts`
- `packages/desktop/src/main/menu.ts`
- Web UI 中的更新设置入口

第一阶段将 `UPDATER_ENABLED` 固定为 `false`。

验证要求：

- updater controller 初始化为 disabled 状态。
- Desktop 菜单和设置中不显示更新入口。
- 不调用 `electron-updater` 的检查、下载或安装方法。
- 保留 channel、发布配置和 updater 源代码，后续另开规格接入企业更新服务。

## 9. 实施约束

1. 禁止全仓库无条件执行 `OpenCode -> ForeachCode` 替换。
2. 每个替换位置必须判断它是产品展示名、官方服务名还是内部兼容标识。
3. 多语言批量替换后必须恢复并复查 OpenCode Zen 和 OpenCode Go。
4. 不手工修改生成的 SDK 或 OpenAPI 文件。
5. 不改动与品牌无关的业务逻辑。
6. 保持 MIT License 和上游版权声明。
7. 测试中的用户可见预期值应同步更新；内部测试名称可保留 OpenCode。
8. 新增用户可见产品名或产品外部身份时必须引用品牌源；不能直接增加新的品牌字面量。

## 10. 验收标准

### 10.1 功能验收

- Desktop 安装后的应用展示名为 ForeachCode。
- Desktop 窗口标题和系统弹窗展示 ForeachCode。
- `foreachcode` CLI 可执行文件能够正常启动并执行核心命令。
- 自动更新入口不可见，且不会连接 OpenCode 官方更新源。

### 10.2 兼容性验收

- `foreachcode --version`、`foreachcode serve` 和其他 CLI 命令可正常执行。
- 新安装中不存在 ForeachCode 提供的 `opencode` 命令或兼容别名。
- 原有 `.opencode` 和 `opencode.json` 配置继续生效。
- 首次启动只在 ForeachCode 新目录中初始化数据，不读取或修改旧 OpenCode 全局目录。
- `foreachcode://` Deep Link 正常工作。
- Desktop app ID 使用 `ai.foreachcode.desktop*`，可与 OpenCode 区分。
- workspace imports 和 `@opencode-ai/*` 包解析不受影响。
- `brand:check` 通过，证明生成文件和品牌源一致。

### 10.3 品牌残留验收

允许残留的 `OpenCode` 必须属于以下类别之一：

- OpenCode Zen 或 OpenCode Go
- OpenCode Documentation 和官方 URL
- 内部类型、服务、主题或 API 标识
- 注释、上游设计说明和测试名称
- 兼容配置、包名、路径、环境变量和协议

除上述允许项外，本阶段覆盖的用户可见界面不得残留 OpenCode 产品名。

### 10.4 工程验证

- 从各受影响 package 目录运行 `bun typecheck`。
- 运行 Desktop electron-builder 配置测试。
- 运行 Desktop WSL 测试。
- 运行 CLI 安装路径、可执行文件名和全局目录测试。
- 验证首次启动能够在 ForeachCode 新目录中独立初始化，并且不会访问或修改旧 OpenCode 全局目录。

## 11. 后续工作

以下工作必须使用独立规格处理：

1. ForeachCode 内部文档、帮助中心和问题反馈地址。
2. 企业内部自动更新服务和签名发布流程。
3. VS Code 扩展品牌和发布者迁移。
4. 官网营销页面品牌迁移。
5. 是否移除或替换 OpenCode Zen、OpenCode Go。
6. 是否在未来迁移项目配置目录和包命名空间。
