# Anthropic providerAdapter 融入设计文档（阶段 1）

> **状态**：设计已确认，待生成 TDD 实施计划
> **子项目**：ReAct SDK 三模式接入 - 阶段 1（共 3 阶段）
> **后续阶段**：阶段 2 Claude Code SDK adapter → 阶段 3 OpenCode SDK adapter
> **设计日期**：2026-07-05

---

## 1. 背景与目标

### 1.1 问题陈述

当前 `internal/models/chat/anthropic.go` 的 `AnthropicChat`（L20）独立实现 `ChatStream`（L176），**不支持 tools/tool_calls**。`chat.go:161-162` 工厂对 Anthropic 走独立分支：

```go
if providerName == provider.ProviderAnthropic {
    return NewAnthropicChat(config)
}
```

这导致 Anthropic 无法驱动 ReAct 循环（ReAct 引擎需要 LLM 返回 tool_calls）。

### 1.2 目标

让 AnthropicChat 融入 providerAdapter 接口，支持 tools/tool_calls，使 Claude 能驱动 native ReAct 引擎。

### 1.3 方案对比（融入 vs 独立增强）

| 维度 | 方案 A（融入 providerAdapter） | 方案 B（独立增强） |
|---|---|---|
| 工具调用协议 | ✅ 统一（OpenAI tools） | ❌ 分裂（Anthropic tool_use vs OpenAI tools） |
| 代码复用 | ✅ 高（streaming/SSE/retry/tracing） | ❌ 低（独立维护） |
| Anthropic 原生特性 | ❌ 需适配 | ✅ 直接用 |
| 改造工作量 | ❌ 大 | ✅ 小 |
| 回归风险 | ❌ 中 | ✅ 低 |
| ReAct 引擎兼容 | ✅ 无需改 | ❌ 需适配两种协议 |
| 未来扩展性 | ✅ 高 | ❌ 低 |

**决策：采用方案 A（融入 providerAdapter）**。核心理由：工具调用协议统一是关键，避免 ReAct 引擎适配两种协议。

### 1.4 兼容性策略

| 兼容点 | 策略 |
|---|---|
| 现有 Anthropic 用户（无工具调用） | 向后兼容：无 tools 时走普通 chat 流程 |
| cache_control 等原生特性 | 通过 ShapeRequest 注入 |
| 流式响应格式 | 通过 stream_emit.go 转换 Anthropic SSE → OpenAI SSE |

---

## 2. 整体架构

### 2.1 改造范围

```
chat.go 工厂（删除 L161-162 Anthropic 独立分支）
   ↓
provider.go（providerAdapter 接口 + 新增 anthropicProvider）
   ↓
anthropic.go（重写：AnthropicChat 复用 OpenAIChat + anthropicProvider 实现）
   ↓
stream_emit.go（新增 Anthropic SSE → OpenAI SSE 转换器）
   ↓
ReAct 引擎（不改，无感知）
```

### 2.2 与现有代码的关系

| 现有组件 | 改动类型 |
|---|---|
| `chat.go` | **改**：删除 L161-162 Anthropic 独立分支 |
| `anthropic.go` | **重写**：从独立 ChatStream 改为 providerAdapter 实现 |
| `provider.go` | **改**：providerRegistry 新增 anthropicProvider |
| `stream_emit.go` | **改**：新增 Anthropic SSE 转换 |
| ReAct 引擎 | **不改** |
| `internal/types/interfaces/agent.go` | **不改** |

---

## 3. anthropicProvider 实现

### 3.1 类型定义

```go
// internal/models/chat/provider.go 新增

type anthropicProvider struct{ baseProvider }

func (anthropicProvider) Name() provider.ProviderName { return provider.ProviderAnthropic }
func (anthropicProvider) ForceRawHTTP() bool          { return true }

func (anthropicProvider) Endpoint(baseURL, _ string, _ bool) string {
    return strings.TrimRight(baseURL, "/") + "/v1/messages"
}

func (anthropicProvider) Auth(req *http.Request, creds authCreds, _ []byte) {
    req.Header.Set("x-api-key", creds.APIKey)
    req.Header.Set("anthropic-version", "2023-06-01")
}
```

### 3.2 providerRegistry 注册

```go
var providerRegistry = []providerAdapter{
    anthropicProvider{},      // 新增
    weKnoraCloudProvider{},
    // ... 其他保留 ...
}
```

### 3.3 chat.go 工厂改造

删除 L161-162：

```go
// 删除：
// if providerName == provider.ProviderAnthropic {
//     return NewAnthropicChat(config)
// }
// 所有 provider 统一走 NewOpenAIChat + providerAdapter
```

### 3.4 AnthropicChat 重写

