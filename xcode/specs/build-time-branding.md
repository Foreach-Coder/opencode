# ForeachCode 构建态品牌参数化规格

- 状态：草案
- 基线版本：OpenCode `1.17.9`
- 默认产品：无；仓库只提供可显式选择的 `ForeachCode` preset
- 验证品牌：`FKGCODE`
- 源码仓库：`D:\Develop\foreachcode\opencode`
- 最后更新：2026-08-14

## 1. 背景

当前仓库已经通过 `@opencode-ai/brand` 集中提供产品名称、slug、CLI、协议、Desktop app ID 和全局目录等品牌身份。TypeScript 业务代码可以直接消费该品牌对象，但 `package.json`、HTML、Shell、Dockerfile、Nix、SVG、SDK 等静态文件仍由 `brand:generate` 直接回写。

这种方式实现了“只手工修改一个品牌源”，但每次改名仍会产生大量受 Git 管理文件的差异，还可能导致 lockfile、旧生成文件和构建缓存混入上一个品牌。`ForeachCode` 改为 `FKGCODE` 的验证已经证明，人工修改点虽然很少，工作树和生成产物仍不够收敛。

本规格把品牌从“源码生成参数”提升为“构建态输入”：同一份源码可以根据构建参数输出不同品牌，且构建过程不得修改受 Git 管理的源码文件。

## 2. 目标

1. 使用构建参数决定最终产品的显示名称和机器身份。
2. 从同一 Git commit 构建 `ForeachCode`、`FKGCODE` 或其他合法品牌。
3. 构建前后 Git 工作树状态完全一致。
4. 品牌参数只影响构建暂存区和最终产物，不回写源码、manifest、SDK 或 lockfile。
5. Desktop、CLI/TUI、Web UI、Enterprise、OAuth 页面和发布产物使用同一份已解析品牌对象。
6. 保证 app ID、协议、CLI、安装目录、配置目录、数据库和日志等身份同步变化。
7. 支持在构建时选择或传入 Desktop 横向字标、App Icon 和 TUI 字标，并生成当前平台需要的全部视觉产物。
8. 保持 OpenCode 兼容标识、官方服务名及企业数据出网边界不变。
9. 通过构建两个不同品牌的自动化测试证明不存在跨品牌残留。

## 3. 非目标

- 不把品牌改成运行时用户配置。
- 不允许最终用户在应用启动后修改产品名、app ID、协议或工作目录。
- 不重命名 `@opencode-ai/*` workspace 包、源码目录、类型、函数或内部服务标识。
- 不修改 `.opencode`、`opencode.json(c)`、`OPENCODE_*`、`x-opencode-*` 等兼容契约。
- 不修改 OpenCode Zen、OpenCode Go、provider ID 和官方文档归属。
- 不因为品牌参数化恢复自动更新、公共分享、公共 Console、上游反馈或其他已禁用外联。
- 不使用生成式模型自动设计 Logo。构建系统只转换调用方明确选择或提供的 SVG 母版。
- 不迁移或读取其他品牌、旧 ForeachCode 或旧 OpenCode 的全局数据。

## 4. 核心原则

### 4.1 构建态而非运行时

品牌必须在构建开始前解析，并作为编译常量进入最终产物。最终应用不得依赖 `PRODUCT_NAME` 等环境变量才能正常启动，也不得在运行时重新读取这些变量改变身份。

### 4.2 源码不可变

品牌构建不得修改 Git 跟踪文件。以下操作均不允许发生在源码工作树：

- 改写仓库内的 `package.json`；
- 改写 HTML、SVG、Shell、Dockerfile 或 Nix 文件；
- 改写已跟踪的 SDK 生成文件；
- 因 CLI 名称变化更新 `bun.lock`；
- 在源码资源目录遗留某个品牌的 metainfo、manifest 或缓存文件。

需要展开品牌值的文件必须在构建暂存区生成，或由 bundler 在输出阶段转换。

### 4.3 单次解析

所有消费者必须使用同一次构建解析得到的不可变 `ResolvedBrand`。不得由 Desktop、CLI、installer 或 SDK 分别实现名称转 slug、app ID 或协议的推导逻辑。

### 4.4 显示名与机器身份分离

显示名称允许大小写和可读格式；机器身份必须满足平台约束。构建系统不得无条件假设任意产品名都可以通过 `toLowerCase()` 得到合法 slug。

## 5. 构建参数合同

### 5.1 标准命令

仓库应提供单一跨平台入口：

```text
bun run product:build --brand-config xcode/build/fkgcode/brand.json
```

