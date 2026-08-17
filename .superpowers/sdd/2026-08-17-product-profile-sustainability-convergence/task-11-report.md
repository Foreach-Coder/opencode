# Task 11 报告：真实 Portable 启动验收

## 实现摘要

- 将 `createRuntimeAcceptanceEvidence` 从 source fixture 证据升级为必须接收最终 Portable EXE 路径的 smoke harness；缺少 EXE 时 fail closed。
- Runtime evidence 改为 `mode: "portable"`，记录 EXE 启动、server health、preload、renderer、管理员模型、干净退出、残留进程、隔离配置目录、日志摘要与无公网调用证据。
- Harness 写入隔离 `home/.config/bluedcode/opencode.json`，包含最小管理员 Provider/model 配置与假 API key；manifest 只记录 provider/model ID 与 API key SHA-256。
- Manifest 校验拒绝旧 `mode: "fixture"` runtime、缺失 readiness、残留进程、主进程错误、伪造 stale `SESSION_NOT_FOUND`、明文 `apiKey`/secret。
- `build.ts` 在找到最终 Portable EXE 后调用真实 runtime harness，并将 evidence 写入 release manifest。

## TDD 记录

RED 命令：

```powershell
cd D:\Develop\foreachcode\opencode\xcode\build\bluedcode
bun test test/runtime-acceptance.test.ts test/failure.test.ts test/build.test.ts
```

RED 结果：失败符合预期。旧生产代码仍允许 source fixture evidence，manifest 仍要求 `mode: "fixture"`，新增“缺少最终 Portable EXE”合同测试失败。

GREEN 命令：

```powershell
bun test test/runtime-acceptance.test.ts test/failure.test.ts test/build.test.ts
```

GREEN 结果：47 pass / 0 fail。

完整验证命令：

```powershell
bun test test/runtime-acceptance.test.ts test/failure.test.ts test/build.test.ts test/typecheck.test.ts
```

完整验证结果：48 pass / 0 fail。

```powershell
git diff --check
```

结果：通过，仅输出 CRLF 工作区提示。

```powershell
git status --short
```

结果：仅 Task 11 相关文件修改。

## 真实 Portable 构建/运行证据

初次真实构建暴露 Task 8 preflight 回归：开发 HEAD 没有精确 `v1.18.18` tag，旧逻辑用 HEAD exact tag 选择 adapter，导致 `无法读取受信基线 tag`。该问题已由后续提交修复为使用受信 baseline metadata，并校验 tag 指向 adapter commit。

随后真实构建又暴露两个构建验收问题：

- 输出审计缺少 `installation.upgrade(` 的 evidence 说明。源码确认 `Installation.upgrade` 服务根在任何升级脚本或网络副作用前执行 `ProductPolicy.rejectPublicUpdate()`，因此仅将该方法符号作为 evidence 残留登记。
- Runtime harness 误把 Portable 外层 stub 退出当成真实 Electron 应用退出，独立系统进程扫描发现 `BluedCode Dev.exe` 仍残留。已补 RED：fake portable 留下 runtime-home 子进程时必须 fail closed 并清理；实现改为真实模式通过 debug port / runtime-home 扫描并关闭完整进程树。

最终真实构建命令：

```powershell
bun run build.ts --channel dev
```

结果：exit 0，生成 dev Portable 与 release manifest。

EXE：

```text
D:\Develop\foreachcode\opencode\.xcode\bluedcode\workspaces\dev-11ca240998942abf\artifacts\466ebda54837e0b7fc5d751e0d3655f5fa3073fe83a0faae7f24c2197faae4fd\BluedCode-Dev-1.18.18-dev-b4d04e19e2-windows-x64-portable.exe
```

EXE SHA-256：

```text
a27336d97af91eb8407dba11d9bda767acdeb23d12d41ed3c52f278e801e02fd
```

Manifest：

```text
D:\Develop\foreachcode\opencode\.xcode\bluedcode\workspaces\dev-11ca240998942abf\artifacts\466ebda54837e0b7fc5d751e0d3655f5fa3073fe83a0faae7f24c2197faae4fd\release-manifest.json
```

Manifest SHA-256：

```text
a862a53bfa65531fa1a6e3fcc085035099f35081632715ae25cff92a196d03fc
```

Runtime evidence 摘要：

