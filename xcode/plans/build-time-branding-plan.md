# 构建态品牌参数化实施计划

- 状态：已完成
- 基线：OpenCode `1.17.9` + ForeachCode 企业改造
- 规格来源：`xcode/specs/build-time-branding.md`
- 默认品牌：无；开发时显式选择 `xcode/build/foreachcode/dev.json`
- 验证品牌：`FKGCODE / fkgcode`
- 更新时间：2026-08-14

## 1. 交付结果

提供单一构建入口：

```text
bun run product:build --brand-config <path-to-brand.json>
```

该命令必须在不改写 Git 跟踪文件的情况下生成品牌完整、可直接运行的 Desktop prod 包，并为 CLI、Web/TUI/Enterprise 和后续分发构建提供同一份已解析品牌配置。

## 2. 当前状态和迁移原则

当前工作树包含一次将 ForeachCode 展开为 FKGCODE 的验证性修改。这些展开结果不作为最终架构提交：

- 将 ForeachCode 收敛到唯一显式 preset，生产源码不保留默认品牌；
- 保留本次验证发现的“旧 metainfo 被打包”回归测试和通用修复；
- 不提交 FKGCODE 展开后的 package manifest、HTML、SVG、SDK 或 lockfile；
- FKGCODE 只作为构建参数和测试 fixture 出现在合同测试中；
- 不覆盖此前已经提交的 ForeachCode 企业安全和产品身份改造。

## 3. 技术方案

### 3.1 品牌模型

在 `@opencode-ai/brand` 中建立：

- `BrandInput`：显式品牌清单的输入模型；
- `resolveBrand(input)`：一次性校验并深冻结 `ResolvedBrand`；
- `Brand`：只由 bundler 编译期注入的最终品牌常量；
- `resolveVisuals(input)`：解析 visual profile 和显式视觉覆盖。

显示名不能无条件转为 slug。仅 ASCII 字母数字名称可以自动派生；其他名称必须显式提供合法 slug。

### 3.2 构建入口

新增根命令 `product:build`，职责限于：

1. 读取一个显式 `--brand-config` 清单；
2. 生成不可变 `ResolvedBrand`；
3. 校验并解析视觉资产；
4. 创建品牌隔离的临时构建目录；
5. 调用 Desktop、CLI、SDK/静态输出的窄构建适配器；
6. 验证产物身份和源码零修改；
7. 输出产物路径、品牌摘要和 SHA256。

不存在默认配置或字段级环境变量 fallback。业务代码和下游构建不得再次各自解析环境变量。

### 3.3 编译期注入

- Bun CLI build 使用 `define` 注入序列化品牌常量；
- Electron main、preload、renderer 使用同一个 define/virtual module 配置；
- 直接运行的 build config 从统一解析结果读取，不自行派生字段；
- 最终 bundle 中不得保留 `PRODUCT_*` 环境变量读取；
- SDK server-ready 使用稳定机器标记，用户可见描述在发布暂存区生成。

### 3.4 静态文件和 manifest

- HTML 使用构建期 transform，不回写源码标题；
- Desktop/CLI 发布 manifest 在暂存区生成；
- CLI 动态 bin key 只存在于发布暂存 manifest；
- Shell、Docker、Nix 和 postinstall 使用模板或暂存输出；
- 品牌构建不运行 `bun install`，不修改 `bun.lock`；
- 旧 `brand:generate` 迁移为只生成临时输出，最终不得回写 Git 跟踪文件。

### 3.5 视觉资产

视觉资产分为：

- `wordmark-svg`：Desktop/Web 横向字标；
- `tui-wordmark-grid`：TUI 点阵字标；
- `app-icon-svg`：方形 App Icon；
- `visual-profile`：三类资产的默认集合，单项参数可覆盖同类资产。

所有输入先做安全校验和内容摘要，再在品牌临时目录生成 PNG、ICO、ICNS、favicon、manifest、Linux 图标和 metainfo。源码资源目录不得产生新文件。

### 3.6 零污染保证

构建入口开始时记录：

- `git status --porcelain=v2`；
- 所有已修改/未跟踪文件的路径和内容摘要；
- Git 跟踪文件索引摘要。

构建结束后重新比较。构建允许调用前已经存在的用户修改，但不得新增或改变任何工作树状态。临时目录和最终 dist 目录必须位于 Git 忽略的构建路径。

## 4. TDD 实施阶段

### 阶段 A：品牌参数解析 RED → GREEN

先写失败测试：

- 缺少显式品牌清单时失败；
- FKGCODE 自动派生 fkgcode；
- `--brand-config` > `PRODUCT_BRAND_CONFIG`，且不存在 default；
- 非 ASCII 名称缺少 slug 失败；
- 非法 slug/app ID/channel 失败；
- 派生字段和 channel 身份一致；
- 结果深冻结；
- consumer 不能重新声明产品身份。

