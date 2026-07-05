package chat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Tencent/WeKnora/internal/models/provider"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAnthropicIntegration_ToolsCallFlow 验证完整的工具调用流程：
//  1. 构造带 tools 的 ChatRequest
//  2. anthropicProvider.BuildRequestBody 转换为 Anthropic 格式
//  3. 模拟 Anthropic SSE 响应（含 tool_use）
//  4. convertAnthropicSSEToOpenAI 转换为 OpenAI 格式
//  5. 验证返回的 tool_calls
func TestAnthropicIntegration_ToolsCallFlow(t *testing.T) {
	t.Setenv("SSRF_WHITELIST", "127.0.0.1")

	// 1. 构造 mock Anthropic SSE 响应（含 tool_use）
	sseResponse := []string{
		`event: message_start` + "\n" + `data: {"type":"message_start","message":{"id":"msg_001","role":"assistant","usage":{"input_tokens":10}}}` + "\n\n",
		`event: content_block_start` + "\n" + `data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_001","name":"search_web","input":{}}}` + "\n\n",
		`event: content_block_delta` + "\n" + `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"test\"}"}}` + "\n\n",
		`event: content_block_stop` + "\n" + `data: {"type":"content_block_stop","index":0}` + "\n\n",
		`event: message_delta` + "\n" + `data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}` + "\n\n",
		`event: message_stop` + "\n" + `data: {"type":"message_stop"}` + "\n\n",
	}

	// 2. 启动 mock HTTP server
	var capturedPath string
	var capturedAPIKey string
	var capturedVersion string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedAPIKey = r.Header.Get("x-api-key")
		capturedVersion = r.Header.Get("anthropic-version")
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for _, sse := range sseResponse {
			_, _ = w.Write([]byte(sse))
			flusher.Flush()
		}
	}))
	defer server.Close()

	// 3. 构造 ChatConfig（使用 ModelName，非 ModelID）
	config := &ChatConfig{
		Source:    types.ModelSourceRemote,
		Provider: string(provider.ProviderAnthropic),
		BaseURL:  server.URL,
		APIKey:   "test-key",
		ModelName: "claude-3-opus",
	}

	// 4. 创建 chat 实例
	chat, err := NewRemoteChat(config)
	require.NoError(t, err)

	// 5. 构造带 tools 的消息
	messages := []Message{
		{Role: "user", Content: "Search for test"},
	}

	// 6. 调用 ChatStream（带 tools）
	opts := &ChatOptions{
		Tools: []Tool{
			{
				Type: "function",
				Function: FunctionDef{
					Name:        "search_web",
					Description: "Search web",
				},
			},
		},
	}
	stream, err := chat.ChatStream(context.Background(), messages, opts)
	require.NoError(t, err)

	// 7. 验证请求路由到 /v1/messages 且带 Anthropic 鉴权头
	assert.Equal(t, "/v1/messages", capturedPath)
	assert.Equal(t, "test-key", capturedAPIKey)
	assert.Equal(t, "2023-06-01", capturedVersion)

	// 8. 收集流式响应
	var toolCalls []types.LLMToolCall
	var finishReason string
	for resp := range stream {
		if len(resp.ToolCalls) > 0 {
			toolCalls = append(toolCalls, resp.ToolCalls...)
		}
		if resp.FinishReason != "" {
			finishReason = resp.FinishReason
		}
	}

	// 9. 验证 tool_calls
	require.NotEmpty(t, toolCalls, "expected tool_calls, got none")
	assert.Equal(t, "call_001", toolCalls[0].ID)
	assert.Equal(t, "search_web", toolCalls[0].Function.Name)
	assert.Contains(t, toolCalls[0].Function.Arguments, "test")

	// 10. 验证 finish_reason（Anthropic 原生 stop_reason 保留：tool_use）
	assert.Contains(t, []string{"tool_calls", "tool_use"}, finishReason,
		"finish_reason = %q, want tool_calls or tool_use", finishReason)
}

// TestAnthropicIntegration_NoToolsBackwardCompat 验证无 tools 时向后兼容
func TestAnthropicIntegration_NoToolsBackwardCompat(t *testing.T) {
	t.Setenv("SSRF_WHITELIST", "127.0.0.1")

	// 1. 构造 mock Anthropic SSE 响应（纯文本）
	sseResponse := []string{
		`event: message_start` + "\n" + `data: {"type":"message_start","message":{"id":"msg_002","role":"assistant","usage":{"input_tokens":5}}}` + "\n\n",
		`event: content_block_start` + "\n" + `data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}` + "\n\n",
		`event: content_block_delta` + "\n" + `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello world"}}` + "\n\n",
		`event: content_block_stop` + "\n" + `data: {"type":"content_block_stop","index":0}` + "\n\n",
		`event: message_delta` + "\n" + `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}` + "\n\n",
		`event: message_stop` + "\n" + `data: {"type":"message_stop"}` + "\n\n",
	}

	// 2. 启动 mock HTTP server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for _, sse := range sseResponse {
			_, _ = w.Write([]byte(sse))
			flusher.Flush()
		}
	}))
	defer server.Close()

	// 3. 构造 ChatConfig
	config := &ChatConfig{
		Source:    types.ModelSourceRemote,
		Provider: string(provider.ProviderAnthropic),
		BaseURL:  server.URL,
		APIKey:   "test-key",
		ModelName: "claude-3-opus",
	}

	// 4. 创建 chat 实例
	chat, err := NewRemoteChat(config)
	require.NoError(t, err)

	// 5. 构造无 tools 的消息
	messages := []Message{
		{Role: "user", Content: "Hello"},
	}

	// 6. 调用 ChatStream（无 tools）
	stream, err := chat.ChatStream(context.Background(), messages, nil)
	require.NoError(t, err)

	// 7. 收集流式响应
	var content string
	var finishReason string
	for resp := range stream {
		if resp.Content != "" {
			content += resp.Content
		}
		if resp.FinishReason != "" {
			finishReason = resp.FinishReason
		}
	}

	// 8. 验证文本内容
	assert.Equal(t, "Hello world", content)

	// 9. 验证 finish_reason（向后兼容：end_turn 原生保留）
	assert.Contains(t, []string{"stop", "end_turn"}, finishReason,
		"finish_reason = %q, want stop or end_turn", finishReason)
}
