# OpenCode 1.18.18 Reasoning 碎片合并落地设计

- 对应跨版本需求：`ORIGIN-05`
- 跨版本 spec：`docs/origin-specs/05-reasoning-fragment-coalescing.md`
- 目标版本：OpenCode `1.18.18`
- 目标基线：`v1.18.18`
- 实现分支：`dev-foreachcode-1.18.18`
- 当前完成提交：`99325c3d258c102c448aab3f89e00ca8a6a89c50`
- 状态：已实现

## 1. 目标

在 1.18.18 的新旧 session 执行链路中，将相邻、无 `providerMetadata` 的传输级 reasoning 生命周期合并为一个逻辑 reasoning 段，避免用户和事件消费者看到大量逐 token 的 reasoning 小块。

带签名或其他 provider metadata 的 reasoning 生命周期继续保持独立，不能被合并。

## 2. 1.18.18 现状

1.18.18 相比 1.17.9 增加了新的 V2 session runner：

- `packages/core/src/session/runner/publish-llm-event.ts`：把 `LLMEvent` 转成 `SessionEvent`，是 V2 主路径的 reasoning 生命周期发布源头；
- `packages/core/src/session/message-updater.ts`：按 `reasoningID` 将事件投影成 assistant content；
- `packages/opencode/src/session/processor.ts`：旧 session processor 仍保留，并继续把 `LLMEvent` 持久化为 V1 message parts；
- `packages/opencode/test/session/processor-effect.test.ts`：旧 processor 行为测试；
- `packages/core/test/session-runner-tool-events.test.ts`：V2 publisher 行为测试。

当前 V2 的 `fragments()` 只会合并同一个 reasoning id 内的 delta。如果 provider 每个 token 都发出新的 `reasoning-start / reasoning-delta / reasoning-end`，当前实现仍会产生多个 reasoning 段。

旧 processor 也仍按每个 reasoning id 独立创建 `ReasoningPart`，没有 1.17.9 中的 `pendingReasoning` 合并逻辑。

## 3. 技术设计

### V2 publisher

在 `publish-llm-event.ts` 中将 reasoning 从通用 `fragments()` 改为专用 reasoning fragment 状态机：

- 第一个无 metadata reasoning start 立即发布 `Reasoning.Started`，并使用其 id 作为逻辑段 id；
- 无 metadata reasoning end 暂不立即发布 ended，而是进入 pending 状态；
- 如果下一个事件是相邻、无 metadata 的 reasoning start，则复用 pending 逻辑段，将后续 delta 继续发布到第一个 id；
- 如果遇到 text、tool input、step finish、provider error、flush 或带 metadata 的 reasoning start，则先发布 pending reasoning ended；
- 带 metadata 的 reasoning 保持原始 start/delta/end 边界，不与前后片段合并。

### 旧 processor

在 `packages/opencode/src/session/processor.ts` 中恢复同等语义：

- `ProcessorContext` 增加 `pendingReasoning`；
- 无 metadata reasoning end 后保留 pending part，不立刻写结束时间；
- 后续相邻无 metadata reasoning start 复用同一个 part；
- text、tool、step finish、provider error、cleanup 和新处理循环开始时关闭或清理 pending 状态。

## 4. 测试与验证

新增和更新测试：

1. `packages/core/test/session-runner-tool-events.test.ts`
   - 三个相邻无 metadata 片段“我”“先”“分析”只发布一次 started、三个 delta、一次 ended，最终文本为“我先分析”；
   - metadata/signature reasoning 不参与合并，并保留独立生命周期。
2. `packages/opencode/test/session/processor-effect.test.ts`
   - 旧 processor 将“我”“先”“分析”持久化为一个 reasoning part；
   - text 边界后 signed reasoning 分别保留为独立 part；
   - 已结束 reasoning part 均写入结束时间。

已执行验证：

```text
packages/core:
bun test test/session-runner-tool-events.test.ts
7 pass / 0 fail / 12 expect

bun typecheck
通过
```

```text
packages/opencode:
bun test test/session/processor-effect.test.ts --test-name-pattern "merges adjacent unsigned reasoning"
1 pass / 0 fail / 4 expect

bun typecheck
仍被既有 script/build-config.ts 无法解析 @opencode-ai/brand/config 阻断
```

```text
xcode/build/bluedcode:
bun run build.ts --channel dev --audit-only
兼容审计完成
```

## 5. BluedCode 构建兼容性

- 是否影响 Desktop 构建依赖图：是，内嵌 server 的 session reasoning 逻辑发生变化，但不新增入口和依赖。
- 是否修改品牌规则目标文件或语义节点：否。
- 是否新增用户可见产品名称：否。
- 是否影响 CLI 入口剔除、更新禁用、Deep Link 或数据隔离：否。
- 是否需要更新当前版本适配器、专用钩子或通用构建框架：否。
- 品牌兼容审计：`bun run build.ts --channel dev --audit-only` 已通过。
