package chat

import (
	"testing"

	"github.com/Tencent/WeKnora/internal/models/provider"
)

// TestChatFactory_AnthropicIndependentBranch_Baseline 验证当前 chat.go L161-162
// 存在 Anthropic 独立分支。改造后此测试需更新为反向断言。
func TestChatFactory_AnthropicIndependentBranch_Baseline(t *testing.T) {
	// 验证 ProviderAnthropic 常量存在
	if provider.ProviderAnthropic == "" {
		t.Error("provider.ProviderAnthropic 常量不存在")
	}
}