GREEN 后运行 brand typecheck 和现有品牌合同测试。

### 阶段 B：视觉输入 RED → GREEN

先写失败测试：

- visual profile 默认解析；
- wordmark、TUI grid、App Icon 独立覆盖；
- SVG 脚本和外部资源拒绝；
- App Icon 方形 viewBox 校验；
- TUI grid 尺寸、cells、控制字符校验；
- 视觉摘要稳定且参与缓存 key；
- FKGCODE 与默认 profile 不交叉残留。

GREEN 后验证生成文件只位于测试临时目录。

### 阶段 C：构建注入 RED → GREEN

先写失败合同测试：

- 同一源码构建两种 Brand bundle；
- bundle 中 Brand 值正确且无运行时 `PRODUCT_*` 读取；
- Desktop main/preload/renderer 使用相同品牌；
- HTML 标题在输出阶段注入；
- app ID、协议、可执行文件和 artifact 名同步；
- CLI launcher 查找当前品牌二进制；
- SDK server-ready 不依赖显示名称。

按消费者逐步接入，禁止全仓字符串替换。

### 阶段 D：静态暂存与 lockfile 隔离 RED → GREEN

先写失败测试：

- 发布 manifest 在临时目录生成动态 CLI bin；
- 源码 package manifest 不变；
- HTML/SVG/Shell/Docker/Nix 模板不被改写；
- 品牌构建不触发 install；
- `bun.lock` 内容摘要不变；
- 不生成旧 app ID metainfo。

迁移或封装旧 `brand:generate`，使其不再回写源码。

### 阶段 E：端到端双品牌验收

1. 从相同工作树构建 ForeachCode prod portable；
2. 随后构建 FKGCODE prod portable；
3. 再次构建 ForeachCode；
4. 对三个产物扫描名称、slug、app ID、协议、目录、store、metainfo 和视觉摘要；
5. 确认构建顺序不影响产物；
6. 启动 Desktop，运行 CLI `--version`，验证 deep link 和 SDK server；
7. 验证构建前后的工作树快照完全相同。

## 5. SubAgent 分工

### Agent A：品牌参数合同

边界：`packages/brand` 的模型、解析、校验和测试。不得修改 Desktop、CLI 或视觉生成消费者。

### Agent B：视觉构建合同

边界：视觉 profile、SVG/TUI grid 安全校验、临时资产生成和测试。不得修改业务 UI 逻辑。

### Agent C：构建集成合同

边界：根构建入口、Desktop/CLI 编译期注入、暂存 manifest、HTML transform 和零污染测试。不得修改会话、Provider、工具、权限或文件业务逻辑。

### Root：整合和验收

负责收敛显式品牌 preset、协调公共 API、解决交叉依赖、审查 scope、运行全套验证、打 FKGCODE prod 可运行包并检查 Git 零污染。

## 6. 不得修改的业务区域

除品牌值消费所必需的窄改外，不得修改：

- Session 和 prompt 执行流程；
- Provider 请求和认证逻辑；
- MCP、LSP、工具调用和权限判断；
- 文件读取、编辑、diff、PTY 和项目管理逻辑；
- 企业出网策略和 updater 禁用行为；
- 数据库 schema 和用户数据迁移逻辑。

发现相邻缺陷时先记录，不顺手改业务逻辑。

## 7. 验证矩阵

| 层级           | 必须通过                                                           |
| -------------- | ------------------------------------------------------------------ |
| Brand          | parser、derivation、freeze、precedence tests；typecheck            |
| Visual         | SVG/TUI security、profile override、asset hash tests               |
| Core/CLI       | global path、database/log、launcher、server-ready tests；typecheck |
| Desktop        | identity、deep link、metainfo、store、updater tests；typecheck     |
| App/TUI/UI     | wordmark、App Icon、TUI renderer tests；typecheck                  |
| Enterprise/SDK | display/OpenAPI/server launch contracts；typecheck                 |
| Build          | ForeachCode + FKGCODE prod build、portable smoke、artifact scan    |
| Repository     | `brand:check`、`git diff --check`、构建前后工作树快照一致          |

测试必须从各 package 目录运行，禁止在仓库根直接运行 package tests。

## 8. 完成定义

- `product:build` 能以参数生成 FKGCODE 可运行包；
- 不需要编辑品牌源码；
- 不修改 `bun.lock` 或任何 Git 跟踪文件；
- 横向字标、TUI 字标和 App Icon 都可独立替换；
- 不传品牌清单时在构建写文件前失败；
- 双品牌连续构建无身份和视觉残留；
- 相关测试、typecheck、prod build 和 smoke 全部通过；
- 变更不触及非品牌业务逻辑。
