# easy-api Agent 指南

## 项目范围

这个仓库只服务于 `easy-api` 项目。

请把仓库中的文件视为项目上下文的权威来源，不要把别的项目经验直接覆盖到这里。

## 项目简介

`easy-api` 是一个基于 OpenRouter 的 OpenAI 兼容智能网关。

它的主要职责是：

- 发现当前可用模型
- 优先使用免费模型
- 把请求路由到更合适的候选模型
- 在需要时执行 fallback
- 在图片请求场景下做视觉预处理编排
- 对客户端保持稳定接口

## 这个项目不是什么

- 不是聊天 UI
- 不是单模型包装器
- 不是没有交付目标的研究沙盒
- 不是第一版就拆成微服务的项目

## 开始改动前先读什么

优先按下面顺序阅读：

1. `README.md`
2. `docs/development/local-setup.md`
3. `docs/api/openai-compatible-contract.md`
4. `docs/product/project-brief.md`
5. `docs/architecture/routing-and-orchestration-spec.md`

## 默认技术决策

除非用户明确要求改动，否则默认采用：

- 语言：TypeScript
- 运行时：Node.js 22+
- Web 框架：Fastify
- 校验：Zod
- 上游 provider：OpenRouter
- 对外接口形状：OpenAI 兼容
- 部署形态：模块化单体
- 缓存：优先内存，需要时再引入 Redis
- 数据库：按任务范围选择 SQLite 或 PostgreSQL
- 免费文本模型定义：`pricing.prompt == "0"` 且 `pricing.completion == "0"`
- 付费 fallback：默认关闭，只有显式设置 `ALLOW_PAID_FALLBACK=true` 才开启

## 优先级顺序

做事优先级如下：

1. 稳定的客户端 API
2. catalog 同步
3. 路由正确性
4. 流式行为
5. 可观测性
6. 多模态编排
7. 优化和打磨

## 护栏

- 路由和编排决策必须留在服务端
- 优先用简单、明确的模块边界
- 不要过早引入微服务或插件系统
- 不要把实现绑死在单个上游模型 id 上
- 不要隐藏不确定行为，尽量通过调试信息和日志暴露出来
- 在可行范围内保持对常见 OpenAI SDK 用法的兼容

## 目录方向

如果需要加代码，优先保持下面这个结构：

```text
src/
  app/
  routes/
  modules/
    catalog/
    routing/
    orchestration/
    adapters/
    telemetry/
  lib/
  types/
tests/
docs/
```

## 不确定时怎么选

- 先交付最小但有用的行为
- 先把文本和图片做稳，再考虑音频
- 优先采用写得清楚、能解释的规则
- 任何会改变公共契约或执行模型的改动，都要同步文档

## 什么算好的进展

好的进展不是“做得很花”，而是：

- 仓库更容易理解
- 接口更容易使用
- 测试更容易跑
- 下一位工程师更容易继续接手

不要为了聪明而复杂化。优先清晰、稳定、可验证。
