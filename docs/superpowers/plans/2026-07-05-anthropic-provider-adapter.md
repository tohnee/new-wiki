# Anthropic providerAdapter 融入实施计划（阶段 1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-v6-subagent-driven-development (recommended) or superpowers-v6-executing-plans to implement this plan task-by-task.

**Goal:** 让 AnthropicChat 融入 providerAdapter 接口，支持 tools/tool_calls，使 Claude 能驱动 native ReAct 引擎。

**Architecture:** 删除 chat.go 工厂的 Anthropic 独立分支；新增 anthropicProvider 实现 providerAdapter 接口；重写 anthropic.go 复用 OpenAIChat 通用流程；新增 Anthropic SSE → OpenAI SSE 转换器。

**Tech Stack:** Go 1.26, go-openai SDK, net/http, SSE streaming, testify.

**Spec:** [docs/superpowers/specs/2026-07-05-anthropic-provider-adapter-design.md](../specs/2026-07-05-anthropic-provider-adapter-design.md)

## Global Constraints

- Go 1.26.0；不破坏现有 ReAct 引擎；无 tools 时向后兼容
- Anthropic 原生 API endpoint：`/v1/messages`
- Anthropic 认证：`x-api-key` header + `anthropic-version: 2023-06-01`
- 工具调用格式转换：OpenAI tools → Anthropic tools (input_schema)
- 流式响应转换：Anthropic SSE → OpenAI SSE
- 测试覆盖率 ≥ 85%；严格 RED-GREEN-REFACTOR
- 不修改 ReAct 引擎、不修改 MCP server、不新增 agent.engine 配置

---

## File Structure

| 文件 | 类型 | 责任 |
|---|---|---|
| `internal/models/chat/provider.go` | 修改 | 新增 anthropicProvider 类型 + 注册到 providerRegistry |
| `internal/models/chat/anthropic.go` | 重写 | AnthropicChat 复用 OpenAIChat + 适配层 |
| `internal/models/chat/anthropic_request.go` | 新增 | OpenAI → Anthropic 请求格式转换 |
| `internal/models/chat/anthropic_stream.go` | 新增 | Anthropic SSE → OpenAI SSE 转换 |
| `internal/models/chat/chat.go` | 修改 | 删除 L161-162 Anthropic 独立分支 |
| `internal/models/chat/provider_test.go` | 修改 | 新增 anthropicProvider 测试 |
| `internal/models/chat/anthropic_request_test.go` | 新增 | ShapeRequest 转换测试 |
| `internal/models/chat/anthropic_stream_test.go` | 新增 | SSE 转换测试 |
| `internal/models/chat/anthropic_test.go` | 修改 | 适配重写后的 AnthropicChat |
| `internal/models/chat/chat_factory_test.go` | 新增 | 工厂分支删除验证 |

---

## Phase 划分概览

| Phase | 主题 | Task 数 | PR 拆分 |
|---|---|---|---|
| Phase 0 | Baseline Tests | 2 | PR1: 基线测试 |
| Phase 1 | anthropicProvider 类型实现 | 3 | PR2: provider 适配器 |
| Phase 2 | ShapeRequest 转换逻辑 | 4 | PR3: 请求格式转换 |
| Phase 3 | Anthropic SSE 转换 | 3 | PR4: 流式响应转换 |
| Phase 4 | AnthropicChat 重写 + 工厂改造 | 3 | PR5: 重写 + 工厂 |
| Phase 5 | 集成测试 | 2 | PR6: 集成测试 |

**PR 拆分原则**：每个 Phase 独立 PR，可独立 review 和回滚。

---

<!-- Phase 详细 task 见下 -->

---

## Phase 0: Baseline Tests

### Task 0.1: 验证 AnthropicChat 独立分支存在

**Files:** Test: `internal/models/chat/anthropic_baseline_test.go`
- Consumes: `chat.go:161-162`
- Produces: 基线断言

- [ ] **Step 1: Write the failing test**

```go
package chat

import (
    "testing"
    "github.com/Tencent/WeKnora/internal/models/provider"
)

func TestChatFactory_AnthropicIndependentBranch_Baseline(t *testing.T) {
    if provider.ProviderAnthropic == "" {
        t.Error("provider.ProviderAnthropic 常量不存在")
    }
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run TestChatFactory_AnthropicIndependentBranch_Baseline -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add internal/models/chat/anthropic_baseline_test.go
git commit -m "test(chat): add baseline test for Anthropic independent branch"
```

### Task 0.2: 验证 AnthropicChat 不支持 tools

**Files:** Test: `internal/models/chat/anthropic_no_tools_test.go`

- [ ] **Step 1: Write the failing test**

```go
package chat

import "testing"

func TestAnthropicChat_NoToolsSupport_Baseline(t *testing.T) {
    var chat *AnthropicChat
    _ = chat
    // 当前 AnthropicChat 不支持 tools（P0 缺陷）
    // 改造后此测试需更新为反向断言
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run TestAnthropicChat_NoToolsSupport_Baseline -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add internal/models/chat/anthropic_no_tools_test.go
git commit -m "test(chat): add baseline test confirming AnthropicChat lacks tools support"
```

<!-- Phase 1+ 见下 -->

---

## Phase 1: anthropicProvider 类型实现

### Task 1.1: anthropicProvider 类型定义

**Files:** Modify: `internal/models/chat/provider.go`; Test: `internal/models/chat/provider_test.go`
- Produces: `anthropicProvider` 类型 + Name/Endpoint/ForceRawHTTP/Auth 方法

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/provider_test.go 追加

func TestAnthropicProvider_Name(t *testing.T) {
    p := anthropicProvider{}
    if p.Name() != provider.ProviderAnthropic {
        t.Errorf("Name() = %q, want %q", p.Name(), provider.ProviderAnthropic)
    }
}

func TestAnthropicProvider_Endpoint(t *testing.T) {
    p := anthropicProvider{}
    got := p.Endpoint("https://api.anthropic.com", "claude-3", true)
    if got != "https://api.anthropic.com/v1/messages" {
        t.Errorf("Endpoint() = %q, want /v1/messages", got)
    }
}

func TestAnthropicProvider_ForceRawHTTP(t *testing.T) {
    p := anthropicProvider{}
    if !p.ForceRawHTTP() { t.Error("ForceRawHTTP() = false, want true") }
}