具体子构建可以复用该入口，但不得绕过品牌解析器自行读取环境变量。

### 5.2 参数

| 参数           | 必填 | 示例                             | 说明                                             |
| -------------- | ---- | -------------------------------- | ------------------------------------------------ |
| `brand-config` | 是   | `xcode/build/fkgcode/brand.json` | 唯一品牌清单；相对资产路径以该文件所在目录为基准 |
| `prepare-only` | 否   | 无值开关                         | 只校验并生成隔离暂存区，不执行编译和打包         |

品牌清单必须显式提供 `name`、`channel`、`appIconSvg`、`wordmarkSvg` 和 `tuiWordmarkGrid`；`slug` 仅在名称可无损派生时可省略，`desktopAppId` 可按 slug 派生。三类视觉资源均不得省略、自动生成或回退到其他品牌资产。

### 5.3 环境变量

CI 只允许通过一个等价配置路径选择品牌：

```text
PRODUCT_BRAND_CONFIG
```

命令行 `--brand-config` 优先于 `PRODUCT_BRAND_CONFIG`。不再接受散落的品牌字段环境变量，也不存在仓库默认品牌。

解析完成后，后续阶段只能接收 `ResolvedBrand`，不得继续直接读取环境变量。

### 5.4 显式开发 preset

不提供品牌清单时，构建和开发命令必须在写入任何文件之前失败。不得从源码常量、旧产物、目录名、环境残留或视觉 profile 猜测品牌。

`xcode/build/` 是项目内唯一允许直接声明产品身份的显式品牌构建目录；开发时必须主动选择 `foreachcode/dev.json`，正式构建时选择品牌目录中的 `brand.json`，它们都不是 fallback。每个品牌子目录必须直接包含自己的配置和视觉资源。

### 5.5 slug 规则

slug 必须满足：

```text
^[a-z][a-z0-9-]{1,30}$
```

当 `name` 仅包含 ASCII 字母和数字时，构建系统可以将其转为小写作为默认 slug，例如 `FKGCODE` 派生为 `fkgcode`。名称包含空格、中文、标点或其他无法无损推导的字符时，调用方必须显式提供 slug。

非法或相互冲突的参数必须在写入任何构建文件之前失败。

## 6. 品牌派生合同

未显式覆盖时，`ResolvedBrand` 按以下规则产生：

| 字段                 | 派生规则                 | FKGCODE 示例              |
| -------------------- | ------------------------ | ------------------------- |
| `name`               | 构建参数                 | `FKGCODE`                 |
| `slug`               | 参数或合法名称的小写形式 | `fkgcode`                 |
| `cli`                | `slug`                   | `fkgcode`                 |
| `protocol`           | `slug`                   | `fkgcode`                 |
| `directory`          | `slug`                   | `fkgcode`                 |
| `database`           | `${slug}.db`             | `fkgcode.db`              |
| `log`                | `${slug}.log`            | `fkgcode.log`             |
| `desktopAppId`       | `ai.${slug}.desktop`     | `ai.fkgcode.desktop`      |
| `desktop.dev.name`   | `${name} Dev`            | `FKGCODE Dev`             |
| `desktop.beta.name`  | `${name} Beta`           | `FKGCODE Beta`            |
| `desktop.prod.name`  | `name`                   | `FKGCODE`                 |
| `desktop.dev.appId`  | `${desktopAppId}.dev`    | `ai.fkgcode.desktop.dev`  |
| `desktop.beta.appId` | `${desktopAppId}.beta`   | `ai.fkgcode.desktop.beta` |
| `desktop.prod.appId` | `desktopAppId`           | `ai.fkgcode.desktop`      |

派生字段默认不允许独立覆盖，防止出现产品名已经变化但 CLI、协议或数据目录仍属于旧品牌的混合产物。

## 7. 构建架构

### 7.1 品牌解析器

`packages/brand` 继续作为品牌模型和消费 API，但需要区分：

- `resolveBrand(input)`：校验输入并生成不可变 `ResolvedBrand`；
- `Brand`：构建时注入并供应用代码消费的最终常量；
- `BrandChannel`：现有 channel 类型。

浏览器、Node、Bun 和 Electron 中的消费者必须得到内容一致的 `Brand`，且浏览器 bundle 不得引入 Node 环境变量读取逻辑。

### 7.2 构建暂存区

需要物化静态品牌值时，构建系统必须使用独立暂存目录，例如：

```text
.tmp/product-build/<slug>/<channel>/
```

要求：

