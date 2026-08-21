# 回复注释审查问题修复计划

> 对应 `ORIGIN-08` 与 `docs/superpowers/specs/2026-08-18-08-conversation-response-annotations-design.md`。本计划只修复本功能引入的问题，不修改无关上游行为。

## 目标

消除审查发现的隔离、Markdown 语义、来源漂移、空评论、Unicode、浮层和键盘缺陷，并用真实浏览器选择覆盖关键交互。普通 Prompt 历史保持上游行为，注释敏感字段按 server + workspace + session 隔离。

## Task 1：锁定回归合同

修改 Core、App 与 Playwright 测试，先分别得到 RED：

- 全局历史序列化中不得出现 `selected/comment/source`，相同 server/workspace/session 可恢复，任一维度变化不可恢复；
- 空评论可以保存，超 2,000 Unicode code point 明确报错，emoji 不被截断；
- 摘要漂移、Part 删除和虚拟卸载使草稿失效并禁止发送；
- Markdown entity、autolink、图片、任务列表、嵌套列表、link destination、blockquote 与 40k 流式文本；
- 浮层顶边 flip、左右 clamp、滚动/resize 重定位、来源卸载关闭；
- textarea 与按钮焦点下的 Enter/Shift+Enter/Escape；
- Playwright 真实跨节点选区、空评论、滚动、V1/V2 与失效草稿。

## Task 2：统一 Markdown token 语义

在 `packages/core` 使用仓库锁定的 Markdown lexer，投影和 directive 识别共享 token 语义。只在普通可见文本 token 中识别 marker，代码、链接目标、引文和损坏 marker 保持原文；全程单次 token walk，不在字符循环中反复复制尾串。序列化 JSON 同时防止来源文本闭合 XML 外壳。

## Task 3：隔离历史与校验来源

保持普通 Prompt 全局历史；把注释 metadata 放入 `Persist.serverWorkspace` 下的 session 子键。V1/V2 创建 history 时注入 server scope、directory 与 session ID。恢复后使用当前 TextPart 重新计算 digest 和投影；不匹配时展示失效状态、禁止提交，不能猜测相似文本。

## Task 4：修复编辑与浮层交互

允许空评论保存；按 `Array.from`/code point 校验长度并显示本地化错误。操作浮层和编辑浮层从当前 Range 计算位置，滚动、resize、字体/布局变化时刷新；来源卸载即关闭。坐标执行水平 clamp 与上方优先、空间不足时下方 flip。容器级键盘处理覆盖按钮焦点，并删除废弃 LineComment CSS 与硬编码 aria。

## Task 5：完整验证

按包运行 Core、App、Session UI 定向测试和 typecheck；运行真实 Playwright smoke，不能用 localStorage 注入替代核心 UI 路径；运行 App production build 与 BluedCode 品牌兼容审计。记录基线问题，但不得用跳过或放宽断言掩盖本功能失败。未经用户后续明确授权，不提交、不推送、不打包。
