# ForeachCode 产品改名实施计划

- 状态：实现完成，验证通过
- 基线：OpenCode `1.17.9`
- 目标产品：`ForeachCode`
- 规格来源：`xcode/specs/product-rebrand.md`
- 计划更新时间：2026-08-13

## 0. 实施结果

- 已建立 `@opencode-ai/brand` 单一品牌数据源，并为不能直接导入 TypeScript 的 9 个静态目标提供 `brand:generate` / `brand:check`。
- 已完成 CLI、全局目录、数据库、日志、managed config、Desktop app ID、Deep Link、持久化 store、WSL 路径和安装产物的独立身份改造。
- 已禁用 Desktop 自动更新并隐藏更新入口；CLI 和 WSL 不再连接 OpenCode 官方安装或更新源。
- 已从确认的 SVG 母版生成 dev、beta、prod 三套 PNG、ICO、ICNS 和 Windows 图标资源。
- 定向自动化测试共 198 项通过，8 个受影响 package 的类型检查通过。
- `foreachcode.exe` 构建及 smoke test 通过；临时 XDG 环境隔离验证通过，旧目录哨兵未改变。
- Desktop 主进程、preload 和 renderer 生产构建通过；品牌包已编译进主进程产物，Windows NSIS 产物 `foreachcode-desktop-win-x64.exe` 构建及实际启动验证通过。
- 残留审计未发现运行时代码硬编码当前产品名；保留项仅为 spec 允许的内部兼容标识、官方服务名以及拒绝旧身份的负向测试。

## 1. 交付目标

在不重命名源码包路径、workspace 包和项目配置协议的前提下，完成 ForeachCode 的独立产品身份：

1. 对外产品名称统一为 `ForeachCode`。
2. CLI 命令和发布产物统一为 `foreachcode`。
3. Desktop 使用独立 app ID、协议、安装身份和用户数据目录。
4. 全局配置、数据、缓存、状态、数据库和日志使用 ForeachCode 路径。
5. 禁用并隐藏 OpenCode 官方自动更新入口。
6. 安装、启动和卸载均不读取或修改旧 OpenCode 全局数据。
7. 建立品牌单一数据源，使后续文字和产品身份改名只需修改少量品牌字段并重新生成静态配置。

## 2. 已确认边界

### 2.1 必须修改

- 产品展示名：`OpenCode` → `ForeachCode`。
- CLI：`opencode` → `foreachcode`。
- CLI 安装结果：`~/.foreachcode/bin/foreachcode`。
- Desktop app ID：`ai.foreachcode.desktop*`。
- Deep Link：`foreachcode://`。
- XDG 应用目录名：`foreachcode`。
- 数据库：`foreachcode.db` 或 `foreachcode-<channel>.db`。
- 日志：`foreachcode.log`。
- Desktop、CLI/TUI、OAuth 和已纳入范围的用户可见品牌文案。
- ForeachCode 字标、TUI 字符画和应用图标资源。

### 2.2 必须保留

- 源码目录 `packages/opencode`。
- workspace 包 `@opencode-ai/*`。
- npm 包名和 TypeScript 内部标识，除非它们直接决定外部产品身份。
- 项目级 `.opencode`。
- 项目配置 `opencode.json`、`opencode.jsonc`。
- `OPENCODE_*` 环境变量。
- `opencode` provider ID。
- OpenCode Zen、OpenCode Go、OpenCode Documentation 及官方文档 URL。
- MIT License、上游仓库地址和原始版权声明。

### 2.3 明确不做

- 不提供 `opencode` CLI 别名、软链接或兼容脚本。
- 不迁移、不兼容读取、不删除旧 OpenCode 数据。
- 不建设企业内部自动更新服务。
- 不重命名包命名空间、项目配置目录或配置文件。
- 不把 Web、Enterprise 页面和专项视觉回归作为交付阻断项。

## 3. 预期目录与身份

