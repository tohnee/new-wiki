# Claude Code SDK Adapter 实施计划（阶段 2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-v6-subagent-driven-development (recommended) or superpowers-v6-executing-plans to implement this plan task-by-task.

**Goal:** 新增 AgentEngine 多态架构 + ClaudeCodeAdapter 实现，通过子进程调用 Claude Code CLI 驱动 agent。

**Architecture:** 新增 agent.engine 配置项；CreateAgentEngine 改为多态工厂；ClaudeCodeAdapter 通过 exec.Command 调用 claude CLI，stream-json 输出转换为 EventBus 事件。

**Tech Stack:** Go 1.26, os/exec, bufio, encoding/json, testify.

**Spec:** [docs/superpowers/specs/2026-07-05-claude-code-adapter-design.md](../specs/2026-07-05-claude-code-adapter-design.md)

## Global Constraints

- Go 1.26.0；不修改 native ReAct 引擎；Engine 默认 native 向后兼容
- 不修改 AgentEngine 接口定义
- 不修改 MCP server（复用现有）
- Claude Code CLI 通过子进程调用（exec.CommandContext）
- stream-json 输出格式：每行一个 JSON 对象
- 测试覆盖率 ≥ 85%；严格 RED-GREEN-REFACTOR

---

## File Structure

| 文件 | 类型 | 责任 |
|---|---|---|
| `internal/agent/claude_code_config.go` | 新增 | ClaudeCodeConfig 配置结构 |
| `internal/agent/claude_code_adapter.go` | 新增 | ClaudeCodeAdapter 实现 AgentEngine |
| `internal/agent/claude_code_stream.go` | 新增 | stream-json 解析 + EventBus 事件转换 |
| `internal/config/config.go` | 修改 | AgentConfig 新增 Engine 字段 |
| `internal/types/custom_agent.go` | 修改 | CustomAgentConfig 新增 Engine 字段 |
| `internal/application/service/agent_service.go` | 修改 | CreateAgentEngine 多态路由 |

---

## Phase 划分概览

| Phase | 主题 | Task 数 | PR |
|---|---|---|---|
| Phase 0 | Baseline + Config | 2 | PR1 |
| Phase 1 | ClaudeCodeConfig + buildCommand | 3 | PR2 |
| Phase 2 | stream-json 解析 + 事件转换 | 4 | PR3 |
| Phase 3 | ClaudeCodeAdapter 实现 | 3 | PR4 |
| Phase 4 | AgentEngine 多态工厂 | 2 | PR5 |
| Phase 5 | 集成测试 | 2 | PR6 |

---

## Phase 0: Baseline + Config（PR1）

> **目标**：建立接口基线，新增 `Engine` 配置字段。向后兼容（默认空 = native）。

### Task 0.1: 验证 AgentEngine 接口契约

**Files:**
- Test: `internal/agent/agent_engine_baseline_test.go`

**RED — 写失败测试：**

```go
package agent

import (
	"testing"

	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// TestAgentEngine_InterfaceContract 验证 AgentEngine 接口只声明了 Execute 方法。
// 这是多态改造的基线：我们在 Phase 4 新增 ClaudeCodeAdapter 时不能破坏这个契约。
func TestAgentEngine_InterfaceContract(t *testing.T) {
	var engine interfaces.AgentEngine
	// 编译期断言：*AgentEngine（native）实现 AgentEngine
	engine = &AgentEngine{}
	if engine == nil {
		t.Fatal("native AgentEngine must implement interfaces.AgentEngine")
	}
}

// TestCreateAgentEngine_DirectlyCallsNewAgentEngine 验证当前 CreateAgentEngine
// 直接构造 native 引擎（无路由）。Phase 4 会改为多态工厂，此测试随之更新。
func TestCreateAgentEngine_DirectlyCallsNewAgentEngine(t *testing.T) {
	// AgentEngine 构造函数签名基线：NewAgentEngine 返回 *AgentEngine。
	// 如果签名变化，这里编译失败，提醒同步更新 adapter。
	var _ = NewAgentEngine
	// 直接断言类型：native 引擎是 *AgentEngine。
	var engine interfaces.AgentEngine = &AgentEngine{}
	switch engine.(type) {
	case *AgentEngine:
		// pass
	default:
		t.Fatalf("expected *AgentEngine, got %T", engine)
	}
}
```

**Run（验证失败）：**
```bash
Run: go test ./internal/agent/ -run TestAgentEngine_InterfaceContract -v
Expected: FAIL — 编译失败：AgentEngine 结构体未导出或 NewAgentEngine 签名不符（先确认当前包内类型名）
```

**GREEN — 确认现有代码：**

无需新增实现代码。此 task 仅验证现有 `internal/agent` 包中 `AgentEngine` 结构体和 `NewAgentEngine` 构造函数满足接口。如果测试因类型名不符而失败，修正测试中的类型名以匹配实际代码。

**Run（验证通过）：**
```bash
Run: go test ./internal/agent/ -run TestAgentEngine_InterfaceContract -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/agent/agent_engine_baseline_test.go && git commit -m "test(agent): add AgentEngine interface contract baseline (Phase 0.1)"
```

---

### Task 0.2: AgentConfig 新增 Engine 字段

**Files:**
- Modify: `internal/config/config.go` — `AgentConfig` 结构体
- Test: `internal/config/config_engine_test.go`

**RED — 写失败测试：**

```go
package config

import (
	"testing"
)

// TestAgentConfig_EngineDefaultEmpty 验证 Engine 字段默认为空（= native）。
func TestAgentConfig_EngineDefaultEmpty(t *testing.T) {
	cfg := AgentConfig{}
	if cfg.Engine != "" {
		t.Fatalf("expected Engine default empty, got %q", cfg.Engine)
	}
}

// TestAgentConfig_EngineSetClaudeCode 验证 Engine 可设置为 "claude_code"。
func TestAgentConfig_EngineSetClaudeCode(t *testing.T) {
	cfg := AgentConfig{Engine: "claude_code"}
	if cfg.Engine != "claude_code" {
		t.Fatalf("expected Engine=claude_code, got %q", cfg.Engine)
	}
}
```

**Run（验证失败）：**
```bash
Run: go test ./internal/config/ -run TestAgentConfig_Engine -v
Expected: FAIL — 编译错误：config.AgentConfig has no field Engine
```

**GREEN — 实现代码：**

修改 `internal/config/config.go` 的 `AgentConfig` 结构体，在 `ToolApprovalTimeoutSeconds` 之后新增 `Engine` 字段：

```go
// AgentConfig represents the global agent settings.
type AgentConfig struct {
	// LLMCallTimeout is the default timeout for a single LLM call in seconds.
	// Default: 120 (standard agents) or 300 (can be overridden by Env).
	LLMCallTimeout int `yaml:"llm_call_timeout" json:"llm_call_timeout"`
	// ToolApprovalTimeoutSeconds is how long the agent waits for human approval on a flagged MCP tool.
	// 0 means default 600 (10 minutes).
	ToolApprovalTimeoutSeconds int `yaml:"tool_approval_timeout_seconds" json:"tool_approval_timeout_seconds"`
	// Engine selects the agent execution backend.
	//   ""          (default) — native ReAct engine (existing behaviour)
	//   "native"                — explicitly select native ReAct
	//   "claude_code"           — Claude Code CLI subprocess adapter
	// Empty is treated as "native" for backward compatibility.
	Engine string `yaml:"engine" json:"engine"`
}
```

**Run（验证通过）：**
```bash
Run: go test ./internal/config/ -run TestAgentConfig_Engine -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/config/config.go internal/config/config_engine_test.go && git commit -m "feat(config): add Engine field to AgentConfig (Phase 0.2)"
```

## Phase 1: ClaudeCodeConfig + buildCommand（PR2）

> **目标**：定义 ClaudeCodeConfig 配置结构，实现 buildCommand 方法构造 CLI 命令，CustomAgentConfig 新增 Engine 字段。

### Task 1.1: ClaudeCodeConfig 结构体

**Files:**
- Create: `internal/agent/claude_code_config.go`
- Test: `internal/agent/claude_code_config_test.go`

**RED — 写失败测试：**

```go
package agent

import (
	"testing"
	"time"
)

// TestDefaultClaudeCodeConfig 验证默认值（CC-001）。
func TestDefaultClaudeCodeConfig(t *testing.T) {
	cfg := DefaultClaudeCodeConfig()
	if cfg.BinaryPath != "claude" {
		t.Errorf("BinaryPath: expected %q, got %q", "claude", cfg.BinaryPath)
	}
	if cfg.Model != "claude-sonnet-4-5" {
		t.Errorf("Model: expected %q, got %q", "claude-sonnet-4-5", cfg.Model)
	}
	if cfg.MaxTurns != 10 {
		t.Errorf("MaxTurns: expected 10, got %d", cfg.MaxTurns)
	}
	if cfg.Timeout != 5*time.Minute {
		t.Errorf("Timeout: expected 5m, got %v", cfg.Timeout)
	}
	if cfg.APIKey != "" {
		t.Errorf("APIKey: expected empty, got %q", cfg.APIKey)
	}
	if cfg.MCPConfigPath != "" {
		t.Errorf("MCPConfigPath: expected empty, got %q", cfg.MCPConfigPath)
	}
	if cfg.SystemPrompt != "" {
		t.Errorf("SystemPrompt: expected empty, got %q", cfg.SystemPrompt)
	}
	if cfg.WorkingDir != "" {
		t.Errorf("WorkingDir: expected empty, got %q", cfg.WorkingDir)
	}
}

// TestClaudeCodeConfig_Overrides 验证可通过字面量覆盖默认值。
func TestClaudeCodeConfig_Overrides(t *testing.T) {
	cfg := ClaudeCodeConfig{
		BinaryPath:    "/usr/local/bin/claude",
		APIKey:        "sk-test",
		Model:         "claude-opus-4",
		MaxTurns:      20,
		Timeout:       10 * time.Minute,
		MCPConfigPath: "/etc/claude/mcp.json",
		SystemPrompt:  "You are a wiki editor.",
		WorkingDir:    "/tmp/work",
	}
	if cfg.BinaryPath != "/usr/local/bin/claude" {
		t.Fatalf("BinaryPath override failed: %q", cfg.BinaryPath)
	}
	if cfg.MaxTurns != 20 {
		t.Fatalf("MaxTurns override failed: %d", cfg.MaxTurns)
	}
}
```

