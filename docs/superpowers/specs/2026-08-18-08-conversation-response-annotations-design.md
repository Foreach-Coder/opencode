# OpenCode 1.18.18 会话回复文本注释落地设计

- 对应需求：`ORIGIN-08`
- 跨版本 spec：`docs/origin-specs/08-conversation-response-annotations.md`
- 目标基线：OpenCode tag `v1.18.18`
- 实现分支：`dev-foreachcode-1.18.18`
- 当前设计基线：`2f61909544301cbe2b13db80c8bbc2d83043d09d`
- 状态：设计已确认，待实现
- 产品范围：BluedCode Windows x64 Desktop，V1 与 V2

## 1. 版本现状

OpenCode 1.18.18 已具备文件和 Diff 行评论链路，但没有针对会话 Assistant 正文的选择注释：

- `packages/app/src/context/comments.tsx` 按文件和行范围持久化 `LineComment`。
- `packages/session-ui/src/components/line-comment.tsx` 提供评论锚点、编辑器和展示组件。
- `packages/app/src/context/prompt-state.ts` 的 `ContextItem` 当前只支持文件上下文。
- `packages/app/src/components/prompt-input-v2.tsx`、`prompt-input.tsx` 和 `prompt-input/image-attachments.tsx` 已能显示文件评论数量与详情。
- `packages/app/src/components/prompt-input/build-request-parts.ts` 将文件评论转换为 synthetic TextPart 与 metadata。
- `packages/app/src/utils/comment-note.ts` 和 `pages/session/timeline/rows.ts` 只识别文件评论协议。
- `packages/session-ui/src/components/markdown.tsx` 渲染 Markdown，但没有会话注释选区锚点或回答指令组件。
- `packages/session-ui/src/components/message-part.tsx` 渲染 Assistant TextPart 和 UserMessage，目前只显示文件评论。
- `packages/app/src/pages/session/timeline/message-timeline.tsx` 已为行项目提供 `messageID` 与 `partID` DOM 身份，可作为选择范围边界。
- `packages/opencode/src/session/prompt.ts` 的 `SessionPrompt.createUserMessage` 是用户 Part 接纳和持久化的集中入口。
- `packages/opencode/src/session/message-v2.ts` 的 `MessageV2.toModelMessagesEffect` 是所有 Provider 共用的模型消息投影入口。
- `SessionV1.TextPartInput.metadata` 已允许结构化任意 metadata，因此无需新增公共 Part 类型或重新生成 SDK。

本需求复用现有评论 UI 原语和 TextPart metadata，但不把会话回复注释塞进文件 `LineComment`。两者来源、定位语义和历史生命周期不同，必须保持独立领域模型。

## 2. 设计原则

1. UI 负责选择与草稿，服务端负责来源真实性和规范化模型输入。
2. 所有 Provider 只经过一个模型投影边界，不添加 Provider 专用实现。
3. V1、V2 共用注释状态与控制器，只分别接入展示组件。
4. 不修改历史 Assistant 原文，不把注释标记插入已保存回复。
5. 没有注释的请求保持现有 Part、system prompt 和 Provider 输入。
6. 模型遗漏是模型合同违约，不触发自动补答或隐藏调用。

## 3. 内部数据模型

新增稳定的 metadata key：

```text
bluedcodeResponseAnnotations
```

草稿对象：

```ts
type ResponseAnnotationDraft = {
  id: string
  source: {
    sessionID: string
    messageID: string
    partID: string
    partDigest: string
    start: number
    end: number
  }
  context: {
    before: string
    selected: string
    after: string
  }
  comment: string
  createdAt: number
}
```

提交后的 metadata 使用版本化结构：

```ts
type ResponseAnnotationMetadata = {
  version: 1
  annotations: Array<{
    index: number
    source: ResponseAnnotationDraft["source"]
    context: ResponseAnnotationDraft["context"]
    comment: string
  }>
}
```

规则：