| 类型                     | ForeachCode 目标值                               |
| ------------------------ | ------------------------------------------------ |
| CLI 可执行文件           | `~/.foreachcode/bin/foreachcode`                 |
| XDG config               | `$XDG_CONFIG_HOME/foreachcode`                   |
| XDG data                 | `$XDG_DATA_HOME/foreachcode`                     |
| XDG cache                | `$XDG_CACHE_HOME/foreachcode`                    |
| XDG state                | `$XDG_STATE_HOME/foreachcode`                    |
| 临时目录                 | `${os.tmpdir()}/foreachcode`                     |
| 默认数据库               | `$XDG_DATA_HOME/foreachcode/foreachcode.db`      |
| 默认日志                 | `$XDG_DATA_HOME/foreachcode/log/foreachcode.log` |
| Windows Desktop userData | `%APPDATA%/ai.foreachcode.desktop*`              |
| macOS managed config     | `/Library/Application Support/foreachcode`       |
| Windows managed config   | `%ProgramData%/foreachcode`                      |
| Linux managed config     | `/etc/foreachcode`                               |
| Desktop 正式 app ID      | `ai.foreachcode.desktop`                         |
| Desktop 测试 app ID      | `ai.foreachcode.desktop.beta`                    |
| Desktop 开发 app ID      | `ai.foreachcode.desktop.dev`                     |
| Deep Link                | `foreachcode://`                                 |

项目仓库中的 `.opencode` 和 `opencode.json(c)` 不属于上述产品全局目录，继续保持原样。

## 4. 实施顺序

### 阶段 0：保护基线并审计已有修改

当前工作区已经存在未提交的品牌修改，实施前先完成以下工作：

- 记录 `git status --short` 和当前 diff。
- 按 spec 将已有修改分成“保留、补全、恢复”三类。
- 不重置或覆盖用户已有修改。
- 识别已改展示名但尚未修改的外部身份，例如 app ID、协议、CLI 文件名和全局目录。
- 建立允许保留的 `OpenCode/opencode` 清单，避免全仓库盲目替换。

完成标准：每个现有改动都能对应到 spec，且没有把上游服务名或内部包路径误改成 ForeachCode。

### 阶段 1：建立品牌单一数据源

主要文件：

- `packages/brand/package.json`
- `packages/brand/src/index.ts`
- `script/brand.ts`
- 根目录 `package.json`
- 各消费品牌值的 package manifest

任务：

- 新增内部包 `@opencode-ai/brand`；包名保持在现有 `@opencode-ai` 内部命名空间，不对外代表产品名。
- 使用一个只读品牌对象集中声明以下源字段：
  - `name`: `ForeachCode`
  - `slug`: `foreachcode`
  - `desktopAppId`: `ai.foreachcode.desktop`
- 从源字段派生 CLI 名称、Deep Link、目录名、数据库名、日志名、dev/beta app ID 和 channel 展示名，避免重复维护。
- 保持品牌包零运行时依赖且浏览器安全，使 Core、CLI、TUI、App、UI、Enterprise、Desktop 和构建配置均可引用。
- 将 TypeScript/TSX 中的品牌字面量改为 `Brand` 引用；多语言文案通过品牌常量插值，不在每个语言文件复制产品名。
- 将 SVG 横向字标和 TUI 字符画改为从 `Brand.name` 渲染，或由生成器输出；字形表本身可复用，产品名称不得继续固化为专用 path/字符串数组。
- 新增 `script/brand.ts`，为不能 import TypeScript 的文件生成或校验品牌字段。
- 在根脚本中增加：
  - `brand:generate`：更新受控的静态字段或文件。
  - `brand:check`：只检查，不写文件；发现不同步时返回非零状态。
- 生成脚本仅允许修改明确列出的 JSON 字段、标记区块或完整生成文件，不执行全仓库字符串替换。
- 将 `.opencode`、`opencode.json(c)`、`OPENCODE_*`、provider 和官方服务名列为非品牌派生值。

品牌源的预期用法示意：

```ts
export const Brand = {
  name: "ForeachCode",
  slug: "foreachcode",
  desktopAppId: "ai.foreachcode.desktop",
} as const
```

实际实现可以在同一模块中提供派生字段，但不得在其他 package 重新声明一份产品常量。

完成标准：修改测试品牌值后运行 `brand:generate`，所有受控外部身份都随之变化；恢复 ForeachCode 值后 `brand:check` 通过。

### 阶段 2：修改 CLI 命令和构建产物

主要文件：

- `packages/opencode/package.json`
- `packages/opencode/script/build.ts`
- `install`
- CLI 帮助、卸载和命令示例相关文件
- Desktop WSL 中的 CLI 安装和探测代码

任务：

