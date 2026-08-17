# OpenCode 1.18.18 LLM 隐私安全性能日志落地设计

- 对应跨版本需求：`ORIGIN-06`
- 跨版本 spec：`docs/origin-specs/06-llm-performance-logging.md`
- 目标版本：OpenCode `1.18.18`
- 目标基线：`v1.18.18`
- 实现分支：`dev-foreachcode-1.18.18`
- 当前完成提交：见根仓 `docs/origin-specs/06-llm-performance-logging.md` 版本实现矩阵
- 状态：已实现

## 1. 目标

为 1.18.18 的 LLM Provider 流式请求增加本地、结构化、隐私安全的性能日志。日志覆盖请求准备、attempt、首输出、生成吞吐、正常结束、错误和中断；同一逻辑请求使用同一个 `llm.request_id` 贯穿全部事件。

该能力只用于本机问题定位，不新增远程遥测，不记录提示词、模型输出、工具内容、凭据、Provider 原始错误消息、stack、headers、URL 或响应 body。

## 2. 1.18.18 现状

1.18.18 同时保留两条 LLM 流路径：

- `packages/core/src/session/runner/llm.ts`：当前 V2 session runner 的主路径，通过 `@opencode-ai/llm` 的 `LLMClient.Service.stream(request)` 发起 Provider turn，并由 `publish-llm-event.ts` 发布流事件。
- `packages/opencode/src/session/llm.ts`：legacy runtime 路径，负责 AI SDK 与 native runtime 的统一输出，旧 `processor.ts` 仍可消费这条流。

  1.17.9 的实现集中在 `packages/opencode/src/session/llm/performance.ts`，并在旧 `llm.ts` 的 stream 边界接入。1.18.18 需要把同一诊断合同迁移到 core V2 主路径，同时让 legacy 路径复用同一纯性能计算器，避免两套语义漂移。

## 3. 技术设计

### 3.1 纯性能日志合同

新增 `packages/core/src/session/runner/performance.ts`，只负责计算日志事件，不依赖数据库、Provider、网络或具体 runner：

- 输入：`requestID`、provider/model/session/agent/mode/small、retry 上限、system/messages/tools；
- 输出：`Entry { message, data }`，消息固定为 `llm performance <event>`；
- 事件：`start`、`attempt`、`response`、`attempt error`、`first output`、`finish`、`error`、`interrupted`；
- 所有耗时使用非负毫秒；时钟回拨时归零；
- `retry_count = max(0, attempt_count - 1)`；
- 只记录计数、字节数、token、耗时、finish reason 和安全错误分类；
- `text-delta`、`reasoning-delta`、`tool-input-delta`、`tool-call` 均可触发唯一一次首输出。

### 3.2 V2 runner 接入

在 `packages/core/src/session/runner/llm.ts` 中：

- 在准备请求前记录开始时间，完成 compaction 检查后创建 tracker 并输出 `start`；
- Provider turn 开始前输出 `attempt`；
- 对 `llm.stream(request)` 返回的 `LLMEvent` 做只读 tap，输出 `first output` 与 `finish`；
- stream failure 输出安全 `error`；
- scope 提前释放且没有终态时输出 `interrupted`；
- 不改变请求参数、流事件顺序、overflow recovery、tool settlement 或取消语义。

V2 的 `LLMClient` 抽象当前无法可靠观察底层 response headers 和 request body，因此 V2 不伪造 `response` / `request_bytes`；这些字段继续由能观察底层 AI SDK response 的 legacy 路径记录。

### 3.3 Legacy runtime 接入

在 `packages/opencode/src/session/llm.ts` 中复用 `@opencode-ai/core/session/runner/performance`：

- `streamText` middleware 的 `wrapStream` 输出 `attempt`、`response`、`attempt error`；
- `onError` 不再记录原始 error 对象，只输出 `performance.fail(error)` 的安全字段；
- native runtime 不经过 AI SDK middleware 时，也至少输出 `attempt`、`first output`、`finish/error/interrupted`。

## 4. 测试与验证

新增测试：

1. `packages/core/test/session-runner-performance.test.ts`
   - 请求大小只记录字节数，不保留 system、messages、工具名或工具描述；
   - attempt/response/first output/finish 耗时和吞吐计算正确；
   - retry 计数正确，错误只保留安全分类；
   - AbortError 标记为 interrupted 且不保留错误消息；
   - 时钟回拨时耗时不为负；
   - text/reasoning/tool-input/tool-call 都可触发唯一首输出。
2. `packages/core/test/session-runner.test.ts`
   - V2 runner 对真实 `LLMClient.Service.stream` 输出 `start`、`attempt`、`first output`、`finish`；
   - Provider stream 失败只记录安全错误分类，不泄露 secret。
3. `packages/opencode/test/session/llm-performance.test.ts`
   - legacy runtime 复用同一性能合同；
   - AI SDK `onError` 不再输出原始错误对象。

已执行验证：

```text
packages/core:
bun test test/session-runner-performance.test.ts
8 pass / 0 fail / 50 expect

bun typecheck
通过
```

```text
packages/opencode:
bun test test/session/llm-performance.test.ts
2 pass / 0 fail / 5 expect

bun typecheck
仍被既有 script/build-config.ts 无法解析 @opencode-ai/brand/config 阻断
```

```text
packages/opencode:
bun test test/session/llm.test.ts --test-name-pattern "runtime selected|stream"
2 pass / 14 fail / 12 filtered out

失败根因：当前企业 Profile/Provider catalog 不包含该旧测试夹具使用的 vivgrid、cerebras、
mistral、alibaba、openai、minimax、anthropic、google 等公共模型。该命令已证明
packages/opencode/src/session/llm.ts 能编译到运行阶段；Provider catalog 夹具修正不属于本
spec。
```

```text
opencode/xcode/build/bluedcode:
bun run build.ts --channel dev --audit-only
兼容审计完成：D:\Develop\foreachcode\opencode\.xcode\bluedcode\workspaces\dev-88a038ca1d959d18\stage\desktop\out
```

```text
opencode:
bunx oxlint packages/core/src/session/runner/performance.ts packages/core/src/session/runner/llm.ts packages/core/test/session-runner-performance.test.ts packages/opencode/src/session/llm.ts packages/opencode/test/session/llm-performance.test.ts
0 errors；6 warnings，均为触碰文件中的既有 unbound-method / unsafe assertion 模式
```

## 5. BluedCode 构建兼容性

- 是否影响 Desktop 构建依赖图：是，内嵌 server 的 LLM runner 增加本地日志模块。
- 是否修改品牌规则目标文件或语义节点：否，不新增用户可见品牌名。
- 是否新增用户可见产品名称：否。
- 是否影响 CLI 入口剔除、更新禁用、Deep Link 或数据隔离：否。
- 是否需要更新当前版本适配器、专用钩子或通用构建框架：若构建输出审计新增安全日志关键字，只更新允许列表；不修改品牌替换规则。
- 品牌兼容审计：`bun run build.ts --channel dev --audit-only` 已通过。