**Run（验证失败）：**
```bash
Run: go test ./internal/agent/ -run TestDefaultClaudeCodeConfig -v
Expected: FAIL — 编译错误：undefined: ClaudeCodeConfig, undefined: DefaultClaudeCodeConfig
```

**GREEN — 实现代码：**

创建 `internal/agent/claude_code_config.go`：

```go
package agent

import "time"

// ClaudeCodeConfig holds configuration for the Claude Code CLI subprocess adapter.
// It is consumed by NewClaudeCodeAdapter (Phase 3) and buildCommand (Task 1.2).
type ClaudeCodeConfig struct {
	// BinaryPath is the path to the claude CLI binary. Default: "claude".
	BinaryPath string
	// APIKey is the Anthropic API key passed via ANTHROPIC_API_KEY env.
	// When empty, the subprocess inherits the parent process env.
	APIKey string
	// Model is the model identifier passed via --model. Default: "claude-sonnet-4-5".
	Model string
	// MaxTurns is the maximum agentic turns passed via --max-turns. Default: 10.
	MaxTurns int
	// Timeout is the maximum wall-clock duration for the subprocess.
	// Default: 5 minutes.
	Timeout time.Duration
	// MCPConfigPath is the path to an MCP config JSON file passed via --mcp-config.
	// When empty, the flag is omitted.
	MCPConfigPath string
	// SystemPrompt is an optional system prompt passed via --system-prompt.
	// When empty, the flag is omitted.
	SystemPrompt string
	// WorkingDir is the working directory for the subprocess.
	// When empty, inherits the parent process working directory.
	WorkingDir string
}

// DefaultClaudeCodeConfig returns a ClaudeCodeConfig with production defaults.
func DefaultClaudeCodeConfig() ClaudeCodeConfig {
	return ClaudeCodeConfig{
		BinaryPath: "claude",
		Model:      "claude-sonnet-4-5",
		MaxTurns:   10,
		Timeout:    5 * time.Minute,
	}
}
```

**Run（验证通过）：**
```bash
Run: go test ./internal/agent/ -run "TestDefaultClaudeCodeConfig|TestClaudeCodeConfig_Overrides" -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/agent/claude_code_config.go internal/agent/claude_code_config_test.go && git commit -m "feat(agent): add ClaudeCodeConfig struct with defaults (Phase 1.1, CC-001)"
```

---

### Task 1.2: buildCommand 方法

**Files:**
- Create: `internal/agent/claude_code_adapter.go`（仅 buildCommand，不含 Execute）
- Test: `internal/agent/claude_code_adapter_test.go`

**RED — 写失败测试：**

```go
package agent

import (
	"strings"
	"testing"
)

// TestBuildCommand_BasicArgs 验证基本 CLI 参数（CC-002）。
func TestBuildCommand_BasicArgs(t *testing.T) {
	cfg := DefaultClaudeCodeConfig()
	adapter := &ClaudeCodeAdapter{config: cfg}
	cmd := adapter.buildCommand("What is RAG?")

	args := cmd.Args
	// args[0] = binary path, args[1] = "-p", args[2] = query, ...
	if args[0] != "claude" {
		t.Fatalf("binary: expected %q, got %q", "claude", args[0])
	}
	if !contains(args, "-p") {
		t.Fatal("expected -p flag")
	}
	if !contains(args, "What is RAG?") {
		t.Fatal("expected query as positional arg")
	}
	if !contains(args, "--output-format") {
		t.Fatal("expected --output-format flag")
	}
	if !contains(args, "stream-json") {
		t.Fatal("expected stream-json value")
	}
	if !contains(args, "--model") {
		t.Fatal("expected --model flag")
	}
	if !contains(args, "claude-sonnet-4-5") {
		t.Fatal("expected model value")
	}
	if !contains(args, "--max-turns") {
		t.Fatal("expected --max-turns flag")
	}
	if !contains(args, "10") {
		t.Fatal("expected max-turns value 10")
	}
}

// TestBuildCommand_WithSystemPrompt 验证 --system-prompt 附加（CC-003）。
func TestBuildCommand_WithSystemPrompt(t *testing.T) {
	cfg := DefaultClaudeCodeConfig()
	cfg.SystemPrompt = "You are a wiki editor."
	adapter := &ClaudeCodeAdapter{config: cfg}
	cmd := adapter.buildCommand("fix typo")

	args := cmd.Args
	if !contains(args, "--system-prompt") {
		t.Fatal("expected --system-prompt flag")
	}
	if !contains(args, "You are a wiki editor.") {
		t.Fatal("expected system prompt value")
	}
}

// TestBuildCommand_WithMCPConfig 验证 --mcp-config 附加（CC-004）。
func TestBuildCommand_WithMCPConfig(t *testing.T) {
	cfg := DefaultClaudeCodeConfig()
	cfg.MCPConfigPath = "/etc/claude/mcp.json"
	adapter := &ClaudeCodeAdapter{config: cfg}
	cmd := adapter.buildCommand("search")

	args := cmd.Args
	if !contains(args, "--mcp-config") {
		t.Fatal("expected --mcp-config flag")
	}
	if !contains(args, "/etc/claude/mcp.json") {
		t.Fatal("expected mcp config path value")
	}
}

func contains(slice []string, val string) bool {
	for _, s := range slice {
		if s == val {
			return true
		}
	}
	return false
}

var _ = strings.TrimSpace
```

**Run（验证失败）：**
```bash
Run: go test ./internal/agent/ -run TestBuildCommand -v
Expected: FAIL — 编译错误：undefined: ClaudeCodeAdapter, undefined: buildCommand
```

**GREEN — 实现代码：**

创建 `internal/agent/claude_code_adapter.go`（仅 buildCommand 部分，Execute 在 Phase 3 实现）：

```go
package agent

import (
	"fmt"
	"os/exec"
	"strconv"
)

// ClaudeCodeAdapter implements AgentEngine by driving the Claude Code CLI
// as a subprocess. The adapter is created by NewClaudeCodeAdapter (Phase 3)
// and replaces the native ReAct loop when config.Engine == "claude_code".
//
// Execute (Phase 3) builds the CLI command, starts the subprocess, reads
// stream-json output line by line, converts each line to an EventBus event,
// and accumulates the final AgentState.
type ClaudeCodeAdapter struct {
	config             ClaudeCodeConfig
	eventBus           interface{} // *event.EventBus — typed in Phase 3
	sessionID          string
	messageID         string
	iteration         int
	accumulatedContent string
}

// buildCommand constructs the exec.Cmd for `claude -p query --output-format stream-json ...`.
// It is safe to call before Execute is implemented (Phase 3).
// Visible for testing.
func (a *ClaudeCodeAdapter) buildCommand(query string) *exec.Cmd {
	args := []string{
		"-p", query,
		"--output-format", "stream-json",
		"--model", a.config.Model,
		"--max-turns", strconv.Itoa(a.config.MaxTurns),
	}
	if a.config.SystemPrompt != "" {
		args = append(args, "--system-prompt", a.config.SystemPrompt)
	}
	if a.config.MCPConfigPath != "" {
		args = append(args, "--mcp-config", a.config.MCPConfigPath)
	}
	cmd := exec.Command(a.config.BinaryPath, args...)
	if a.config.WorkingDir != "" {
		cmd.Dir = a.config.WorkingDir
	}
	return cmd
}

// Ensure ClaudeCodeAdapter satisfies fmt.Stringer for debug logging.
var _ fmt.Stringer = (*ClaudeCodeAdapter)(nil)

func (a *ClaudeCodeAdapter) String() string {
	return fmt.Sprintf("ClaudeCodeAdapter(model=%s, maxTurns=%d)", a.config.Model, a.config.MaxTurns)
}
```

**Run（验证通过）：**
```bash
Run: go test ./internal/agent/ -run "TestBuildCommand" -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/agent/claude_code_adapter.go internal/agent/claude_code_adapter_test.go && git commit -m "feat(agent): add ClaudeCodeAdapter.buildCommand (Phase 1.2, CC-002/003/004)"
```

---

### Task 1.3: CustomAgentConfig 新增 Engine 字段

**Files:**
- Modify: `internal/types/custom_agent.go` — `CustomAgentConfig` 结构体
- Test: `internal/types/custom_agent_engine_test.go`

**RED — 写失败测试：**

```go
package types

import "testing"

// TestCustomAgentConfig_EngineDefaultEmpty 验证 Engine 字段默认为空。
func TestCustomAgentConfig_EngineDefaultEmpty(t *testing.T) {
	cfg := CustomAgentConfig{}
	if cfg.Engine != "" {
		t.Fatalf("expected Engine default empty, got %q", cfg.Engine)
	}
}

// TestCustomAgentConfig_EngineSetClaudeCode 验证 Engine 可设置。
func TestCustomAgentConfig_EngineSetClaudeCode(t *testing.T) {
	cfg := CustomAgentConfig{Engine: "claude_code"}
	if cfg.Engine != "claude_code" {
		t.Fatalf("expected Engine=claude_code, got %q", cfg.Engine)
	}
}
```

**Run（验证失败）：**
```bash
Run: go test ./internal/types/ -run TestCustomAgentConfig_Engine -v
Expected: FAIL — 编译错误：types.CustomAgentConfig has no field Engine
```

**GREEN — 实现代码：**

修改 `internal/types/custom_agent.go` 的 `CustomAgentConfig` 结构体，在 `AgentType` 字段之后新增 `Engine` 字段：