- 将 package 的 `bin` 命令键改为 `foreachcode`，包自身名称仍保持 `opencode`。
- 将编译输出从 `bin/opencode` 改为 `bin/foreachcode`。
- 更新构建脚本的 smoke test，使其执行 `foreachcode --version`。
- 将安装目录改为 `~/.foreachcode/bin`，目标文件名改为 `foreachcode`。
- 更新 PATH 注释、安装成功提示、版本检查和命令示例。
- 更新 WSL 探测路径为 `$HOME/.foreachcode/bin/foreachcode`。
- 不查找 `$HOME/.opencode/bin/opencode`，不生成兼容别名。
- 更新卸载逻辑，使其只处理 ForeachCode 安装和全局目录。

远程安装约束：

- 安装器不得继续下载 OpenCode 官方 release 作为 ForeachCode 二进制。
- 内部发布地址未确定前，使用 `--binary` 验证本地产物安装流程。
- 不虚构企业下载地址；远程发布接入需要单独提供真实地址。

完成标准：构建目录、压缩包和安装目录中只有名为 `foreachcode` 的 CLI 可执行文件。

### 阶段 3：修改全局运行目录

主要文件：

- `packages/core/src/global.ts`
- `packages/core/src/database/database.ts`
- `packages/core/src/observability/logging.ts`
- `packages/opencode/src/config/managed.ts`
- 使用 `Global.Path` 的相关测试

任务：

- 将全局应用目录片段从 `opencode` 改为 `foreachcode`。
- 将默认数据库文件改为 `foreachcode.db`，channel 数据库同步改名。
- 将默认日志文件改为 `foreachcode.log`。
- 将 managed config 路径和 macOS plist domain 改为 ForeachCode 身份。
- 保留 `OPENCODE_CONFIG_DIR`、`OPENCODE_DB` 等现有环境变量及其覆盖行为。
- 不添加任何旧目录探测、复制或回退逻辑。
- 临时目录、认证文件、session 数据、repo 数据和工具输出通过新的 `Global.Path` 自然进入 ForeachCode 目录。

完成标准：使用默认配置启动时只创建 ForeachCode 全局目录；测试预置的旧 OpenCode 目录保持未访问、未修改。

### 阶段 4：修改 Desktop 独立身份

主要文件：

- `packages/desktop/electron-builder.config.ts`
- `packages/desktop/electron-builder.config.test.ts`
- `packages/desktop/package.json`
- `packages/desktop/src/main/index.ts`
- `packages/desktop/src/main/store-keys.ts`
- `packages/desktop/src/main/store.ts`
- `packages/desktop/src/main/updater.ts`
- `packages/desktop/src/main/wsl/*.ts`
- Linux desktop entry 和平台资源

任务：

- 将 dev、beta、prod app ID 改为 `ai.foreachcode.desktop*`。
- 将协议注册和二次实例 URL 识别改为 `foreachcode://`。
- 将 artifact name、Linux executable name、desktop file、rpm/deb 名称改为 ForeachCode 身份。
- 删除旧 OpenCode launcher/pin 兼容安装逻辑；本项目不做旧版兼容。
- 让 Electron `userData` 使用新的 app ID 路径。
- 将 onboarding 临时目录等产品拥有的运行目录改为 `foreachcode-*`。
- 将 Desktop 自有 store 文件和持久化键改为 `foreachcode.*`，不读取旧 `opencode.*` store。
- 停止调用旧 Tauri/OpenCode 数据迁移逻辑；无其他引用后删除对应迁移代码和测试。
- 更新 WSL 内 CLI 路径和启动命令。
- 保持内部 HTTP 用户名、协议字段或 API 标识不变，除非它们属于用户可见产品身份。

完成标准：安装包元数据、运行时 app ID、Deep Link、userData 和持久化文件均属于 ForeachCode，且不存在旧身份兼容安装项。

### 阶段 5：禁用自动更新

主要文件：

- `packages/desktop/src/main/constants.ts`
- `packages/desktop/src/main/menu.ts`
- `packages/desktop/src/main/updater*.ts`
- App 中的更新菜单和设置入口

任务：

- 固定 `UPDATER_ENABLED = false`。
- 不初始化或触发 check、download、install 更新动作。
- 隐藏“检查更新”和相关设置入口，而不仅是禁用点击。
- 保留 updater 代码结构，供以后接入企业更新服务。
- 构建配置可以暂时保留上游 publish 元数据，但运行时不得访问它；如 publish 元数据会触发构建或运行行为，则从 ForeachCode 产物中移除。

