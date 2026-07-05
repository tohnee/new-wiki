package chat

import (
	"encoding/json"

	"github.com/sashabaranov/go-openai"
)

// convertToolsToAnthropic converts OpenAI tool definitions to Anthropic format.
// OpenAI: { type: "function", function: { name, description, parameters } }
// Anthropic: { name, description, input_schema }
func convertToolsToAnthropic(tools []openai.Tool) []map[string]any {
	result := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		if tool.Type == openai.ToolTypeFunction && tool.Function != nil {
			var schema any
			if params, ok := tool.Function.Parameters.(json.RawMessage); ok && len(params) > 0 {
				_ = json.Unmarshal(params, &schema)
			} else if tool.Function.Parameters != nil {
				schema = tool.Function.Parameters
			}
			// Anthropic API rejects input_schema: null with HTTP 400. Default
			// to an empty object schema when no parameters were provided.
			if schema == nil {
				schema = map[string]any{"type": "object", "properties": map[string]any{}}
			}
			result = append(result, map[string]any{
				"name":         tool.Function.Name,
				"description":  tool.Function.Description,
				"input_schema": schema,
			})
		}
	}
	return result
}

// convertMessagesToAnthropic converts OpenAI messages to Anthropic format.
// Returns (system_prompt, messages).
// - OpenAI system message → Anthropic top-level system field
// - OpenAI user message → Anthropic user with content blocks [{type:"text"}]
// - OpenAI assistant tool_calls → Anthropic assistant with tool_use content blocks
// - OpenAI tool role → Anthropic user with tool_result content block
func convertMessagesToAnthropic(msgs []openai.ChatCompletionMessage) (string, []map[string]any) {
	var system string
	converted := make([]map[string]any, 0, len(msgs))

	for _, msg := range msgs {
		switch msg.Role {
		case "system":
			if system == "" {
				system = msg.Content
			} else {
				system += "\n\n" + msg.Content
			}
		case "user":
			converted = append(converted, map[string]any{
				"role": "user",
				"content": []map[string]any{
					{"type": "text", "text": msg.Content},
				},
			})
		case "assistant":
			content := []map[string]any{}
			if msg.Content != "" {
				content = append(content, map[string]any{"type": "text", "text": msg.Content})
			}
			for _, tc := range msg.ToolCalls {
				var args any
				_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
				content = append(content, map[string]any{
					"type":  "tool_use",
					"id":    tc.ID,
					"name":  tc.Function.Name,
					"input": args,
				})
			}
			converted = append(converted, map[string]any{
				"role":    "assistant",
				"content": content,
			})
		case "tool":
			converted = append(converted, map[string]any{
				"role": "user",
				"content": []map[string]any{
					{
						"type":        "tool_result",
						"tool_use_id": msg.ToolCallID,
						"content":     msg.Content,
					},
				},
			})
		}
	}
	return system, converted
}
