package chat

import (
	"encoding/json"
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestConvertToolsToAnthropic(t *testing.T) {
	openaiTools := []openai.Tool{
		{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        "search_web",
				Description: "Search the web",
				Parameters:  json.RawMessage(`{"type":"object","properties":{"query":{"type":"string"}}}`),
			},
		},
	}
	result := convertToolsToAnthropic(openaiTools)
	if len(result) != 1 {
		t.Fatalf("len = %d, want 1", len(result))
	}
	if result[0]["name"] != "search_web" {
		t.Errorf("name = %q", result[0]["name"])
	}
	if result[0]["description"] != "Search the web" {
		t.Errorf("description = %q", result[0]["description"])
	}
	if result[0]["input_schema"] == nil {
		t.Error("input_schema is nil")
	}
}

func TestConvertMessagesToAnthropic_SystemMessage(t *testing.T) {
	msgs := []openai.ChatCompletionMessage{{Role: "system", Content: "You are helpful"}}
	system, converted := convertMessagesToAnthropic(msgs)
	if system != "You are helpful" {
		t.Errorf("system = %q", system)
	}
	if len(converted) != 0 {
		t.Errorf("converted len = %d, want 0", len(converted))
	}
}

func TestConvertMessagesToAnthropic_UserMessage(t *testing.T) {
	msgs := []openai.ChatCompletionMessage{{Role: "user", Content: "Hello"}}
	_, converted := convertMessagesToAnthropic(msgs)
	if len(converted) != 1 {
		t.Fatalf("len = %d, want 1", len(converted))
	}
	if converted[0]["role"] != "user" {
		t.Errorf("role = %q", converted[0]["role"])
	}
}

func TestConvertMessagesToAnthropic_AssistantToolCall(t *testing.T) {
	msgs := []openai.ChatCompletionMessage{
		{
			Role: "assistant",
			ToolCalls: []openai.ToolCall{
				{ID: "call_001", Function: openai.FunctionCall{Name: "search", Arguments: `{"query":"test"}`}},
			},
		},
	}
	_, converted := convertMessagesToAnthropic(msgs)
	if len(converted) != 1 {
		t.Fatalf("len = %d, want 1", len(converted))
	}
	content, ok := converted[0]["content"].([]map[string]any)
	if !ok {
		t.Fatal("content not []map[string]any")
	}
	found := false
	for _, block := range content {
		if block["type"] == "tool_use" {
			found = true
			break
		}
	}
	if !found {
		t.Error("no tool_use content block found")
	}
}

func TestConvertMessagesToAnthropic_ToolResult(t *testing.T) {
	msgs := []openai.ChatCompletionMessage{
		{Role: "tool", Content: "result", ToolCallID: "call_001"},
	}
	_, converted := convertMessagesToAnthropic(msgs)
	if len(converted) != 1 {
		t.Fatalf("len = %d, want 1", len(converted))
	}
	content, ok := converted[0]["content"].([]map[string]any)
	if !ok {
		t.Fatal("content not []map[string]any")
	}
	found := false
	for _, block := range content {
		if block["type"] == "tool_result" {
			found = true
			break
		}
	}
	if !found {
		t.Error("no tool_result content block found")
	}
}