完成标准：菜单和设置中没有更新入口，自动化测试证明 updater controller 不会调用官方更新检查。

### 阶段 5.1：关闭产品公共服务出网

- 移除公共会话分享兜底地址，分享后端仅接受显式配置的 `enterprise.url`。
- 关闭自动分享，并移除 Web UI、CLI 和 TUI 的分享入口与提示。
- 从 CLI 注册表移除默认 OpenCode Console 和 GitHub Agent 命令。
- 保持 changelog、反馈、公共 Web UI 代理和官方更新源 fail-closed。
- 保留显式 URL 导入能力，确保导入请求不向非配置域名附带企业鉴权头。
- 增加出网契约测试，覆盖零默认分享 HTTP 调用、不可达公共产品服务和 Enterprise 外链删除。

完成标准：未配置内部地址时不会向 OpenCode 产品服务发送会话或诊断数据；所有普通用户分享入口均不可见。

### 阶段 6：完成产品展示层和资源

主要范围：

- Desktop 窗口、菜单、系统提示和 WSL 提示
- CLI/TUI 启动画面、标题、权限和卸载提示
- OAuth 回调与外部认证显示名
- 已有 Web UI、Enterprise 品牌修改
- `packages/ui` 字标、favicon 和主题元数据
- Desktop 图标资源
- package author、homepage 等发布元数据

任务：

- 复查并补全当前工作区已经开始的展示名修改。
- 保留 OpenCode Zen、OpenCode Go 和 OpenCode Documentation 原名。
- 使用已确认的 SVG 字标、TUI 字符画和应用图标。
- 保持当前已确认的字标与字符画视觉结果，同时让其中的文字由品牌源驱动。
- 从确认的应用图标 SVG 母版生成构建所需的 PNG、ICO、ICNS 等资源。
- `author.name` 改为 ForeachCode；移除上游联系邮箱和产品 homepage；保留 License、repository 和版权。
- Web 和 Enterprise 只完成已确认品牌修改及构建兼容，不安排专项页面验收。
- 不因改名重命名源码文件、theme ID、翻译 key、类型或 API 标识。

完成标准：允许清单以外的用户可见产品名统一为 ForeachCode，受影响 package 能正常构建。

### 阶段 7：静态清理与一致性检查

任务：

- 扫描 `OpenCode` 和 `opencode` 残留。
- 按“用户可见品牌、产品外部身份、官方服务、内部兼容标识”分类审查。
- 重点检查 CLI 输出名、安装脚本、Desktop app ID、protocol、artifact、XDG 目录、数据库和日志。
- 检查没有 `opencode` CLI alias、旧 Desktop launcher 或旧数据迁移入口。
- 检查新增路径和文件名在测试、构建脚本及文档示例中一致。
- 运行 `brand:check`，检查生成内容没有偏离品牌源。

完成标准：所有残留均在 spec 允许清单内，或有明确的内部兼容理由。

## 5. 测试计划

### 5.1 自动化测试

需要补充或更新以下测试：

- Brand 派生出的 CLI、协议、目录、数据库、日志和各 channel app ID 符合预期。
- SVG 字标和 TUI 字符画使用品牌名输入，测试品牌名变化时不会继续输出 `FOREACHCODE`。
- `brand:generate` 具有幂等性，连续执行不会产生额外 diff。
- `brand:check` 能识别手工篡改的生成值并返回失败。
- Global Path 默认值全部包含 `foreachcode`。
- 默认数据库与日志文件名为 ForeachCode。
- managed config 在三平台返回 ForeachCode 路径。
- CLI 构建产物名和 smoke test 使用 `foreachcode`。
- 安装脚本在临时 HOME 中只创建 `.foreachcode/bin/foreachcode`。
- Desktop 各 channel 的 app ID、artifact、协议和 executable identity。
- Desktop userData、store key 和 WSL CLI 路径。
- updater disabled 状态以及菜单入口隐藏。
- 不存在旧数据迁移调用和旧身份兼容 launcher。

测试必须从对应 package 目录运行，不能从仓库根目录运行测试。

### 5.2 类型检查

根据实际改动，从以下受影响目录分别运行 `bun typecheck`：

- `packages/core`
- `packages/opencode`
- `packages/desktop`
- `packages/app`
- `packages/ui`
- `packages/tui`
- `packages/enterprise`

