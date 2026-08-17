# Task 8 baseline preflight 修复报告

- 根因：`preflightBuild` 使用 `git describe --tags --exact-match HEAD` 读取 adapter tag，并把当前开发 HEAD 的 `identity.commit` 放入 adapter 选择键；当 `dev` HEAD 是产品实现提交而非上游 `v1.18.18` tag 提交时，preflight fail-closed 到“无法读取受信基线 tag”。
- RED：新增 `dev HEAD 无 baseline exact tag 时仍按受信 baseline 选择适配器`，确认旧实现因 HEAD 无 exact tag 失败；同时新增 baseline tag 缺失、tag 指向非 adapter commit 的 fail-closed 覆盖。
- GREEN：`preflightBuild` 改为使用受信 baseline metadata 的 `tag + commit` 与当前 Desktop version 选择 VersionAdapter；当前构建 `identity.commit` 仍保持开发 HEAD。选择后用 `git rev-parse <adapter.tag>^{}` 校验 Git tag 实际指向 `adapter.commit`。
- 范围：未修改 `packages/**`，未启动真实 builder。
- 验证：
  - `bun test test/build.test.ts test/typecheck.test.ts`：通过，39 pass。
  - `bun test test/adapter.test.ts`：失败 1 项，失败点为既有审计 allowance 计数断言期望数字但当前 adapter 数据为 `expected: "any"`；与本次 baseline 选择修复无文件重叠。
  - `bun test test/adapter.test.ts test/build.test.ts test/typecheck.test.ts`：因上述 adapter.test 既有失败整体 exit 1；build/typecheck 部分通过。
  - `git diff --check`：通过。
