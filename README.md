# easy-api

`easy-api` 是一个基于 OpenRouter 的 OpenAI 兼容网关。

它做的事情很简单：

- 帮你找当前可用的模型
- 优先用免费模型
- 自动挑一个更合适的模型去执行
- 主模型失败时自动回退
- 图片请求需要时自动做视觉预处理
- 对外保持稳定、尽量接近 OpenAI 的接口

如果你不想自己天天追模型、换模型、处理回退逻辑，这个项目就是为这件事准备的。

## 这个项目适合谁

- 想继续用 OpenAI SDK，但底层想接 OpenRouter 的开发者
- 想优先使用免费模型的人
- 想把“模型选择、回退、图片预处理”都放到服务端的人

## 这个项目不做什么

- 不做聊天网页
- 不做计费平台
- 不做多租户后台
- 不保证“永远最强模型”
- 不保证免费模型永远稳定

## 现在已经可以用的接口

- `GET /health`
- `GET /v1/models`
- `GET /v1/models/auto`
- `GET /v1/capabilities`
- `GET /v1/metrics`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/route/debug`

## 已实现的核心能力

- OpenRouter 模型目录同步
- 免费模型优先路由
- 默认关闭“免费模型自动降级到收费模型”
- 候选过滤、打分、主模型选择、fallback chain
- 图片请求的 direct route 和 orchestration route
- `chat/completions` 与 `responses` 两套入口
- SSE 流式输出
- 调试路由元数据
- NDJSON 请求遥测落盘
- 进程内 metrics 汇总
- `Prometheus` 文本格式导出
- 纯固定文本的严格短答 shortcut

## 三分钟上手

### 1. 准备环境

需要这些东西：

- Node.js 22 或更高版本
- npm

### 2. 安装依赖

```bash
npm install
```

### 3. 准备环境变量

把 [`.env.example`](./.env.example) 复制成 `.env`。

如果你只是想启动服务、跑测试、看接口形状，不填 `OPENROUTER_API_KEY` 也可以。

默认情况下，网关只会在免费模型里做选择和回退，不会自动降级到收费模型。

只有你显式设置下面这个环境变量，才会开启免费转收费降级：

```env
ALLOW_PAID_FALLBACK=true
```

如果你想让网关真的去调用 OpenRouter，就必须填写：

```env
OPENROUTER_API_KEY=你的测试 key
```

服务启动时会自动读取：

- `.env`
- `.env.local`

### 4. 启动服务

开发模式：

```bash
npm run dev
```

生产风格启动：

```bash
npm run build
npm start
```

默认地址：

- `http://127.0.0.1:3000`

### 5. 先测一个最简单的接口

```bash
curl http://127.0.0.1:3000/health
```

正常会返回：

```json
{
  "status": "ok",
  "service": "easy-api"
}
```

### 6. 发一个最常见的聊天请求

```bash
curl -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto:free",
    "messages": [
      {
        "role": "user",
        "content": "请用一句话介绍你自己。"
      }
    ]
  }'
```

### 7. 如果你用的是 OpenAI SDK

可以这样接：

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "easy-api-local",
  baseURL: "http://127.0.0.1:3000/v1"
});

const response = await client.chat.completions.create({
  model: "auto:free",
  messages: [
    {
      role: "user",
      content: "请只回复 smoke-ok，不要输出其他内容。"
    }
  ]
});

