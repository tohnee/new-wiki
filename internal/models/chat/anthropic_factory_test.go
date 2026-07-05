package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Tencent/WeKnora/internal/models/provider"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNewRemoteChat_AnthropicNoLongerIndependent verifies that Anthropic no
// longer goes through a separate NewAnthropicChat branch but instead uses the
// unified NewRemoteAPIChat path.
func TestNewRemoteChat_AnthropicNoLongerIndependent(t *testing.T) {
	// Set SSRF whitelist early so the sync.Once-cached whitelist includes
	// 127.0.0.1 for subsequent tests that use httptest servers.
	t.Setenv("SSRF_WHITELIST", "127.0.0.1")
	chat, err := NewRemoteChat(&ChatConfig{
		Source:    types.ModelSourceRemote,
		Provider:  string(provider.ProviderAnthropic),
		BaseURL:   "https://api.anthropic.com",
		APIKey:    "test-key",
		ModelName: "claude-3-opus",
	})
	require.NoError(t, err)
	require.NotNil(t, chat)

	// The returned type must be *RemoteAPIChat, not *AnthropicChat.
	_, ok := chat.(*RemoteAPIChat)
	assert.True(t, ok, "NewRemoteChat should return *RemoteAPIChat for Anthropic, got %T", chat)
}

// TestNewRemoteChat_AnthropicBackwardCompat verifies backward compatibility:
// without tools, the Anthropic path through RemoteAPIChat produces the same
// request shape and parses the same response as the old AnthropicChat.
func TestNewRemoteChat_AnthropicBackwardCompat(t *testing.T) {
	t.Setenv("SSRF_WHITELIST", "127.0.0.1")

	var capturedHeaders http.Header
	var capturedBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedHeaders = r.Header.Clone()
		_ = json.NewDecoder(r.Body).Decode(&capturedBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"msg_123",
			"type":"message",
			"role":"assistant",
			"content":[{"type":"text","text":"hello"}],
			"stop_reason":"end_turn",
			"usage":{"input_tokens":3,"output_tokens":2}
		}`))
	}))
	defer server.Close()

	chat, err := NewRemoteChat(&ChatConfig{
		Source:    types.ModelSourceRemote,
		Provider:  string(provider.ProviderAnthropic),
		BaseURL:   server.URL,
		APIKey:    "test-key",
		ModelName: "claude-sonnet-4-5",
	})
	require.NoError(t, err)

	resp, err := chat.Chat(context.Background(), []Message{
		{Role: "system", Content: "You are helpful."},
		{Role: "user", Content: "Hi"},
	}, &ChatOptions{MaxTokens: 7, Temperature: 0.2})
	require.NoError(t, err)

	// Verify Anthropic auth headers
	assert.Equal(t, "test-key", capturedHeaders.Get("x-api-key"))
	assert.Equal(t, "2023-06-01", capturedHeaders.Get("anthropic-version"))

	// Verify request body is Anthropic format (not OpenAI format)
	assert.Equal(t, "claude-sonnet-4-5", capturedBody["model"])
	assert.Equal(t, float64(7), capturedBody["max_tokens"])
	assert.Equal(t, "You are helpful.", capturedBody["system"])

	// Messages should be in Anthropic format (content blocks, not plain string)
	msgs, ok := capturedBody["messages"].([]any)
	require.True(t, ok, "messages should be an array")
	require.Len(t, msgs, 1)
	firstMsg, ok := msgs[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "user", firstMsg["role"])

	// Verify response parsing
	assert.Equal(t, "hello", resp.Content)
	assert.Equal(t, "end_turn", resp.FinishReason)
	assert.Equal(t, 3, resp.Usage.PromptTokens)
	assert.Equal(t, 2, resp.Usage.CompletionTokens)
	assert.Equal(t, 5, resp.Usage.TotalTokens)
}

// TestNewRemoteChat_AnthropicStreamBackwardCompat verifies streaming backward
// compatibility through the unified RemoteAPIChat path.
func TestNewRemoteChat_AnthropicStreamBackwardCompat(t *testing.T) {
	t.Setenv("SSRF_WHITELIST", "127.0.0.1")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "text/event-stream", r.Header.Get("Accept"))
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":0,"output_tokens":0}}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"pong"}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":114,"output_tokens":5}}

event: message_stop
data: {"type":"message_stop"}

`))
	}))
	defer server.Close()

	chat, err := NewRemoteChat(&ChatConfig{
		Source:    types.ModelSourceRemote,
		Provider:  string(provider.ProviderAnthropic),
		BaseURL:   server.URL,
		APIKey:    "test-key",
		ModelName: "claude-sonnet-4-5",
	})
	require.NoError(t, err)

	ch, err := chat.ChatStream(context.Background(), []Message{
		{Role: "user", Content: "ping"},
	}, nil)
	require.NoError(t, err)

	var chunks []types.StreamResponse
	for chunk := range ch {
		chunks = append(chunks, chunk)
	}
	require.NotEmpty(t, chunks)

	// First chunk should have content "pong"
	assert.Equal(t, "pong", chunks[0].Content)
	assert.False(t, chunks[0].Done)

	// Last chunk should be Done with finish reason and usage
	last := chunks[len(chunks)-1]
	assert.True(t, last.Done)
	assert.Equal(t, "end_turn", last.FinishReason)
	require.NotNil(t, last.Usage)
	assert.Equal(t, 114, last.Usage.PromptTokens)
	assert.Equal(t, 5, last.Usage.CompletionTokens)
	assert.Equal(t, 119, last.Usage.TotalTokens)
}
