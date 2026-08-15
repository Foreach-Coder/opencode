# OpenCode 1.17.9 Reasoning 碎片合并落地设计

- 类型：版本级实施规格
- Origin spec：父级根仓 `docs/origin-specs/05-reasoning-fragment-coalescing.md`（`ORIGIN-05`）
- 目标版本：OpenCode `1.17.9`
- 实现提交：`268cd6d3dd`
- 状态：已实现，逆向确认

## 1. 状态模型

`packages/opencode/src/session/processor.ts` 在 `ProcessorContext` 中维护：

- `reasoningMap`：Provider reasoning ID 到 V1 reasoning part 的映射；
- `pendingReasoning`：canonical reasoning ID 与尚未最终结束的 V1 part。

`finishReasoning()` 负责写入 end time、持久化 part、发布一次 V2 `Reasoning.Ended`、删除所有指向该 part 的临时 Provider ID，并清空 pending 状态。重复调用为空操作。

## 2. Start/Delta/End 处理

收到 `reasoning-start` 时，如果存在 pending part、当前没有 active reasoning ID，并且 pending part 与新 start 都没有 metadata，则把新的 Provider ID 映射到原 part，不发布新的 V2 Started。

不满足条件时先调用 `finishReasoning()`，再创建新 part，并把首次 start ID 记录为 canonical ID。

收到 `reasoning-delta` 时更新当前 V1 part；若该 Provider ID 映射到 pending part，V2 Delta 使用 pending 的 canonical ID。

收到无 metadata 的 `reasoning-end` 时只删除 active ID，不结束 pending part。end 带 metadata 时先附加 metadata，再立即结束该 part。

## 3. 强制结束边界

以下处理分支在继续之前调用 `finishReasoning()`：

- `tool-input-start`；
- `tool-call`；
- `text-start`；
- `step-finish`；
- 正常流结束、失败事件发布和 processor cleanup。

每次新的 Provider 重试循环开始时清空 `reasoningMap` 和 `pendingReasoning`，防止跨 attempt 合并。

## 4. V1/V2 双写

1.17.9 仍处于 V1 part 与 V2 event 双写阶段。合并后的无签名 reasoning：

- V1 只持久化一个 part；
- V2 只发布首次 canonical ID 的 Started 和 Ended；
- 所有合并 Delta 使用该 canonical ID。

带 metadata 的 lifecycle 仍各自产生独立 V1 part 和 V2 生命周期。

## 5. 验证

`packages/opencode/test/session/processor-effect.test.ts` 的
`merges only adjacent unsigned token reasoning lifecycles` 构造“我”“先”“分析”三个无签名 lifecycle，以及两个不同签名 lifecycle，并断言：

- 最终三个 reasoning parts；
- 第一个文本为“我先分析”；
- Started/Delta/Ended ID 使用 canonical 规则；
- 所有 parts 都具有 end time。

同文件的 retry、failure、普通 reasoning、summary tool 限制、usage 和 assistant text 测试必须继续通过。
