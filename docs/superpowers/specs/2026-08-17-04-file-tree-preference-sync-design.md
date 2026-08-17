# OpenCode 1.18.18 文件树偏好同步落地设计

- 类型：版本级实施规格
- Origin spec：父级根仓 `docs/origin-specs/03-file-tree-preference-sync.md`（`ORIGIN-03`）
- 目标版本：OpenCode `1.18.18`
- 目标基线：`v1.18.18`
- 实现分支：`dev-foreachcode-1.18.18`
- 当前完成提交：待用户明确要求提交后填写
- 状态：已实现，待提交

## 1. 目标

在 1.18.18 的会话页中同步“显示文件树”偏好，使设置恢复和运行时切换都能驱动文件树打开/关闭，同时不把设置恢复前的临时默认值当作用户意图。

该需求只处理会话文件树的打开状态同步，不改变布局结构、文件树宽度、tab、review panel、响应式断点、V1/V2 布局开关或设置持久化格式。

## 2. 当前版本源码映射

1.18.18 中相关代码位置：

- `packages/app/src/context/settings.tsx`
  - `settings.ready()` 表示设置持久化已恢复；
  - `settings.general.showFileTree()` 是原始用户偏好；
  - `settings.visibility.fileTree()` 是 UI 可见性投影，会结合 V1/V2 布局规则。
- `packages/app/src/context/layout.tsx`
  - `layout.fileTree.opened()` 保存会话布局中的文件树打开状态；
  - `layout.fileTree.open()` / `close()` 只改布局状态，不回写设置。
- `packages/app/src/pages/session.tsx`
  - `desktopFileTreeOpen` 只读取 `settings.visibility.fileTree()` 与 `layout.fileTree.opened()`；
  - 当前没有 effect 在设置恢复完成后补偿打开文件树。
- `packages/app/src/pages/session/helpers.ts`
  - 已有 `shouldShowFileTree` 纯函数和测试，适合放入新的同步 helper。

## 3. 行为设计

新增纯状态机 `fileTreePreferenceAction` 和响应式接线 `createFileTreePreferenceSync`。`Session` 在创建布局和设置上下文后调用接线函数。它观察：

- `settings.ready()`；
- `settings.visibility.fileTree()`；
- `layout.fileTree.open()`；
- `layout.fileTree.close()`。

同步规则：

| 场景                               | 行为                                  |
| ---------------------------------- | ------------------------------------- |
| 设置未恢复                         | 不执行任何动作                        |
| 首次恢复且可见性为 `true`          | 调用 `layout.fileTree.open()` 一次    |
| 首次恢复且可见性为 `false`         | 不调用 `close()`，保留当前初始布局    |
| 设置就绪后 `false -> true`         | 调用 `open()` 一次                    |
| 设置就绪后 `true -> false`         | 调用 `close()` 一次                   |
| 重复相同值                         | 不重复调用                            |
| 组件重新挂载且设置已就绪为 `true`  | 新实例再次调用 `open()`，补偿挂载时序 |
| 组件重新挂载且设置已就绪为 `false` | 不主动关闭                            |

同步过程只改 `layout.fileTree`，不写 `settings`，避免偏好和布局形成反馈循环。

## 4. 测试设计

在 `packages/app/src/pages/session/helpers.test.ts` 中补充测试：

- 设置未恢复时不打开或关闭；
- 首次恢复为启用时只打开一次；
- 首次恢复为关闭时不关闭；
- 设置就绪后的启用/关闭切换分别只触发一次；
- 重复通知幂等；
- 重新挂载时，已就绪启用会再次打开，已就绪关闭不会关闭。

完整状态转移由纯函数测试覆盖；响应式 helper 只做挂载接线，避免测试依赖 Solid SSR 环境对后续 signal 更新的模拟细节。

保留现有 `shouldShowFileTree`、session panel、file tab 相关测试。

## 5. BluedCode 构建兼容性

- 是否影响 Desktop 构建依赖图：是，修改 `packages/app/src/pages/session.tsx` 和 `packages/app/src/pages/session/helpers.ts`，属于 Desktop renderer 依赖图。
- 是否修改品牌规则目标文件或语义节点：否，不新增产品名、Logo、协议或路径文案。
- 是否新增用户可见产品名称：否。
- 是否影响 CLI 入口剔除、更新禁用、Deep Link 或数据隔离：否。
- 是否需要更新当前版本适配器、专用钩子或通用构建框架：正常情况下不需要；实现后运行 BluedCode 构建兼容审计确认。
- 品牌兼容审计：已运行 `bun run build.ts --channel dev --audit-only`，兼容审计完成，输出目录为 `.xcode/bluedcode/workspaces/dev-a0bdd67656e945cf/stage/desktop/out`。

## 6. 完成条件

1. ORIGIN-03 的所有行为合同在 1.18.18 中有测试覆盖。
2. `Session` 挂载后，设置恢复为显示文件树时能补偿打开。
3. 设置恢复为隐藏文件树时不破坏当前初始布局。
4. 用户运行时切换显示/隐藏文件树能立即同步布局。
5. 重复通知不会产生重复布局动作。
6. BluedCode 构建兼容审计通过或给出明确阻塞原因。
