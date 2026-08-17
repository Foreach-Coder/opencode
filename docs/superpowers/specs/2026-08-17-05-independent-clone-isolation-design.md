# OpenCode 1.18.18 独立 Clone 与 Worktree 隔离落地设计

- 对应跨版本需求：`ORIGIN-04`
- 跨版本 spec：`docs/origin-specs/04-independent-clone-isolation.md`
- 目标版本：OpenCode `1.18.18`
- 目标基线：`v1.18.18`
- 实现分支：`dev-foreachcode-1.18.18`
- 当前完成提交：待用户明确要求提交后填写
- 状态：已实现，待提交

## 1. 目标

在 1.18.18 的项目解析流程中区分独立 clone 和 linked worktree。独立 clone 可以继续共享同一个逻辑 project id，但不能被记录为主项目的 `sandboxes`；真正依附外部 Git store 的 linked worktree 仍可作为 sandbox/worktree 记录。

## 2. 1.18.18 现状

当前相关代码集中在：

- `packages/core/src/project.ts`：`ProjectV2.resolve` 负责解析目录、项目 ID 和 Git store；
- `packages/core/src/git.ts`：`Git.repo.discover` 通过 `git rev-parse --git-dir` 和 `--git-common-dir` 得到 `gitDirectory` / `commonDirectory`；
- `packages/opencode/src/project/project.ts`：旧 Project service 负责把解析结果写入 `ProjectTable.worktree` 和 `ProjectTable.sandboxes`；
- `packages/opencode/test/project/project.test.ts`：已有 project/worktree 行为测试。

  1.18.18 已经能让同一 remote 的独立 clone 共享 project id，也能让 linked worktree 共享 project id。但 `Project.fromDirectory` 之前只判断 `data.directory !== result.worktree`，会把独立 clone 和 linked worktree 都加入 `sandboxes`。

## 3. 技术设计

保留项目 ID 解析算法不变，只在 `Project.fromDirectory` 写入 `sandboxes` 前增加 Git store 分类：

- `projectID` 为 global：不写 sandbox；
- 当前目录等于项目主 `worktree`：不写 sandbox；
- 没有 Git store：不写 sandbox；
- Git store 位于当前目录内部：视为独立 clone，不写 sandbox，并移除此前误入的精确路径；
- Git store 位于当前目录外部：视为 linked worktree，可以写入 sandbox。

本实现使用 `ProjectV2.resolve` 已经返回的 `data.vcs.store`，不扩展 `ProjectV2` schema，也不改变 project id、project directories 和 session 迁移逻辑。

## 4. 测试与验证

新增和更新 `packages/opencode/test/project/project.test.ts`：

1. 独立 clone 继续共享 project id；
2. 独立 clone 不改变主 `worktree`；
3. 独立 clone 不进入 `sandboxes`；
4. 如果独立 clone 已被手动或历史错误加入 `sandboxes`，再次解析会移除该精确路径；
5. linked worktree 仍能按既有行为进入 `sandboxes`。

已执行验证：

```text
bun test test/project/project.test.ts test/project/project-directory.test.ts
45 pass / 0 fail / 108 expect
```

```text
bun run build.ts --channel dev --audit-only
兼容审计完成
```

`packages/opencode` 的 `bun typecheck` 当前仍被既有 `script/build-config.ts` 无法解析 `@opencode-ai/brand/config` 阻断；该问题不由本需求引入。

## 5. BluedCode 构建兼容性

- 是否影响 Desktop 构建依赖图：否。改动在内嵌 server 的 project service 逻辑内，不新增 Desktop 入口。
- 是否修改品牌规则目标文件或语义节点：否。
- 是否新增用户可见产品名称：否。
- 是否影响 CLI 入口剔除、更新禁用、Deep Link 或数据隔离：否。
- 是否需要更新当前版本适配器、专用钩子或通用构建框架：否。
- 品牌兼容审计：`bun run build.ts --channel dev --audit-only` 已通过。
