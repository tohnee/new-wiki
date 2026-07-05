# AgentEngine 多态架构 + Claude Code SDK adapter 设计文档（阶段 2）

> **状态**：设计已确认，待生成 TDD 实施计划
> **子项目**：ReAct SDK 三模式接入 - 阶段 2（共 3 阶段）
> **前置阶段**：阶段 1（Anthropic providerAdapter 融入）已完成
> **后续阶段**：阶段 3 OpenCode SDK adapter
> **设计日期**：2026-07-05

---

## 1. 背景与目标

### 1.1 问题陈述

AgentEngine 接口只有单一实现（native ReAct）。架构文档 §4.6.2 提到 `agent.engine: native|claude_code|opencode` 配置项，但代码中不存在。

### 1.2 目标

1. 新增 agent.engine 配置项
2. 新增 AgentEngine 多态工厂
3. 新增 ClaudeCodeAdapter 实现 AgentEngine 接口
4. 通过子进程调用 Claude Code CLI
5. stream-json 事件流转换为 AgentStreamEvent

### 1.3 非目标

- 不接入 OpenCode SDK（阶段 3）
- 不修改 native ReAct 引擎
- 不修改 MCP server（已有，复用）

---

## 2. 整体架构

### 2.1 改动范围

| 文件 | 类型 | 责任 |
|---|---|---|
| `internal/config/config.go` | 修改 | AgentConfig 新增 Engine 字段 |
| `internal/types/custom_agent.go` | 修改 | CustomAgentConfig 新增 Engine 字段 |
| `internal/application/service/agent_service.go` | 修改 | CreateAgentEngine 多态路由 |
| `internal/agent/claude_code_adapter.go` | 新增 | ClaudeCodeAdapter 实现 |
| `internal/agent/claude_code_stream.go` | 新增 | stream-json 解析 + 事件转换 |
| `internal/agent/claude_code_config.go` | 新增 | ClaudeCodeConfig 配置 |

### 2.2 兼容性

- Engine 默认 native，向后兼容
- AgentEngine 接口不改
- MCP server 不改

---

## 3. ClaudeCodeAdapter 实现

### 3.1 ClaudeCodeConfig

```go
type ClaudeCodeConfig struct {
    BinaryPath    string        // 默认 "claude"
    APIKey        string
    Model         string        // 默认 "claude-sonnet-4-5"
    MaxTurns      int           // 默认 10
    Timeout       time.Duration // 默认 5 分钟
    MCPConfigPath string
    SystemPrompt  string
    WorkingDir    string
}
```

### 3.2 Execute 流程

1. buildCommand 构造 `claude -p "query" --output-format stream-json`
2. exec.CommandContext 启动子进程
3. bufio.Scanner 读取 stdout（每行一个 JSON）
4. parseClaudeCodeStreamEvent 解析事件
5. emitEvent 转换为 EventBus 事件
6. updateState 累积 AgentState
7. 返回 AgentState

### 3.3 stream-json 事件类型映射

| Claude Code 事件 | WeKnora EventBus 事件 |
|---|---|
| `assistant_message` | `EventAgentThinking` |
| `tool_use` | `EventAgentToolCall` |
| `tool_result` | `EventAgentToolResult` |
| `message_stop` | `EventAgentFinalAnswer` |

---

## 4. TDD 测试策略

### 4.1 测试用例（14 个）

| ID | 测试名 | 验证点 |
|---|---|---|
| CC-001 | TestClaudeCodeConfig_Defaults | 默认值 |
| CC-002 | TestBuildCommand_BasicArgs | CLI 参数 |
| CC-003 | TestBuildCommand_WithSystemPrompt | system-prompt |
| CC-004 | TestBuildCommand_WithMCPConfig | mcp-config |
| CC-005 | TestParseStreamEvent_AssistantMessage | 解析 assistant_message |
| CC-006 | TestParseStreamEvent_ToolUse | 解析 tool_use |
| CC-007 | TestParseStreamEvent_ToolResult | 解析 tool_result |
| CC-008 | TestParseStreamEvent_MessageStop | 解析 message_stop |
| CC-009 | TestAdapter_EmitEvents | 事件发射 |
| CC-010 | TestAdapter_UpdateState | 状态累积 |
| CC-011 | TestCreateAgentEngine_NativeDefault | 默认 native |
| CC-012 | TestCreateAgentEngine_ClaudeCode | Engine=claude_code |
| CC-013 | TestAdapter_Execute_MockProcess | 集成测试 |
| CC-014 | TestAdapter_BackwardCompat | 向后兼容 |

### 4.2 Phase 划分 + PR 拆分

| Phase | 主题 | Task 数 | PR |
|---|---|---|---|
| Phase 0 | Baseline + Config | 2 | PR1 |
| Phase 1 | ClaudeCodeConfig + buildCommand | 3 | PR2 |
| Phase 2 | stream-json 解析 + 事件转换 | 4 | PR3 |
| Phase 3 | ClaudeCodeAdapter 实现 | 3 | PR4 |
| Phase 4 | AgentEngine 多态工厂 | 2 | PR5 |
| Phase 5 | 集成测试 | 2 | PR6 |
