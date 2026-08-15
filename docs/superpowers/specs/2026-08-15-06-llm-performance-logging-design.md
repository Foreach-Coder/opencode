# OpenCode 1.17.9 LLM 性能日志落地设计

- 类型：版本级实施规格
- Origin spec：父级根仓 `docs/origin-specs/06-llm-performance-logging.md`（`ORIGIN-06`）
- 目标版本：OpenCode `1.17.9`
- 实现提交：`7e98570f70`
- 状态：已实现，逆向确认

## 1. Tracker

`packages/opencode/src/session/llm/performance.ts` 实现 `LLMPerformance.create(input, options)`。每个 `LLM.run` 创建一个 tracker，并通过 `randomUUID()` 生成 request ID。

tracker 内部维护逻辑开始时间、attempt 数、当前 attempt 开始时间、response 时间、首输出时间和 terminal 标志。`options.now` 与 `options.started` 用于确定性测试，生产默认使用 `Date.now()`。

方法映射为：

| 方法 | 日志事件 |
| --- | --- |
| `start()` | `llm performance start` |
| `attempt()` | `llm performance attempt` |
| `response()` | `llm performance response` |
| `attemptError()` | `llm performance attempt error` |
| `observe()` 首次有效输出 | `llm performance first output` |
| `observe()` finish | `llm performance finish` |
| `fail()` | `llm performance error` |
| `end()` | `llm performance interrupted` |

所有方法返回只包含结构化白名单数据的 `Entry`，由 `Effect.logInfo` 写入日志。

## 2. 流接入

`packages/opencode/src/session/llm.ts` 在请求准备后创建 tracker 并记录 start。

- Native runtime 在获得 supported stream 时记录一次 attempt。
- AI SDK runtime 在最接近实际 `doStream` 的 `wrapStream` middleware 中为每次 retry 记录 attempt，并在 Promise resolve/reject 时记录 response 或 attempt error。
- 两种 runtime 最终都转换为标准 `LLMEvent` stream，再由统一 `monitor` 观察首输出和 finish。
- `Stream.tapError` 调用 `fail()`，资源 finalizer 调用 `end()`；terminal 标志保证终态幂等。

性能观察包裹在标准化流外层，不修改 Provider params、retry 行为、事件顺序或取消逻辑。

## 3. 字段计算

- `bytes()` 只返回 JSON UTF-8 长度，序列化失败时返回 undefined。
- `elapsed()` 对时间差四舍五入并限制最小为 0。
- `rate()` 以 output tokens 和 generation milliseconds 计算每秒吞吐并保留两位小数。
- `errorData()` 只递归提取 name、HTTP status、retryable 和 interrupted，不返回 message、stack 或原始对象。
- `isOutput()` 识别 text delta、reasoning delta、tool input delta 和 tool call。

字段名和事件语义遵守根仓 `ORIGIN-06`。

## 4. 验证

`packages/opencode/test/session/llm-performance.test.ts` 使用可控时间源验证：

- 请求大小只留下数字，不留下 system、prompt 或工具 secret；
- attempt、response headers、TTFT、generation 和 throughput 计算；
- retry 计数及 Provider 错误清洗；
- 无 finish/error 的流被标记 interrupted；
- AbortError 不泄露 message；
- tracker 只产生一个终态。

集成验证还需覆盖 Native 和 AI SDK 两条 runtime 路径，并确认原始 LLM event stream 不变。
