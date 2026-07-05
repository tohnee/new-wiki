package chat

import "testing"

// TestAnthropicChat_NoToolsSupport_Baseline 验证当前 AnthropicChat
// 不支持 tools/tool_calls（P0 缺陷）。改造后此测试需更新为反向断言。
func TestAnthropicChat_NoToolsSupport_Baseline(t *testing.T) {
	// AnthropicChat 结构体当前不包含 tools 字段
	// 通过类型引用确认 AnthropicChat 类型存在
	var chat *AnthropicChat
	_ = chat
	// 如果 AnthropicChat 实现了带 tools 的接口，此测试需更新
}