- 暂存路径必须位于明确的构建目录内；
- 开始构建前只清理本次已解析的精确目标；
- 不扫描、移动或删除其他品牌的用户数据；
- 暂存目录不得被 Git 跟踪；
- 正常成功和失败退出后均不得污染源码资源目录；
- 不允许从旧暂存内容推断本次品牌。

### 7.3 TypeScript 和 TSX

应用代码继续通过 `@opencode-ai/brand` 消费品牌。构建工具可以使用虚拟模块、bundler define 或暂存生成模块注入 `ResolvedBrand`，但最终 bundle 中必须是常量，不得保留对构建机器环境变量的运行时访问。

### 7.4 HTML

`packages/app/index.html` 和 Desktop renderer HTML 不再保存具体产品名。标题、meta 和相关可访问文本应通过 Vite/Electron HTML transform 在输出阶段注入。

### 7.5 package manifest 与 CLI 分发

源码 workspace manifest 保持稳定，不因品牌变化修改 `bin` key 或 author 字段。用于 npm、portable 或 Desktop sidecar 的发布 manifest 必须在暂存区生成。

最终发布包只能暴露当前品牌 CLI。例如 FKGCODE 包只能安装 `fkgcode`，不得额外安装 `opencode` 或 `foreachcode` 兼容别名。

品牌构建不得运行会重写整个 `bun.lock` 的 install 操作。lockfile 描述源码依赖关系，不描述某次品牌发布产物。

### 7.6 Desktop

Electron builder 配置必须直接接收 `ResolvedBrand`，并在输出阶段设置：

- product name；
- executable name；
- app ID；
- protocol scheme；
- artifact name；
- Windows/macOS/Linux 元数据；
- Linux desktop file 和 metainfo 文件名；
- channel 后缀。

每次构建只允许打入当前 app ID 对应的一份 metainfo。不得把其他品牌或其他 channel 的历史 metainfo 打入 `app.asar` 或 resources。

### 7.7 CLI、installer、Docker 和 Nix

CLI launcher、postinstall、Shell installer、Dockerfile 和 Nix 中需要产品身份的内容必须来自模板或暂存输出。源码模板不得包含任何具体品牌展开值。

若某一分发渠道暂不支持构建态品牌参数，应显式失败并指出不支持，不得静默生成包含默认品牌的混合产物。

### 7.8 SDK 和机器协议

SDK 启动握手、server-ready 判断等机器协议必须使用稳定的、与显示名称无关的标记，避免仅修改产品名就重新生成 SDK 或破坏兼容性。

SDK 的用户可见文档可以在发布输出阶段注入品牌，但不得因为一次本地品牌构建改写仓库中已跟踪的 SDK 文件。

### 7.9 横向字标、TUI 字标、favicon 和应用图标

视觉输入分为三个明确角色：

1. `wordmark-svg`：Desktop 和 Web 品牌区域展示的长条状横向字标；
2. `tui-wordmark-grid`：TUI 中与横向字标语义对应的终端点阵字标；
3. `app-icon-svg`：操作系统、favicon、通知和应用菜单使用的方形 App Icon。

视觉输入来自当前显式品牌清单，不存在默认 visual profile。`appIconSvg` 必填；横向字标和 TUI 点阵未提供时，只能根据当前 `name` 生成。所有本地输入只用于本次构建，不得被复制回源码目录或自动加入 Git。

横向字标通常包含产品文字或完整品牌造型，是用户所说的 Desktop 长条状 Logo。它与 TUI 点阵字标表达同一品牌，但介质不同，不能把 SVG 直接粗暴转换为终端字符。App Icon 则是独立的方形视觉资产，不得由横向字标拉伸或裁切生成。

Wordmark SVG 和 App Icon SVG 必须满足：

- 文件存在且可读；
- 是不包含脚本的静态 SVG；
- 不引用 HTTP、HTTPS 或其他外部资源；
- 包含合法 `viewBox`；
- 构建前计算内容摘要，并将摘要加入构建缓存 key；
- 无法安全解析或转换时立即失败，不得回退到上一个品牌的图标。

构建系统应从已解析的横向字标和 App Icon 母版在暂存区生成：

- Desktop PNG 尺寸集；
- Windows ICO；
- macOS ICNS；
- Linux 应用图标；
- Web favicon SVG、PNG 和 ICO；
- Web manifest 图标；
- Desktop 通知和应用内需要的本地图标。

其中所有方形应用图标必须来自已解析的 App Icon，而不是横向 Logo。覆盖范围包括：

