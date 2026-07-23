# Weknora Agent Harness 与 Skills 系统研究报告

## 摘要

本报告深入分析了 Weknora 项目的 Agent Harness（智能体执行框架）与 Skills（技能）系统的架构设计、核心实现和技术亮点。Weknora 是一个基于 Go 语言构建的企业级知识库问答系统，其 Agent 层采用了 ReAct（Reasoning + Acting）范式实现，而 Skills 系统则遵循 Progressive Disclosure（渐进式披露）设计理念，通过三级加载机制和沙箱执行环境，为智能体提供了安全、可扩展的能力扩展方式。

---

## 1. 项目概述

Weknora 是腾讯开源的企业级 RAG（Retrieval-Augmented Generation）知识库系统，支持文档解析、向量检索、知识图谱、Web 搜索、MCP 服务集成等多种能力。项目采用 Go 作为主要后端语言，前端使用 Vue 3 构建，整体架构包含：

- **Agent 层**：基于 ReAct 循环的智能推理与执行引擎
- **Skills 系统**：渐进式披露的技能扩展框架
- **Sandbox 层**：安全的脚本隔离执行环境
- **工具注册表**：统一的工具注册、验证与执行机制
- **事件总线**：流式输出与状态同步的事件驱动架构

---

## 2. Agent Harness 架构分析

### 2.1 核心设计理念

Agent Harness 实现了经典的 **ReAct（Reasoning + Acting）** 框架，将智能体的执行过程分解为四个阶段：

