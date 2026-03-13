# 路由与编排规范

> 说明：这份文档描述的是服务端路由和编排原则。实际对外接口字段与使用方式请优先参考 `README.md` 和 `docs/api/openai-compatible-contract.md`。

## 目的

这份文档把高层设计落到更具体的路由行为上。

## 路由目标

- 尽快选出一个可用模型
- 默认免费优先
- 避免脆弱地依赖单个上游模型
- 在需要时通过编排支持图片或音频请求
- 让路由行为可观测

## 能力池

维护独立的候选池：

- `reasoning_pool`
- `vision_pool`
- `audio_pool`

一个模型可以同时属于多个池。

## 免费模型语义

对于 MVP，文本生成场景下将模型视为“免费”的条件是：

- `pricing.prompt == "0"`
- `pricing.completion == "0"`

图片或音频工作流后续可能需要加入更细的能力维度成本判断。

## 路由输入

每个进入系统的请求都应归一化为：

```json
{
  "task_type": "general_chat",
  "required_modalities": ["text"],
  "required_features": [],
  "preferred_context_length": 16000,
  "allow_paid_fallback": false,
  "debug": false
}
```

## 任务类型

第一批任务分类：

- `general_chat`
- `coding`
- `reasoning`
- `vision_qa`
- `document_extraction`
- `audio_transcription`

任务类型可以由请求线索推断；推断不出来时默认 `general_chat`。

## 候选过滤

候选按以下顺序过滤：

1. 在最新 catalog 快照中仍处于 active
2. 符合当前策略
3. 在 direct mode 下支持所有所需模态
4. 支持所有所需特性
5. 满足最小上下文阈值
6. 如果存在健康度数据，则满足健康度阈值

如果 direct mode 没有可用候选，而多模态预处理可行，则切到 orchestrated planning。

## 候选打分

建议纳入这些打分输入：

- `capability_score`
- `task_prior_score`
- `uptime_score`
- `latency_score`
- `throughput_score`
- `recent_success_score`

MVP 建议权重：

```text
0.35 capability_score
0.25 task_prior_score
0.20 uptime_score
0.10 latency_score
0.05 throughput_score
0.05 recent_success_score
```

## Task Priors

第一版从显式、可编辑的 task priors 开始。

示例：

```json
{
  "coding": {
    "qwen/qwen3-coder:free": 0.95,
    "openai/gpt-oss-120b:free": 0.82
  },
  "vision_qa": {
    "google/gemma-3-27b-it:free": 0.88,
    "mistralai/mistral-small-3.1-24b-instruct:free": 0.72
  }
}
```

这些 priors 最好放在独立配置模块中，避免深埋在路由逻辑里。

## Direct Mode

当某个候选模型可以完整处理请求，且健康度足够时，使用 direct mode。

direct mode 的步骤：

1. 分析请求
2. 过滤 direct candidates
3. 对候选打分
4. 选择主模型
5. 构建 fallback chain
6. 调用上游执行

## Orchestrated Mode

在以下场景使用 orchestrated mode：

- 推理模型缺少必要的图片或音频输入能力
- 某个专门模型更适合做预处理
- direct candidates 太弱或不可用

### 图片编排流程

1. 从 `vision_pool` 选择一个视觉候选
2. 从图片中提取结构化信息
3. 把用户意图和提取结果一起交给推理模型
4. 产出最终答案

### 音频编排流程

1. 从 `audio_pool` 选择一个音频候选
2. 把音频转写或总结成结构化输出
3. 把转写结果和用户意图一起交给推理模型
4. 产出最终答案

## 中间契约

专门的预处理器应尽量输出结构化 JSON。

最小字段建议：

```json
{
  "source_type": "image",
  "summary": "简短摘要",
  "raw_text": "识别出的文本（如果有）",
  "entities": [],
  "uncertainties": [],
  "confidence": 0.0
}
```

## Fallback 策略

每个能力池单独构建 fallback。

规则：

- 切换策略前，优先在同一个能力池里重试第二个候选
- 如果推理模型失败，而预处理结果仍可复用，就保留它
- 如果没有免费候选且付费 fallback 被禁用，返回一个能力感知错误
- 在 telemetry 里记录失败原因

## 缓存建议

建议缓存：

- 最新 catalog 快照
- shortlist 模型的 endpoint health
- 对相似请求类别短 TTL 复用 route scores

不建议缓存：

- 以破坏隐私预期的方式缓存用户 prompt
- 默认缓存最终 completion，除非明确在做 response cache

## Telemetry 要求

至少记录：

- request id
- 请求 alias 或 model
- 选中的主模型
- 实际成功执行的模型
- 选中的预处理器
- route mode
- 是否用了 fallback
- 上游延迟
- 成功或失败
- 错误码

## 初始运维策略

除非用户覆盖，默认使用以下策略：

- 开启免费优先路由
- 关闭付费 fallback
- 默认关闭 debug metadata
- 直接文本路径稳定后再正式打开图片编排
- 如果没有健康的免费音频池，音频请求可以显式返回不可用