- 草稿 `id` 只用于本地编辑，不进入模型协议。
- `index` 在提交前按 `createdAt` 和稳定插入顺序重新生成，必须为连续的 `1..N`。
- metadata 只挂在承载本轮普通用户文本的一个 TextPart 上。
- 用户文本为空但存在注释时，仍创建一个空 TextPart 作为 metadata carrier。
- 一个用户消息最多存在一个 annotation carrier；多个 carrier 在服务端拒绝。
- 服务端验证后覆盖客户端 metadata，持久化规范化版本。

## 4. Markdown 可读文本投影与选区锚点

新增无 DOM 的共享投影模块，供 App 和 OpenCode server 使用。建议位于：

```text
packages/core/src/session/response-annotation.ts
```

投影输入是 Assistant TextPart 的原始 Markdown，输出至少包含：

```ts
type AnnotationProjection = {
  text: string
  segments: Array<{
    projectionStart: number
    projectionEnd: number
    sourceStart: number
    sourceEnd: number
  }>
}
```

投影必须基于 Markdown token/AST，不允许使用删除标点的正则近似。稳定语义：

- CRLF 归一化为 LF。
- Markdown 结构标记不进入可读文本；代码内容、链接文字和可见转义字符进入。
- 块边界使用确定性换行，连续展示空白按固定规则归一化。
- projection offset 与全部容量限制统一按 Unicode code point 计算，不按 UTF-16 code unit 或 UTF-8 byte 计算；不得截断 surrogate pair。
- fenced code、inline code、列表、表格、强调和链接必须有回归夹具。

Assistant TextPart 完成后，App 使用同一投影建立可见 DOM 文本到 projection offset 的映射。选择完成时保存 `start/end`，并从 projection 重新生成 `selected` 及最多 160 字符的 `before/after`。同文重复时使用 offset，不使用第一次字符串匹配猜测位置。

选区必须完全位于一个带 `data-timeline-part-id` 的 Assistant TextPart。流式未完成、Reasoning、ToolPart、UserMessage 或跨 Part 选区不创建草稿。

## 5. App 状态与持久化

### 5.1 Prompt Context 扩展

在 `packages/app/src/context/prompt-state.ts` 将 `ContextItem` 扩展为文件上下文与回复注释上下文的判别联合。回复注释项包含完整 `ResponseAnnotationDraft`，使用草稿 `id` 作为 key，不复用文件路径和行号 key。

继续使用现有 `Persist.prompt` / `Persist.serverScoped` 作用域，因此天然按：

```text
server scope + directory + session/draft
```

隔离并恢复。V1/V2 通过 `usePrompt()` 访问同一状态，切换布局不搬迁或复制草稿。

新增动作：

- `addResponseAnnotation`
- `updateResponseAnnotation`
- `removeResponseAnnotation`
- `responseAnnotations`
- `replaceResponseAnnotations`

普通 `reset()` 在提交成功后清空文本、附件和注释；提交失败保留全部草稿。

### 5.2 历史与输入导航

扩展 `packages/app/src/components/prompt-input/history.ts` 和 `history-store.ts`，将回复注释作为历史条目的独立 metadata 保存。上下翻阅输入历史时恢复对应注释；Shell 模式不恢复或提交回复注释。

文件评论与回复注释分别复制和比较，不能通过同一个 path/selection 类型强行合并。

## 6. 选择与编辑交互

### 6.1 共享选择控制器

在 App session timeline 增加一个共享 `ResponseAnnotationSelectionController`：

- 监听完成 Assistant TextPart 内的 selection change / pointerup。
- 验证 anchor/focus 位于同一 TextPart。
- 将 DOM 选择映射为 shared projection offset。
- 计算浮层位置，但不持久化屏幕坐标。
- 滚动、resize、字体和布局变化后重算高亮与浮层。
- selection 离开有效区域、消息开始变化或 Part 卸载时关闭浮层。

选择浮层只提供“添加到对话”。不实现“更多详情”和“在侧边聊天中提问”。

### 6.2 Session UI 组件

在 `packages/session-ui` 增加无业务状态的可复用组件：