```json
{
  "mode": "portable",
  "executableStarted": true,
  "serverHealthReady": true,
  "preloadReady": true,
  "rendererReady": true,
  "adminModelLoaded": true,
  "exitedCleanly": true,
  "lingeringProcesses": [],
  "configDirectory": ".config/bluedcode",
  "visibleVersion": "1.18.18-dev-b4d04e19e2",
  "publicNetworkCalls": [],
  "checks": {
    "defaultSessionCore": "v1",
    "sessionCoreSwitchesTo": "v2",
    "disabledEntrypoints": ["auth", "connect-provider", "share", "update"],
    "staleSession": {
      "appShellLoaded": true,
      "recoveryError": {
        "code": "SESSION_NOT_FOUND",
        "message": "Session not found: stale-session"
      }
    }
  }
}
```

独立进程检查：构建结束后未发现 `BluedCode Dev.exe` 残留；manifest 中也记录 `lingeringProcesses: []`。管理员假 API key 仅以 SHA-256 形式记录，未在 runtime evidence 中明文出现。

## Review fix 记录

复审指出旧实现仍可能读取同一 runtime-home 下的历史日志，把旧日志中的 ready 信号误判为本次 Portable 启动成功。修复后：

- `runtime-acceptance.ts` 在启动 Portable 前记录 `startedAt`；
- 日志观察只读取 `mtimeMs + 1000 >= startedAt` 的当前启动日志；
- 日志只允许辅助确认 `executableStarted/serverHealthReady`，不再从日志直接设置 `preloadReady/rendererReady/adminModelLoaded`；
- `preloadReady/rendererReady/adminModelLoaded` 必须来自当前 `--remote-debugging-port`；
- manifest runtime schema 增加 exact key 校验，并递归拒绝 `secret/api_key/token/password` 等明文字段。

Review fix 验证命令：

```powershell
cd D:\Develop\foreachcode\opencode\xcode\build\bluedcode
bun test test/runtime-acceptance.test.ts test/failure.test.ts test/build.test.ts test/adapter.test.ts test/snapshot.test.ts test/typecheck.test.ts
```

结果：63 pass / 0 fail / 249 expect。

Review fix 提交：

```text
2ba84d5ac5 fix(build): 使用当前启动信号验收 Portable
```

最新真实构建命令：

```powershell
bun run build.ts --channel dev
```

结果：exit 0。

最新 EXE：

```text
D:\Develop\foreachcode\opencode\.xcode\bluedcode\workspaces\dev-9f1bb2d2e4c9c788\artifacts\f2929d609485a8f4eb118993a2228d8d509bbd6546513b720252a6f9bc031637\BluedCode-Dev-1.18.18-dev-2ba84d5ac5-windows-x64-portable.exe
```

EXE SHA-256：

```text
2e512ff066bd1cfc364f70084b53149271cf581683147092d4ca6bbf714ff090
```

最新 Manifest：

```text
D:\Develop\foreachcode\opencode\.xcode\bluedcode\workspaces\dev-9f1bb2d2e4c9c788\artifacts\f2929d609485a8f4eb118993a2228d8d509bbd6546513b720252a6f9bc031637\release-manifest.json
```

Manifest SHA-256：

```text
de9088dc7832b33a2973e0f82a95686df3f6056a149a6e28ddf680c742302394
```

最新 runtime evidence 摘要：

```json
{
  "mode": "portable",
  "executableStarted": true,
  "serverHealthReady": true,
  "preloadReady": true,
  "rendererReady": true,
  "adminModelLoaded": true,
  "exitedCleanly": true,
  "lingeringProcesses": [],
  "configDirectory": ".config/bluedcode",
  "visibleVersion": "1.18.18-dev-2ba84d5ac5",
  "adminConfig": {
    "providerId": "openai-proxy",
    "modelId": "gpt-4.1",
    "apiKeySha256": "be1a186ad5399278bd0942db2185028509cd423bf6635b3ac76667935504b1ba"
  },
  "publicNetworkCalls": [],
  "checks": {
    "defaultSessionCore": "v1",
    "sessionCoreSwitchesTo": "v2",
    "disabledEntrypoints": ["auth", "connect-provider", "share", "update"],
    "staleSession": {
      "appShellLoaded": true,
      "recoveryError": {
        "code": "SESSION_NOT_FOUND",
        "message": "Session not found: stale-session"
      }
    }
  }
}
```

独立进程检查：构建结束后未发现 `BluedCode Dev.exe` 残留。

## Concerns

- 当前 harness 对真实 packaged Electron 的 readiness 使用外部可观测信号：日志、固定 OPENCODE_PORT health check、remote debugging renderer 检查；如果未来上游 Electron/portable 包装器禁止传递 `--remote-debugging-port`，真实构建验收会 fail closed 并报告 renderer/preload 未就绪。
- 本任务只真实验证 dev channel；prod channel 的最终构建与真实 runtime acceptance 留给 Task 13。