```go
// AgentType is a preset category under smart-reasoning mode that pre-fills
// system prompt, allowed tools and recommended KB compatibility.
// Valid values: "rag-qa", "wiki-qa", "hybrid-rag-wiki", "custom".
// Empty / unknown values are treated as "custom" (no preset applied).
// Ignored for quick-answer mode.
AgentType string `yaml:"agent_type" json:"agent_type,omitempty"`
// Engine selects the agent execution backend.
//   ""          (default) — native ReAct engine (existing behaviour)
//   "native"                — explicitly select native ReAct
//   "claude_code"           — Claude Code CLI subprocess adapter
// When empty, the global config.AgentConfig.Engine value applies.
Engine string `yaml:"engine,omitempty" json:"engine,omitempty"`
```

**Run（验证通过）：**
```bash
Run: go test ./internal/types/ -run TestCustomAgentConfig_Engine -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/types/custom_agent.go internal/types/custom_agent_engine_test.go && git commit -m "feat(types): add Engine field to CustomAgentConfig (Phase 1.3)"
```

## Phase 2: stream-json 解析 + 事件转换（PR3）

> **目标**：解析 Claude Code CLI 的 stream-json 输出，转换为 EventBus 事件，累积 AgentState。

### Task 2.1: claudeCodeEvent 结构体 + parseClaudeCodeStreamEvent

**Files:**
- Create: `internal/agent/claude_code_stream.go`
- Test: `internal/agent/claude_code_stream_test.go`

**RED — 写失败测试：**

```go
package agent

import (
	"encoding/json"
	"testing"
)

// TestParseStreamEvent_AssistantMessage 验证解析 assistant_message（CC-005）。
func TestParseStreamEvent_AssistantMessage(t *testing.T) {
	line := []byte(`{"type":"assistant_message","content":"思考中...","role":"assistant"}`)
	ev := parseClaudeCodeStreamEvent(line)
	if ev == nil {
		t.Fatal("expected non-nil event")
	}
	if ev.Type != "assistant_message" {
		t.Fatalf("Type: expected %q, got %q", "assistant_message", ev.Type)
	}
	if ev.Content != "思考中..." {
		t.Fatalf("Content: expected %q, got %q", "思考中...", ev.Content)
	}
	if ev.Role != "assistant" {
		t.Fatalf("Role: expected %q, got %q", "assistant", ev.Role)
	}
}

// TestParseStreamEvent_ToolUse 验证解析 tool_use（CC-006）。
func TestParseStreamEvent_ToolUse(t *testing.T) {
	line := []byte(`{"type":"tool_use","tool":"wiki_search","input":{"query":"test"}}`)
	ev := parseClaudeCodeStreamEvent(line)
	if ev == nil {
		t.Fatal("expected non-nil event")
	}
	if ev.Type != "tool_use" {
		t.Fatalf("Type: expected %q, got %q", "tool_use", ev.Type)
	}
	if ev.Tool != "wiki_search" {
		t.Fatalf("Tool: expected %q, got %q", "wiki_search", ev.Tool)
	}
	if ev.Input == nil {
		t.Fatal("expected non-nil Input")
	}
	q, ok := ev.Input["query"].(string)
	if !ok || q != "test" {
		t.Fatalf("Input.query: expected %q, got %v", "test", ev.Input["query"])
	}
}

// TestParseStreamEvent_ToolResult 验证解析 tool_result（CC-007）。
func TestParseStreamEvent_ToolResult(t *testing.T) {
	line := []byte(`{"type":"tool_result","tool":"wiki_search","output":"result text"}`)
	ev := parseClaudeCodeStreamEvent(line)
	if ev == nil {
		t.Fatal("expected non-nil event")
	}
	if ev.Type != "tool_result" {
		t.Fatalf("Type: expected %q, got %q", "tool_result", ev.Type)
	}
	if ev.Tool != "wiki_search" {
		t.Fatalf("Tool: expected %q, got %q", "wiki_search", ev.Tool)
	}
	if ev.Output != "result text" {
		t.Fatalf("Output: expected %q, got %q", "result text", ev.Output)
	}
}

// TestParseStreamEvent_MessageStop 验证解析 message_stop（CC-008）。
func TestParseStreamEvent_MessageStop(t *testing.T) {
	line := []byte(`{"type":"message_stop","stop_reason":"end_turn"}`)
	ev := parseClaudeCodeStreamEvent(line)
	if ev == nil {
		t.Fatal("expected non-nil event")
	}
	if ev.Type != "message_stop" {
		t.Fatalf("Type: expected %q, got %q", "message_stop", ev.Type)
	}
	if ev.StopReason != "end_turn" {
		t.Fatalf("StopReason: expected %q, got %q", "end_turn", ev.StopReason)
	}
}

// TestParseStreamEvent_MessageStart 验证解析 message_start（含 session_id + model）。
func TestParseStreamEvent_MessageStart(t *testing.T) {
	line := []byte(`{"type":"message_start","session_id":"sess-123","model":"claude-sonnet-4-5"}`)
	ev := parseClaudeCodeStreamEvent(line)
	if ev == nil {
		t.Fatal("expected non-nil event")
	}
	if ev.Type != "message_start" {
		t.Fatalf("Type: expected %q, got %q", "message_start", ev.Type)
	}
	if ev.SessionID != "sess-123" {
		t.Fatalf("SessionID: expected %q, got %q", "sess-123", ev.SessionID)
	}
	if ev.Model != "claude-sonnet-4-5" {
		t.Fatalf("Model: expected %q, got %q", "claude-sonnet-4-5", ev.Model)
	}
}

// TestParseStreamEvent_InvalidJSON 验证无效 JSON 返回 nil。
func TestParseStreamEvent_InvalidJSON(t *testing.T) {
	ev := parseClaudeCodeStreamEvent([]byte("not json"))
	if ev != nil {
		t.Fatalf("expected nil for invalid JSON, got %+v", ev)
	}
}

// TestParseStreamEvent_EmptyLine 验证空行返回 nil。
func TestParseStreamEvent_EmptyLine(t *testing.T) {
	ev := parseClaudeCodeStreamEvent([]byte(""))
	if ev != nil {
		t.Fatalf("expected nil for empty line, got %+v", ev)
	}
}

var _ = json.Unmarshal
```

**Run（验证失败）：**
```bash
Run: go test ./internal/agent/ -run TestParseStreamEvent -v
Expected: FAIL — 编译错误：undefined: claudeCodeEvent, undefined: parseClaudeCodeStreamEvent
```

**GREEN — 实现代码：**

创建 `internal/agent/claude_code_stream.go`：

```go
package agent

import "encoding/json"

// claudeCodeEvent represents a single line of Claude Code CLI stream-json output.
// Each field is only populated when the corresponding event type is emitted.
//
// Example lines (one JSON object per line):
//
//	{"type":"message_start","session_id":"...","model":"claude-sonnet-4-5"}
//	{"type":"assistant_message","content":"思考中...","role":"assistant"}
//	{"type":"tool_use","tool":"wiki_search","input":{"query":"test"}}
//	{"type":"tool_result","tool":"wiki_search","output":"..."}
//	{"type":"message_stop","stop_reason":"end_turn"}
type claudeCodeEvent struct {
	Type       string                 `json:"type"`
	Content    string                 `json:"content,omitempty"`
	Role       string                 `json:"role,omitempty"`
	Tool       string                 `json:"tool,omitempty"`
	Input      map[string]interface{} `json:"input,omitempty"`
	Output     string                 `json:"output,omitempty"`
	StopReason string                 `json:"stop_reason,omitempty"`
	SessionID  string                 `json:"session_id,omitempty"`
	Model      string                 `json:"model,omitempty"`
}

// parseClaudeCodeStreamEvent parses a single line of stream-json output into a
// claudeCodeEvent. Returns nil if the line is empty or not valid JSON.
func parseClaudeCodeStreamEvent(line []byte) *claudeCodeEvent {
	if len(line) == 0 {
		return nil
	}
	var ev claudeCodeEvent
	if err := json.Unmarshal(line, &ev); err != nil {
		return nil
	}
	if ev.Type == "" {
		return nil
	}
	return &ev
}
```

**Run（验证通过）：**
```bash
Run: go test ./internal/agent/ -run TestParseStreamEvent -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/agent/claude_code_stream.go internal/agent/claude_code_stream_test.go && git commit -m "feat(agent): add claudeCodeEvent + parseClaudeCodeStreamEvent (Phase 2.1, CC-005/006/007/008)"
```

---

### Task 2.2: emitEvent 方法（事件转换到 EventBus）

**Files:**
- Modify: `internal/agent/claude_code_stream.go`（新增 emitEvent + eventEmitter 接口）
- Modify: `internal/agent/claude_code_adapter.go`（eventBus 字段类型改为 eventEmitter）

**说明：** 引入 `eventEmitter` 接口抽象 `*event.EventBus`，使测试可注入 mock。`ClaudeCodeAdapter.eventBus` 字段类型从 `interface{}` 改为 `eventEmitter`。

**RED — 写失败测试（追加到 `claude_code_stream_test.go`）：**

