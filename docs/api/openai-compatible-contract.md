# OpenAI 兼容接口说明

这份文档描述的是“当前已经实现并可直接使用”的接口行为。

如果你只关心怎么接入，不需要先读架构文档。

## 兼容范围说明

`easy-api` 的目标是：

- 尽量兼容常见 OpenAI SDK 用法
- 把模型选择、回退、视觉编排放到服务端
- 对客户端暴露稳定的接口形状

它不是“逐字段 100% 复刻 OpenAI 官方全部接口”。

当前实现优先覆盖最常见、最实用的部分。

## 默认路由策略

当前默认策略是：

- 优先使用免费模型
- 免费模型失败时，优先在免费模型池里回退
- 默认不会自动降级到收费模型

只有服务端显式设置 `ALLOW_PAID_FALLBACK=true`，才允许从免费模型降级到收费模型。

## 认证说明

当前版本：

- 不校验客户端传入的 Bearer Token
- 也不做用户级鉴权

需要特别区分两件事：

1. 客户端调用本服务时带不带 API Key  
   当前不强制。

2. 服务端调用 OpenRouter 时要不要 API Key  
   必须要。这个由服务端环境变量 `OPENROUTER_API_KEY` 决定。

如果你使用 OpenAI SDK，而 SDK 要求必须填写 `apiKey`，可以填任意非空字符串。

## 已实现的对外接口

- `GET /health`
- `GET /v1/models`
- `GET /v1/models/auto`
- `GET /v1/capabilities`
- `GET /v1/metrics`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/route/debug`

## `POST /v1/chat/completions`

这是当前最推荐的主入口。

### 已支持的能力

- 文本消息
- 图片消息
- 工具调用
- `stream=true`
- 调试元数据
- 模型自动选择
- fallback
- 显式模型运行时安全降级
- 严格固定短答 shortcut

### 常见请求字段

当前已经支持常见这些字段：

- `model`
- `messages`
- `stream`
- `temperature`
- `top_p`
- `stop`
- `presence_penalty`
- `frequency_penalty`
- `seed`
- `tools`
- `tool_choice`
- `parallel_tool_calls`
- `response_format`
- `metadata`

### 示例

```json
{
  "model": "auto:free",
  "messages": [
    {
      "role": "user",
      "content": "请用一句话介绍这个项目。"
    }
  ]
}
```

### 图片示例

```json
{
  "model": "auto:reasoning",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "读一下这张图片，并告诉我里面最重要的信息。"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "https://example.com/invoice.png"
          }
        }
      ]
    }
  ]
}
```

### 返回特点

- 响应体保持 OpenAI 风格
- `model` 字段保留客户端请求时写的模型别名，比如 `auto:free`
- 如果开启调试，响应体里会多一个 `route`

## `POST /v1/responses`

这是当前已经可用的第二入口。

内部会复用和 `chat/completions` 相同的路由、回退、视觉编排和上游执行链。

### 已支持的字段

- `model`
- `input`
- `instructions`
- `temperature`
- `top_p`
- `stop`
- `presence_penalty`
- `frequency_penalty`
- `seed`
- `metadata`
- `tools`
- `tool_choice`
- `parallel_tool_calls`
- `stream`
- `max_output_tokens`
- `text.format`

### `input` 的支持形状

- 普通字符串
- Responses 风格消息数组
- Chat Completions 风格消息数组

### 当前明确不支持的状态型字段

这些字段会直接报错，不会被静默忽略：

- `previous_response_id`
- `store`
- `prompt`
- `conversation`
- `include`
- `truncation`
- `max_tool_calls`

### 返回特点

- 非流式时返回 Responses 风格对象
- 流式时返回基于 SSE 的 Responses 事件流
- 如果上游产生工具调用，非流式和流式都会尽量保真

## 流式输出

### `chat/completions`

当 `stream=true` 时：

- 返回 `text/event-stream`
- 使用 OpenAI 风格 SSE 分块
- 最后会有 `data: [DONE]`

### `responses`

当 `stream=true` 时：

- 返回 `text/event-stream`
- 输出 Responses 风格事件

当前已经接通的常见事件包括：

- `response.created`
- `response.output_text.delta`
- `response.output_item.added`
- `response.function_call_arguments.delta`
- `response.function_call_arguments.done`
- `response.output_item.done`
- `response.completed`

## 模型与能力相关接口

### `GET /v1/models`

返回两类内容：

- 稳定别名
- 当前 catalog 下推荐暴露给客户端的模型

稳定别名包括：

- `auto`
- `auto:free`
- `auto:vision`
- `auto:coding`
- `auto:reasoning`

### `GET /v1/models/auto`

返回每个稳定别名当前的解析结果，包含：

- `selected_model`
- `fallback_chain`
- `required_modalities`
- `required_features`
- `reasons`

### `GET /v1/capabilities`

返回当前 catalog 快照下的能力总览，主要包含：

- catalog 是否可用
- 模型数量
- 稳定别名当前是否可用
- 文本、图片、音频能力摘要
- `streaming`、`tools`、`response_format` 能力摘要
- orchestration 可用性
- 活跃模型健康度摘要

## 调试接口

### `POST /v1/route/debug`

这个接口的作用不是“生成答案”，而是“解释路由决策”。

适合排查这些问题：

- 为什么这次选了这个模型
- 候选链是什么
- 图片请求会不会走 orchestration
- 当前 catalog 是否足够支撑这次请求

返回里通常会包含：

- `normalized_request`
- `direct`
- `orchestration_preview`
- `catalog`

## 调试元数据

### 开启方式

- `?debug=1`
- 请求头 `x-easyapi-debug: 1`
- 环境变量 `ENABLE_DEBUG_ROUTE_METADATA=true`

### 非流式请求

调试元数据会出现在响应体里的 `route` 字段。

常见字段包括：

- `mode`
- `requested_model`
- `selected_model`
- `actual_model`
- `attempted_models`
- `fallback_chain`
- `fallback_used`
- `runtime_fallback`
- `runtime_fallback_used`
- `selected_preprocessors`

### 流式请求

调试信息会放在响应头里。

常见响应头包括：

- `x-easyapi-selected-model`
- `x-easyapi-actual-model`
- `x-easyapi-fallback-used`
- `x-easyapi-attempted-models`

## 指标接口

### `GET /v1/metrics`

默认返回 JSON，统计当前进程生命周期内的请求情况。

主要包含：

- `window`
- `totals`
- `routes`
- `route_modes`
- `error_codes`

### `GET /v1/metrics?format=prometheus`

返回 Prometheus 兼容的纯文本指标。

## 严格短答 shortcut

对于“只允许输出固定文本”的纯指令，比如：

- “请只回复 smoke-ok，不要输出其他内容。”
- “Only reply with OK.”

网关会直接返回固定文本，不再交给上游模型执行。

这样做是为了避免免费模型在这类请求上输出多余内容。

## 错误响应

统一返回 OpenAI 风格错误对象：

```json
{
  "error": {
    "message": "Invalid chat completions request body.",
    "type": "invalid_request_error",
    "code": "invalid_request"
  }
}
```

### 当前稳定错误码

- `invalid_request`
- `no_eligible_model`
- `capability_unavailable`
- `paid_fallback_disabled`
- `upstream_timeout`
- `upstream_unavailable`

## 当前边界

- 没有客户端鉴权
- 没有会话存储
- 没有持久化对话历史
- 没有多租户和计费能力
- Responses API 只覆盖常用字段，不覆盖全部状态型能力
- 默认关闭免费模型到收费模型的自动降级