Web、Enterprise 不做专项页面验收，但只要其源码被修改，类型检查和构建不能失败。

### 5.3 CLI 构建与隔离验证

从 `packages/opencode` 构建当前平台单一产物：

```text
bun run build --single
```

验证：

- 输出文件名为 `foreachcode` 或 Windows 下的 `foreachcode.exe`。
- `foreachcode --version`、`foreachcode --help`、`foreachcode serve` 可执行。
- 临时 HOME/XDG 环境中只生成 ForeachCode 目录。
- 预先放入旧 OpenCode 目录的哨兵文件在运行前后哈希和时间戳不变。
- `--binary` 安装后只得到 `~/.foreachcode/bin/foreachcode`。

### 5.4 Desktop 构建与运行验证

从 `packages/desktop` 运行：

```text
bun run build
bun run package:win
```

验证：

- 安装包名、Product Name、app ID、EXE 名称和协议属于 ForeachCode。
- 安装后窗口和系统菜单显示 ForeachCode。
- `foreachcode://` 能被注册并唤起应用。
- `%APPDATA%/ai.foreachcode.desktop*` 被创建。
- 不读取 `%APPDATA%/ai.opencode.desktop*`。
- 更新菜单不可见，启动时不检查 OpenCode 官方更新。
- 卸载只处理 ForeachCode 文件和目录。

当前环境完整验收 Windows；macOS 和 Linux 只检查配置与可自动化测试，实际平台安装包验收需对应系统或 CI runner。

### 5.5 非阻断项

以下内容不作为最终交付阻断项：

- Web 页面逐页人工检查。
- Enterprise 页面逐页人工检查。
- 字标、TUI 字符画和应用图标的专项视觉回归。

这不免除相关源码的类型检查、构建检查和基础资源存在性检查。

## 6. 最终交付门槛

只有同时满足以下条件，才能认为改名成功：

1. `foreachcode` CLI 能从构建产物和安装目录正常运行。
2. ForeachCode 不提供 `opencode` CLI 命令或别名。
3. 默认全局目录、数据库、日志和 Desktop userData 均使用 ForeachCode 身份。
4. 旧 OpenCode 目录在测试运行前后保持不变。
5. Desktop app ID 和 Deep Link 分别为 `ai.foreachcode.desktop*` 与 `foreachcode://`。
6. 自动更新入口不可见，运行时不触发 OpenCode 官方更新。
7. 允许清单以外没有错误的 OpenCode 用户可见品牌残留。
8. 受影响 package 的类型检查、目标测试和 Windows 构建通过。
9. `brand:check` 通过，且代码审查没有发现新增的重复品牌常量。

## 7. 实施风险与处理

| 风险                                            | 处理方式                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| 当前工作区已有大量未提交修改                    | 先审计并保留，不使用 reset 或整仓覆盖                              |
| 盲目替换破坏 OpenCode Zen/Go、包路径或 provider | 使用允许清单逐项审查                                               |
| 把所有 `opencode` 都错误绑定到品牌 slug         | 只让外部产品身份引用 Brand，兼容标识使用明确的原值                 |
| 静态文件无法直接引用 TypeScript 品牌包          | 使用受控生成器和 `brand:check`，不复制手写常量                     |
| 生成器改写范围过大导致上游合并困难              | 只更新白名单字段、标记区块或完整生成文件                           |
| CLI 文件名只改一处导致构建、安装和 WSL 不一致   | 将 package bin、build、install、WSL 和测试作为同一阶段修改         |
| Global 模块加载时提前创建目录                   | 在隔离环境中测试，并确保默认值直接指向 ForeachCode，不增加迁移逻辑 |
| Desktop 仍携带旧 launcher 或协议                | builder 配置测试覆盖全部 channel，并删除兼容安装项                 |
| installer 继续下载上游 OpenCode 二进制          | 未配置内部发布源前只验证本地 `--binary` 安装                       |
| Windows 验证无法代表 macOS/Linux                | 平台配置自动化测试通过后，将实际安装包验证留给对应 runner          |

## 8. 计划外依赖

以下信息不阻塞本地改名和 Windows 构建，但会阻塞正式分发：

- ForeachCode CLI 的企业内部下载地址。
- Desktop 安装包的内部发布位置。
- Windows/macOS 代码签名身份。
- macOS、Linux 构建或 CI runner。

这些依赖不应通过继续使用 OpenCode 官方 release 来临时替代。