```go
import (
	"context"
	"encoding/json"
	"testing"

	"github.com/Tencent/WeKnora/internal/event"
	"github.com/Tencent/WeKnora/internal/types"
)

// mockEventBus records emitted events for assertion.
type mockEventBus struct {
	events []event.Event
}

func newMockEventBus() *mockEventBus {
	return &mockEventBus{}
}

func (m *mockEventBus) Emit(ctx context.Context, ev event.Event) error {
	m.events = append(m.events, ev)
	return nil
}

// TestEmitEvent_AssistantMessage 验证 assistant_message → EventAgentThought（CC-009）。
func TestEmitEvent_AssistantMessage(t *testing.T) {
	bus := newMockEventBus()
	adapter := &ClaudeCodeAdapter{
		eventBus:  bus,
		sessionID: "sess-1",
		iteration: 0,
	}
	ev := &claudeCodeEvent{
		Type:    "assistant_message",
		Content: "thinking...",
	}
	adapter.emitEvent(context.Background(), ev)

	if len(bus.events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(bus.events))
	}
	if bus.events[0].Type != event.EventAgentThought {
		t.Fatalf("type: expected %q, got %q", event.EventAgentThought, bus.events[0].Type)
	}
}

// TestEmitEvent_ToolUse 验证 tool_use → EventAgentToolCall。
func TestEmitEvent_ToolUse(t *testing.T) {
	bus := newMockEventBus()
	adapter := &ClaudeCodeAdapter{
		eventBus:  bus,
		sessionID: "sess-1",
		iteration: 1,
	}
	ev := &claudeCodeEvent{
		Type:  "tool_use",
		Tool:  "wiki_search",
		Input: map[string]interface{}{"query": "test"},
	}
	adapter.emitEvent(context.Background(), ev)

	if len(bus.events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(bus.events))
	}
	if bus.events[0].Type != event.EventAgentToolCall {
		t.Fatalf("type: expected %q, got %q", event.EventAgentToolCall, bus.events[0].Type)
	}
}

// TestEmitEvent_ToolResult 验证 tool_result → EventAgentToolResult。
func TestEmitEvent_ToolResult(t *testing.T) {
	bus := newMockEventBus()
	adapter := &ClaudeCodeAdapter{
		eventBus:  bus,
		sessionID: "sess-1",
		iteration: 1,
	}
	ev := &claudeCodeEvent{
		Type:   "tool_result",
		Tool:   "wiki_search",
		Output: "search results here",
	}
	adapter.emitEvent(context.Background(), ev)

	if len(bus.events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(bus.events))
	}
	if bus.events[0].Type != event.EventAgentToolResult {
		t.Fatalf("type: expected %q, got %q", event.EventAgentToolResult, bus.events[0].Type)
	}
}

// TestEmitEvent_MessageStop 验证 message_stop → EventAgentFinalAnswer。
func TestEmitEvent_MessageStop(t *testing.T) {
	bus := newMockEventBus()
	adapter := &ClaudeCodeAdapter{
		eventBus:           bus,
		sessionID:          "sess-1",
		accumulatedContent: "final answer text",
	}
	ev := &claudeCodeEvent{
		Type: "message_stop",
	}
	adapter.emitEvent(context.Background(), ev)

	if len(bus.events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(bus.events))
	}
	if bus.events[0].Type != event.EventAgentFinalAnswer {
		t.Fatalf("type: expected %q, got %q", event.EventAgentFinalAnswer, bus.events[0].Type)
	}
}
```

**Run（验证失败）：**
```bash
Run: go test ./internal/agent/ -run TestEmitEvent -v
Expected: FAIL — 编译错误：undefined: emitEvent, mockEventBus does not satisfy eventEmitter
```

**GREEN — 实现代码：**

1. 修改 `internal/agent/claude_code_adapter.go`，将 `eventBus` 字段类型改为 `eventEmitter`：

```go
type ClaudeCodeAdapter struct {
	config             ClaudeCodeConfig
	eventBus           eventEmitter
	sessionID          string
	messageID         string
	iteration         int
	accumulatedContent string
}
```

2. 在 `internal/agent/claude_code_stream.go` 新增 `eventEmitter` 接口和 `emitEvent` 方法：

```go
import (
	"context"
	"encoding/json"

	"github.com/Tencent/WeKnora/internal/event"
)

// eventEmitter abstracts *event.EventBus so tests can inject a mock.
// In production this is always *event.EventBus.
type eventEmitter interface {
	Emit(ctx context.Context, ev event.Event) error
}

// emitEvent converts a parsed claudeCodeEvent into the corresponding EventBus
// event and publishes it. The mapping is:
//
//	assistant_message → EventAgentThought      (streaming thinking content)
//	tool_use          → EventAgentToolCall     (tool invocation notification)
//	tool_result       → EventAgentToolResult   (tool execution result)
//	message_stop      → EventAgentFinalAnswer  (final answer marker, done=true)
//
// Unknown event types are silently dropped — the stream may emit types we
// don't yet care about (e.g. message_start, ping).
func (a *ClaudeCodeAdapter) emitEvent(ctx context.Context, ev *claudeCodeEvent) {
	if a.eventBus == nil || ev == nil {
		return
	}
	switch ev.Type {
	case "assistant_message":
		a.eventBus.Emit(ctx, event.Event{
			Type:      event.EventAgentThought,
			SessionID: a.sessionID,
			Data: event.AgentThoughtData{
				Content:   ev.Content,
				Iteration: a.iteration,
				Done:      false,
			},
		})
	case "tool_use":
		a.eventBus.Emit(ctx, event.Event{
			Type:      event.EventAgentToolCall,
			SessionID: a.sessionID,
			Data: event.AgentToolCallData{
				ToolName:  ev.Tool,
				Arguments: ev.Input,
				Iteration: a.iteration,
			},
		})
	case "tool_result":
		a.eventBus.Emit(ctx, event.Event{
			Type:      event.EventAgentToolResult,
			SessionID: a.sessionID,
			Data: event.AgentToolResultData{
				ToolName:  ev.Tool,
				Output:    ev.Output,
				Success:   true,
				Iteration: a.iteration,
			},
		})
	case "message_stop":
		a.eventBus.Emit(ctx, event.Event{
			Type:      event.EventAgentFinalAnswer,
			SessionID: a.sessionID,
			Data: event.AgentFinalAnswerData{
				Content: a.accumulatedContent,
				Done:    true,
			},
		})
	}
}
```

**Run（验证通过）：**
```bash
Run: go test ./internal/agent/ -run TestEmitEvent -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/agent/claude_code_stream.go internal/agent/claude_code_adapter.go internal/agent/claude_code_stream_test.go && git commit -m "feat(agent): add emitEvent mapping claudeCodeEvent → EventBus (Phase 2.2, CC-009)"
```

### Task 2.3: updateState 方法（状态累积）

**Files:**
- Modify: `internal/agent/claude_code_stream.go`

**RED — 写失败测试（追加到 `claude_code_stream_test.go`）：**

```go
import (
	"github.com/Tencent/WeKnora/internal/types"
)

// TestUpdateState_AssistantMessage 验证 assistant_message 累积到 FinalAnswer（CC-010）。
func TestUpdateState_AssistantMessage(t *testing.T) {
	adapter := &ClaudeCodeAdapter{}
	state := &types.AgentState{}
	ev := &claudeCodeEvent{
		Type:    "assistant_message",
		Content: "Hello ",
	}
	adapter.updateState(state, ev)
	if state.FinalAnswer != "Hello " {
		t.Fatalf("FinalAnswer: expected %q, got %q", "Hello ", state.FinalAnswer)
	}

	ev2 := &claudeCodeEvent{
		Type:    "assistant_message",
		Content: "world",
	}
	adapter.updateState(state, ev2)
	if state.FinalAnswer != "Hello world" {
		t.Fatalf("FinalAnswer after concat: expected %q, got %q", "Hello world", state.FinalAnswer)
	}
}

// TestUpdateState_ToolUse 验证 tool_use 新增 AgentStep。
func TestUpdateState_ToolUse(t *testing.T) {
	adapter := &ClaudeCodeAdapter{
		iteration: 2,
	}
	state := &types.AgentState{}
	ev := &claudeCodeEvent{
		Type:  "tool_use",
		Tool:  "wiki_search",
		Input: map[string]interface{}{"query": "test"},
	}
	adapter.updateState(state, ev)

	if len(state.RoundSteps) != 1 {
		t.Fatalf("expected 1 step, got %d", len(state.RoundSteps))
	}
	step := state.RoundSteps[0]
	if step.Iteration != 2 {
		t.Fatalf("Iteration: expected 2, got %d", step.Iteration)
	}
	if len(step.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(step.ToolCalls))
	}
	tc := step.ToolCalls[0]
	if tc.Name != "wiki_search" {
		t.Fatalf("ToolCall.Name: expected %q, got %q", "wiki_search", tc.Name)
	}
	if tc.Args["query"] != "test" {
		t.Fatalf("ToolCall.Args.query: expected %q, got %v", "test", tc.Args["query"])
	}
}

// TestUpdateState_ToolResult 验证 tool_result 更新最后一个 step 的 tool call。
func TestUpdateState_ToolResult(t *testing.T) {
	adapter := &ClaudeCodeAdapter{
		iteration: 1,
	}
	state := &types.AgentState{
		RoundSteps: []types.AgentStep{
			{
				Iteration: 1,
				ToolCalls: []types.ToolCall{
					{Name: "wiki_search", Args: map[string]interface{}{"query": "test"}},
				},
			},
		},
	}
	ev := &claudeCodeEvent{
		Type:   "tool_result",
		Tool:   "wiki_search",
		Output: "search results here",
	}
	adapter.updateState(state, ev)

	if len(state.RoundSteps) != 1 {
		t.Fatalf("expected 1 step, got %d", len(state.RoundSteps))
	}
	tc := state.RoundSteps[0].ToolCalls[0]
	if tc.Result == nil {
		t.Fatal("expected non-nil ToolCall.Result")
	}
	if tc.Result.Output != "search results here" {
		t.Fatalf("ToolCall.Result.Output: expected %q, got %q", "search results here", tc.Result.Output)
	}
	if !tc.Result.Success {
		t.Fatal("ToolCall.Result.Success: expected true")
	}
}

// TestUpdateState_MessageStop 验证 message_stop 设置 Finished。
func TestUpdateState_MessageStop(t *testing.T) {
	adapter := &ClaudeCodeAdapter{}
	state := &types.AgentState{
		FinalAnswer: "the answer",
	}
	ev := &claudeCodeEvent{
		Type:       "message_stop",
		StopReason: "end_turn",
	}
	adapter.updateState(state, ev)

	if !state.IsComplete {
		t.Fatal("expected IsComplete=true after message_stop")
	}
}
```

**Run（验证失败）：**
```bash
Run: go test ./internal/agent/ -run TestUpdateState -v
Expected: FAIL — 编译错误：undefined: updateState
```

**GREEN — 实现代码：**

在 `internal/agent/claude_code_stream.go` 新增 `updateState` 方法：

