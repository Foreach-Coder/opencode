# OpenCode 1.17.9 独立 Clone 隔离落地设计

- 类型：版本级实施规格
- Origin spec：父级根仓 `docs/origin-specs/04-independent-clone-isolation.md`（`ORIGIN-04`）
- 目标版本：OpenCode `1.17.9`
- 实现提交：`66ec4bbeff`
- 状态：已实现，逆向确认

## 1. 现有模型

`packages/opencode/src/project/project.ts` 的 `fromDirectory` 可能让同一仓库的两个 clone 得到相同 `ProjectV2.ID`。本版本保留该识别算法，只修正 `project.sandboxes` 的分类。

`data.vcs.store` 表示当前目录的 Git store：

- 独立 clone 的 store 位于当前工作目录内部；
- linked worktree 的 store 位于当前工作目录外部。

## 2. 更新算法

处理一个属于已有项目、且不是 `result.worktree` 的目录时：

1. 使用 `FSUtil.resolve(data.directory)` 得到规范目录。
2. 从 `result.sandboxes` 删除所有 resolve 后等于该目录的条目。
3. 仅当项目不是 global、VCS 为 Git，并且 `!FSUtil.contains(data.directory, data.vcs.store)` 时重新加入目录。
4. 继续执行既有 sandbox 有效性和去重处理。

先删除再按结构重新加入，使独立 clone 能清除历史误分类，同时让 linked worktree 保持 sandbox 身份。算法不更新 `result.worktree`，也不操作目录内容。

## 3. 验证

`packages/opencode/test/project/project.test.ts` 中的回归测试：

```text
separate clones of the same repo should share project ID without becoming sandboxes
```

测试先创建两个相同 bare 仓库来源的独立 clone，把第二个显式加入 sandboxes，再解析第二个，并断言：

- project ID 与第一个 clone 相同；
- 主 worktree 未变化；
- sandboxes 不包含第二个 clone。

linked worktree 和路径规范化测试必须继续证明外部 Git store 会进入 sandboxes，且重复解析不会重复添加。