- Windows EXE、安装元数据、任务栏和窗口图标；
- macOS App Bundle、Dock 和通知图标；
- Linux desktop entry、metainfo 和应用菜单图标；
- `packages/app` 使用的 App Icon、favicon、PWA/Web manifest 图标；
- Desktop/Web 通知、本地 About 页面和其他用户可见产品图标。

这些消费者不得引用源码中某个固定品牌的图标路径，也不得引用 OpenCode 公共 favicon URL。

未提供自定义 `wordmark-svg` 时，横向字标由 `Brand.name` 和默认字形规则在构建阶段生成，不得保存某个临时品牌的展开结果。

TUI 字标的解析顺序固定为：

1. 显式 `tui-wordmark-grid` 点阵文件；
2. `visual-profile` 中登记的 TUI 点阵；
3. 根据 `Brand.name` 和共享像素字体生成的文字字标。

TUI 点阵使用结构化 JSON 表示，不接受带 ANSI 转义序列的任意文本。格式至少包含 `width`、`height` 和二维布尔或 `0/1` cells；可选 accent 区域必须使用坐标或语义分组表达，颜色仍由当前 TUI theme 决定。输入必须满足终端安全限制：

- 不含控制字符和 ANSI escape；
- 宽度不超过 80 cells，高度不超过 16 cells；
- cells 数量与声明尺寸一致；
- 不允许外部文件或网络引用；
- 内容摘要加入构建缓存 key。

同一个 TUI 字标必须由共享 renderer 驱动所有终端入口，不得在 `packages/opencode` 和 `packages/tui` 各自保存一份展开字符画。终端宽度不足时允许使用由当前 `Brand.name` 确定性生成的紧凑表示，但不存在读取其他品牌字符画的 fallback。

SVG title、Web manifest 和可访问文本必须使用当前 `Brand.name`，或使用产品无关描述。应用不得继续引用 OpenCode 公共 favicon URL。

App Icon 不得省略。传入新的横向字标、TUI 字标或 App Icon 时，所有消费该类资产的入口必须同步替换，不能只改某一个页面。

## 8. 保留标识

以下内容不受构建品牌参数影响：

| 类别          | 保留内容                                       |
| ------------- | ---------------------------------------------- |
| workspace 包  | `@opencode-ai/*`                               |
| 源码目录      | `packages/opencode` 等现有路径                 |
| 项目配置      | `.opencode`、`opencode.json`、`opencode.jsonc` |
| 环境变量      | `OPENCODE_*`                                   |
| HTTP 兼容协议 | `x-opencode-*`、稳定内部 API 类型名            |
| Provider      | `opencode` provider ID                         |
| 官方服务      | OpenCode Zen、OpenCode Go                      |
| 官方文档      | OpenCode Documentation 及已确认保留的文档 URL  |
| 版权          | MIT License、上游版权与来源归属                |

保留标识不得出现在当前产品的通用显示标题、CLI 示例、安装目录或 Desktop 身份中。

## 9. 企业安全约束

品牌参数化不得改变既有“企业信息只进不出”策略。任意品牌构建均必须满足：

- 不默认上传会话、消息、代码、诊断和模型信息到 OpenCode 公共服务；
- 未配置可信企业内部地址时，分享、Console、反馈、changelog 和上游 Web UI 代理继续 fail closed；
- 自动更新继续禁用；
- 构建过程不得因为品牌解析访问公共品牌服务；
- 品牌参数不得包含 token、密钥或内部服务凭据；
- Provider、MCP 和企业内部服务仍只根据用户或管理员的显式配置工作。

## 10. 构建可重复性和隔离

1. 相同 commit、相同品牌参数和相同工具链必须产生相同的品牌身份集合。
2. 先构建品牌 A 再构建品牌 B，品牌 B 的产物中不得出现品牌 A 的显示名、slug、app ID、协议、目录名或旧 metainfo。
3. 构建顺序不得影响最终身份。
4. dev、beta、prod 必须使用各自 app ID，不得共享 store 或 userData。
5. 不同 slug 被视为不同产品，不提供配置或数据迁移。
6. 构建缓存 key 必须包含完整品牌配置摘要、channel、横向字标、App Icon 和 TUI 点阵的内容摘要。

## 11. 测试要求

### 11.1 品牌解析测试

至少覆盖：

