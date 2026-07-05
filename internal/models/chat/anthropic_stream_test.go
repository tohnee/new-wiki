package chat

import (
	"encoding/json"
	"testing"
)

func TestConvertAnthropicSSE_MessageStart(t *testing.T) {
	data := json.RawMessage(`{"type":"message_start","message":{"id":"msg_001","role":"assistant"}}`)
	resp, done := convertAnthropicSSEToOpenAI("message_start", data)
	if done {
		t.Error("message_start should not set done=true")
	}
	if resp == nil {
		t.Fatal("resp is nil")
	}
}

func TestConvertAnthropicSSE_TextDelta(t *testing.T) {
	data := json.RawMessage(`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`)
	resp, done := convertAnthropicSSEToOpenAI("content_block_delta", data)
	if done {
		t.Error("text_delta should not set done=true")
	}
	if resp == nil {
		t.Fatal("resp is nil")
	}
	if resp.Content != "Hello" {
		t.Errorf("Content = %q, want %q", resp.Content, "Hello")
	}
}

func TestConvertAnthropicSSE_InputJsonDelta(t *testing.T) {
	data := json.RawMessage(`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"test\"}"}}`)
	resp, done := convertAnthropicSSEToOpenAI("content_block_delta", data)
	if done {
		t.Error("input_json_delta should not set done=true")
	}
	if resp == nil {
		t.Fatal("resp is nil")
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("ToolCalls len = %d, want 1", len(resp.ToolCalls))
	}
	want := `{"query":"test"}`
	if resp.ToolCalls[0].Function.Arguments != want {
		t.Errorf("Arguments = %q, want %q", resp.ToolCalls[0].Function.Arguments, want)
	}
}

func TestConvertAnthropicSSE_ContentBlockStart_ToolUse(t *testing.T) {
	data := json.RawMessage(`{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_001","name":"search","input":{}}}`)
	resp, done := convertAnthropicSSEToOpenAI("content_block_start", data)
	if done {
		t.Error("content_block_start should not set done=true")
	}
	if resp == nil {
		t.Fatal("resp is nil")
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("ToolCalls len = %d, want 1", len(resp.ToolCalls))
	}
	if resp.ToolCalls[0].ID != "call_001" {
		t.Errorf("ID = %q, want %q", resp.ToolCalls[0].ID, "call_001")
	}
	if resp.ToolCalls[0].Function.Name != "search" {
		t.Errorf("Name = %q, want %q", resp.ToolCalls[0].Function.Name, "search")
	}
}

func TestConvertAnthropicSSE_ContentBlockStart_Text(t *testing.T) {
	data := json.RawMessage(`{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`)
	resp, done := convertAnthropicSSEToOpenAI("content_block_start", data)
	if done {
		t.Error("content_block_start text should not set done=true")
	}
	if resp == nil {
		t.Fatal("resp is nil")
	}
}

func TestConvertAnthropicSSE_MessageStop(t *testing.T) {
	data := json.RawMessage(`{"type":"message_stop"}`)
	_, done := convertAnthropicSSEToOpenAI("message_stop", data)
	if !done {
		t.Error("message_stop should set done=true")
	}
}

func TestConvertAnthropicSSE_MessageDelta_StopReason(t *testing.T) {
	data := json.RawMessage(`{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":50}}`)
	resp, done := convertAnthropicSSEToOpenAI("message_delta", data)
	if done {
		t.Error("message_delta should not set done=true")
	}
	if resp == nil {
		t.Fatal("resp is nil")
	}
	if resp.FinishReason != "tool_calls" {
		t.Errorf("FinishReason = %q, want %q", resp.FinishReason, "tool_calls")
	}
}

func TestConvertAnthropicSSE_MessageDelta_EndTurn(t *testing.T) {
	data := json.RawMessage(`{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":50}}`)
	resp, done := convertAnthropicSSEToOpenAI("message_delta", data)
	if done {
		t.Error("message_delta should not set done=true")
	}
	if resp == nil {
		t.Fatal("resp is nil")
	}
	if resp.FinishReason != "stop" {
		t.Errorf("FinishReason = %q, want %q", resp.FinishReason, "stop")
	}
}

func TestConvertAnthropicSSE_ContentBlockStop(t *testing.T) {
	data := json.RawMessage(`{"type":"content_block_stop","index":0}`)
	resp, done := convertAnthropicSSEToOpenAI("content_block_stop", data)
	if done {
		t.Error("content_block_stop should not set done=true")
	}
	if resp == nil {
		t.Fatal("resp is nil")
	}
}

func TestConvertAnthropicSSE_UnknownEvent(t *testing.T) {
	data := json.RawMessage(`{"type":"ping"}`)
	resp, done := convertAnthropicSSEToOpenAI("ping", data)
	if done {
		t.Error("unknown event should not set done=true")
	}
	if resp == nil {
		t.Fatal("resp is nil")
	}
}
