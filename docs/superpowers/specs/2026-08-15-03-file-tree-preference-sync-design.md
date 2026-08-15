# OpenCode 1.17.9 文件树偏好同步落地设计

- 类型：版本级实施规格
- Origin spec：父级根仓 `docs/origin-specs/03-file-tree-preference-sync.md`（`ORIGIN-03`）
- 目标版本：OpenCode `1.17.9`
- 实现提交：`70157ccf92`
- 状态：已实现，逆向确认

## 1. 状态转换

`packages/app/src/pages/session/helpers.ts` 新增纯函数 `fileTreePreferenceAction`，输入为：

- `ready`：设置存储是否恢复；
- `enabled`：`settings.general.showFileTree()` 当前值；
- `previous`：上一次已经就绪的 enabled 值，未知时为 `undefined`。

| 输入 | 返回动作 |
| --- | --- |
| `ready=false` | `undefined` |
| `ready=true, enabled=true, previous!=true` | `open` |
| `ready=true, enabled=false, previous=undefined` | `undefined` |
| `ready=true, enabled=false, previous=true` | `close` |
| 其他未变化状态 | `undefined` |

首次 false 不关闭是 1.17.9 的版本兼容行为，用于保留 legacy initial layout，而不是把恢复前默认值当作用户偏好。

## 2. UI 接入

`packages/app/src/pages/session/session-side-panel.tsx` 在 side panel 生命周期中创建 Solid effect，同时观察 `settings.ready()` 和 `settings.general.showFileTree()`。

effect 使用 `on(...)` 的 previous tuple，只在 previous 已就绪时把旧 enabled 传给 helper。返回 `open` 时调用 `layout.fileTree.open()`，返回 `close` 时调用 `layout.fileTree.close()`。

该 effect 不写设置，不修改 `shouldShowFileTree`、review panel、文件 tab、断点和尺寸逻辑。

## 3. 验证

`packages/app/src/pages/session/helpers.test.ts` 覆盖：

- 设置未就绪无动作；
- 首次 true 打开；
- 首次 false 保留初始布局；
- false → true 打开；
- true → false 关闭；
- 相同值无动作。

现有文件树显示、review panel 和文件 tab 测试必须继续通过。