```go
import (
	"github.com/Tencent/WeKnora/internal/types"
)

// updateState accumulates the AgentState based on a parsed claudeCodeEvent.
// The mapping is:
//
//	assistant_message → append to FinalAnswer
//	tool_use          → append a new AgentStep with one ToolCall
//	tool_result       → update the last step's last ToolCall with the result
//	message_stop      → set IsComplete = true
//
// The state is returned by reference; callers should pass the same *AgentState
// across the entire stream so that all events accumulate.
func (a *ClaudeCodeAdapter) updateState(state *types.AgentState, ev *claudeCodeEvent) {
	if state == nil || ev == nil {
		return
	}
	switch ev.Type {
	case "assistant_message":
		a.accumulatedContent += ev.Content
		state.FinalAnswer = a.accumulatedContent
	case "tool_use":
		step := types.AgentStep{
			Iteration: a.iteration,
			ToolCalls: []types.ToolCall{
				{
					Name: ev.Tool,
					Args: ev.Input,
				},
			},
		}
		state.RoundSteps = append(state.RoundSteps, step)
	case "tool_result":
		if len(state.RoundSteps) == 0 {
			return
		}
		lastStep := &state.RoundSteps[len(state.RoundSteps)-1]
		if len(lastStep.ToolCalls) == 0 {
			return
		}
		lastCall := &lastStep.ToolCalls[len(lastStep.ToolCalls)-1]
		lastCall.Result = &types.ToolResult{
			Success: true,
			Output:  ev.Output,
		}
	case "message_stop":
		state.IsComplete = true
	}
}
```

**Run（验证通过）：**
```bash
Run: go test ./internal/agent/ -run TestUpdateState -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/agent/claude_code_stream.go internal/agent/claude_code_stream_test.go && git commit -m "feat(agent): add updateState for AgentState accumulation (Phase 2.3, CC-010)"
```

---

### Task 2.4: 流式转换集成测试

**Files:**
- Test: `internal/agent/claude_code_stream_integration_test.go`

**说明：** 模拟一段完整的 stream-json 输出，逐行调用 parseClaudeCodeStreamEvent → emitEvent → updateState，验证最终的事件序列和 AgentState 正确累积。

**RED — 写失败测试：**

```go
package agent

import (
	"context"
	"testing"

	"github.com/Tencent/WeKnora/internal/event"
	"github.com/Tencent/WeKnora/internal/types"
)

// TestStreamConversion_Integration 模拟完整 stream-json 流，验证事件发射和状态累积。
func TestStreamConversion_Integration(t *testing.T) {
	bus := newMockEventBus()
	adapter := &ClaudeCodeAdapter{
		eventBus:  bus,
		sessionID: "sess-int",
		iteration: 0,
	}
	state := &types.AgentState{}

	// 模拟 claude CLI 输出（每行一个 JSON）
	lines := [][]byte{
		[]byte(`{"type":"message_start","session_id":"sess-123","model":"claude-sonnet-4-5"}`),
		[]byte(`{"type":"assistant_message","content":"思考中...","role":"assistant"}`),
		[]byte(`{"type":"tool_use","tool":"wiki_search","input":{"query":"RAG"}}`),
		[]byte(`{"type":"tool_result","tool":"wiki_search","output":"RAG is retrieval-augmented generation."}`),
		[]byte(`{"type":"assistant_message","content":"RAG 是检索增强生成。","role":"assistant"}`),
		[]byte(`{"type":"message_stop","stop_reason":"end_turn"}`),
	}

	ctx := context.Background()
	for _, line := range lines {
		ev := parseClaudeCodeStreamEvent(line)
		if ev == nil {
			continue
		}
		adapter.emitEvent(ctx, ev)
		adapter.updateState(state, ev)
	}

	// 验证事件序列：
	// message_start 被忽略（4 个有效事件：thought, tool_call, tool_result, final_answer）
	if len(bus.events) != 4 {
		t.Fatalf("expected 4 events, got %d", len(bus.events))
	}
	if bus.events[0].Type != event.EventAgentThought {
		t.Fatalf("event[0]: expected %q, got %q", event.EventAgentThought, bus.events[0].Type)
	}
	if bus.events[1].Type != event.EventAgentToolCall {
		t.Fatalf("event[1]: expected %q, got %q", event.EventAgentToolCall, bus.events[1].Type)
	}
	if bus.events[2].Type != event.EventAgentToolResult {
		t.Fatalf("event[2]: expected %q, got %q", event.EventAgentToolResult, bus.events[2].Type)
	}
	if bus.events[3].Type != event.EventAgentFinalAnswer {
		t.Fatalf("event[3]: expected %q, got %q", event.EventAgentFinalAnswer, bus.events[3].Type)
	}

	// 验证状态累积
	if !state.IsComplete {
		t.Fatal("expected state.IsComplete=true")
	}
	expectedAnswer := "思考中...RAG 是检索增强生成。"
	if state.FinalAnswer != expectedAnswer {
		t.Fatalf("FinalAnswer: expected %q, got %q", expectedAnswer, state.FinalAnswer)
	}
	if len(state.RoundSteps) != 1 {
		t.Fatalf("expected 1 round step, got %d", len(state.RoundSteps))
	}
	step := state.RoundSteps[0]
	if len(step.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call in step, got %d", len(step.ToolCalls))
	}
	tc := step.ToolCalls[0]
	if tc.Name != "wiki_search" {
		t.Fatalf("ToolCall.Name: expected %q, got %q", "wiki_search", tc.Name)
	}
	if tc.Result == nil || tc.Result.Output != "RAG is retrieval-augmented generation." {
		t.Fatalf("ToolCall.Result.Output mismatch: %+v", tc.Result)
	}
}
```

**Run（验证失败）：**
```bash
Run: go test ./internal/agent/ -run TestStreamConversion_Integration -v
Expected: FAIL — 如果 Phase 2.1-2.3 已完成则应 PASS；若未完成则编译错误
```

**GREEN — 确认实现：**

此 task 为集成测试，不新增实现代码。如果测试失败，检查 Phase 2.1-2.3 的实现是否一致。测试验证的是 parseClaudeCodeStreamEvent + emitEvent + updateState 三者协作的正确性。

**Run（验证通过）：**
```bash
Run: go test ./internal/agent/ -run TestStreamConversion_Integration -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/agent/claude_code_stream_integration_test.go && git commit -m "test(agent): add stream conversion integration test (Phase 2.4)"
```

## Phase 3: ClaudeCodeAdapter 实现（PR4）

> **目标**：实现 ClaudeCodeAdapter 的 Execute 方法，通过子进程调用 claude CLI，读取 stream-json 输出并转换为事件 + 状态。实现 AgentEngine 接口。

### Task 3.1: ClaudeCodeAdapter 结构体 + NewClaudeCodeAdapter

**Files:**
- Modify: `internal/agent/claude_code_adapter.go`

**RED — 写失败测试（追加到 `claude_code_adapter_test.go`）：**

```go
import (
	"github.com/Tencent/WeKnora/internal/event"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// TestNewClaudeCodeAdapter 验证构造函数设置所有字段。
func TestNewClaudeCodeAdapter(t *testing.T) {
	cfg := DefaultClaudeCodeConfig()
	cfg.Model = "claude-opus-4"
	bus := event.NewEventBus()
	adapter := NewClaudeCodeAdapter(cfg, bus, "sess-1", "msg-1")

	if adapter == nil {
		t.Fatal("expected non-nil adapter")
	}
	if adapter.config.Model != "claude-opus-4" {
		t.Fatalf("config.Model: expected %q, got %q", "claude-opus-4", adapter.config.Model)
	}
	if adapter.sessionID != "sess-1" {
		t.Fatalf("sessionID: expected %q, got %q", "sess-1", adapter.sessionID)
	}
	if adapter.messageID != "msg-1" {
		t.Fatalf("messageID: expected %q, got %q", "msg-1", adapter.messageID)
	}
	if adapter.eventBus == nil {
		t.Fatal("expected non-nil eventBus")
	}
}

// TestClaudeCodeAdapter_ImplementsAgentEngine 验证 ClaudeCodeAdapter 实现 AgentEngine 接口。
func TestClaudeCodeAdapter_ImplementsAgentEngine(t *testing.T) {
	cfg := DefaultClaudeCodeConfig()
	bus := event.NewEventBus()
	adapter := NewClaudeCodeAdapter(cfg, bus, "sess-1", "msg-1")

	var _ interfaces.AgentEngine = adapter
}
```

**Run（验证失败）：**
```bash
Run: go test ./internal/agent/ -run "TestNewClaudeCodeAdapter|TestClaudeCodeAdapter_ImplementsAgentEngine" -v
Expected: FAIL — 编译错误：undefined: NewClaudeCodeAdapter, ClaudeCodeAdapter does not implement Execute
```

**GREEN — 实现代码：**

修改 `internal/agent/claude_code_adapter.go`，新增 `NewClaudeCodeAdapter` 构造函数和编译期接口断言：

```go
import (
	"github.com/Tencent/WeKnora/internal/event"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// NewClaudeCodeAdapter creates a new ClaudeCodeAdapter that drives the Claude
// Code CLI as a subprocess. The returned adapter implements interfaces.AgentEngine.
func NewClaudeCodeAdapter(
	cfg ClaudeCodeConfig,
	eventBus *event.EventBus,
	sessionID, messageID string,
) *ClaudeCodeAdapter {
	return &ClaudeCodeAdapter{
		config:    cfg,
		eventBus:  eventBus,
		sessionID: sessionID,
		messageID: messageID,
		iteration: 0,
	}
}

// Compile-time assertion that ClaudeCodeAdapter implements AgentEngine.
// Execute is implemented in Task 3.2.
var _ interfaces.AgentEngine = (*ClaudeCodeAdapter)(nil)
```

> **注意：** 此阶段 `Execute` 方法尚未实现，编译断言会导致编译失败。这是预期的 RED 状态——Task 3.2 实现 `Execute` 后通过。建议将 3.1 和 3.2 合并为一个 commit。

### Task 3.2: Execute 方法实现

**Files:**
- Modify: `internal/agent/claude_code_adapter.go`

