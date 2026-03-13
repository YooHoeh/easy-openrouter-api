# 本地使用与开发

这份文档按“第一次跑这个项目的人”来写。

如果你只是想把服务跑起来，不需要先理解全部架构。

## 先说结论

本项目本地启动很轻：

- 不需要 Redis
- 不需要 PostgreSQL
- 不需要消息队列

只要有 Node.js 和 npm，就能先把服务启动起来。

## 1. 准备环境

需要：

- Node.js 22 或更高版本
- npm

建议先确认版本：

```bash
node -v
npm -v
```

## 2. 安装依赖

在项目根目录执行：

```bash
npm install
```

## 3. 准备 `.env`

把项目根目录下的 [`.env.example`](../../.env.example) 复制成 `.env`。

最简单的做法：

```bash
cp .env.example .env
```

如果你在 Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

### 什么时候必须填 `OPENROUTER_API_KEY`

分两种情况：

1. 只想启动服务、看接口、跑测试  
   这种情况可以不填。

2. 想让 `/v1/chat/completions` 或 `/v1/responses` 真的去调用 OpenRouter  
   这种情况必须填。

示例：

```env
OPENROUTER_API_KEY=你的测试 key
```

### 默认不会自动用收费模型

默认情况下：

- 网关优先使用免费模型
- 回退也只会在免费模型里进行
- 不会自动从免费模型降级到收费模型

只有你显式设置下面这个环境变量，才会允许这件事：

```env
ALLOW_PAID_FALLBACK=true
```

### `.env` 和 `.env.local`

服务启动时会自动读取：

- `.env`
- `.env.local`

如果同一个变量在系统环境变量里已经存在，文件里的值不会覆盖它。

## 4. 启动服务

### 开发模式

```bash
npm run dev
```

适合你改代码时使用。修改文件后会自动重启。

### 生产风格启动

```bash
npm run build
npm start
```

适合你想确认最终构建产物是否能正常跑起来。

默认地址：

- `http://127.0.0.1:3000`

## 5. 最小 smoke 测试

### 先测健康检查

```bash
curl http://127.0.0.1:3000/health
```

### 看看模型列表

```bash
curl http://127.0.0.1:3000/v1/models
```

### 发一个聊天请求

```bash
curl -X POST http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto:free",
    "messages": [
      {
        "role": "user",
        "content": "请只回复 smoke-ok，不要输出其他内容。"
      }
    ]
  }'
```

### 发一个 Responses 请求

```bash
curl -X POST http://127.0.0.1:3000/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto:free",
    "input": "请只回复 smoke-ok，不要输出其他内容。"
  }'
```

### 看 metrics

```bash
curl http://127.0.0.1:3000/v1/metrics
```

## 6. 你最可能会用到的环境变量

### `OPENROUTER_API_KEY`

作用：

- 让网关真的能访问 OpenRouter

不设置会怎样：

- 服务能启动
- 真实上游执行会报 `upstream_unavailable`

### `ENABLE_DEBUG_ROUTE_METADATA`

作用：

- 默认总是返回调试路由信息

适合什么时候开：

- 本地排查路由行为时

### `ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK`

作用：

- 你显式指定了某个模型
- 如果这个模型在运行时碰到可重试错误
- 网关允许自动降级到安全候选链

默认值：

- `false`

### `TELEMETRY_REQUEST_LOG_PATH`

作用：

- 把每次请求的遥测信息追加写入 NDJSON 文件

示例：

```env
TELEMETRY_REQUEST_LOG_PATH=.logs/requests.ndjson
```

### `ALLOW_PAID_FALLBACK`

作用：

- 允许从免费模型降级到收费模型

默认值：

- `false`

建议：

- 如果你还在本地调试或控制成本，保持默认值就好
- 只有你明确接受产生费用时，再改成 `true`

## 7. 开发时推荐执行的命令

```bash
npm run check
npm test
npm run build
```

这三个命令都通过，再算这次改动比较稳。

## 8. 常见问题

### 服务能启动，但聊天接口报 `upstream_unavailable`

原因通常是：

- 没有设置 `OPENROUTER_API_KEY`
- 或者 key 已失效

### 返回的模型和昨天不一样

这是正常现象。

因为网关会根据当前 catalog、健康度和路由规则重新挑选模型。

### 明明写的是 `auto:free`，为什么实际执行模型不是你预想的那个

先带 `?debug=1` 再请求。

你会看到：

- `selected_model`
- `actual_model`
- `attempted_models`
- `fallback_used`

如果是流式请求，就看响应头里的这些字段。

### 图片请求为什么有时更慢

因为一部分图片请求会先走视觉预处理，再把结果交给推理模型。

这是为了让“不支持图片输入的文本模型”也能完成部分图片任务。

## 9. 本地调试最有用的接口

- `GET /v1/models`
- `GET /v1/models/auto`
- `GET /v1/capabilities`
- `GET /v1/metrics`
- `GET /v1/metrics?format=prometheus`
- `POST /v1/route/debug`

如果你在排查“为什么这次选了这个模型”，优先用：

- `POST /v1/route/debug`

如果你在排查“服务最近到底成功了多少请求”，优先用：

- `GET /v1/metrics`

## 10. 交付前最低检查线

交付前至少执行：

```bash
npm run check
npm test
npm run build
```

如果这三步不过，不建议把改动当成完成状态。