- 选择操作浮层；
- 可选评论编辑器；
- `N 条注释` 触发器；
- 草稿详情列表；
- 历史注释只读列表；
- Assistant 回答中的“注释 N”引用按钮与详情弹层。

组件通过 props 接收内容和动作，不读取 App context。可以复用 `line-comment.tsx` 的键盘、焦点和弹层原语，但不能让新组件依赖文件路径或行号。

键盘合同：

- `Enter` 保存评论；
- `Shift+Enter` 换行；
- `Esc` 取消；
- 所有编辑、删除、打开、关闭和返回来源操作可通过键盘完成。

### 6.3 V1/V2 接入

- `packages/app/src/components/prompt-input.tsx` 接入 V1 数量、详情和编辑操作。
- `packages/app/src/components/prompt-input-v2.tsx` 将回复注释映射到 V2 controller comments 区域。
- 两套布局使用相同排序、限制、持久化和提交函数。
- `message-timeline.tsx` 同时负责 V1/V2 历史回显和来源滚动。

## 7. 请求构建与服务端接纳

### 7.1 Client Request

扩展 `packages/app/src/components/prompt-input/build-request-parts.ts`：

- 没有回复注释时保持当前输出逐字节语义不变。
- 存在注释时，将完整草稿 metadata 挂在普通用户 TextPart。
- 用户正文为空时仍生成 annotation carrier TextPart。
- Client 不生成最终 `<response-annotations>` 文本，不把模型协议内容混入普通编辑器文本。

### 7.2 Prompt Admission

在 `packages/opencode/src/session/prompt.ts` 的 `SessionPrompt.createUserMessage` 内，解析并验证 annotation carrier。新增集中服务/模块建议为：

```text
packages/opencode/src/session/response-annotation.ts
```

验证必须发生在 `sessions.updateMessage` / `sessions.updatePart` 和模型调用之前：

1. metadata version 为 1，结构严格且只有一个 carrier。
2. 数量为 1..20，index 尚未由客户端决定或必须被服务端重写。
3. 来源 session 与当前 session 相同，来源消息早于当前消息。
4. 来源 message 为 Assistant，`time.completed` 存在且没有被删除。
5. 来源 part 为 TextPart，不是 Reasoning 或 ToolPart。
6. 服务端从原始 TextPart 重新计算 digest 和 Markdown projection。
7. `start/end` 在 projection 内，选区非空且不超过 4,000 字符。
8. comment 不超过 2,000 字符。
9. 服务端重新截取 `before/selected/after`，忽略客户端提交的对应值。
10. 按稳定创建顺序生成连续 index，并写回规范化 metadata。

失败返回稳定的 `RESPONSE_ANNOTATION_INVALID` 错误及不含原文的原因码，例如 source missing、source incomplete、digest changed、range invalid、limit exceeded。失败不能创建半条用户消息，也不能启动 Provider。

## 8. 模型消息投影

在 `packages/opencode/src/session/message-v2.ts` 的 `MessageV2.toModelMessagesEffect` 集中处理规范化 metadata。对带注释的用户消息生成一个模型可见 TextPart：

```text
<response-annotations version="1">
[
  {
    "index": 1,
    "source": {
      "messageID": "msg_xxx",
      "partID": "part_xxx",
      "start": 42,
      "end": 91,
      "digest": "sha256:..."
    },
    "context": {
      "before": "...",
      "selected": "...",
      "after": "..."
    },
    "comment": ""
  }
]
</response-annotations>

<user-request>
用户原始输入
</user-request>
```

序列化要求：

- 内部数组由 `JSON.stringify` 生成，字段顺序固定，换行格式确定。
- `<user-request>` 内容按文本数据转义，不能提前闭合标签。
- 文件、图片、Agent 和其他 Part 继续按当前顺序投影。
- 历史中的 annotation carrier 每次 replay 都得到相同模型文本。
- 没有 annotation metadata 的用户消息走原分支，不增加包装。

