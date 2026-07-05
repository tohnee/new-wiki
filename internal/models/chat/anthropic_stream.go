package chat

import (
	"encoding/json"

	"github.com/Tencent/WeKnora/internal/types"
)

// convertAnthropicSSEToOpenAI converts an Anthropic SSE event to the internal
// types.StreamResponse format (which mirrors the OpenAI streaming delta shape).
// Returns (streamResponse, done). done=true means the stream is complete.
func convertAnthropicSSEToOpenAI(eventType string, data json.RawMessage) (*types.StreamResponse, bool) {
	switch eventType {
	case "message_start":
		// Stream start; emit an empty response to signal begin.
		return &types.StreamResponse{}, false

	case "content_block_start":
		var ev struct {
			Index int `json:"index"`
			ContentBlock struct {
				Type string `json:"type"`
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"content_block"`
		}
		_ = json.Unmarshal(data, &ev)
		if ev.ContentBlock.Type == "tool_use" {
			return &types.StreamResponse{
				ToolCalls: []types.LLMToolCall{{
					ID:   ev.ContentBlock.ID,
					Type: "function",
					Function: types.FunctionCall{
						Name: ev.ContentBlock.Name,
					},
				}},
			}, false
		}
		return &types.StreamResponse{}, false

	case "content_block_delta":
		var ev struct {
			Index int `json:"index"`
			Delta struct {
				Type        string `json:"type"`
				Text        string `json:"text"`
				PartialJSON string `json:"partial_json"`
			} `json:"delta"`
		}
		_ = json.Unmarshal(data, &ev)
		if ev.Delta.Type == "text_delta" {
			return &types.StreamResponse{
				Content: ev.Delta.Text,
			}, false
		}
		if ev.Delta.Type == "input_json_delta" {
			return &types.StreamResponse{
				ToolCalls: []types.LLMToolCall{{
					Function: types.FunctionCall{
						Arguments: ev.Delta.PartialJSON,
					},
				}},
			}, false
		}
		return &types.StreamResponse{}, false

	case "content_block_stop":
		return &types.StreamResponse{}, false

	case "message_delta":
		var ev struct {
			Delta struct {
				StopReason string `json:"stop_reason"`
			} `json:"delta"`
		}
		_ = json.Unmarshal(data, &ev)
		return &types.StreamResponse{
			FinishReason: convertAnthropicStopReason(ev.Delta.StopReason),
		}, false

	case "message_stop":
		return nil, true

	default:
		return &types.StreamResponse{}, false
	}
}

// convertAnthropicStopReason converts an Anthropic stop_reason to the OpenAI
// finish_reason equivalent.
func convertAnthropicStopReason(reason string) string {
	switch reason {
	case "end_turn":
		return "stop"
	case "tool_use":
		return "tool_calls"
	case "max_tokens":
		return "length"
	default:
		return reason
	}
}