| 阶段 | 职责 | 核心文件 |
|------|------|----------|
| **Think（思考）** | 调用 LLM 进行推理，生成思考内容或工具调用 | [think.go](file:///workspace/internal/agent/think.go) |
| **Analyze（分析）** | 判断是否达到终止条件，处理空内容重试 | [engine.go](file:///workspace/internal/agent/engine.go#L598-L627) |
| **Act（行动）** | 执行工具调用（支持并行执行） | [act.go](file:///workspace/internal/agent/act.go) |
| **Observe（观察）** | 收集工具结果，追加到上下文 | [observe.go](file:///workspace/internal/agent/observe.go) |

### 2.2 核心数据结构

Agent Harness 的核心是 `AgentEngine` 结构体，定义在 [engine.go](file:///workspace/internal/agent/engine.go#L34-L52)：

```go
type AgentEngine struct {
    config               *types.AgentConfig          // 智能体配置
    toolRegistry         *agenttools.ToolRegistry    // 工具注册表
    chatModel            chat.Chat                   // LLM 聊天模型接口
    eventBus             *event.EventBus             // 事件总线（流式输出）
    knowledgeBasesInfo   []*KnowledgeBaseInfo        // 知识库信息
    selectedDocs         []*SelectedDocumentInfo     // 用户 @ 提及的文档
    pinnedMCPServices    []*PinnedMCPServiceInfo     // 用户 @ 提及的 MCP 服务
    pinnedSkills         []*PinnedSkillInfo          // 用户 @ 提及的技能
    skillsManager        *skills.Manager             // Skills 管理器
    tokenEstimator       *agenttoken.Estimator       // Token 估算器
    memoryConsolidator   *agentmemory.Consolidator   // 记忆整合器（上下文压缩）
    // ... 其他字段
}
```

**关键设计特点**：
- **无状态设计**：引擎本身不维护跨轮次状态，对话历史由调用方从数据库重建后传入
- **依赖注入**：LLM 模型、工具注册表、事件总线等通过构造函数注入，便于测试和扩展
- **可选组件**：Skills Manager、图片描述器、记忆整合器等均为可选组件，通过 Setter 方法注入

### 2.3 执行循环详解

主执行循环位于 [executeLoop](file:///workspace/internal/agent/engine.go#L344-L426) 方法，其执行流程如下：

```
┌─────────────────────────────────────────────────────────────┐
│                     executeLoop                              │
├─────────────────────────────────────────────────────────────┤
│  初始化状态 → 进入循环                                        │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 检查上下文取消（用户停止/超时）                          │  │
│  │   └─ 如有工具结果，尝试合成最终回答                      │  │
│  └───────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ runReActIteration（单次 ReAct 迭代）                    │  │
│  │  ├─ 上下文窗口管理（Token 估算与压缩）                  │  │
│  │  ├─ Think：调用 LLM（含重试机制）                       │  │
│  │  ├─ 检测死循环（相同内容重复返回）                       │  │
│  │  ├─ Analyze：判断是否自然停止                           │  │
│  │  │   ├─ 是 → 检查空内容 → 重试或返回最终答案             │  │
│  │  │   └─ 否 → 继续执行工具                               │  │
│  │  ├─ Act：执行工具调用（串行/并行）                       │  │
│  │  └─ Observe：追加工具结果到消息列表                      │  │
│  └───────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  达到最大迭代次数？ → 是 → 尝试生成兜底回答                   │
│                    └─ 否 → 继续下一轮                        │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 流式输出与事件系统

Agent 通过 `EventBus` 实现细粒度的流式事件推送，支持前端实时展示思考过程、工具调用状态和最终回答。主要事件类型包括：

| 事件类型 | 用途 |
|----------|------|
| `EventAgentThought` | 思考过程流式输出（支持 reasoning_content） |
| `EventAgentToolCall` | 工具调用开始（显示工具名称和提示） |
| `EventAgentToolResult` | 工具执行结果返回 |
| `EventAgentFinalAnswer` | 最终回答流式输出 |
| `EventAgentComplete` | 执行完成（持久化步骤记录） |

流式输出的核心实现在 [streamThinkingToEventBus](file:///workspace/internal/agent/think.go#L114-L325)，它巧妙地处理了：
- **思考内容与回答分离**：支持 DeepSeek 等模型的 `reasoning_content` 通道
- **内联 `<think>` 标签解析**：对于不支持独立 reasoning 通道的模型，通过 `ThinkStreamSplitter` 分离思考内容
- **工具调用预通知**：在工具参数尚未完整接收时就通知 UI 显示工具调用状态
- **回答撤回机制**：如果本回合最终调用了工具，之前流式输出的"预回答"会被标记为思考前言而非最终答案

### 2.5 上下文窗口管理

为避免 Token 超限，Agent 实现了多层上下文管理策略：

1. **增量 Token 估算**：[estimateCurrentTokens](file:///workspace/internal/agent/engine.go#L178-L184) 利用上一轮 API 返回的 usage 作为基准，仅估算新增消息的 Token 数，提高效率
2. **记忆整合**：当配置了 `MaxContextTokens` 时，启用 `memoryConsolidator`，使用 LLM 对历史消息进行摘要压缩
3. **工具输出截断**：工具输出在注册表层面被截断（默认 16KB），防止污染上下文窗口
4. **消息清理**：发送前通过 `SanitizeMessages` 修复连续角色、孤立工具结果等格式问题

### 2.6 错误处理与容错机制

Agent Harness 具备完善的容错能力：

- **LLM  transient 错误重试**：对超时、限流、服务器错误等进行最多 3 次指数退避重试
- **优雅降级**：当 LLM 彻底失败但已有工具结果时，尝试用单独的 LLM 调用从已有结果合成最终答案
- **空内容重试**：当 LLM 自然停止但内容为空时，追加提示消息并重试（最多 3 次）
- **死循环检测**：连续 3 轮返回相同内容且无工具调用时，强制终止并将当前内容作为最终答案
- **用户取消处理**：上下文取消时，保留已有的部分思考步骤供用户查看

### 2.7 可观测性

深度集成 **Langfuse** 进行链路追踪，层级结构为：

```
trace (HTTP 请求)
 └─ agent.execute（智能体执行）
     ├─ agent.round.1（第 1 轮）
     │   ├─ chat（LLM 调用）
     │   └─ agent.tool.knowledge_search（工具调用）
     │       └─ embed / rerank（嵌套调用）
     ├─ agent.round.2
     │   └─ ...
     └─ agent.round.N
```

---

## 3. 工具注册表（Tool Registry）

### 3.1 设计目标

工具注册表是 Agent 与外部能力交互的统一入口，负责工具的注册、查找、参数验证、执行和清理。核心实现在 [registry.go](file:///workspace/internal/agent/tools/registry.go)。

### 3.2 安全机制

注册表实现了多层安全防护：

1. **First-Wins 注册策略**：重复注册同名工具时保留第一个，防止通过名称劫持工具执行（GHSA-67q9-58vj-32qx 安全修复）
2. **参数类型自动转换**：[CastParams](file:///workspace/internal/agent/tools/param_cast.go) 处理 LLM 常见的类型错误（如字符串 "true" → 布尔值 true）
3. **JSON Schema 验证**：执行前根据工具定义的参数 Schema 进行严格验证，避免无效执行
4. **输出截断**：通过 `TruncateToolOutput` 限制单个工具输出大小，防止上下文窗口溢出
5. **资源清理**：执行结束后调用所有实现了 `Cleanable` 接口的工具的 Cleanup 方法

### 3.3 内置工具

系统内置了丰富的工具集，涵盖：

| 工具类别 | 代表工具 |
|----------|----------|
| **元认知工具** | `thinking`（深度思考）、`todo_write`（制定计划）、`sequentialthinking`（顺序思考） |
| **知识检索** | `knowledge_search`、`grep_chunks`、`list_knowledge_chunks`、`query_knowledge_graph` |
| **数据处理** | `database_query`、`data_analysis`、`data_schema` |
| **网络能力** | `web_search`、`web_fetch` |
| **文档操作** | `get_document_info`、FAQ 片段工具 |
| **Wiki 编辑** | `wiki_read_page`、`wiki_write_page`、`wiki_replace_text` 等 |
| **Skills 交互** | `read_skill`、`execute_skill_script` |
| **MCP 集成** | 动态注册的 MCP 服务工具 |

---

## 4. Skills 系统深度分析

### 4.1 设计理念：Progressive Disclosure

Skills 系统借鉴了 Anthropic Claude 的技能设计理念，采用**三级渐进式披露**机制，在 Token 效率和能力可用性之间取得平衡：

```
┌─────────────────────────────────────────────────────────────────┐
│ Level 1: 元数据（Metadata）                                     │
│ • 始终注入 System Prompt                                        │
│ • 约 100 tokens/skill                                           │
│ • 内容：名称 + 简短描述                                          │
│ • 时机：系统启动时一次性加载并缓存                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓ LLM 判断需要使用某个技能时
┌─────────────────────────────────────────────────────────────────┐
│ Level 2: 指令（Instructions）                                   │
│ • 通过 read_skill 工具按需加载                                   │
│ • SKILL.md 的 Markdown 主体内容                                  │
│ • 内容：详细使用说明、代码示例、工作流程                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓ 需要具体资源文件时
┌─────────────────────────────────────────────────────────────────┐
│ Level 3: 资源（Resources）                                      │
│ • 通过 read_skill 加载指定文件                                   │
│ • 通过 execute_skill_script 执行脚本                            │
│ • 内容：参考文档、配置模板、Python/Shell 脚本                    │
└─────────────────────────────────────────────────────────────────┘
```

**设计优势**：
- **Token 高效**：默认仅加载轻量元数据，避免无关技能占用上下文
- **按需加载**：只有当 LLM 判断匹配用户请求时才加载详细指令
- **可扩展**：新技能只需添加目录和 SKILL.md 文件，无需修改代码

### 4.2 目录结构与 SKILL.md 格式

每个 Skill 是一个独立目录，遵循约定优于配置的原则：

```
my-skill/
├── SKILL.md              # 必需：主文件（YAML frontmatter + Markdown 指令）
├── REFERENCE.md          # 可选：补充参考文档
├── templates/            # 可选：配置模板
│   └── config.yaml
└── scripts/              # 可选：可执行脚本
    ├── analyze.py
    └── process.sh
```

SKILL.md 必须以 YAML frontmatter 开头：

```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files. Use when working with PDF files.
---

# PDF Processing

这里是详细的使用说明、代码示例和工作流程...
```

元数据验证规则在 [skill.go](file:///workspace/internal/agent/skills/skill.go#L68-L100) 中定义：
- 名称：1-64 字符，仅允许字母、数字、连字符，不能包含保留词（anthropic、claude）
- 描述：1-1024 字符，说明技能用途和触发条件
- 不允许包含 XML 标签（防止注入）

### 4.3 核心组件

Skills 系统由三个核心组件协作完成：

#### 4.3.1 Loader（加载器）

[loader.go](file:///workspace/internal/agent/skills/loader.go) 负责文件系统层面的技能发现和加载：

- **DiscoverSkills**：扫描配置的多个目录，查找 SKILL.md 文件，解析元数据并缓存（Level 1）
- **LoadSkillInstructions**：加载完整的 SKILL.md 内容（Level 2），带缓存机制
- **LoadSkillFile**：加载技能目录下的任意文件（Level 3），包含路径遍历防护
- **安全检查**：使用 `filepath.Clean` 和 `filepath.Abs` 验证文件路径，防止通过 `../` 访问技能目录外的文件

关键安全代码：
```go
// 防止路径遍历
if strings.HasPrefix(cleanPath, "..") || filepath.IsAbs(cleanPath) {
    return nil, fmt.Errorf("invalid file path: %s", relativePath)
}
// 验证最终路径在技能目录内
if !strings.HasPrefix(absFilePath, absSkillPath) {
    return nil, fmt.Errorf("file path outside skill directory: %s", relativePath)
}
```

#### 4.3.2 Manager（管理器）

[manager.go](file:///workspace/internal/agent/skills/manager.go) 是 Skills 系统的对外门面，协调 Loader 和 Sandbox：

```go
type Manager struct {
    loader        *Loader
    sandboxMgr    sandbox.Manager
    skillDirs     []string
    allowedSkills []string  // 白名单过滤
    enabled       bool
    metadataCache []*SkillMetadata
    mu            sync.RWMutex
}
```

主要方法：
- `Initialize`：启动时发现所有技能，应用白名单过滤，缓存元数据
- `GetAllMetadata`：返回所有技能元数据（供 System Prompt 注入）
- `LoadSkill` / `ReadSkillFile`：加载 Level 2/3 内容，带权限检查
- `ExecuteScript`：在沙箱中执行技能脚本
- `Reload`：热重载技能（支持不重启更新技能）

#### 4.3.3 Agent 工具桥接

Skills 通过两个专用工具暴露给 Agent：

**read_skill 工具**（[skill_read.go](file:///workspace/internal/agent/tools/skill_read.go)）：
- 仅传 `skill_name` → 加载 SKILL.md 完整内容 + 文件列表
- 同时传 `file_path` → 加载指定文件内容
- 返回格式化的 Markdown 内容和结构化 Data

**execute_skill_script 工具**（[skill_execute.go](file:///workspace/internal/agent/tools/skill_execute.go)）：
- 参数：`skill_name`、`script_path`、`args`、`input`（stdin 数据）
- 在沙箱中执行脚本，返回结构化结果（stdout、stderr、退出码、耗时）
- 格式化输出方便 LLM 理解执行结果

### 4.4 预加载技能

系统内置 5 个预加载技能增强基础能力：

| 技能名称 | 用途 | 核心能力 |
|----------|------|----------|
| `citation-generator` | 引用生成 | APA/MLA/Chicago 格式引用、来源标注、参考文献列表 |
| `data-processor` | 数据处理 | 数据分析、格式转换（JSON/CSV/Markdown）、信息提取、报告生成 |
| `doc-coauthoring` | 文档协作 | 三阶段文档创作：上下文收集 → 细化结构 → 读者测试 |
| `document-analyzer` | 文档分析 | 结构分析、关键信息提取、文档类型识别、质量评估 |
| `summary-generator` | 摘要生成 | 内容摘要、要点提炼 |

---

## 5. Sandbox 沙箱执行环境

### 5.1 架构设计

沙箱系统为技能脚本提供隔离执行环境，支持三种运行模式：

| 模式 | 隔离强度 | 适用场景 |
|------|----------|----------|
| **Docker** | 最强 | 生产环境推荐 |
| **Local** | 基础 | 开发环境、可信脚本 |
| **Disabled** | 无 | 禁用脚本执行 |

核心接口定义在 [sandbox.go](file:///workspace/internal/sandbox/sandbox.go)：

```go
type Sandbox interface {
    Execute(ctx context.Context, config *ExecuteConfig) (*ExecuteResult, error)
    Cleanup(ctx context.Context) error
    Type() SandboxType
    IsAvailable(ctx context.Context) bool
}

type Manager interface {
    Execute(ctx context.Context, config *ExecuteConfig) (*ExecuteResult, error)
    Cleanup(ctx context.Context) error
    GetSandbox() Sandbox
    GetType() SandboxType
}
```

### 5.2 多层安全防护

#### 5.2.1 脚本验证器（ScriptValidator）

[validator.go](file:///workspace/internal/sandbox/validator.go) 在执行前进行多层静态安全检查：

**危险命令检测**：拦截系统破坏、权限提升、凭证窃取、容器逃逸类命令
- `rm -rf /`、`mkfs`、`dd if=/dev/zero`
- `shutdown`、`reboot`、`killall`
- `chmod 777 /`、`passwd`、访问 `/etc/shadow`
- 访问 `.ssh/`、`id_rsa` 等凭证文件
- `docker`、`kubectl`、`nsenter` 等容器逃逸工具
- Fork bombs：`:(){ :|:& };:`

**危险模式匹配**：检测代码注入、编码绕过等
- `curl | bash`、`wget | sh`（下载执行）
- `eval()`、`exec()`、`os.system()`、`subprocess.Popen(shell=True)`
- `base64 -d`、`xxd -r`（编码绕过）
- `__import__()`、`pickle.load()`、`yaml.unsafe_load()`（Python 特有风险）

**网络访问检测**：`curl`、`wget`、`socket.connect`、`requests.get` 等

**反向 Shell 检测**：`/dev/tcp/`、`bash -i`、`nc -e` 等

**参数注入检测**：Shell 操作符拦截
- 命令链接：`&&`、`||`、`;`、`|`
- 命令替换：`$()`、反引号
- 重定向：`>`、`>>`、`<`
- 换行注入：`\n`、`\r`

#### 5.2.2 Docker 沙箱隔离

Docker 模式提供最强的运行时隔离：

| 隔离维度 | 配置 |
|----------|------|
| **用户权限** | 非 root 用户（uid 1000）运行 |
| **Capabilities** | `--cap-drop ALL`（移除所有 Linux capabilities） |
| **文件系统** | 根文件系统只读（`--read-only`） |
| **内存限制** | 256MB |
| **CPU 限制** | 1 核 |
| **网络** | 默认无网络访问（`--network=none`） |
| **挂载** | Skill 目录只读挂载，不挂载宿主机其他目录 |
| **工作目录** | 限定在 Skill 目录 |
| **镜像** | 预装 Python 3.11、Node.js 20、常用工具的专用镜像 |

Docker 执行命令示例：
```bash
docker run --rm \
  --user 1000:1000 \
  --cap-drop ALL \
  --read-only \
  --memory=256m \
  --network=none \
  -v /path/to/skill:/skill:ro \
  -w /skill \
  wechatopenai/weknora-sandbox:latest \
  python scripts/analyze.py
```

#### 5.2.3 Local 沙箱保护

Local 模式在本地进程执行，但仍有基础保护：
- **命令白名单**：仅允许 `python`、`python3`、`node`、`bash`、`sh`、`ruby`、`go run` 及基础 Unix 工具（cat、grep、sed、awk 等）
- **工作目录限制**：限定在 Skill 目录内
- **环境变量过滤**：仅传递安全的环境变量
- **超时控制**：默认 60 秒超时
- **路径遍历防护**：防止访问 Skill 目录外文件
- **脚本预校验**：执行前经过 ScriptValidator 检查

### 5.3 执行配置与结果

ExecuteConfig 提供细粒度的执行控制：
- `Script`、`Args`、`WorkDir`：脚本路径、参数、工作目录
- `Timeout`：超时时间（默认 60 秒）
- `Env`：额外环境变量
- `AllowedCmds`：命令白名单
- `AllowNetwork`：是否允许网络（仅 Docker）
- `MemoryLimit`、`CPULimit`、`ReadOnlyRootfs`：资源限制
- `Stdin`：标准输入数据（支持通过 stdin 传递数据而非文件）
- `SkipValidation`：跳过安全验证（仅用于可信脚本）

ExecuteResult 返回完整执行信息：
- `Stdout`、`Stderr`：标准输出和错误
- `ExitCode`：退出码（0 = 成功）
- `Duration`：实际执行时长
- `Killed`：是否被杀死（超时等）
- `Error`：执行错误信息

---

## 6. System Prompt 构建与知识注入

### 6.1 渐进式 RAG Prompt

系统提示词采用结构化 XML 格式构建，支持多种上下文注入：

- **知识库信息**：[formatKnowledgeBaseList](file:///workspace/internal/agent/prompts.go#L129-L199) 将知识库列表格式化为 XML，包含 ID、名称、类型、文档数量、能力标签、最近文档摘要
- **Skills 元数据**：启用 Skills 时，将 Level 1 元数据注入 System Prompt
- ** pinned 资源**：用户 @ 提及的文档、MCP 服务、技能信息
- **工具定义**：通过 Function Calling 格式传递工具 Schema

### 6.2 工具定义排序

为支持 Prompt Caching（如 Qwen 的前缀缓存），工具定义按名称**字母序排序**，确保多次请求间工具列表字节级一致，提高缓存命中率。

---

## 7. 架构设计亮点

### 7.1 非侵入式扩展

Skills 系统完全不侵入原有 ReAct 流程：
- 不修改核心执行循环
- 通过两个标准工具与 Agent 交互
- Skills Manager 是可选组件，未配置时不影响 Agent 运行
- 新增技能无需重启（支持 Reload）

### 7.2 安全优先设计

安全贯穿整个技术栈：
- 工具注册表 First-Wins 防劫持
- 脚本多层静态校验（命令、模式、参数、stdin）
- Docker 强隔离（非 root、只读、无网络、cap-drop）
- 路径遍历防护（Loader + Sandbox 双层检查）
- 工具输出截断（防上下文污染）
- 参数类型转换 + Schema 验证（防 LLM 幻觉参数）

### 7.3 Token 效率优化

- 三级 Progressive Disclosure 最小化无关技能的 Token 占用
- 增量 Token 估算减少 BPE 计算开销
- 工具输出截断控制上下文增长
- 记忆整合（Memory Consolidation）支持长对话
- 工具列表排序支持 Prompt Caching

### 7.4 生产级可观测性

- Langfuse 完整链路追踪（trace → agent → round → tool → nested calls）
- EventBus 细粒度事件支持实时 UI 更新
- Pipeline 结构化日志（start/result/error 关键点）
- 执行时长、Token 用量、工具成功率等关键指标采集

### 7.5 鲁棒性设计

- Transient 错误重试 + 指数退避
- 优雅降级（LLM 失败时用已有工具结果合成答案）
- 死循环检测与自动终止
- 用户取消友好处理（保留部分结果）
- 空内容自动重试

---

## 8. 代码组织与模块划分

```
internal/
├── agent/                    # Agent Harness 核心
│   ├── engine.go             # AgentEngine 主循环
│   ├── think.go              # LLM 调用与流式输出
│   ├── act.go                # 工具执行（串行/并行）
│   ├── observe.go            # 结果观察与消息追加
│   ├── prompts.go            # System Prompt 构建
│   ├── finalize.go           # 最终回答生成
│   ├── skills/               # Skills 系统
│   │   ├── manager.go        # 管理器（对外门面）
│   │   ├── loader.go         # 文件系统加载器
│   │   └── skill.go          # 数据结构与解析
│   ├── tools/                # 工具实现
│   │   ├── registry.go       # 工具注册表
│   │   ├── skill_read.go     # read_skill 工具
│   │   ├── skill_execute.go  # execute_skill_script 工具
│   │   └── ...其他工具...
│   ├── memory/               # 记忆整合
│   ├── token/                # Token 估算与压缩
│   └── approval/             # 工具审批（MCP 人机确认）
├── sandbox/                  # 沙箱执行
│   ├── sandbox.go            # 接口定义
│   ├── docker.go             # Docker 沙箱实现
│   ├── local.go              # Local 沙箱实现
│   ├── manager.go            # 沙箱管理器（ fallback 逻辑）
│   └── validator.go          # 脚本安全校验
├── event/                    # 事件总线
├── types/                    # 公共类型定义
└── mcp/                      # MCP 客户端管理
```

---

## 9. 总结与启示

Weknora 的 Agent Harness 和 Skills 系统展现了企业级 AI Agent 框架的优秀设计实践：

1. **经典 ReAct + 工程增强**：在标准 ReAct 范式基础上，增加了流式输出、错误重试、上下文管理、死循环检测、可观测性等生产级特性
2. **渐进式披露的技能扩展**：通过三级加载机制优雅解决了"能力丰富度"与"Token 效率"的矛盾，是 Agent 能力扩展的优秀范式
3. **纵深防御的安全设计**：从注册表层、参数验证层、脚本校验层到运行时隔离层，形成了完整的安全防护链
4. **事件驱动的流式架构**：EventBus 实现了后端推理与前端展示的解耦，支持细粒度的实时反馈
5. **可观测性优先**：Langfuse 集成和结构化日志为生产环境的问题排查和性能优化提供了有力支撑

这种架构设计使得 Weknora 在保持核心推理引擎简洁的同时，具备了强大的扩展能力和生产环境所需的安全性、稳定性和可维护性。