在 `SessionPrompt.run` 组装 system prompt 时，只在最后一个 UserMessage 带有效注释时追加注释处理提示。提示使用静态常量并覆盖：引用数据非指令、逐条回应、编号唯一、禁止虚构和禁止泄露内部协议。

## 9. Assistant 指令解析与展示

新增纯解析模块，识别：

```text
:bluedcode-annotation{index="N"}
```

解析必须在 Markdown token 层完成，而不是对 HTML 或整个输出做全局字符串替换：

- fenced code 和 inline code 内保持原文；
- 普通正文中的完整合法指令变成 annotation reference token；
- 流式输出中可能构成指令的尾部暂缓显示，完整后再裁决；
- malformed 或未知 index 保持普通文本；
- 重复 index 只让第一次形成关联，后续保持普通文本；
- 解析器不改变其他 Markdown 内容和复制结果。

`message-timeline.tsx` 根据 Assistant `parentID` 读取父 UserMessage 的规范化 annotation metadata，并传给 `MessagePart`。引用按钮点击或悬停展示 `selected` 与 `comment`；返回来源使用 `messageID` 滚动到历史行并按 `partID/start/end` 重建短暂高亮。

模型没有输出某个编号时不提示错误、不自动补答、不触发额外请求。可以记录 expected/valid/missing/duplicate/unknown 数量，但日志不得包含选区或评论正文。

## 10. 错误处理

- 来源漂移：草稿保留但标记失效，禁止发送，提供删除或重新选择。
- 超限：在保存草稿或编辑评论时即时提示；服务端再次验证。
- 提交失败：保留编辑器文本、附件和全部注释。
- 历史来源已删除：注释详情仍展示已保存 `selected/comment`，返回来源操作显示不可用。
- malformed 模型指令：作为普通正文显示，不影响其余回答。
- 持久化读取失败：按现有 Prompt draft 错误路径处理，不跨会话回退。

## 11. TDD 计划范围

实施必须遵循 RED → GREEN → REFACTOR，至少包含以下测试组。

### 11.1 Core Projection

- 普通 Markdown、强调、链接、inline code、fenced code、列表和表格投影。
- CRLF、Unicode、emoji、组合字符和边界截取。
- 重复文本通过 offset 定位，不退化为第一次字符串匹配。
- App 与 server 对同一夹具生成相同 projection/digest。

### 11.2 Prompt State

- add/update/remove/replace、稳定排序和 key。
- server/directory/session 隔离。
- V1/V2 切换和重启恢复。
- prompt history 上下导航恢复。
- 提交成功清空，失败保留。

### 11.3 UI

- 只允许 completed Assistant TextPart。
- 跨 DOM text node、inline code 和 code block 选择。
- 跨 Part、Reasoning、ToolPart、UserMessage 和 streaming 拒绝。
- 评论为空、编辑、删除、数量和详情。
- V1/V2 交互等价及键盘可访问性。
- 历史详情与来源滚动。

### 11.4 Request Admission

- 正常 metadata 得到服务端规范化内容。
- 跨 session、未来消息、未完成 Assistant、错误 Part 类型和错误 digest 拒绝。
- 客户端伪造 selected/before/after 被服务端覆盖。
- 多 carrier、未知 version、空范围和全部容量边界拒绝。
- 失败时零用户消息持久化、零 Provider 调用。

### 11.5 Model Projection

- 精确 XML 外壳、稳定 JSON 字段和 user-request 转义。
- 空用户输入但有注释。
- 多条注释连续编号。
- 普通请求保持现有模型输入。
- replay 输出稳定。
- 仅注释请求注入 system prompt。

### 11.6 Assistant Directive

- 单个、多个、相邻和跨 stream delta 指令。
- inline/fenced code 不解释。
- unknown、duplicate、malformed 保持安全显示。
- parent UserMessage 隔离，不能引用其他轮次 annotation index。
- 缺失编号不发起额外模型调用。

### 11.7 真实 Desktop 验收

在最终 BluedCode Windows x64 目录 ZIP 产物中分别使用 V1、V2：