```go
// internal/models/chat/anthropic.go 重写

type AnthropicChat struct {
    *OpenAIChat  // 嵌入，复用通用流程
}

func NewAnthropicChat(config *ChatConfig) (*AnthropicChat, error) {
    openaiChat, err := NewOpenAIChat(config)
    if err != nil {
        return nil, err
    }
    return &AnthropicChat{OpenAIChat: openaiChat}, nil
}
```

---

## 4. ShapeRequest 转换逻辑

### 4.1 OpenAI → Anthropic 请求格式转换

```go
func (p anthropicProvider) ShapeRequest(req *openai.ChatCompletionRequest, opts *ChatOptions, isStream bool) {
    // 1. OpenAI tools → Anthropic tools
    //    OpenAI: { type: "function", function: { name, description, parameters } }
    //    Anthropic: { name, description, input_schema }

    // 2. OpenAI messages → Anthropic messages
    //    OpenAI: { role, content (string), tool_calls, tool_call_id }
    //    Anthropic: { role, content: [{ type: "text"|"tool_use"|"tool_result", ... }] }

    // 3. OpenAI system message → Anthropic top-level system 字段

    // 4. OpenAI max_tokens → Anthropic max_tokens（必填）

    // 5. OpenAI tool_choice → Anthropic tool_choice
}
```

### 4.2 工具调用流程

```
ReAct 引擎构造 OpenAI 格式 ChatCompletionRequest（含 tools）
   ↓
AnthropicChat.ChatStream
   ↓
anthropicProvider.ShapeRequest 转换为 Anthropic 格式
   ├─ OpenAI tools → Anthropic tools (input_schema)
   └─ OpenAI messages → Anthropic messages (content blocks)
   ↓
HTTP POST /v1/messages
   ↓
接收 Anthropic SSE 流
   ├─ message_start → 转换为 OpenAI chunk
   ├─ content_block_delta (text_delta) → OpenAI delta.content
   ├─ content_block_delta (input_json_delta) → OpenAI delta.tool_calls
   └─ message_stop → 流结束
   ↓
转换后的 OpenAI 格式 StreamResponse 返回 ReAct 引擎
```

---

## 5. TDD 测试策略

### 5.1 测试用例清单（18 个）

| ID | 测试名 | 验证点 |
|---|---|---|
| AP-001 | TestAnthropicProvider_Name | 返回 ProviderAnthropic |
| AP-002 | TestAnthropicProvider_Endpoint | 返回 baseURL + /v1/messages |
| AP-003 | TestAnthropicProvider_Auth | 设置 x-api-key + anthropic-version |
| AP-004 | TestAnthropicProvider_ForceRawHTTP | 返回 true |
| AP-005 | TestShapeRequest_ToolsConversion | OpenAI tools → Anthropic tools |
| AP-006 | TestShapeRequest_MessagesConversion | OpenAI messages → Anthropic content blocks |
| AP-007 | TestShapeRequest_SystemMessage | OpenAI system → Anthropic top-level system |
| AP-008 | TestShapeRequest_MaxTokens | OpenAI max_tokens → Anthropic max_tokens |
| AP-009 | TestShapeRequest_ToolChoice | OpenAI tool_choice → Anthropic tool_choice |
| AP-010 | TestAnthropicSSE_MessageStart | message_start → OpenAI chunk |
| AP-011 | TestAnthropicSSE_TextDelta | text_delta → OpenAI delta.content |
| AP-012 | TestAnthropicSSE_ToolUseDelta | input_json_delta → OpenAI delta.tool_calls |
| AP-013 | TestAnthropicSSE_MessageStop | message_stop → 流结束 |
| AP-014 | TestChatStream_NoTools | 无 tools 时走普通 chat |
| AP-015 | TestChatStream_WithTools | 有 tools 时返回 tool_calls |
| AP-016 | TestChatFactory_AnthropicBranchDeleted | chat.go 无独立分支 |
| AP-017 | TestReAct_AnthropicDrivesReAct | Claude 驱动 ReAct（集成） |
| AP-018 | TestAnthropic_BackwardCompat | 无 tools 时与改造前一致 |

### 5.2 覆盖率目标

| 模块 | 覆盖率 |
|---|---|
| `anthropic.go`（重写后） | 90%+ |
| `provider.go`（anthropicProvider） | 95%+ |
| `chat.go`（工厂改造） | 85%+ |

### 5.3 TDD 纪律

严格 RED-GREEN-REFACTOR：先写测试 → 验证失败 → 写最小实现 → 验证通过 → 重构。

---

## 6. 非目标

- 不接入 Claude Code SDK（阶段 2）
- 不接入 OpenCode SDK（阶段 3）
- 不新增 `agent.engine` 配置项（阶段 2）
- 不修改 ReAct 引擎核心逻辑
- 不修改 MCP server