console.log(response.choices[0]?.message?.content);
```

说明：

- 当前版本对“客户端传来的 API Key”不做校验
- 上面这个 `apiKey` 主要是为了兼容 OpenAI SDK 的初始化参数
- 真正决定能不能访问 OpenRouter 的，是服务端环境变量 `OPENROUTER_API_KEY`

## 最常用的几个接口

### `GET /v1/models`

用来查看网关暴露给客户端的模型列表。

这里返回的不只是 OpenRouter 原始模型，还会包含稳定别名，比如：

- `auto`
- `auto:free`
- `auto:vision`
- `auto:coding`
- `auto:reasoning`

### `GET /v1/models/auto`

用来查看这些稳定别名当前会解析到哪个模型。

适合排查：

- 为什么今天 `auto:free` 选了这个模型
- fallback chain 是什么
- 某个 alias 当前是否可用

### `POST /v1/chat/completions`

这是最推荐直接使用的主入口。

适合大多数 OpenAI SDK 客户端。

支持：

- 文本请求
- 图片请求
- 工具调用
- SSE 流式输出
- 调试元数据

### `POST /v1/responses`

这是另一个 OpenAI 风格入口。

当前已经支持最常用的一批字段，适合想接近新 Responses API 形状的客户端。

### `POST /v1/route/debug`

这个接口不会真正执行完整生成。

它主要用来回答这些问题：

- 这次请求会怎么路由
- 选中了哪个模型
- 候选链是什么
- 图片请求会不会走视觉编排

### `GET /v1/capabilities`

快速查看当前 catalog 快照下，网关整体具备哪些能力。

### `GET /v1/metrics`

查看当前进程生命周期内的请求统计。

如果你想拿 Prometheus 文本格式：

```bash
curl "http://127.0.0.1:3000/v1/metrics?format=prometheus"
```

## 调试怎么开

可以用下面任意一种方式：

- 请求加 `?debug=1`
- 请求头加 `x-easyapi-debug: 1`
- 环境变量设置 `ENABLE_DEBUG_ROUTE_METADATA=true`

非流式请求里，调试信息会放在响应体的 `route` 字段。

流式请求里，调试信息会放在响应头，比如：

- `x-easyapi-selected-model`
- `x-easyapi-actual-model`
- `x-easyapi-fallback-used`
- `x-easyapi-attempted-models`

## 环境变量说明

最常用的是下面几个：

- `HOST`
  监听地址，默认 `0.0.0.0`
- `PORT`
  监听端口，默认 `3000`
- `LOG_LEVEL`
  日志级别，默认 `info`
- `OPENROUTER_API_KEY`
  真正调用 OpenRouter 时必须填写
- `ENABLE_DEBUG_ROUTE_METADATA`
  让调试元数据默认始终返回
- `ALLOW_PAID_FALLBACK`
  允许从免费模型降级到付费模型，默认关闭
- `ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK`
  显式指定模型时，如果上游返回可重试运行时错误，允许自动降级到安全候选链
- `TELEMETRY_REQUEST_LOG_PATH`
  把请求遥测追加写入 NDJSON 文件

完整示例见 [`.env.example`](./.env.example)。

## 现实边界

这几件事要提前知道：

- 不填 `OPENROUTER_API_KEY` 时，服务能启动，但真实上游生成会返回 `upstream_unavailable`
- 默认不会从免费模型自动降级到收费模型，除非你显式设置 `ALLOW_PAID_FALLBACK=true`
- 免费模型池会变，今天能用的模型明天不一定还在
- 免费模型的质量和指令服从性并不稳定
- 图片请求有时会走两段式编排，所以延迟可能比纯文本请求更高
- 当前没有做客户端鉴权、账号系统、计费系统

## 严格短答 shortcut

对这类请求：

- “请只回复 smoke-ok，不要输出其他内容。”
- “Only reply with OK.”

网关会优先识别是不是“纯固定文本回复指令”。

如果是，就直接返回固定文本，不再把这类请求交给上游模型碰运气。

这样做的目的很简单：减少免费模型在“只允许输出固定短文本”场景里的不稳定表现。

## 观测能力

当前已经有这些可直接使用的观测手段：

- 结构化日志
- NDJSON 请求遥测文件
- `GET /v1/metrics`
- `GET /v1/metrics?format=prometheus`
- `/v1/route/debug`

## 常用命令

```bash
npm install
npm run dev
npm run test
npm run check
npm run build
npm start
```

## 给第一次接手这个项目的人

如果你是第一次看这个仓库，建议按这个顺序读：

1. [README.md](./README.md)
2. [docs/development/local-setup.md](./docs/development/local-setup.md)
3. [docs/api/openai-compatible-contract.md](./docs/api/openai-compatible-contract.md)
4. [docs/product/project-brief.md](./docs/product/project-brief.md)
5. [docs/architecture/routing-and-orchestration-spec.md](./docs/architecture/routing-and-orchestration-spec.md)