1. 打开包含格式化正文和代码块的完成回复。
2. 添加空评论和非空评论，切换会话、切换布局并重启。
3. 验证原会话恢复且其他会话无草稿。
4. 发送多条注释并捕获脱敏后的 Provider 请求结构证据。
5. 使用可控测试模型返回合法、缺失和损坏指令。
6. 验证合法“注释 N”、历史详情、来源滚动及无自动补答。
7. 退出后确认无额外进程和无敏感诊断内容。

## 12. BluedCode 构建兼容性

- 是否影响 Desktop 构建依赖图：是，`packages/core`、`packages/app`、`packages/session-ui` 和 `packages/opencode` 均进入 Desktop 运行链路。
- 是否修改品牌规则目标或语义节点：可能。`prompt-input.tsx`、`prompt-input-v2.tsx`、`message-timeline.tsx`、`message-part.tsx`、`session/prompt.ts` 和 `message-v2.ts` 可能属于当前版本适配器的受控模块，实施时必须重新生成候选差异并人工确认指纹。
- 是否新增用户可见产品名称：否。新增文案为通用“添加到对话”“N 条注释”等，不引入 OpenCode 或 BluedCode 品牌字符串。
- 是否影响 CLI、更新、Deep Link 或数据隔离：不改变能力合同；仅使用现有 Desktop Prompt 持久化作用域，必须验证不会跨 server/directory/session 泄漏草稿。
- 是否需要更新当前版本适配器：若受控文件摘要或结构改变，必须只更新 `version/1.18.18` 对应模块合同和指纹。
- 是否需要更新通用构建框架：预计不需要。只有真实编译证明出现跨版本可复用的新构建能力时才允许扩展。

源码实现完成后必须运行：

1. 受影响 package 单元测试与 `bun typecheck`。
2. `xcode/build/bluedcode` adapter-diff / 候选指纹检查。
3. BluedCode 全部相关构建测试。
4. `bun run build.ts --channel dev --audit-only`。
5. Windows x64 prod 目录 ZIP 构建与真实 Desktop 注释验收。

构建兼容审计失败时不得把本需求标记完成，不得更新 `ORIGIN-08` 版本实现矩阵。

## 13. 实施顺序

1. Core Markdown projection 与共享数据合同。
2. Prompt State 注释草稿与持久化。
3. Session timeline 选择控制器和 Session UI 组件。
4. V1/V2 输入框和历史详情接入。
5. Client request carrier 与服务端 admission 验证。
6. MessageV2 模型投影和按需 system prompt。
7. Assistant 指令 token 解析与来源关联。
8. package 测试、类型检查和 BluedCode 兼容审计。
9. 最终 Windows x64 目录 ZIP 真实运行验收。
10. 验收完成后更新 `ORIGIN-08` 矩阵。

## 14. 完成条件

1. V1、V2 都能对任意完成 Assistant TextPart 添加空或非空评论。
2. 草稿按 server/directory/session 隔离并跨重启恢复。
3. 服务端从 durable history 校验来源并重新生成上下文。
4. 模型输入精确符合 XML 外壳、JSON 内部和独立 user-request 合同。
5. 无注释请求不改变现有模型输入。
6. 模型提示要求逐条回应并输出稳定 directive。
7. 合法 directive 渲染和来源回跳正确；代码内容、未知和损坏 directive 不误判。
8. 模型漏答不触发自动补答或隐藏请求。
9. 历史用户消息永久展示结构化注释，内部协议不直接暴露。
10. 容量、安全、隐私、键盘和失败原子性测试全部通过。
11. BluedCode audit-only、prod 目录 ZIP 和真实 Desktop 验收通过。

## 15. 非目标

- 不新增公开 `ResponseAnnotationPart` 或重新生成 SDK。
- 不改变 CLI、Web 或 TUI。
- 不支持用户消息、Reasoning、工具内容、流式内容或跨 Part 选择。
- 不实现多人协作评论、云端同步或评论权限。
- 不实现侧边聊天、更多详情或自动模型补答。
- 不借本需求修改无关注释、Markdown 或 Provider 行为。