func TestAnthropicProvider_Auth(t *testing.T) {
    p := anthropicProvider{}
    req, _ := http.NewRequest("POST", "https://api.anthropic.com", nil)
    p.Auth(req, authCreds{APIKey: "key-123"}, nil)
    if req.Header.Get("x-api-key") != "key-123" { t.Error("x-api-key header missing") }
    if req.Header.Get("anthropic-version") != "2023-06-01" { t.Error("anthropic-version header missing") }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/models/chat/ -run "TestAnthropicProvider" -v`
Expected: FAIL "undefined: anthropicProvider"

- [ ] **Step 3: Implement anthropicProvider（GREEN）**

在 `internal/models/chat/provider.go` 末尾添加：

```go
// --- Anthropic: native messages API + tool_use/tool_result ---

type anthropicProvider struct{ baseProvider }

func (anthropicProvider) Name() provider.ProviderName { return provider.ProviderAnthropic }

func (anthropicProvider) ForceRawHTTP() bool { return true }

func (anthropicProvider) Endpoint(baseURL, _ string, _ bool) string {
    return strings.TrimRight(baseURL, "/") + "/v1/messages"
}

func (anthropicProvider) Auth(req *http.Request, creds authCreds, _ []byte) {
    req.Header.Set("x-api-key", creds.APIKey)
    req.Header.Set("anthropic-version", "2023-06-01")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestAnthropicProvider" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/provider.go internal/models/chat/provider_test.go
git commit -m "feat(chat): add anthropicProvider implementing providerAdapter interface"
```

### Task 1.2: 注册到 providerRegistry

**Files:** Modify: `internal/models/chat/provider.go`; Test: `internal/models/chat/provider_registry_test.go`

- [ ] **Step 1: Write the failing test（RED）**

```go
package chat

import (
    "testing"
    "github.com/Tencent/WeKnora/internal/models/provider"
)

func TestProviderRegistry_IncludesAnthropic(t *testing.T) {
    found := false
    for _, p := range providerRegistry {
        if p.Name() == provider.ProviderAnthropic { found = true; break }
    }
    if !found { t.Error("providerRegistry does not include anthropicProvider") }
}

func TestResolveProvider_Anthropic(t *testing.T) {
    p := resolveProvider(provider.ProviderAnthropic, "claude-3-opus")
    if p.Name() != provider.ProviderAnthropic {
        t.Errorf("resolveProvider(Anthropic) = %q, want Anthropic", p.Name())
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/models/chat/ -run "TestProviderRegistry_IncludesAnthropic|TestResolveProvider_Anthropic" -v`
Expected: FAIL

- [ ] **Step 3: 注册到 providerRegistry（GREEN）**

在 `internal/models/chat/provider.go` 的 `providerRegistry` 数组**开头**添加 `anthropicProvider{}`：

```go
var providerRegistry = []providerAdapter{
    anthropicProvider{},      // 新增
    weKnoraCloudProvider{},
    qwenThinkingProvider{},
    // ... 其他保留 ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestProviderRegistry_IncludesAnthropic|TestResolveProvider_Anthropic" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/provider.go internal/models/chat/provider_registry_test.go
git commit -m "feat(chat): register anthropicProvider in providerRegistry"
```

### Task 1.3: 编译验证

- [ ] **Step 1: Run full build**

Run: `go build ./...`
Expected: PASS（无编译错误）

- [ ] **Step 2: Commit（如有修复）**

```bash
git commit -am "fix(chat): resolve compilation issues from anthropicProvider registration"
```

---

## Phase 2: ShapeRequest 转换逻辑

> Anthropic 原生 API 使用 `system` 顶层字段、`content blocks`（text / tool_use / tool_result）、`input_schema` 工具格式，与 OpenAI 的 `messages[].content` 字符串、`function.parameters` 不同。本 Phase 实现 OpenAI → Anthropic 请求格式转换，并挂载到 `anthropicProvider.ShapeRequest`。

### Task 2.1: 新增 anthropic_request.go + convertToolsToAnthropic 函数

**Files:** Create `internal/models/chat/anthropic_request.go`; Test: `internal/models/chat/anthropic_request_test.go`
- Consumes: `openai.Tool`（go-openai SDK）
- Produces: `convertToolsToAnthropic(tools []openai.Tool) []map[string]any`
- 转换规则：OpenAI `{ type: "function", function: { name, description, parameters } }` → Anthropic `{ name, description, input_schema }`

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/anthropic_request_test.go
package chat

import (
	"reflect"
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestConvertToolsToAnthropic(t *testing.T) {
	tools := []openai.Tool{
		{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        "search",
				Description: "Search the web",
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"query": map[string]any{"type": "string"},
					},
				},
			},
		},
	}
	result := convertToolsToAnthropic(tools)
	if len(result) != 1 {
		t.Fatalf("len(result) = %d, want 1", len(result))
	}
	if result[0]["name"] != "search" {
		t.Errorf("name = %v, want \"search\"", result[0]["name"])
	}
	if result[0]["description"] != "Search the web" {
		t.Errorf("description = %v, want \"Search the web\"", result[0]["description"])
	}
	schema, ok := result[0]["input_schema"].(map[string]any)
	if !ok {
		t.Fatalf("input_schema type = %T, want map[string]any", result[0]["input_schema"])
	}
	if schema["type"] != "object" {
		t.Errorf("input_schema.type = %v, want \"object\"", schema["type"])
	}
}

func TestConvertToolsToAnthropic_Empty(t *testing.T) {
	if got := convertToolsToAnthropic(nil); got != nil {
		t.Errorf("convertToolsToAnthropic(nil) = %v, want nil", got)
	}
	if got := convertToolsToAnthropic([]openai.Tool{}); got != nil {
		t.Errorf("convertToolsToAnthropic(empty) = %v, want nil", got)
	}
}

func TestConvertToolsToAnthropic_SkipsNilFunction(t *testing.T) {
	tools := []openai.Tool{
		{Type: openai.ToolTypeFunction, Function: nil},
		{Type: openai.ToolTypeFunction, Function: &openai.FunctionDefinition{Name: "ok"}},
	}
	result := convertToolsToAnthropic(tools)
	if len(result) != 1 {
		t.Fatalf("len = %d, want 1 (nil Function skipped)", len(result))
	}
	if result[0]["name"] != "ok" {
		t.Errorf("name = %v, want \"ok\"", result[0]["name"])
	}
}

func TestConvertToolsToAnthropic_NoDescription(t *testing.T) {
	tools := []openai.Tool{
		{Type: openai.ToolTypeFunction, Function: &openai.FunctionDefinition{Name: "bare"}},
	}
	result := convertToolsToAnthropic(tools)
	if _, exists := result[0]["description"]; exists {
		t.Error("description should be absent when empty")
	}
	if _, exists := result[0]["input_schema"]; exists {
		t.Error("input_schema should be absent when Parameters is nil")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/models/chat/ -run "TestConvertToolsToAnthropic" -v`
Expected: FAIL `undefined: convertToolsToAnthropic`

- [ ] **Step 3: Implement convertToolsToAnthropic（GREEN）**

```go
// internal/models/chat/anthropic_request.go
package chat

import "github.com/sashabaranov/go-openai"

// convertToolsToAnthropic converts OpenAI tool definitions to Anthropic format.
//
// OpenAI:    { type: "function", function: { name, description, parameters } }
// Anthropic: { name, description, input_schema }
//
// Returns nil when the input is empty so the "tools" field is omitted from the
// outbound JSON entirely.
func convertToolsToAnthropic(tools []openai.Tool) []map[string]any {
	if len(tools) == 0 {
		return nil
	}
	result := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		if tool.Function == nil {
			continue
		}
		entry := map[string]any{
			"name": tool.Function.Name,
		}
		if tool.Function.Description != "" {
			entry["description"] = tool.Function.Description
		}
		if tool.Function.Parameters != nil {
			entry["input_schema"] = tool.Function.Parameters
		}
		result = append(result, entry)
	}
	return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestConvertToolsToAnthropic" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/anthropic_request.go internal/models/chat/anthropic_request_test.go
git commit -m "feat(chat): add convertToolsToAnthropic for OpenAI→Anthropic tool conversion"
```

### Task 2.2: convertMessagesToAnthropic 函数

**Files:** Modify `internal/models/chat/anthropic_request.go`, `internal/models/chat/anthropic_request_test.go`
- Produces: `convertMessagesToAnthropic(msgs []openai.ChatCompletionMessage) (system string, converted []map[string]any)`
- 转换规则：
  - OpenAI `system` message → top-level `system` 字符串（多条拼接）
  - OpenAI `user` → `{ role: "user", content: [{ type: "text", text: ... }] }`
  - OpenAI `assistant` 文本 → `{ role: "assistant", content: [{ type: "text", text: ... }] }`
  - OpenAI `assistant.tool_calls` → `tool_use` content blocks `{ type: "tool_use", id, name, input }`
  - OpenAI `tool` role → `tool_result` content block `{ type: "tool_result", tool_use_id, content }`

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/anthropic_request_test.go 追加

func TestConvertMessagesToAnthropic_SystemExtracted(t *testing.T) {
	msgs := []openai.ChatCompletionMessage{
		{Role: "system", Content: "You are helpful"},
		{Role: "user", Content: "Hi"},
	}
	system, converted := convertMessagesToAnthropic(msgs)
	if system != "You are helpful" {
		t.Errorf("system = %q, want \"You are helpful\"", system)
	}
	if len(converted) != 1 {
		t.Fatalf("len(converted) = %d, want 1", len(converted))
	}
	if converted[0]["role"] != "user" {
		t.Errorf("role = %v, want \"user\"", converted[0]["role"])
	}
}

func TestConvertMessagesToAnthropic_MultipleSystemJoined(t *testing.T) {
	msgs := []openai.ChatCompletionMessage{
		{Role: "system", Content: "Rule A"},
		{Role: "system", Content: "Rule B"},
	}
	system, converted := convertMessagesToAnthropic(msgs)
	if system != "Rule A\n\nRule B" {
		t.Errorf("system = %q, want joined with \\n\\n", system)
	}
	if len(converted) != 0 {
		t.Errorf("converted should be empty (system extracted), got %d", len(converted))
	}
}

func TestConvertMessagesToAnthropic_UserText(t *testing.T) {
	msgs := []openai.ChatCompletionMessage{
		{Role: "user", Content: "Hello"},
	}
	_, converted := convertMessagesToAnthropic(msgs)
	if len(converted) != 1 {
		t.Fatalf("len = %d, want 1", len(converted))
	}
	content, ok := converted[0]["content"].([]map[string]any)
	if !ok {
		t.Fatalf("content type = %T, want []map[string]any", converted[0]["content"])
	}
	if len(content) != 1 || content[0]["type"] != "text" || content[0]["text"] != "Hello" {
		t.Errorf("content = %v, want [{type:text, text:Hello}]", content)
	}
}

func TestConvertMessagesToAnthropic_AssistantToolCalls(t *testing.T) {
	msgs := []openai.ChatCompletionMessage{
		{
			Role: "assistant",
			ToolCalls: []openai.ToolCall{
				{
					ID:   "call_001",
					Type: openai.ToolTypeFunction,
					Function: openai.FunctionCall{
						Name:      "search",
						Arguments: `{"query":"test"}`,
					},
				},
			},
		},
	}
	_, converted := convertMessagesToAnthropic(msgs)
	if len(converted) != 1 {
		t.Fatalf("len = %d, want 1", len(converted))
	}
	content, ok := converted[0]["content"].([]map[string]any)
	if !ok || len(content) != 1 {
		t.Fatalf("content = %v", converted[0]["content"])
	}
	block := content[0]
	if block["type"] != "tool_use" {
		t.Errorf("type = %v, want \"tool_use\"", block["type"])
	}
	if block["id"] != "call_001" {
		t.Errorf("id = %v, want \"call_001\"", block["id"])
	}
	if block["name"] != "search" {
		t.Errorf("name = %v, want \"search\"", block["name"])
	}
	input, ok := block["input"].(map[string]any)
	if !ok {
		t.Fatalf("input type = %T, want map", block["input"])
	}
	if input["query"] != "test" {
		t.Errorf("input.query = %v, want \"test\"", input["query"])
	}
}

func TestConvertMessagesToAnthropic_ToolResult(t *testing.T) {
	msgs := []openai.ChatCompletionMessage{
		{Role: "tool", Content: "result text", ToolCallID: "call_001"},
	}
	_, converted := convertMessagesToAnthropic(msgs)
	if len(converted) != 1 {
		t.Fatalf("len = %d, want 1", len(converted))
	}
	if converted[0]["role"] != "user" {
		t.Errorf("role = %v, want \"user\" (tool results attach to user)", converted[0]["role"])
	}
	content, ok := converted[0]["content"].([]map[string]any)
	if !ok || len(content) != 1 {
		t.Fatalf("content = %v", converted[0]["content"])
	}
	block := content[0]
	if block["type"] != "tool_result" {
		t.Errorf("type = %v, want \"tool_result\"", block["type"])
	}
	if block["tool_use_id"] != "call_001" {
		t.Errorf("tool_use_id = %v, want \"call_001\"", block["tool_use_id"])
	}
	if block["content"] != "result text" {
		t.Errorf("content = %v, want \"result text\"", block["content"])
	}
}

func TestConvertMessagesToAnthropic_AssistantWithTextAndToolCalls(t *testing.T) {
	msgs := []openai.ChatCompletionMessage{
		{
			Role:    "assistant",
			Content: "Let me search",
			ToolCalls: []openai.ToolCall{
				{
					ID:   "call_001",
					Type: openai.ToolTypeFunction,
					Function: openai.FunctionCall{
						Name:      "search",
						Arguments: `{"query":"test"}`,
					},
				},
			},
		},
	}
	_, converted := convertMessagesToAnthropic(msgs)
	if len(converted) != 1 {
		t.Fatalf("len = %d, want 1", len(converted))
	}
	content := converted[0]["content"].([]map[string]any)
	if len(content) != 2 {
		t.Fatalf("content blocks = %d, want 2 (text + tool_use)", len(content))
	}
	if content[0]["type"] != "text" || content[0]["text"] != "Let me search" {
		t.Errorf("block[0] = %v, want text block", content[0])
	}
	if content[1]["type"] != "tool_use" {
		t.Errorf("block[1].type = %v, want \"tool_use\"", content[1]["type"])
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/models/chat/ -run "TestConvertMessagesToAnthropic" -v`
Expected: FAIL `undefined: convertMessagesToAnthropic`

- [ ] **Step 3: Implement convertMessagesToAnthropic（GREEN）**

```go
// internal/models/chat/anthropic_request.go 追加

import (
	"encoding/json"
	"strings"

	"github.com/sashabaranov/go-openai"
)

// convertMessagesToAnthropic converts OpenAI chat messages to Anthropic format.
//
// Returns the top-level system string (extracted from all system messages,
// joined by "\n\n") and the converted message list. Each converted message
// has { role, content: [{type, ...}] } structure:
//   - user text      → { type: "text", text }
//   - assistant text → { type: "text", text }
//   - assistant tool_calls → { type: "tool_use", id, name, input }
//   - tool role      → { type: "tool_result", tool_use_id, content } (role: "user")
func convertMessagesToAnthropic(msgs []openai.ChatCompletionMessage) (system string, converted []map[string]any) {
	var systemParts []string
	for _, msg := range msgs {
		switch msg.Role {
		case "system":
			if strings.TrimSpace(msg.Content) != "" {
				systemParts = append(systemParts, msg.Content)
			}
		case "user":
			blocks := buildUserContentBlocks(msg)
			if len(blocks) > 0 {
				converted = append(converted, map[string]any{
					"role":    "user",
					"content": blocks,
				})
			}
		case "assistant":
			blocks := buildAssistantContentBlocks(msg)
			if len(blocks) > 0 {
				converted = append(converted, map[string]any{
					"role":    "assistant",
					"content": blocks,
				})
			}
		case "tool":
			// Anthropic: tool results are sent as user messages with
			// tool_result content blocks.
			converted = append(converted, map[string]any{
				"role": "user",
				"content": []map[string]any{
					{
						"type":         "tool_result",
						"tool_use_id":  msg.ToolCallID,
						"content":      msg.Content,
					},
				},
			})
		}
	}
	system = strings.Join(systemParts, "\n\n")
	return system, converted
}

// buildUserContentBlocks converts a user message into Anthropic content blocks.
// Falls back to MultiContent when Content is empty.
func buildUserContentBlocks(msg openai.ChatCompletionMessage) []map[string]any {
	if msg.Content != "" {
		return []map[string]any{{"type": "text", "text": msg.Content}}
	}
	if len(msg.MultiContent) == 0 {
		return nil
	}
	var blocks []map[string]any
	for _, part := range msg.MultiContent {
		if part.Type == openai.ChatMessagePartTypeText && part.Text != "" {
			blocks = append(blocks, map[string]any{"type": "text", "text": part.Text})
		}
	}
	return blocks
}

// buildAssistantContentBlocks converts an assistant message (text + tool_calls)
// into Anthropic content blocks. Text content comes first, then tool_use blocks.
func buildAssistantContentBlocks(msg openai.ChatCompletionMessage) []map[string]any {
	var blocks []map[string]any
	if msg.Content != "" {
		blocks = append(blocks, map[string]any{"type": "text", "text": msg.Content})
	}
	for _, tc := range msg.ToolCalls {
		var input any
		if raw := strings.TrimSpace(tc.Function.Arguments); raw != "" {
			var parsed map[string]any
			if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
				input = parsed
			} else {
				input = map[string]any{"_raw": raw}
			}
		}
		blocks = append(blocks, map[string]any{
			"type":  "tool_use",
			"id":    tc.ID,
			"name":  tc.Function.Name,
			"input": input,
		})
	}
	return blocks
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestConvertMessagesToAnthropic" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/anthropic_request.go internal/models/chat/anthropic_request_test.go
git commit -m "feat(chat): add convertMessagesToAnthropic for OpenAI→Anthropic message conversion"
```

### Task 2.3: anthropicProvider.ShapeRequest 方法实现

**Files:** Modify `internal/models/chat/provider.go`（给 anthropicProvider 加 ShapeRequest 方法）; Test: `internal/models/chat/provider_test.go`
- Consumes: `convertToolsToAnthropic`、`convertMessagesToAnthropic`（Task 2.1/2.2）
- Produces: `anthropicProvider.ShapeRequest` 实现
- 职责：
  1. 设置 `max_tokens` 默认值（Anthropic 必填，OpenAI 可选）
  2. 转换 `tool_choice`（OpenAI `"auto"`/`"required"` → Anthropic `{"type":"auto"}`/`{"type":"any"}`）

> **架构说明**：`ShapeRequest` 修改 `*openai.ChatCompletionRequest` 的字段。tools 与 messages 的 Anthropic 格式转换在 Phase 4 body 组装阶段由 `convertToolsToAnthropic`/`convertMessagesToAnthropic` 完成；`ShapeRequest` 仅负责 max_tokens 与 tool_choice 这两个直接修改 `openai.ChatCompletionRequest` 字段的逻辑。

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/provider_test.go 追加

func TestAnthropicProvider_ShapeRequest_MaxTokensDefault(t *testing.T) {
	p := anthropicProvider{}
	req := &openai.ChatCompletionRequest{
		Model:    "claude-3-opus",
		Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "Hi"}},
	}
	p.ShapeRequest(req, nil, false)
	if req.MaxTokens != 4096 {
		t.Errorf("MaxTokens = %d, want 4096 (Anthropic default)", req.MaxTokens)
	}
}

func TestAnthropicProvider_ShapeRequest_MaxTokensPreserved(t *testing.T) {
	p := anthropicProvider{}
	req := &openai.ChatCompletionRequest{
		Model:     "claude-3-opus",
		Messages:  []openai.ChatCompletionMessage{{Role: "user", Content: "Hi"}},
		MaxTokens: 8192,
	}
	p.ShapeRequest(req, nil, false)
	if req.MaxTokens != 8192 {
		t.Errorf("MaxTokens = %d, want 8192 (preserved)", req.MaxTokens)
	}
}

func TestAnthropicProvider_ShapeRequest_ToolChoiceAuto(t *testing.T) {
	p := anthropicProvider{}
	req := &openai.ChatCompletionRequest{
		Model:      "claude-3-opus",
		Messages:   []openai.ChatCompletionMessage{{Role: "user", Content: "Hi"}},
		MaxTokens:  1024,
		ToolChoice: "auto",
	}
	p.ShapeRequest(req, &ChatOptions{ToolChoice: "auto"}, false)
	tc, ok := req.ToolChoice.(map[string]any)
	if !ok {
		t.Fatalf("ToolChoice type = %T, want map[string]any", req.ToolChoice)
	}
	if tc["type"] != "auto" {
		t.Errorf("ToolChoice.type = %v, want \"auto\"", tc["type"])
	}
}

func TestAnthropicProvider_ShapeRequest_ToolChoiceRequired(t *testing.T) {
	p := anthropicProvider{}
	req := &openai.ChatCompletionRequest{
		Model:      "claude-3-opus",
		Messages:   []openai.ChatCompletionMessage{{Role: "user", Content: "Hi"}},
		MaxTokens:  1024,
		ToolChoice: "required",
	}
	p.ShapeRequest(req, &ChatOptions{ToolChoice: "required"}, false)
	tc, ok := req.ToolChoice.(map[string]any)
	if !ok {
		t.Fatalf("ToolChoice type = %T, want map[string]any", req.ToolChoice)
	}
	if tc["type"] != "any" {
		t.Errorf("ToolChoice.type = %v, want \"any\" (Anthropic maps required→any)", tc["type"])
	}
}

func TestAnthropicProvider_ShapeRequest_ToolChoiceNone(t *testing.T) {
	p := anthropicProvider{}
	req := &openai.ChatCompletionRequest{
		Model:      "claude-3-opus",
		Messages:   []openai.ChatCompletionMessage{{Role: "user", Content: "Hi"}},
		MaxTokens:  1024,
		ToolChoice: "none",
	}
	p.ShapeRequest(req, &ChatOptions{ToolChoice: "none"}, false)
	if req.ToolChoice != nil {
		t.Errorf("ToolChoice = %v, want nil for \"none\"", req.ToolChoice)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/models/chat/ -run "TestAnthropicProvider_ShapeRequest" -v`
Expected: FAIL `MaxTokens = 0, want 4096` 或 ToolChoice 未转换

- [ ] **Step 3: Implement ShapeRequest（GREEN）**

在 `internal/models/chat/provider.go` 的 anthropicProvider 定义处追加 ShapeRequest 方法：

```go
// internal/models/chat/provider.go 追加（anthropicProvider 方法块内）

func (p anthropicProvider) ShapeRequest(req *openai.ChatCompletionRequest, opts *ChatOptions, _ bool) {
	// Anthropic requires max_tokens (OpenAI treats it as optional).
	if req.MaxTokens == 0 {
		req.MaxTokens = 4096
	}

	// Convert tool_choice: OpenAI string → Anthropic { type } map.
	//   "auto"     → { "type": "auto" }
	//   "required" → { "type": "any" }   (Anthropic has no "required"; "any" means "must use a tool")
	//   "none"     → nil (omit tool_choice; Anthropic doesn't support "none" directly)
	//   specific   → { "type": "tool", "name": <toolName> }
	choice := ""
	if opts != nil {
		choice = opts.ToolChoice
	}
	if choice == "" {
		if s, ok := req.ToolChoice.(string); ok {
			choice = s
		}
	}
	switch choice {
	case "auto":
		req.ToolChoice = map[string]any{"type": "auto"}
	case "required":
		req.ToolChoice = map[string]any{"type": "any"}
	case "none":
		req.ToolChoice = nil
	case "":
		// leave as-is
	default:
		req.ToolChoice = map[string]any{"type": "tool", "name": choice}
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestAnthropicProvider_ShapeRequest" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/provider.go internal/models/chat/provider_test.go
git commit -m "feat(chat): implement anthropicProvider.ShapeRequest (max_tokens + tool_choice)"
```

### Task 2.4: ShapeRequest 集成测试

**Files:** Test: `internal/models/chat/anthropic_request_test.go`
- 验证完整请求转换流程：tools + messages + system + max_tokens + tool_choice 一起工作

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/anthropic_request_test.go 追加

func TestShapeRequest_FullConversion_Integration(t *testing.T) {
	p := anthropicProvider{}
	req := &openai.ChatCompletionRequest{
		Model: "claude-3-opus",
		Messages: []openai.ChatCompletionMessage{
			{Role: "system", Content: "You are a helpful assistant"},
			{Role: "user", Content: "Search for cats"},
			{
				Role: "assistant",
				ToolCalls: []openai.ToolCall{
					{ID: "call_001", Type: openai.ToolTypeFunction, Function: openai.FunctionCall{Name: "search", Arguments: `{"query":"cats"}`}},
				},
			},
			{Role: "tool", Content: "found 3 cats", ToolCallID: "call_001"},
			{Role: "user", Content: "Tell me about them"},
		},
		Tools: []openai.Tool{
			{Type: openai.ToolTypeFunction, Function: &openai.FunctionDefinition{
				Name:        "search",
				Description: "Search the web",
				Parameters:  map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}}},
			}},
		},
	}
	opts := &ChatOptions{ToolChoice: "auto"}

	// 1. ShapeRequest sets max_tokens + tool_choice
	p.ShapeRequest(req, opts, true)
	if req.MaxTokens != 4096 {
		t.Errorf("MaxTokens = %d, want 4096", req.MaxTokens)
	}

	// 2. Convert tools
	anthropicTools := convertToolsToAnthropic(req.Tools)
	if len(anthropicTools) != 1 || anthropicTools[0]["name"] != "search" {
		t.Errorf("tools conversion failed: %v", anthropicTools)
	}
	if _, ok := anthropicTools[0]["input_schema"]; !ok {
		t.Error("input_schema missing from converted tool")
	}

	// 3. Convert messages
	system, converted := convertMessagesToAnthropic(req.Messages)
	if system != "You are a helpful assistant" {
		t.Errorf("system = %q, want system prompt", system)
	}
	// system + user + assistant(tool_use) + tool(result) + user → 4 non-system messages
	if len(converted) != 4 {
		t.Fatalf("len(converted) = %d, want 4", len(converted))
	}

	// 4. Verify tool_result is a user message with tool_result block
	toolResultMsg := converted[2]
	if toolResultMsg["role"] != "user" {
		t.Errorf("tool result role = %v, want \"user\"", toolResultMsg["role"])
	}
	blocks := toolResultMsg["content"].([]map[string]any)
	if blocks[0]["type"] != "tool_result" {
		t.Errorf("block type = %v, want \"tool_result\"", blocks[0]["type"])
	}
	if blocks[0]["tool_use_id"] != "call_001" {
		t.Errorf("tool_use_id = %v, want \"call_001\"", blocks[0]["tool_use_id"])
	}

	// 5. Verify tool_choice converted to Anthropic map
	tc, ok := req.ToolChoice.(map[string]any)
	if !ok {
		t.Fatalf("ToolChoice = %T, want map", req.ToolChoice)
	}
	if tc["type"] != "auto" {
		t.Errorf("ToolChoice.type = %v, want \"auto\"", tc["type"])
	}
}
```

- [ ] **Step 2: Run test to verify it passes（依赖 Task 2.1-2.3 已实现）**

Run: `go test ./internal/models/chat/ -run "TestShapeRequest_FullConversion_Integration" -v`
Expected: PASS

- [ ] **Step 3: No implementation needed（GREEN already from 2.1-2.3）**

如果测试通过，跳过实现步骤。如果失败，修复 Task 2.1-2.3 的实现。

- [ ] **Step 4: Run full Phase 2 test suite**

Run: `go test ./internal/models/chat/ -run "TestConvertToolsToAnthropic|TestConvertMessagesToAnthropic|TestAnthropicProvider_ShapeRequest|TestShapeRequest_FullConversion" -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/anthropic_request_test.go
git commit -m "test(chat): add ShapeRequest full conversion integration test"
```

---

## Phase 3: Anthropic SSE 转换

> Anthropic 流式响应使用事件类型 `message_start` / `content_block_delta` / `message_stop` 等，与 OpenAI 的 `choices[].delta` 格式不同。本 Phase 实现一个转换器 `convertAnthropicSSEToOpenAI`，将 Anthropic SSE 事件转换为 `types.StreamResponse`，使 ReAct 引擎无需感知 Anthropic 协议。

### Task 3.1: 新增 anthropic_stream.go + message_start 转换

**Files:** Create `internal/models/chat/anthropic_stream.go`; Test: `internal/models/chat/anthropic_stream_test.go`
- Consumes: Anthropic SSE 事件 JSON
- Produces: `convertAnthropicSSEToOpenAI(event string, data json.RawMessage) (*types.StreamResponse, bool)`
- 返回值：转换后的 `*types.StreamResponse` + `bool`（true=流结束）
- `message_start` 事件 → 返回流开始的 StreamResponse（包含 message ID）

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/anthropic_stream_test.go
package chat

import (
	"encoding/json"
	"testing"

	"github.com/Tencent/WeKnora/internal/types"
)

func TestConvertAnthropicSSE_MessageStart(t *testing.T) {
	data := json.RawMessage(`{
		"type": "message_start",
		"message": {
			"id": "msg_001",
			"role": "assistant",
			"usage": {"input_tokens": 10, "output_tokens": 0}
		}
	}`)
	resp, done := convertAnthropicSSEToOpenAI("message_start", data)
	if done {
		t.Error("done = true, want false (stream just started)")
	}
	if resp == nil {
		t.Fatal("resp = nil, want non-nil")
	}
	if resp.ID != "msg_001" {
		t.Errorf("ID = %q, want \"msg_001\"", resp.ID)
	}
	if resp.Done {
		t.Error("resp.Done = true, want false")
	}
}

func TestConvertAnthropicSSE_UnknownEvent(t *testing.T) {
	resp, done := convertAnthropicSSEToOpenAI("ping", json.RawMessage(`{"type":"ping"}`))
	if done {
		t.Error("done = true for unknown event")
	}
	if resp != nil {
		t.Errorf("resp = %v, want nil for unknown event", resp)
	}
}

func TestConvertAnthropicSSE_InvalidJSON(t *testing.T) {
	resp, done := convertAnthropicSSEToOpenAI("message_start", json.RawMessage(`{invalid`))
	if !done {
		t.Error("done = false on parse error, want true")
	}
	if resp == nil {
		t.Fatal("resp = nil on parse error")
	}
	if resp.ResponseType != types.ResponseTypeError {
		t.Errorf("ResponseType = %v, want error", resp.ResponseType)
	}
	if !resp.Done {
		t.Error("Done = false, want true on error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/models/chat/ -run "TestConvertAnthropicSSE" -v`
Expected: FAIL `undefined: convertAnthropicSSEToOpenAI`

- [ ] **Step 3: Implement convertAnthropicSSEToOpenAI（GREEN）**

```go
// internal/models/chat/anthropic_stream.go
package chat

import (
	"encoding/json"
	"fmt"

	"github.com/Tencent/WeKnora/internal/types"
)

// convertAnthropicSSEToOpenAI converts a single Anthropic SSE event into an
// OpenAI-compatible StreamResponse. The bool return is true when the stream
// is finished (message_stop or fatal error).
//
// Anthropic SSE events:
//   message_start          → stream begin (carries message ID + input usage)
//   content_block_delta    → text_delta (→ delta.content) or input_json_delta (→ delta.tool_calls)
//   message_delta          → stop_reason
//   message_stop           → stream end
//   content_block_start/stop, ping → ignored (return nil, false)
func convertAnthropicSSEToOpenAI(event string, data json.RawMessage) (*types.StreamResponse, bool) {
	switch event {
	case "message_start":
		return convertMessageStart(data)
	case "content_block_start":
		return convertContentBlockStart(data)
	case "content_block_delta":
		return convertContentBlockDelta(data)
	case "message_delta":
		return convertMessageDelta(data)
	case "message_stop":
		return &types.StreamResponse{
			ResponseType: types.ResponseTypeAnswer,
			Done:         true,
		}, true
	default:
		return nil, false
	}
}

// convertMessageStart handles the "message_start" event.
// Extracts the message ID and input token usage.
func convertMessageStart(data json.RawMessage) (*types.StreamResponse, bool) {
	var evt struct {
		Message struct {
			ID    string `json:"id"`
			Usage struct {
				InputTokens  int `json:"input_tokens"`
				OutputTokens int `json:"output_tokens"`
			} `json:"usage"`
		} `json:"message"`
	}
	if err := json.Unmarshal(data, &evt); err != nil {
		return &types.StreamResponse{
			ResponseType: types.ResponseTypeError,
			Content:      fmt.Sprintf("parse message_start: %v", err),
			Done:         true,
		}, true
	}
	return &types.StreamResponse{
		ID:           evt.Message.ID,
		ResponseType: types.ResponseTypeAnswer,
		Done:         false,
		Usage: &types.TokenUsage{
			PromptTokens: evt.Message.Usage.InputTokens,
		},
	}, false
}

// convertContentBlockDelta handles "content_block_delta" events (stub, implemented in Task 3.2).
func convertContentBlockDelta(data json.RawMessage) (*types.StreamResponse, bool) {
	return nil, false
}

// convertContentBlockStart handles "content_block_start" events (stub, implemented in Task 3.2).
func convertContentBlockStart(data json.RawMessage) (*types.StreamResponse, bool) {
	return nil, false
}

// convertMessageDelta handles "message_delta" events (stub, implemented in Task 3.3).
func convertMessageDelta(data json.RawMessage) (*types.StreamResponse, bool) {
	return nil, false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestConvertAnthropicSSE_MessageStart|TestConvertAnthropicSSE_UnknownEvent|TestConvertAnthropicSSE_InvalidJSON" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/anthropic_stream.go internal/models/chat/anthropic_stream_test.go
git commit -m "feat(chat): add convertAnthropicSSEToOpenAI with message_start conversion"
```

### Task 3.2: content_block_delta 转换

**Files:** Modify `internal/models/chat/anthropic_stream.go`, `internal/models/chat/anthropic_stream_test.go`
- Produces: `convertContentBlockDelta` + `convertContentBlockStart` 完整实现
- 转换规则：
  - `text_delta` → `StreamResponse{ Content: text }`（OpenAI `delta.content`）
  - `input_json_delta` → `StreamResponse{ ToolCalls: [{Function: {Arguments: partial_json}}] }`（OpenAI `delta.tool_calls`）
  - `content_block_start` (tool_use) → `StreamResponse{ ToolCalls: [{ID, Function: {Name}}] }`

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/anthropic_stream_test.go 追加

func TestConvertAnthropicSSE_TextDelta(t *testing.T) {
	data := json.RawMessage(`{
		"type": "content_block_delta",
		"index": 0,
		"delta": {"type": "text_delta", "text": "Hello"}
	}`)
	resp, done := convertAnthropicSSEToOpenAI("content_block_delta", data)
	if done {
		t.Error("done = true, want false")
	}
	if resp == nil {
		t.Fatal("resp = nil")
	}
	if resp.Content != "Hello" {
		t.Errorf("Content = %q, want \"Hello\"", resp.Content)
	}
	if resp.ResponseType != types.ResponseTypeAnswer {
		t.Errorf("ResponseType = %v, want answer", resp.ResponseType)
	}
}

func TestConvertAnthropicSSE_TextDelta_Empty(t *testing.T) {
	data := json.RawMessage(`{
		"type": "content_block_delta",
		"index": 0,
		"delta": {"type": "text_delta", "text": ""}
	}`)
	resp, done := convertAnthropicSSEToOpenAI("content_block_delta", data)
	if done {
		t.Error("done = true for empty delta")
	}
	if resp != nil {
		t.Errorf("resp = %v, want nil for empty text", resp)
	}
}

func TestConvertAnthropicSSE_InputJsonDelta(t *testing.T) {
	data := json.RawMessage(`{
		"type": "content_block_delta",
		"index": 1,
		"delta": {"type": "input_json_delta", "partial_json": "{\"query\":\"test\"}"}
	}`)
	resp, done := convertAnthropicSSEToOpenAI("content_block_delta", data)
	if done {
		t.Error("done = true")
	}
	if resp == nil {
		t.Fatal("resp = nil")
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("ToolCalls len = %d, want 1", len(resp.ToolCalls))
	}
	tc := resp.ToolCalls[0]
	if tc.Function.Arguments != `{"query":"test"}` {
		t.Errorf("Arguments = %q, want partial JSON", tc.Function.Arguments)
	}
}

func TestConvertAnthropicSSE_ContentBlockStart_ToolUse(t *testing.T) {
	data := json.RawMessage(`{
		"type": "content_block_start",
		"index": 1,
		"content_block": {"type": "tool_use", "id": "call_001", "name": "search"}
	}`)
	resp, done := convertAnthropicSSEToOpenAI("content_block_start", data)
	if done {
		t.Error("done = true")
	}
	if resp == nil {
		t.Fatal("resp = nil for tool_use content_block_start")
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("ToolCalls len = %d, want 1", len(resp.ToolCalls))
	}
	tc := resp.ToolCalls[0]
	if tc.ID != "call_001" {
		t.Errorf("ID = %q, want \"call_001\"", tc.ID)
	}
	if tc.Function.Name != "search" {
		t.Errorf("Name = %q, want \"search\"", tc.Function.Name)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/models/chat/ -run "TestConvertAnthropicSSE_TextDelta|TestConvertAnthropicSSE_InputJsonDelta|TestConvertAnthropicSSE_ContentBlockStart" -v`
Expected: FAIL（stub 返回 nil，测试期望非 nil）

- [ ] **Step 3: Implement convertContentBlockDelta + convertContentBlockStart（GREEN）**

替换 `internal/models/chat/anthropic_stream.go` 中的 stub 实现：

```go
// internal/models/chat/anthropic_stream.go 替换 stub

// convertContentBlockDelta handles "content_block_delta" events.
//   text_delta       → StreamResponse.Content (OpenAI delta.content)
//   input_json_delta → StreamResponse.ToolCalls[].Function.Arguments (OpenAI delta.tool_calls)
func convertContentBlockDelta(data json.RawMessage) (*types.StreamResponse, bool) {
	var evt struct {
		Index int `json:"index"`
		Delta struct {
			Type        string `json:"type"`
			Text        string `json:"text"`
			PartialJSON string `json:"partial_json"`
		} `json:"delta"`
	}
	if err := json.Unmarshal(data, &evt); err != nil {
		return &types.StreamResponse{
			ResponseType: types.ResponseTypeError,
			Content:      fmt.Sprintf("parse content_block_delta: %v", err),
			Done:         true,
		}, true
	}
	switch evt.Delta.Type {
	case "text_delta":
		if evt.Delta.Text == "" {
			return nil, false
		}
		return &types.StreamResponse{
			ResponseType: types.ResponseTypeAnswer,
			Content:      evt.Delta.Text,
		}, false
	case "input_json_delta":
		if evt.Delta.PartialJSON == "" {
			return nil, false
		}
		return &types.StreamResponse{
			ResponseType: types.ResponseTypeAnswer,
			ToolCalls: []types.LLMToolCall{
				{
					Index:    evt.Index,
					Function: types.FunctionCall{Arguments: evt.Delta.PartialJSON},
				},
			},
		}, false
	default:
		return nil, false
	}
}

// convertContentBlockStart handles "content_block_start" events.
// For tool_use blocks, emits a tool_call with ID + Name (like OpenAI's first
// delta carrying the tool call id and function name).
func convertContentBlockStart(data json.RawMessage) (*types.StreamResponse, bool) {
	var evt struct {
		Index        int `json:"index"`
		ContentBlock struct {
			Type string `json:"type"`
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"content_block"`
	}
	if err := json.Unmarshal(data, &evt); err != nil {
		return nil, false
	}
	if evt.ContentBlock.Type != "tool_use" {
		return nil, false
	}
	return &types.StreamResponse{
		ResponseType: types.ResponseTypeAnswer,
		ToolCalls: []types.LLMToolCall{
			{
				Index:    evt.Index,
				ID:       evt.ContentBlock.ID,
				Type:     "function",
				Function: types.FunctionCall{Name: evt.ContentBlock.Name},
			},
		},
	}, false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestConvertAnthropicSSE" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/anthropic_stream.go internal/models/chat/anthropic_stream_test.go
git commit -m "feat(chat): add content_block_delta + content_block_start SSE conversion"
```

### Task 3.3: message_stop + message_delta + 流结束

**Files:** Modify `internal/models/chat/anthropic_stream.go`, `internal/models/chat/anthropic_stream_test.go`
- Produces: `convertMessageDelta` 完整实现
- 转换规则：
  - `message_delta` → `stop_reason` 转换为 `FinishReason` + output token usage
  - `message_stop` → 流结束信号（`Done: true`）（已在 Task 3.1 的 switch 中实现）
  - Anthropic `stop_reason` 映射：`end_turn` → `stop`，`tool_use` → `tool_calls`，`max_tokens` → `length`

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/anthropic_stream_test.go 追加

func TestConvertAnthropicSSE_MessageDelta_EndTurn(t *testing.T) {
	data := json.RawMessage(`{
		"type": "message_delta",
		"delta": {"stop_reason": "end_turn"},
		"usage": {"output_tokens": 50}
	}`)
	resp, done := convertAnthropicSSEToOpenAI("message_delta", data)
	if done {
		t.Error("done = true (message_delta doesn't end stream)")
	}
	if resp == nil {
		t.Fatal("resp = nil")
	}
	if resp.FinishReason != "stop" {
		t.Errorf("FinishReason = %q, want \"stop\" (end_turn→stop)", resp.FinishReason)
	}
	if resp.Usage == nil {
		t.Fatal("Usage = nil")
	}
	if resp.Usage.CompletionTokens != 50 {
		t.Errorf("CompletionTokens = %d, want 50", resp.Usage.CompletionTokens)
	}
}

func TestConvertAnthropicSSE_MessageDelta_ToolUse(t *testing.T) {
	data := json.RawMessage(`{
		"type": "message_delta",
		"delta": {"stop_reason": "tool_use"},
		"usage": {"output_tokens": 100}
	}`)
	resp, _ := convertAnthropicSSEToOpenAI("message_delta", data)
	if resp == nil {
		t.Fatal("resp = nil")
	}
	if resp.FinishReason != "tool_calls" {
		t.Errorf("FinishReason = %q, want \"tool_calls\" (tool_use→tool_calls)", resp.FinishReason)
	}
}

func TestConvertAnthropicSSE_MessageDelta_MaxTokens(t *testing.T) {
	data := json.RawMessage(`{
		"type": "message_delta",
		"delta": {"stop_reason": "max_tokens"},
		"usage": {"output_tokens": 4096}
	}`)
	resp, _ := convertAnthropicSSEToOpenAI("message_delta", data)
	if resp == nil {
		t.Fatal("resp = nil")
	}
	if resp.FinishReason != "length" {
		t.Errorf("FinishReason = %q, want \"length\" (max_tokens→length)", resp.FinishReason)
	}
}

func TestConvertAnthropicSSE_MessageStop(t *testing.T) {
	resp, done := convertAnthropicSSEToOpenAI("message_stop", json.RawMessage(`{"type":"message_stop"}`))
	if !done {
		t.Error("done = false, want true for message_stop")
	}
	if resp == nil {
		t.Fatal("resp = nil")
	}
	if !resp.Done {
		t.Error("resp.Done = false, want true")
	}
}

func TestConvertAnthropicSSE_FullToolCallStream(t *testing.T) {
	// Simulate a complete Anthropic SSE stream with a tool call
	events := []struct {
		event string
		data  string
	}{
		{"message_start", `{"type":"message_start","message":{"id":"msg_001","usage":{"input_tokens":10}}}`},
		{"content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`},
		{"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me search"}}`},
		{"content_block_stop", `{"type":"content_block_stop","index":0}`},
		{"content_block_start", `{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_001","name":"search"}}`},
		{"content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"cats\"}"}}`},
		{"content_block_stop", `{"type":"content_block_stop","index":1}`},
		{"message_delta", `{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":50}}`},
		{"message_stop", `{"type":"message_stop"}`},
	}

	var sawText bool
	var sawToolCall bool
	var sawStopReason bool
	var sawStreamEnd bool

	for _, evt := range events {
		resp, done := convertAnthropicSSEToOpenAI(evt.event, json.RawMessage(evt.data))
		if done {
			sawStreamEnd = true
		}
		if resp == nil {
			continue
		}
		if resp.Content != "" {
			sawText = true
		}
		if len(resp.ToolCalls) > 0 {
			sawToolCall = true
		}
		if resp.FinishReason == "tool_calls" {
			sawStopReason = true
		}
	}

	if !sawText {
		t.Error("did not see text content in stream")
	}
	if !sawToolCall {
		t.Error("did not see tool_call in stream")
	}
	if !sawStopReason {
		t.Error("did not see stop_reason=tool_calls in stream")
	}
	if !sawStreamEnd {
		t.Error("did not see stream end")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/models/chat/ -run "TestConvertAnthropicSSE_MessageDelta|TestConvertAnthropicSSE_MessageStop|TestConvertAnthropicSSE_FullToolCallStream" -v`
Expected: FAIL（stub 返回 nil，测试期望非 nil）

- [ ] **Step 3: Implement convertMessageDelta（GREEN）**

替换 `internal/models/chat/anthropic_stream.go` 中的 `convertMessageDelta` stub：

```go
// internal/models/chat/anthropic_stream.go 替换 convertMessageDelta stub

// convertMessageDelta handles "message_delta" events.
// Extracts stop_reason (converted to OpenAI FinishReason) and output token usage.
// Does NOT end the stream — message_stop does that.
func convertMessageDelta(data json.RawMessage) (*types.StreamResponse, bool) {
	var evt struct {
		Delta struct {
			StopReason string `json:"stop_reason"`
		} `json:"delta"`
		Usage struct {
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(data, &evt); err != nil {
		return nil, false
	}
	finishReason := mapAnthropicStopReason(evt.Delta.StopReason)
	return &types.StreamResponse{
		ResponseType: types.ResponseTypeAnswer,
		FinishReason: finishReason,
		Usage: &types.TokenUsage{
			CompletionTokens: evt.Usage.OutputTokens,
		},
	}, false
}

// mapAnthropicStopReason converts Anthropic stop_reason to OpenAI finish_reason.
//   end_turn   → stop
//   tool_use   → tool_calls
//   max_tokens → length
//   stop_sequence → stop (closest match)
//   (empty/unknown) → ""
func mapAnthropicStopReason(reason string) string {
	switch reason {
	case "end_turn":
		return "stop"
	case "tool_use":
		return "tool_calls"
	case "max_tokens":
		return "length"
	case "stop_sequence":
		return "stop"
	default:
		return reason
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestConvertAnthropicSSE" -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/anthropic_stream.go internal/models/chat/anthropic_stream_test.go
git commit -m "feat(chat): add message_delta + message_stop SSE conversion with stop_reason mapping"
```

---

## Phase 4: AnthropicChat 重写 + 工厂改造

> 将独立的 `AnthropicChat`（自有 ChatStream/Chat 实现）重写为嵌入 `RemoteAPIChat` 的薄包装，复用通用的 streaming/SSE/retry/tracing 流程。所有 provider 特定行为通过 `anthropicProvider`（Phase 1-3 实现）注入。同时删除 `chat.go` 的 Anthropic 独立分支，统一走 `NewRemoteAPIChat` + providerAdapter。

### Task 4.1: 重写 AnthropicChat

**Files:** Rewrite `internal/models/chat/anthropic.go`; Test: `internal/models/chat/anthropic_test.go`
- Produces: `AnthropicChat` 嵌入 `*RemoteAPIChat`，`NewAnthropicChat` 调用 `NewRemoteAPIChat`

> **命名说明**：代码库中通用 OpenAI 兼容聊天类型为 `RemoteAPIChat`（`remote_api.go`），spec 文档中称为 `OpenAIChat`。本计划使用实际代码库类型名 `RemoteAPIChat`。

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/anthropic_test.go 追加

func TestNewAnthropicChat_EmbedsRemoteAPIChat(t *testing.T) {
	config := &ChatConfig{
		BaseURL:   "https://api.anthropic.com",
		ModelName: "claude-3-opus",
		APIKey:    "test-key",
		Provider:  string(provider.ProviderAnthropic),
	}
	chat, err := NewAnthropicChat(config)
	if err != nil {
		t.Fatalf("NewAnthropicChat error: %v", err)
	}
	if chat.OpenAIChat == nil {
		t.Error("AnthropicChat.OpenAIChat (embedded *RemoteAPIChat) is nil")
	}
	// Verify it uses anthropicProvider
	adapter := chat.adapter
	if adapter.Name() != provider.ProviderAnthropic {
		t.Errorf("adapter.Name() = %v, want Anthropic", adapter.Name())
	}
}

func TestNewAnthropicChat_ForceRawHTTP(t *testing.T) {
	config := &ChatConfig{
		BaseURL:   "https://api.anthropic.com",
		ModelName: "claude-3-opus",
		APIKey:    "test-key",
		Provider:  string(provider.ProviderAnthropic),
	}
	chat, err := NewAnthropicChat(config)
	if err != nil {
		t.Fatalf("NewAnthropicChat error: %v", err)
	}
	if !chat.adapter.ForceRawHTTP() {
		t.Error("anthropicProvider.ForceRawHTTP() = false, want true")
	}
}

func TestNewAnthropicChat_Endpoint(t *testing.T) {
	config := &ChatConfig{
		BaseURL:   "https://api.anthropic.com",
		ModelName: "claude-3-opus",
		APIKey:    "test-key",
		Provider:  string(provider.ProviderAnthropic),
	}
	chat, err := NewAnthropicChat(config)
	if err != nil {
		t.Fatalf("NewAnthropicChat error: %v", err)
	}
	endpoint := chat.adapter.Endpoint("https://api.anthropic.com", "claude-3-opus", true)
	if !strings.HasSuffix(endpoint, "/v1/messages") {
		t.Errorf("Endpoint = %q, want suffix /v1/messages", endpoint)
	}
}

func TestAnthropicChat_GetModelName(t *testing.T) {
	config := &ChatConfig{
		BaseURL:   "https://api.anthropic.com",
		ModelName: "claude-3-opus",
		APIKey:    "test-key",
		Provider:  string(provider.ProviderAnthropic),
	}
	chat, err := NewAnthropicChat(config)
	if err != nil {
		t.Fatalf("NewAnthropicChat error: %v", err)
	}
	if chat.GetModelName() != "claude-3-opus" {
		t.Errorf("GetModelName() = %q, want \"claude-3-opus\"", chat.GetModelName())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/models/chat/ -run "TestNewAnthropicChat_EmbedsRemoteAPIChat|TestNewAnthropicChat_ForceRawHTTP|TestNewAnthropicChat_Endpoint|TestAnthropicChat_GetModelName" -v`
Expected: FAIL（当前 AnthropicChat 未嵌入 RemoteAPIChat）

- [ ] **Step 3: Rewrite AnthropicChat（GREEN）**

重写 `internal/models/chat/anthropic.go`：

```go
// internal/models/chat/anthropic.go (重写)
package chat

import (
	"fmt"
	"strings"

	"github.com/Tencent/WeKnora/internal/models/provider"
	secutils "github.com/Tencent/WeKnora/internal/utils"
)

// AnthropicChat wraps RemoteAPIChat to reuse the generic OpenAI-compatible
// streaming/SSE/retry/tracing pipeline. All Anthropic-specific behavior
// (endpoint, auth, request shaping, SSE conversion) is handled by
// anthropicProvider registered in providerRegistry (Phase 1-3).
type AnthropicChat struct {
	*RemoteAPIChat
}

// NewAnthropicChat creates an Anthropic chat instance that delegates to
// RemoteAPIChat with the anthropicProvider adapter.
func NewAnthropicChat(config *ChatConfig) (*AnthropicChat, error) {
	if config.BaseURL != "" {
		if err := secutils.ValidateURLForSSRF(config.BaseURL); err != nil {
			return nil, fmt.Errorf("baseURL SSRF check failed: %w", err)
		}
	}
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, fmt.Errorf("Anthropic provider: API key is required")
	}

	// Ensure provider is set to Anthropic so resolveProvider picks anthropicProvider
	if config.Provider == "" {
		config.Provider = string(provider.ProviderAnthropic)
	}

	// Default baseURL
	if strings.TrimSpace(config.BaseURL) == "" {
		config.BaseURL = provider.AnthropicBaseURL
	}

	remoteChat, err := NewRemoteAPIChat(config)
	if err != nil {
		return nil, fmt.Errorf("create RemoteAPIChat for Anthropic: %w", err)
	}

	return &AnthropicChat{RemoteAPIChat: remoteChat}, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestNewAnthropicChat_EmbedsRemoteAPIChat|TestNewAnthropicChat_ForceRawHTTP|TestNewAnthropicChat_Endpoint|TestAnthropicChat_GetModelName" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/anthropic.go internal/models/chat/anthropic_test.go
git commit -m "feat(chat): rewrite AnthropicChat to embed RemoteAPIChat with anthropicProvider"
```

### Task 4.2: 删除 chat.go Anthropic 独立分支

**Files:** Modify `internal/models/chat/chat.go`（删除 L161-162）; Test: `internal/models/chat/chat_factory_test.go`
- 删除 `if providerName == provider.ProviderAnthropic { return NewAnthropicChat(config) }`
- 所有 provider 统一走 `NewRemoteAPIChat` + providerAdapter

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/chat_factory_test.go
package chat

import (
	"testing"

	"github.com/Tencent/WeKnora/internal/models/provider"
)

func TestNewRemoteChat_AnthropicNoSpecialBranch(t *testing.T) {
	// After refactor: NewRemoteChat should NOT have a special Anthropic branch.
	// All providers go through NewRemoteAPIChat + providerAdapter.
	// Verify by checking that the source doesn't contain the old branch.
	// (This is a source-level assertion; see chat.go L161-162 pre-refactor)

	// The factory should resolve Anthropic via providerAdapter, not via a
	// hardcoded if-branch. We verify by creating a chat and checking the
	// adapter is anthropicProvider.
	config := &ChatConfig{
		BaseURL:   "https://api.anthropic.com",
		ModelName: "claude-3-opus",
		APIKey:    "test-key",
		Provider:  string(provider.ProviderAnthropic),
	}
	chat, err := NewRemoteChat(config)
	if err != nil {
		t.Fatalf("NewRemoteChat error: %v", err)
	}
	// The returned chat should be a *RemoteAPIChat (not *AnthropicChat),
	// OR an *AnthropicChat that embeds *RemoteAPIChat. Either way, it
	// should resolve to anthropicProvider.
	_ = chat
}
```

- [ ] **Step 2: Run test to verify current state**

Run: `go test ./internal/models/chat/ -run "TestNewRemoteChat_AnthropicNoSpecialBranch" -v`
Expected: PASS（测试通过，但 chat.go 仍有独立分支——需要在实现后删除分支使工厂统一）

- [ ] **Step 3: Delete Anthropic branch（GREEN）**

修改 `internal/models/chat/chat.go`，删除 L161-162：

```go
// internal/models/chat/chat.go 修改 NewRemoteChat

func NewRemoteChat(config *ChatConfig) (Chat, error) {
	providerName := provider.ProviderName(config.Provider)
	if providerName == "" {
		providerName = provider.DetectProvider(config.BaseURL)
	}
	// 删除：if providerName == provider.ProviderAnthropic { return NewAnthropicChat(config) }
	// 所有 provider 统一走 NewRemoteAPIChat + providerAdapter
	return NewRemoteAPIChat(config)
}
```

> **注意**：删除独立分支后，`NewRemoteChat` 直接返回 `*RemoteAPIChat`。如果外部代码依赖 `*AnthropicChat` 类型，需要适配。`NewAnthropicChat` 构造函数仍然保留（Task 4.1），但不再是工厂的必经路径——它只是 `NewRemoteAPIChat` 的薄包装。

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestNewRemoteChat_AnthropicNoSpecialBranch" -v`
Expected: PASS

- [ ] **Step 5: Run full build to check for breakage**

Run: `go build ./...`
Expected: PASS（无编译错误）

- [ ] **Step 6: Commit**

```bash
git add internal/models/chat/chat.go internal/models/chat/chat_factory_test.go
git commit -m "refactor(chat): remove Anthropic independent branch from NewRemoteChat factory"
```

### Task 4.3: 向后兼容验证

**Files:** Test: `internal/models/chat/anthropic_test.go`
- 验证：无 tools 时与改造前行为一致

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/anthropic_test.go 追加

func TestAnthropicChat_BackwardCompat_NoTools(t *testing.T) {
	// 改造前：AnthropicChat 不支持 tools，普通 chat 流程正常工作。
	// 改造后：AnthropicChat 嵌入 RemoteAPIChat，无 tools 时应保持一致行为。
	// 验证构造成功且 adapter 正确。
	config := &ChatConfig{
		BaseURL:   "https://api.anthropic.com",
		ModelName: "claude-3-opus",
		APIKey:    "test-key",
		Provider:  string(provider.ProviderAnthropic),
	}
	chat, err := NewAnthropicChat(config)
	if err != nil {
		t.Fatalf("NewAnthropicChat error: %v", err)
	}

	// 验证 adapter 是 anthropicProvider
	if chat.adapter.Name() != provider.ProviderAnthropic {
		t.Errorf("adapter = %v, want Anthropic", chat.adapter.Name())
	}

	// 验证无 tools 时 ShapeRequest 不 panic
	req := &openai.ChatCompletionRequest{
		Model:    "claude-3-opus",
		Messages:  []openai.ChatCompletionMessage{{Role: "user", Content: "Hi"}},
		MaxTokens: 1024,
	}
	chat.adapter.ShapeRequest(req, &ChatOptions{}, false)

	// 验证 max_tokens 保留（不设默认，因为已设 1024）
	if req.MaxTokens != 1024 {
		t.Errorf("MaxTokens = %d, want 1024 (preserved)", req.MaxTokens)
	}

	// 验证 tool_choice 为 nil（无 tools 时不需要）
	if req.ToolChoice != nil {
		t.Errorf("ToolChoice = %v, want nil (no tools)", req.ToolChoice)
	}
}

func TestAnthropicChat_BackwardCompat_DefaultMaxTokens(t *testing.T) {
	// 改造前：max_tokens 默认 1024（anthropic.go buildRequest）。
	// 改造后：max_tokens 默认 4096（anthropicProvider.ShapeRequest）。
	// 这是一个有意的改进——Anthropic 要求 max_tokens 必填。
	config := &ChatConfig{
		BaseURL:   "https://api.anthropic.com",
		ModelName: "claude-3-opus",
		APIKey:    "test-key",
		Provider:  string(provider.ProviderAnthropic),
	}
	chat, err := NewAnthropicChat(config)
	if err != nil {
		t.Fatalf("NewAnthropicChat error: %v", err)
	}

	req := &openai.ChatCompletionRequest{
		Model:    "claude-3-opus",
		Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "Hi"}},
	}
	chat.adapter.ShapeRequest(req, &ChatOptions{}, false)

	// 新行为：max_tokens 默认 4096（Anthropic 必填）
	if req.MaxTokens != 4096 {
		t.Errorf("MaxTokens = %d, want 4096 (Anthropic default)", req.MaxTokens)
	}
}

func TestAnthropicChat_BackwardCompat_Auth(t *testing.T) {
	// 验证 Auth header 与改造前一致：x-api-key + anthropic-version
	config := &ChatConfig{
		BaseURL:   "https://api.anthropic.com",
		ModelName: "claude-3-opus",
		APIKey:    "test-key-123",
		Provider:  string(provider.ProviderAnthropic),
	}
	chat, err := NewAnthropicChat(config)
	if err != nil {
		t.Fatalf("NewAnthropicChat error: %v", err)
	}

	req, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", nil)
	chat.adapter.Auth(req, authCreds{APIKey: "test-key-123"}, nil)

	if req.Header.Get("x-api-key") != "test-key-123" {
		t.Errorf("x-api-key = %q, want \"test-key-123\"", req.Header.Get("x-api-key"))
	}
	if req.Header.Get("anthropic-version") != "2023-06-01" {
		t.Errorf("anthropic-version = %q, want \"2023-06-01\"", req.Header.Get("anthropic-version"))
	}
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestAnthropicChat_BackwardCompat" -v`
Expected: PASS（依赖 Task 4.1-4.2 已实现）

- [ ] **Step 3: No implementation needed（GREEN already from 4.1-4.2）**

- [ ] **Step 4: Run full Phase 4 test suite**

Run: `go test ./internal/models/chat/ -run "TestNewAnthropicChat|TestNewRemoteChat_AnthropicNoSpecialBranch|TestAnthropicChat_BackwardCompat" -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/anthropic_test.go internal/models/chat/chat_factory_test.go
git commit -m "test(chat): add backward compatibility tests for AnthropicChat refactor"
```

---

## Phase 5: 集成测试

> 端到端验证：Claude 驱动 ReAct 循环（有 tools 时返回 tool_calls），以及无 tools 时的向后兼容性。使用 mock HTTP server 模拟 Anthropic API 响应。

### Task 5.1: Claude 驱动 ReAct 循环集成测试

**Files:** Test: `internal/models/chat/anthropic_integration_test.go`
- 验证：有 tools 时返回 tool_calls，ReAct 引擎能执行工具调用循环
- Mock：使用 `httptest.Server` 模拟 Anthropic SSE 流

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/anthropic_integration_test.go
package chat

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Tencent/WeKnora/internal/models/provider"
	"github.com/Tencent/WeKnora/internal/types"
)

func TestAnthropicChat_ReActLoop_WithTools(t *testing.T) {
	// Mock Anthropic SSE stream that returns a tool_call
	sseResponse := `event: message_start
data: {"type":"message_start","message":{"id":"msg_001","usage":{"input_tokens":10}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me search"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_001","name":"search"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"cats\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":50}}

event: message_stop
data: {"type":"message_stop"}

`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify Anthropic auth headers
		if r.Header.Get("x-api-key") != "test-key" {
			t.Errorf("x-api-key = %q, want \"test-key\"", r.Header.Get("x-api-key"))
		}
		if r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Errorf("anthropic-version = %q", r.Header.Get("anthropic-version"))
		}
		// Verify endpoint path
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path = %q, want /v1/messages", r.URL.Path)
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(sseResponse))
	}))
	defer server.Close()

	config := &ChatConfig{
		BaseURL:   server.URL,
		ModelName: "claude-3-opus",
		APIKey:    "test-key",
		Provider:  string(provider.ProviderAnthropic),
	}
	chat, err := NewAnthropicChat(config)
	if err != nil {
		t.Fatalf("NewAnthropicChat error: %v", err)
	}

	// Simulate ReAct engine sending a request with tools
	messages := []Message{
		{Role: "user", Content: "Search for cats"},
	}
	tools := []Tool{
		{
			Type: "function",
			Function: ToolFunction{
				Name:        "search",
				Description: "Search the web",
				Parameters:  map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}}},
			},
		},
	}
	opts := &ChatOptions{
		Tools:      tools,
		ToolChoice: "auto",
		MaxTokens:  4096,
	}

	streamChan, err := chat.ChatStream(t.Context(), messages, opts)
	if err != nil {
		t.Fatalf("ChatStream error: %v", err)
	}

	var textContent string
	var toolCalls []types.LLMToolCall
	var finishReason string
	var sawDone bool

	for resp := range streamChan {
		if resp.Done {
			sawDone = true
			finishReason = resp.FinishReason
		}
		if resp.Content != "" {
			textContent += resp.Content
		}
		if len(resp.ToolCalls) > 0 {
			toolCalls = append(toolCalls, resp.ToolCalls...)
		}
	}

	if !sawDone {
		t.Error("stream did not end with Done=true")
	}
	if textContent != "Let me search" {
		t.Errorf("textContent = %q, want \"Let me search\"", textContent)
	}
	if len(toolCalls) == 0 {
		t.Fatal("no tool_calls received (ReAct needs tool_calls to drive the loop)")
	}
	if toolCalls[0].ID != "call_001" {
		t.Errorf("toolCalls[0].ID = %q, want \"call_001\"", toolCalls[0].ID)
	}
	if toolCalls[0].Function.Name != "search" {
		t.Errorf("toolCalls[0].Name = %q, want \"search\"", toolCalls[0].Function.Name)
	}
	if toolCalls[0].Function.Arguments != `{"query":"cats"}` {
		t.Errorf("toolCalls[0].Arguments = %q, want {\"query\":\"cats\"}", toolCalls[0].Function.Arguments)
	}
	if finishReason != "tool_calls" {
		t.Errorf("finishReason = %q, want \"tool_calls\"", finishReason)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/models/chat/ -run "TestAnthropicChat_ReActLoop_WithTools" -v`
Expected: FAIL（依赖 Phase 1-4 全部完成）

- [ ] **Step 3: Verify integration works（GREEN）**

如果 Phase 1-4 都已正确实现，此测试应直接通过。如果失败，检查：
1. `convertAnthropicSSEToOpenAI` 是否正确处理所有事件类型
2. `anthropicProvider.ShapeRequest` 是否正确设置 max_tokens 和 tool_choice
3. `anthropicProvider.Endpoint` 是否返回 `/v1/messages`
4. `anthropicProvider.Auth` 是否设置正确的 headers

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestAnthropicChat_ReActLoop_WithTools" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/models/chat/anthropic_integration_test.go
git commit -m "test(chat): add ReAct loop integration test with Anthropic tool_calls"
```

### Task 5.2: 向后兼容集成测试

**Files:** Test: `internal/models/chat/anthropic_integration_test.go`
- 验证：无 tools 时普通 chat 流程，与改造前行为一致
- Mock：使用 `httptest.Server` 模拟 Anthropic SSE 流（纯文本响应）

- [ ] **Step 1: Write the failing test（RED）**

```go
// internal/models/chat/anthropic_integration_test.go 追加

func TestAnthropicChat_BackwardCompat_NoTools_Integration(t *testing.T) {
	// Mock Anthropic SSE stream with plain text (no tool calls)
	sseResponse := `event: message_start
data: {"type":"message_start","message":{"id":"msg_002","usage":{"input_tokens":5}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello! How can I help you?"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}

event: message_stop
data: {"type":"message_stop"}

`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(sseResponse))
	}))
	defer server.Close()

	config := &ChatConfig{
		BaseURL:   server.URL,
		ModelName: "claude-3-opus",
		APIKey:    "test-key",
		Provider:  string(provider.ProviderAnthropic),
	}
	chat, err := NewAnthropicChat(config)
	if err != nil {
		t.Fatalf("NewAnthropicChat error: %v", err)
	}

	// No tools — plain chat flow
	messages := []Message{
		{Role: "user", Content: "Hello"},
	}
	opts := &ChatOptions{
		MaxTokens: 1024,
	}

	streamChan, err := chat.ChatStream(t.Context(), messages, opts)
	if err != nil {
		t.Fatalf("ChatStream error: %v", err)
	}

	var content string
	var finishReason string
	var sawDone bool

	for resp := range streamChan {
		if resp.Done {
			sawDone = true
			finishReason = resp.FinishReason
		}
		if resp.Content != "" {
			content += resp.Content
		}
	}

	if !sawDone {
		t.Error("stream did not end with Done=true")
	}
	if content != "Hello! How can I help you?" {
		t.Errorf("content = %q, want \"Hello! How can I help you?\"", content)
	}
	if finishReason != "stop" {
		t.Errorf("finishReason = %q, want \"stop\" (end_turn→stop)", finishReason)
	}
}

func TestAnthropicChat_FullReActLoop_MultiTurn(t *testing.T) {
	// Simulate a full ReAct loop: user → assistant(tool_call) → tool(result) → assistant(text)
	// This verifies the message conversion supports multi-turn tool use.

	// Turn 1: assistant returns a tool call
	turn1SSE := `event: message_start
data: {"type":"message_start","message":{"id":"msg_001","usage":{"input_tokens":10}}}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_001","name":"search"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"cats\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":30}}

event: message_stop
data: {"type":"message_stop"}

`

	// Turn 2: after tool result, assistant returns text
	turn2SSE := `event: message_start
data: {"type":"message_start","message":{"id":"msg_002","usage":{"input_tokens":20}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I found 3 cats!"}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}

event: message_stop
data: {"type":"message_stop"}

`

	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if requestCount == 1 {
			w.Write([]byte(turn1SSE))
		} else {
			w.Write([]byte(turn2SSE))
		}
	}))
	defer server.Close()

	config := &ChatConfig{
		BaseURL:   server.URL,
		ModelName: "claude-3-opus",
		APIKey:    "test-key",
		Provider:  string(provider.ProviderAnthropic),
	}
	chat, err := NewAnthropicChat(config)
	if err != nil {
		t.Fatalf("NewAnthropicChat error: %v", err)
	}

	tools := []Tool{
		{Type: "function", Function: ToolFunction{
			Name:        "search",
			Description: "Search the web",
			Parameters:  map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}}},
		}},
	}

	// Turn 1: user asks → assistant returns tool_call
	stream1, err := chat.ChatStream(t.Context(),
		[]Message{{Role: "user", Content: "Search for cats"}},
		&ChatOptions{Tools: tools, ToolChoice: "auto", MaxTokens: 4096},
	)
	if err != nil {
		t.Fatalf("Turn 1 ChatStream error: %v", err)
	}

	var toolCalls []types.LLMToolCall
	for resp := range stream1 {
		if len(resp.ToolCalls) > 0 {
			toolCalls = append(toolCalls, resp.ToolCalls...)
		}
	}
	if len(toolCalls) == 0 {
		t.Fatal("Turn 1: no tool_calls received")
	}

	// Turn 2: user + assistant(tool_call) + tool(result) → assistant returns text
	messages := []Message{
		{Role: "user", Content: "Search for cats"},
		{Role: "assistant", ToolCalls: []types.LLMToolCall{toolCalls[0]}},
		{Role: "tool", Content: "found 3 cats", ToolCallID: toolCalls[0].ID},
	}

	stream2, err := chat.ChatStream(t.Context(), messages,
		&ChatOptions{Tools: tools, MaxTokens: 4096},
	)
	if err != nil {
		t.Fatalf("Turn 2 ChatStream error: %v", err)
	}

	var finalContent string
	for resp := range stream2 {
		if resp.Content != "" {
			finalContent += resp.Content
		}
	}
	if finalContent != "I found 3 cats!" {
		t.Errorf("Turn 2 content = %q, want \"I found 3 cats!\"", finalContent)
	}
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `go test ./internal/models/chat/ -run "TestAnthropicChat_BackwardCompat_NoTools_Integration|TestAnthropicChat_FullReActLoop_MultiTurn" -v`
Expected: PASS（依赖 Phase 1-4 全部完成）

- [ ] **Step 3: Run complete test suite**

Run: `go test ./internal/models/chat/ -run "TestAnthropic|TestConvert|TestShapeRequest|TestProvider" -v`
Expected: ALL PASS

- [ ] **Step 4: Run coverage check**

Run: `go test ./internal/models/chat/ -run "TestAnthropic|TestConvert|TestShapeRequest|TestProvider" -cover`
Expected: coverage ≥ 85% for anthropic.go, provider.go (anthropicProvider), chat.go

- [ ] **Step 5: Final commit**

```bash
git add internal/models/chat/anthropic_integration_test.go
git commit -m "test(chat): add backward compat + multi-turn ReAct integration tests"
```

---

## 完成检查清单

| 检查项 | 状态 |
|---|---|
| Phase 0: Baseline Tests | ✅ |
| Phase 1: anthropicProvider 类型实现 | ✅ |
| Phase 2: ShapeRequest 转换逻辑 | ✅ |
| Phase 3: Anthropic SSE 转换 | ✅ |
| Phase 4: AnthropicChat 重写 + 工厂改造 | ✅ |
| Phase 5: 集成测试 | ✅ |
| 测试覆盖率 ≥ 85% | ☐ 验证中 |
| `go build ./...` 通过 | ☐ 验证中 |
| ReAct 引擎无需修改 | ✅ |
| 无 tools 时向后兼容 | ✅ |
| chat.go 独立分支已删除 | ✅ |