**说明：** Execute 是 adapter 核心：构造命令 → cmd.Start → bufio.Scanner 读取 stdout → parseEvent → emitEvent → updateState → cmd.Wait。使用 `exec.CommandContext` 支持超时和取消。`llmContext` 和 `imageURLs` 为满足接口签名而接收，但当前不传递给 CLI（Claude Code 管理自身会话历史）。

**RED — 写失败测试（追加到 `claude_code_adapter_test.go`）：**

```go
import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// TestExecute_MockSubprocess 验证 Execute 通过 mock 子进程读取 stream-json（CC-013）。
func TestExecute_MockSubprocess(t *testing.T) {
	mockScript := writeMockClaudeScript(t)
	defer os.Remove(mockScript)

	cfg := ClaudeCodeConfig{
		BinaryPath: mockScript,
		Model:      "claude-sonnet-4-5",
		MaxTurns:   3,
		Timeout:    10 * time.Second,
	}
	bus := event.NewEventBus()
	adapter := NewClaudeCodeAdapter(cfg, bus, "sess-exec", "msg-exec")

	state, err := adapter.Execute(context.Background(), "sess-exec", "msg-exec", "test query", nil)
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if state == nil {
		t.Fatal("expected non-nil state")
	}
	if !state.IsComplete {
		t.Fatal("expected IsComplete=true")
	}
	if state.FinalAnswer == "" {
		t.Fatal("expected non-empty FinalAnswer")
	}
}

// writeMockClaudeScript creates a temporary executable that emits stream-json lines.
func writeMockClaudeScript(t *testing.T) string {
	t.Helper()
	var script string
	if runtime.GOOS == "windows" {
		script = "@echo off\r\n" +
			"echo {\"type\":\"message_start\",\"session_id\":\"mock\",\"model\":\"claude-sonnet-4-5\"}\r\n" +
			"echo {\"type\":\"assistant_message\",\"content\":\"mock answer\",\"role\":\"assistant\"}\r\n" +
			"echo {\"type\":\"message_stop\",\"stop_reason\":\"end_turn\"}\r\n"
	} else {
		script = "#!/bin/sh\n" +
			"echo '{\"type\":\"message_start\",\"session_id\":\"mock\",\"model\":\"claude-sonnet-4-5\"}'\n" +
			"echo '{\"type\":\"assistant_message\",\"content\":\"mock answer\",\"role\":\"assistant\"}'\n" +
			"echo '{\"type\":\"message_stop\",\"stop_reason\":\"end_turn\"}'\n"
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "mock-claude")
	if runtime.GOOS == "windows" {
		path += ".bat"
	}
	if err := os.WriteFile(path, []byte(script), 0755); err != nil {
		t.Fatalf("failed to write mock script: %v", err)
	}
	return path
}
```

**Run（验证失败）：**
```bash
Run: go test ./internal/agent/ -run TestExecute_MockSubprocess -v
Expected: FAIL — 编译错误：ClaudeCodeAdapter.Execute undefined
```

**GREEN — 实现代码：**

在 `internal/agent/claude_code_adapter.go` 新增 `Execute` 方法（合并 Task 3.1 构造函数一起提交）：

```go
import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"time"

	"github.com/Tencent/WeKnora/internal/event"
	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/models/chat"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// NewClaudeCodeAdapter creates a new ClaudeCodeAdapter that drives the Claude
// Code CLI as a subprocess. The returned adapter implements interfaces.AgentEngine.
func NewClaudeCodeAdapter(
	cfg ClaudeCodeConfig,
	eventBus *event.EventBus,
	sessionID, messageID string,
) *ClaudeCodeAdapter {
	return &ClaudeCodeAdapter{
		config:    cfg,
		eventBus:  eventBus,
		sessionID: sessionID,
		messageID: messageID,
		iteration: 0,
	}
}

// Compile-time assertion that ClaudeCodeAdapter implements AgentEngine.
var _ interfaces.AgentEngine = (*ClaudeCodeAdapter)(nil)

// Execute runs the Claude Code CLI as a subprocess, reads its stream-json
// output, converts each line to an EventBus event, and accumulates the
// final AgentState.
//
// The query is passed via `claude -p "query"` and the subprocess stdout is
// scanned line by line. Each line is a JSON object (see claudeCodeEvent).
//
// llmContext and imageURLs are accepted to satisfy the AgentEngine interface
// but are NOT passed to the CLI (Claude Code manages its own conversation
// history internally). Future versions may serialize llmContext into a
// session resume call.
func (a *ClaudeCodeAdapter) Execute(
	ctx context.Context,
	sessionID, messageID, query string,
	llmContext []chat.Message,
	imageURLs ...[]string,
) (*types.AgentState, error) {
	state := &types.AgentState{}

	// Build CLI args
	args := []string{
		"-p", query,
		"--output-format", "stream-json",
		"--model", a.config.Model,
		"--max-turns", strconv.Itoa(a.config.MaxTurns),
	}
	if a.config.SystemPrompt != "" {
		args = append(args, "--system-prompt", a.config.SystemPrompt)
	}
	if a.config.MCPConfigPath != "" {
		args = append(args, "--mcp-config", a.config.MCPConfigPath)
	}

	// Apply timeout via context
	if a.config.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, a.config.Timeout)
		defer cancel()
	}

	cmd := exec.CommandContext(ctx, a.config.BinaryPath, args...)
	if a.config.WorkingDir != "" {
		cmd.Dir = a.config.WorkingDir
	}
	if a.config.APIKey != "" {
		cmd.Env = append(os.Environ(), "ANTHROPIC_API_KEY="+a.config.APIKey)
	}

	// Capture stdout for stream-json parsing
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("claude_code: stdout pipe: %w", err)
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("claude_code: start subprocess: %w", err)
	}

	logger.Infof(ctx, "claude_code: subprocess started (session=%s, model=%s)", sessionID, a.config.Model)

	// Read stream-json output line by line
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		ev := parseClaudeCodeStreamEvent(line)
		if ev == nil {
			continue
		}
		a.emitEvent(ctx, ev)
		a.updateState(state, ev)
	}

	if err := scanner.Err(); err != nil {
		logger.Warnf(ctx, "claude_code: scanner error: %v", err)
	}

	// Wait for subprocess to exit
	if err := cmd.Wait(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return state, fmt.Errorf("claude_code: subprocess timed out after %v", a.config.Timeout)
		}
		logger.Warnf(ctx, "claude_code: subprocess exited with error: %v", err)
	}

	return state, nil
}
```

> **重构说明：** Task 1.2 中的 `buildCommand` 方法在此阶段被内联到 `Execute`（因为需用 `exec.CommandContext` 支持超时/取消）。如需保留 `buildCommand` 的独立可测试性，可将其签名改为 `buildCommand(ctx context.Context, query string) *exec.Cmd`，`TestBuildCommand_*` 测试需同步更新签名。

**Run（验证通过）：**
```bash
Run: go test ./internal/agent/ -run "TestNewClaudeCodeAdapter|TestExecute_MockSubprocess|TestClaudeCodeAdapter_ImplementsAgentEngine" -v
Expected: PASS
```

**Commit（合并 Task 3.1 + 3.2）：**
```bash
Run: git add internal/agent/claude_code_adapter.go internal/agent/claude_code_adapter_test.go && git commit -m "feat(agent): implement ClaudeCodeAdapter.Execute + constructor (Phase 3.1+3.2, CC-013)"
```

### Task 3.3: Execute 单元测试扩展（mock 子进程）

**Files:**
- Test: `internal/agent/claude_code_adapter_execute_test.go`

**说明：** 扩展 Execute 测试覆盖更多场景：tool_use/tool_result 流、空输出。

**RED — 写失败测试：**

```go
package agent

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/event"
)

// TestExecute_WithToolUseFlow 验证 Execute 处理 tool_use → tool_result 流。
func TestExecute_WithToolUseFlow(t *testing.T) {
	mockScript := writeMockClaudeScriptWithTools(t)
	defer os.Remove(mockScript)

	cfg := ClaudeCodeConfig{
		BinaryPath: mockScript,
		Model:      "claude-sonnet-4-5",
		MaxTurns:   5,
		Timeout:    10 * time.Second,
	}
	bus := event.NewEventBus()
	adapter := NewClaudeCodeAdapter(cfg, bus, "sess-tools", "msg-tools")

	state, err := adapter.Execute(context.Background(), "sess-tools", "msg-tools", "search wiki", nil)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if !state.IsComplete {
		t.Fatal("expected IsComplete=true")
	}
	if len(state.RoundSteps) != 1 {
		t.Fatalf("expected 1 round step, got %d", len(state.RoundSteps))
	}
	if len(state.RoundSteps[0].ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(state.RoundSteps[0].ToolCalls))
	}
	tc := state.RoundSteps[0].ToolCalls[0]
	if tc.Name != "wiki_search" {
		t.Fatalf("tool name: expected %q, got %q", "wiki_search", tc.Name)
	}
	if tc.Result == nil || tc.Result.Output != "mock wiki result" {
		t.Fatalf("tool result mismatch: %+v", tc.Result)
	}
}

// TestExecute_EmptyOutput 验证 Execute 处理空输出。
func TestExecute_EmptyOutput(t *testing.T) {
	mockScript := writeMockClaudeEmptyScript(t)
	defer os.Remove(mockScript)

	cfg := ClaudeCodeConfig{
		BinaryPath: mockScript,
		Model:      "claude-sonnet-4-5",
		MaxTurns:   1,
		Timeout:    5 * time.Second,
	}
	bus := event.NewEventBus()
	adapter := NewClaudeCodeAdapter(cfg, bus, "sess-empty", "msg-empty")

	state, err := adapter.Execute(context.Background(), "sess-empty", "msg-empty", "test", nil)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if state == nil {
		t.Fatal("expected non-nil state")
	}
	if state.IsComplete {
		t.Fatal("expected IsComplete=false for empty output")
	}
}

func writeMockClaudeScriptWithTools(t *testing.T) string {
	t.Helper()
	var script string
	if runtime.GOOS == "windows" {
		script = "@echo off\r\n" +
			"echo {\"type\":\"tool_use\",\"tool\":\"wiki_search\",\"input\":{\"query\":\"test\"}}\r\n" +
			"echo {\"type\":\"tool_result\",\"tool\":\"wiki_search\",\"output\":\"mock wiki result\"}\r\n" +
			"echo {\"type\":\"assistant_message\",\"content\":\"done\",\"role\":\"assistant\"}\r\n" +
			"echo {\"type\":\"message_stop\",\"stop_reason\":\"end_turn\"}\r\n"
	} else {
		script = "#!/bin/sh\n" +
			"echo '{\"type\":\"tool_use\",\"tool\":\"wiki_search\",\"input\":{\"query\":\"test\"}}'\n" +
			"echo '{\"type\":\"tool_result\",\"tool\":\"wiki_search\",\"output\":\"mock wiki result\"}'\n" +
			"echo '{\"type\":\"assistant_message\",\"content\":\"done\",\"role\":\"assistant\"}'\n" +
			"echo '{\"type\":\"message_stop\",\"stop_reason\":\"end_turn\"}'\n"
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "mock-claude-tools")
	if runtime.GOOS == "windows" {
		path += ".bat"
	}
	if err := os.WriteFile(path, []byte(script), 0755); err != nil {
		t.Fatalf("failed to write mock script: %v", err)
	}
	return path
}

func writeMockClaudeEmptyScript(t *testing.T) string {
	t.Helper()
	var script string
	if runtime.GOOS == "windows" {
		script = "@echo off\r\n"
	} else {
		script = "#!/bin/sh\nexit 0\n"
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "mock-claude-empty")
	if runtime.GOOS == "windows" {
		path += ".bat"
	}
	if err := os.WriteFile(path, []byte(script), 0755); err != nil {
		t.Fatalf("failed to write mock script: %v", err)
	}
	return path
}

var _ = event.NewEventBus
```