- 缺少显式品牌清单时失败；
- `FKGCODE` 自动派生 `fkgcode`；
- 显式 slug；
- 非 ASCII 名称缺少 slug 时失败；
- 非法 slug 和 app ID 时失败；
- `--brand-config` 优先于 `PRODUCT_BRAND_CONFIG`；
- 解析结果深度只读；
- channel 身份派生正确；
- Wordmark SVG 不存在、包含脚本或引用外部资源时失败；
- App Icon 的 viewBox、安全区或外部资源校验失败时终止构建；
- TUI 点阵尺寸、cells 或控制字符不合法时失败；
- 未提供 TUI 点阵时根据当前 `Brand.name` 确定性生成，且不读取任何其他品牌资产。

### 11.2 源码零修改测试

测试必须记录构建前工作树快照，执行品牌构建后再次比较。允许调用前已经存在的用户改动，但构建不得新增、删除或修改任何 Git 跟踪状态。

在干净 CI 中，以下命令执行后必须仍为空：

```text
git status --porcelain
```

### 11.3 双品牌合同测试

同一测试流程依次构建：

```text
ForeachCode / foreachcode
FKGCODE / fkgcode
```

分别验证：

- executable 和 artifact 名称；
- Windows/macOS/Linux 产品元数据；
- CLI 名称及真实 launcher 可执行性；
- app ID 和 deep link；
- data/config/cache/state/tmp 路径；
- database、log 和 Desktop store；
- HTML、TUI、OAuth 和 Enterprise 展示名称；
- Desktop 和 Web 品牌区域使用当前横向字标；
- `packages/app`、操作系统外壳和通知使用当前 App Icon；
- TUI 启动页、首页和终端品牌区域使用当前 TUI 字标；
- SDK 启动协议没有因显示名变化失效；
- 当前产物不包含另一个测试品牌的身份。

### 11.4 历史残留扫描

扫描必须使用明确的历史品牌 denylist 和兼容 allowlist，不能只搜索当前 `Brand.name`。至少覆盖：

- TypeScript、JavaScript、JSON、HTML、SVG、Shell、Docker、Nix；
- Electron resources 和 `app.asar`；
- 安装包、portable 包和 CLI artifact；
- SDK/OpenAPI 用户可见描述；
- app ID、协议、store key、目录和 metainfo 文件名。

### 11.5 启动验证

每个支持的平台至少验证：

- Desktop 冷启动；
- Desktop 二次实例 deep link；
- CLI `--version`；
- SDK 管理的 server 启动；
- 当前品牌首次启动不读取任何其他品牌的全局目录。

## 12. 验收标准

本规格完成必须同时满足：

1. 一条构建命令可以从默认源码生成 FKGCODE prod 可运行包。
2. 构建 FKGCODE 不需要编辑任何源码或配置文件。
3. 构建结束后 Git 工作树状态与构建开始前完全一致。
4. `bun.lock` 不因品牌变化产生差异。
5. FKGCODE 产物的名称、CLI、协议、app ID 和全局目录全部为 `FKGCODE` / `fkgcode` 派生值。
6. FKGCODE 产物中不存在 ForeachCode 运行时身份残留；明确允许的兼容标识除外。
7. 随后构建 ForeachCode 时，不包含 FKGCODE 残留。
8. 两个品牌的 Desktop、CLI 和 SDK 启动验证均通过。
9. 指定 FKGCODE 横向字标和 App Icon 后，Desktop 长条字标与方形图标各自使用正确母版，且不包含默认视觉资产残留。
10. `packages/app`、Windows、macOS、Linux、favicon、manifest 和通知中的 App Icon 全部来自同一个已解析 App Icon。
11. 指定 FKGCODE TUI 点阵后，所有终端入口使用该点阵；未指定时显示由 `FKGCODE` 生成的像素字标，均不得出现 ForeachCode TUI 字样。
12. 现有业务逻辑测试通过，品牌构建没有修改会话、模型、工具、权限和文件处理逻辑。
13. 企业数据出网限制和更新禁用策略在两个品牌中均通过行为测试。

## 13. 与现有品牌生成器的关系

现有 `brand:generate` 直接回写源码的模式只作为过渡实现，不是本规格的最终方案。

完成迁移后：

- `brand:generate` 不得继续修改 Git 跟踪文件；
- `brand:check` 应验证消费者、模板和构建输出合同，而不是要求源码保存某次品牌展开值；
- 具体品牌源码只允许存在于显式 preset；
- 所有静态展开内容进入构建暂存区或最终产物；
- FKGCODE 等验证品牌不应作为源码生成结果提交。

## 14. 完成定义

只有当“修改产品名称”从一次源码变更变成一次纯构建操作时，本规格才算完成。最终使用者应能在不修改、不提交任何品牌文件的情况下，通过参数构建独立身份的产品，并能用自动化证据证明产物完整、隔离且没有旧品牌残留。