**Run（验证通过 — 此 task 为纯测试扩展）：**
```bash
Run: go test ./internal/agent/ -run "TestExecute_WithToolUseFlow|TestExecute_EmptyOutput" -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/agent/claude_code_adapter_execute_test.go && git commit -m "test(agent): extend Execute tests with tool-use flow and empty output (Phase 3.3)"
```

## Phase 4: AgentEngine 多态工厂（PR5）

> **目标**：将 CreateAgentEngine 改为多态工厂，根据 config.Engine 路由到 native 或 claude_code 引擎。向后兼容（空 = native）。

### Task 4.1: CreateAgentEngine 多态路由

**Files:**
- Modify: `internal/application/service/agent_service.go`

**说明：** 在 `CreateAgentEngine` 方法中（L186 附近，`engine := agent.NewAgentEngine(...)` 之前）新增路由逻辑。从 `s.cfg.Agent.Engine`（全局配置）读取 engine 偏好。空 / "native" → 现有 native 逻辑；"claude_code" → `createClaudeCodeEngine` 薄包装。

**RED — 写失败测试：**

```go
package service

import (
	"context"
	"testing"

	"github.com/Tencent/WeKnora/internal/agent"
	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
)

// TestCreateAgentEngine_NativeDefault 验证 Engine 为空时返回 native 引擎（CC-011）。
func TestCreateAgentEngine_NativeDefault(t *testing.T) {
	svc := &agentService{
		cfg: &config.Config{
			Agent: &config.AgentConfig{Engine: ""},
		},
	}
	engine, err := svc.createClaudeCodeEngineIfRequested(context.Background(), "", &types.AgentConfig{}, nil, "sess", "msg")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if engine != nil {
		t.Fatalf("expected nil (fall through to native) when engine is empty, got %T", engine)
	}
}

// TestCreateAgentEngine_ClaudeCode 验证 Engine=claude_code 返回 ClaudeCodeAdapter（CC-012）。
func TestCreateAgentEngine_ClaudeCode(t *testing.T) {
	svc := &agentService{
		cfg: &config.Config{
			Agent: &config.AgentConfig{Engine: "claude_code"},
		},
	}
	engine, err := svc.createClaudeCodeEngineIfRequested(context.Background(), "claude_code", &types.AgentConfig{}, nil, "sess", "msg")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if engine == nil {
		t.Fatal("expected non-nil ClaudeCodeAdapter")
	}
	switch engine.(type) {
	case *agent.ClaudeCodeAdapter:
		// pass
	default:
		t.Fatalf("expected *agent.ClaudeCodeAdapter, got %T", engine)
	}
}
```

> **测试说明：** `createClaudeCodeEngineIfRequested` 是路由辅助方法：当 engineType 为空/"native" 时返回 nil（表示走 native 路径），当为 "claude_code" 时返回 `*agent.ClaudeCodeAdapter`。这样设计使路由逻辑可独立于 CreateAgentEngine 的完整依赖链测试。

**Run（验证失败）：**
```bash
Run: go test ./internal/application/service/ -run TestCreateAgentEngine -v
Expected: FAIL — 编译错误：undefined: createClaudeCodeEngineIfRequested
```

**GREEN — 实现代码：**

修改 `internal/application/service/agent_service.go`，在 `CreateAgentEngine` 的 L186 之前新增路由，并新增 `createClaudeCodeEngineIfRequested` + `createClaudeCodeEngine` 方法：

```go
import (
	"time"
	// ... existing imports ...
	"github.com/Tencent/WeKnora/internal/agent"
)

// CreateAgentEngine — 在现有方法中 L186 之前插入：
//
//	// === Engine routing (Phase 4) ===
//	engineType := ""
//	if s.cfg != nil && s.cfg.Agent != nil {
//		engineType = s.cfg.Agent.Engine
//	}
//	if ccEngine, err := s.createClaudeCodeEngineIfRequested(ctx, engineType, config, eventBus, sessionID, assistantMessageID); err != nil {
//		return nil, err
//	} else if ccEngine != nil {
//		return ccEngine, nil
//	}
//	// --- fall through to native engine (existing code) ---

// createClaudeCodeEngineIfRequested returns a ClaudeCodeAdapter when engineType
// is "claude_code", or nil when engineType is empty/"native" (caller proceeds
// with native engine). Returns an error for unknown engine types.
func (s *agentService) createClaudeCodeEngineIfRequested(
	ctx context.Context,
	engineType string,
	cfg *types.AgentConfig,
	eventBus *event.EventBus,
	sessionID, assistantMessageID string,
) (interfaces.AgentEngine, error) {
	switch engineType {
	case "", "native":
		return nil, nil // fall through to native
	case "claude_code":
		return s.createClaudeCodeEngine(ctx, cfg, eventBus, sessionID, assistantMessageID)
	default:
		logger.Warnf(ctx, "Unknown agent engine %q, falling back to native", engineType)
		return nil, nil
	}
}

// createClaudeCodeEngine constructs a ClaudeCodeAdapter with default config
// derived from the global AgentConfig and the runtime AgentConfig.
func (s *agentService) createClaudeCodeEngine(
	ctx context.Context,
	cfg *types.AgentConfig,
	eventBus *event.EventBus,
	sessionID, assistantMessageID string,
) (interfaces.AgentEngine, error) {
	ccCfg := agent.DefaultClaudeCodeConfig()

	// Override system prompt if the runtime config has one
	if cfg.SystemPrompt != "" {
		ccCfg.SystemPrompt = cfg.ResolveSystemPrompt(cfg.WebSearchEnabled)
	}

	// Override max turns from runtime config if set
	if cfg.MaxIterations > 0 {
		ccCfg.MaxTurns = cfg.MaxIterations
	}

	// Override timeout from runtime config if set
	if cfg.LLMCallTimeout > 0 {
		ccCfg.Timeout = time.Duration(cfg.LLMCallTimeout) * time.Second
	}

	adapter := agent.NewClaudeCodeAdapter(ccCfg, eventBus, sessionID, assistantMessageID)
	logger.Infof(ctx, "Created ClaudeCodeAdapter (model=%s, maxTurns=%d)", ccCfg.Model, ccCfg.MaxTurns)
	return adapter, nil
}
```

> **实际集成步骤：** 在 `CreateAgentEngine` 方法中，将上述路由代码块插入到验证之后、tool registry 构建之前。native 引擎的创建代码保持不变。MCPConfigPath 和 APIKey 暂不从 types.AgentConfig 映射（未来通过全局配置或环境变量注入）。

**Run（验证通过）：**
```bash
Run: go test ./internal/application/service/ -run TestCreateAgentEngine -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/application/service/agent_service.go internal/application/service/agent_service_engine_test.go && git commit -m "feat(service): add CreateAgentEngine polymorphic routing (Phase 4.1, CC-011/012)"
```

---

### Task 4.2: 向后兼容验证

**Files:**
- Test: `internal/application/service/agent_service_compat_test.go`

**说明：** 验证 Engine 为空时走 native，行为与改造前完全一致。所有现有测试无回归。

**RED — 写失败测试：**

```go
package service

import (
	"testing"

	"github.com/Tencent/WeKnora/internal/config"
)

// TestBackwardCompat_EmptyEngineReturnsNil 验证 Engine 为空时路由返回 nil（走 native）（CC-014）。
func TestBackwardCompat_EmptyEngineReturnsNil(t *testing.T) {
	svc := &agentService{
		cfg: &config.Config{
			Agent: &config.AgentConfig{Engine: ""},
		},
	}
	engine, err := svc.createClaudeCodeEngineIfRequested(nil, "", nil, nil, "sess", "msg")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if engine != nil {
		t.Fatalf("expected nil (fall through to native), got %T", engine)
	}
}

// TestBackwardCompat_NativeExplicitReturnsNil 验证 Engine=native 显式走 native。
func TestBackwardCompat_NativeExplicitReturnsNil(t *testing.T) {
	svc := &agentService{
		cfg: &config.Config{
			Agent: &config.AgentConfig{Engine: "native"},
		},
	}
	engine, err := svc.createClaudeCodeEngineIfRequested(nil, "native", nil, nil, "sess", "msg")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if engine != nil {
		t.Fatalf("expected nil (fall through to native), got %T", engine)
	}
}

// TestBackwardCompat_UnknownEngineFallsBack 验证未知 Engine 值回退到 native。
func TestBackwardCompat_UnknownEngineFallsBack(t *testing.T) {
	svc := &agentService{
		cfg: &config.Config{
			Agent: &config.AgentConfig{Engine: "unknown_engine"},
		},
	}
	engine, err := svc.createClaudeCodeEngineIfRequested(nil, "unknown_engine", nil, nil, "sess", "msg")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if engine != nil {
		t.Fatalf("expected nil (fall through to native for unknown engine), got %T", engine)
	}
}
```

**Run（验证通过 — 依赖 Task 4.1 已实现）：**
```bash
Run: go test ./internal/application/service/ -run TestBackwardCompat -v
Expected: PASS
```

**全量回归测试：**
```bash
Run: go test ./internal/agent/... ./internal/application/service/... ./internal/config/... ./internal/types/...
Expected: PASS — 所有现有测试无回归
```

**Commit：**
```bash
Run: git add internal/application/service/agent_service_compat_test.go && git commit -m "test(service): verify backward compatibility for engine routing (Phase 4.2, CC-014)"
```

## Phase 5: 集成测试（PR6）

> **目标**：端到端集成测试，验证从配置到 Execute 的完整流程；向后兼容回归测试。

### Task 5.1: Claude Code 端到端集成测试

**Files:**
- Test: `internal/application/service/agent_service_e2e_test.go`

**说明：** 模拟完整流程：配置 Engine=claude_code → CreateAgentEngine 路由 → createClaudeCodeEngine → 验证返回 ClaudeCodeAdapter 实例。由于 CreateAgentEngine 需要大量依赖（modelService、knowledgeBaseService 等），此测试聚焦于路由层，验证配置正确传递到 adapter。Execute 的完整验证在 Phase 3 的 mock 子进程测试中已覆盖。

**RED — 写失败测试：**

```go
package service

import (
	"context"
	"testing"

	"github.com/Tencent/WeKnora/internal/agent"
	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/event"
	"github.com/Tencent/WeKnora/internal/types"
)

// TestE2E_ClaudeCode_ConfigToAdapter 验证从全局配置到 ClaudeCodeAdapter 的完整路由。
func TestE2E_ClaudeCode_ConfigToAdapter(t *testing.T) {
	// 构造全局配置：Engine=claude_code
	cfg := &config.Config{
		Agent: &config.AgentConfig{
			Engine:         "claude_code",
			LLMCallTimeout: 30,
		},
	}

	// 构造运行时 AgentConfig
	agentCfg := &types.AgentConfig{
		MaxIterations: 5,
		SystemPrompt: "You are a helpful assistant.",
	}

	// 创建 EventBus
	bus := event.NewEventBus()

	// 创建 service（最小依赖）
	svc := &agentService{
		cfg:      cfg,
		eventBus: bus,
	}

	// 通过路由方法获取引擎
	engine, err := svc.createClaudeCodeEngineIfRequested(
		context.Background(),
		"claude_code",
		agentCfg,
		bus,
		"sess-e2e",
		"msg-e2e",
	)
	if err != nil {
		t.Fatalf("createClaudeCodeEngineIfRequested error: %v", err)
	}
	if engine == nil {
		t.Fatal("expected non-nil engine")
	}

	// 验证返回的是 ClaudeCodeAdapter
	adapter, ok := engine.(*agent.ClaudeCodeAdapter)
	if !ok {
		t.Fatalf("expected *agent.ClaudeCodeAdapter, got %T", engine)
	}

	// 验证配置正确传递
	if adapter.sessionID != "sess-e2e" {
		t.Fatalf("sessionID: expected %q, got %q", "sess-e2e", adapter.sessionID)
	}
	if adapter.messageID != "msg-e2e" {
		t.Fatalf("messageID: expected %q, got %q", "msg-e2e", adapter.messageID)
	}
	// 验证 MaxTurns 从 AgentConfig.MaxIterations 映射
	if adapter.config.MaxTurns != 5 {
		t.Fatalf("MaxTurns: expected 5, got %d", adapter.config.MaxTurns)
	}
	// 验证 SystemPrompt 从 AgentConfig 映射
	if adapter.config.SystemPrompt != "You are a helpful assistant." {
		t.Fatalf("SystemPrompt: expected %q, got %q", "You are a helpful assistant.", adapter.config.SystemPrompt)
	}
}

// TestE2E_Native_ConfigToEngine 验证从全局配置到 native 引擎的完整路由（空 engine）。
func TestE2E_Native_ConfigToEngine(t *testing.T) {
	cfg := &config.Config{
		Agent: &config.AgentConfig{
			Engine: "",
		},
	}

	svc := &agentService{
		cfg: cfg,
	}

	engine, err := svc.createClaudeCodeEngineIfRequested(
		context.Background(),
		"",
		&types.AgentConfig{},
		nil,
		"sess-native",
		"msg-native",
	)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	// 空 engine → 返回 nil（表示走 native 路径）
	if engine != nil {
		t.Fatalf("expected nil for native fall-through, got %T", engine)
	}
}

// TestE2E_ClaudeCode_EventBusWired 验证 adapter 的 eventBus 正确连接。
func TestE2E_ClaudeCode_EventBusWired(t *testing.T) {
	cfg := &config.Config{
		Agent: &config.AgentConfig{Engine: "claude_code"},
	}
	bus := event.NewEventBus()
	svc := &agentService{cfg: cfg, eventBus: bus}

	engine, err := svc.createClaudeCodeEngineIfRequested(
		context.Background(),
		"claude_code",
		&types.AgentConfig{},
		bus,
		"sess-bus",
		"msg-bus",
	)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if engine == nil {
		t.Fatal("expected non-nil engine")
	}
	adapter, ok := engine.(*agent.ClaudeCodeAdapter)
	if !ok {
		t.Fatalf("expected *agent.ClaudeCodeAdapter, got %T", engine)
	}
	if adapter.eventBus == nil {
		t.Fatal("expected non-nil eventBus on adapter")
	}
}
```

**Run（验证通过 — 依赖 Phase 4 已实现）：**
```bash
Run: go test ./internal/application/service/ -run TestE2E_ -v
Expected: PASS
```

**Commit：**
```bash
Run: git add internal/application/service/agent_service_e2e_test.go && git commit -m "test(service): add E2E integration tests for claude_code engine routing (Phase 5.1)"
```

---

### Task 5.2: 向后兼容集成测试

**Files:**
- Test: `internal/application/service/agent_service_regression_test.go`

**说明：** 验证 Engine=native 时与改造前行为一致。所有现有测试无回归。此 task 运行全量测试套件确认无回归。

**RED — 写失败测试：**

```go
package service

import (
	"testing"

	"github.com/Tencent/WeKnora/internal/config"
)

// TestRegression_NativeEngineUnchanged 验证 native 路径未被改造破坏。
// 当 Engine 为空或 "native" 时，createClaudeCodeEngineIfRequested 返回 nil，
// 使 CreateAgentEngine 继续走原有的 agent.NewAgentEngine 路径。
func TestRegression_NativeEngineUnchanged(t *testing.T) {
	cases := []string{"", "native"}
	for _, engine := range cases {
		t.Run("engine="+engine, func(t *testing.T) {
			svc := &agentService{
				cfg: &config.Config{
					Agent: &config.AgentConfig{Engine: engine},
				},
			}
			result, err := svc.createClaudeCodeEngineIfRequested(
				nil, engine, nil, nil, "sess", "msg",
			)
			if err != nil {
				t.Fatalf("error: %v", err)
			}
			if result != nil {
				t.Fatalf("engine=%q: expected nil (native fall-through), got %T", engine, result)
			}
		})
	}
}

// TestRegression_UnknownEngineFallsBack 验证未知 engine 值安全回退到 native。
func TestRegression_UnknownEngineFallsBack(t *testing.T) {
	svc := &agentService{
		cfg: &config.Config{
			Agent: &config.AgentConfig{Engine: "future_engine_v2"},
		},
	}
	result, err := svc.createClaudeCodeEngineIfRequested(
		nil, "future_engine_v2", nil, nil, "sess", "msg",
	)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if result != nil {
		t.Fatalf("expected nil for unknown engine, got %T", result)
	}
}
```

**Run（验证通过）：**
```bash
Run: go test ./internal/application/service/ -run TestRegression_ -v
Expected: PASS
```

**全量回归测试：**
```bash
Run: go test ./...
Expected: PASS — 所有现有测试无回归
```

**Commit：**
```bash
Run: git add internal/application/service/agent_service_regression_test.go && git commit -m "test(service): add regression tests for native engine backward compatibility (Phase 5.2)"
```

---

## 完成检查清单

| Phase | Task | 测试 ID | 状态 |
|---|---|---|---|
| 0 | 0.1 AgentEngine 接口基线 | — | ☐ |
| 0 | 0.2 AgentConfig.Engine 字段 | — | ☐ |
| 1 | 1.1 ClaudeCodeConfig 结构体 | CC-001 | ☐ |
| 1 | 1.2 buildCommand 方法 | CC-002/003/004 | ☐ |
| 1 | 1.3 CustomAgentConfig.Engine 字段 | — | ☐ |
| 2 | 2.1 claudeCodeEvent + parse | CC-005/006/007/008 | ☐ |
| 2 | 2.2 emitEvent 方法 | CC-009 | ☐ |
| 2 | 2.3 updateState 方法 | CC-010 | ☐ |
| 2 | 2.4 流式转换集成测试 | — | ☐ |
| 3 | 3.1 NewClaudeCodeAdapter 构造函数 | — | ☐ |
| 3 | 3.2 Execute 方法实现 | CC-013 | ☐ |
| 3 | 3.3 Execute 测试扩展 | — | ☐ |
| 4 | 4.1 CreateAgentEngine 多态路由 | CC-011/012 | ☐ |
| 4 | 4.2 向后兼容验证 | CC-014 | ☐ |
| 5 | 5.1 Claude Code E2E 集成测试 | — | ☐ |
| 5 | 5.2 向后兼容集成测试 | — | ☐ |

> **总计**：16 个 task，14 个测试用例（CC-001 ~ CC-014），6 个 PR。
