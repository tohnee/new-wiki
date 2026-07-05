# Wiki QA + Memory Layer 设计文档

> **状态**：设计已确认，待生成 TDD 实施计划
> **子项目**：方案 A 第 1 个子项目（共 3 个）
> **后续子项目**：ReAct SDK 三模式接入 → Notebook Studio 完整实现
> **设计日期**：2026-07-05
> **作者**：基于 brainstorming skill 协作设计

---

## 1. 背景与目标

### 1.1 问题陈述

WeKnora 当前 Wiki 子系统存在 5 个关键缺陷（已通过 4 路并行 search agent 代码核查确认）：

1. **Wiki chunk 写入侧未实现**（P0 严重缺陷）：`internal/types/chunk.go:39` 定义了 `ChunkTypeWikiPage` 常量，`wiki_boost.go` 加权逻辑就绪，`wiki_page.go:925-931` 实现了 `deleteChunkForPage`（删除侧），但**写入侧 `upsertChunkForPage` 在整个代码库中不存在**。`wiki_boost` 插件在实际运行中永远走 fast-path（`hasWikiChunk == false`），1.3x 加权从未生效。

2. **QAMode 枚举完全不存在**：`QAMode` / `qa_mode` 在 `.go` 文件中零匹配。`session_knowledge_qa.go:158-198` pipeline 装配是布尔驱动，无 QA mode 路由。

3. **`wiki-qa` 是 Agent 类型预设，不是 QA 执行路径**：`custom_agent.go:48` 定义 `AgentTypeWikiQA`，但仅影响工具白名单和提示词，实际仍走统一 chat pipeline。

4. **Wiki 与 Knowledge Graph 完全割裂**：Wiki 自身有 `WikiGraph*` 链接图（基于 InLinks/OutLinks），Neo4j 存储 Entity/Relationship，两者无任何数据交互。

5. **不存在 Memory Layer**：现有 wiki 文档（13 份）中 0 次出现 Memory Layer / Compact / Forget / TTL 概念。仅 `版本路线图.md:48` 提到"探索知识库与 Memory 结合"作为未落地规划。IM 集成的 `/clear` 指令是当前唯一"记忆操作"，仅清空当前对话，无分层/压缩/过期。

### 1.2 目标

参考 gist Memory Layer 的五阶段流程（Retrieve → Rank → Inject → Write → Compact），在 WeKnora 中实现：

1. **修复 P0 缺陷**：补齐 `upsertChunkForPage`，让 wiki_boost 真正生效
2. **新增 QAMode 枚举 + Pipeline 路由**：支持 RAG / Wiki / Hybrid 三种 QA 模式（Graph 仅留枚举，P1 实现）
3. **新增 MemoryLayer service**：封装 Write/Retrieve/Compact/Forget/Associate 五阶段
4. **不破坏现有代码**：保留 wikiIngestService 工业级 2-pass LLM 编译；保留 RAG pipeline；保留 wiki_boost 加权逻辑

### 1.3 非目标

- 不重写 wikiIngestService 的 2-pass LLM 编译链路
- 不实现 Cypher 图查询（QAModeGraph 仅留枚举，P1 实现）
- 不实现 Wiki-Graph 数据联动（P1 改进项）
- 不实现 Schema 层（P2 改进项）
- 不修改 Notebook Studio（子项目 3 范围）

### 1.4 兼容性决策（5 个修正点）

经反思 `docs/wiki/` 全部 13 份文档后确认：

| 修正点 | 详情 |
|---|---|
| **修正 1：IM 集成强制 RAG** | IM 渠道 QARequest 显式设置 `QAMode=QAModeRAG`，绕过自动推断 |
| **修正 2：数据源导入不触发 Write** | Memory Layer.Write() 不被数据源导入自动触发，仅由 KB WikiEnabled 入库流程或手动 API 触发 |
| **修正 3：API 挂 RBAC 守卫** | memory endpoint 挂 `OwnedKnowledgeBaseOrAdmin` 守卫 |
| **修正 4：复用 weknora_embeddings_* 表** | `upsertChunkForPage` 写入现有 `weknora_embeddings_*` 表，通过 `ChunkType=wiki_page` 区分 |
| **修正 5：API 路径风格对齐** | 路径符合 `/api/v1/knowledge_bases/:id/memory/*` 风格 |

### 1.5 上线策略

**直接上线，不使用 feature flag**。KB 启用 Wiki 的用户行为会改变（从 RAG fast-path 变成 QAModeWiki），需在升级文档中明确标注。

---

## 2. 整体架构

### 2.1 模块边界图

```
┌─────────────────────────────────────────────────────────────────┐
│  session_knowledge_qa.go (KnowledgeQA 主入口)                  │
│  └─ 根据 QAMode 装配不同 pipeline                              │
└─────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ RAG Pipeline  │   │ Wiki QA       │   │ Hybrid        │
│ (现有，保留)  │   │ Pipeline      │   │ Pipeline      │
│               │   │ (新增)        │   │ (新增)        │
└───────────────┘   └───────────────┘   └───────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  MemoryLayer Service (新增，独立 service)                       │
│  ├─ Write()      → 复用现有 wikiIngestService (2-pass LLM 编译)│
│  ├─ Retrieve()   → 纯 Wiki 检索（不查普通 chunk）              │
│  ├─ Compact()    → 新增：合并重复页面、降级冷数据              │
│  ├─ Forget()     → 新增：TTL 过期 + 冷数据归档                 │
│  └─ Associate()  → 复用 WikiGraph* (InLinks/OutLinks)         │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  wiki_page.go (补齐 P0 缺陷)                                    │
│  └─ 新增 upsertChunkForPage()：WikiPage → ChunkTypeWikiPage   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 设计原则

1. **不重写**：现有 `wikiIngestService` 的 2-pass LLM 编译保留，MemoryLayer.Write() 内部调用它
2. **不破坏**：现有 RAG pipeline 完全保留，QAMode 默认 `RAG`，向后兼容
3. **修复缺陷**：必须先补齐 `upsertChunkForPage`（写入侧），否则 wiki_boost 永远走 fast-path
4. **独立可测**：MemoryLayer service 接口清晰，可独立 TDD 单元测试

### 2.3 QAMode 路由规则

| QAMode | 装配的 pipeline | 适用场景 |
|---|---|---|
| `RAG`（默认） | 现有 RAG pipeline（向后兼容） | KB 无 Wiki 启用；IM 渠道强制 |
| `Wiki` | 新增 Wiki QA pipeline（纯 Wiki 检索） | 已编译好的 Wiki，快速问答 |
| `Hybrid` | 新增 Hybrid pipeline（RAG + Wiki + Graph） | 综合问答 |
| `Graph` | 现有 RAG（暂不实现独立 Graph pipeline） | 图谱遍历（P1，本次仅留枚举） |

### 2.4 QAMode 决策优先级

```
1. QARequest.QAMode      （调用方显式指定，最高优先级）
        ↓ 为空时
2. CustomAgent.QAMode    （自定义 Agent 预设，如 AgentTypeWikiQA 默认 QAModeWiki）
        ↓ 为空时
3. KB 自动推断           （根据 SearchTargets 中 KB 的 IndexingStrategy 推断）
   - 所有 KB 均 WikiEnabled       → QAModeWiki
   - 所有 KB 均未 WikiEnabled     → QAModeRAG
   - 混合（部分 Wiki 启用）        → QAModeHybrid
        ↓ 仍为空时
4. 默认 QAModeRAG
```

**特殊规则**：IM 渠道 QARequest 强制 `QAMode=QAModeRAG`，绕过上述推断（兼容性修正 1）。

---

## 3. 数据模型设计

### 3.1 新增 QAMode 枚举

新文件：`internal/types/qa_mode.go`

```go
package types

type QAMode string

const (
    QAModeRAG    QAMode = "rag"
    QAModeWiki   QAMode = "wiki"
    QAModeHybrid QAMode = "hybrid"
    QAModeGraph  QAMode = "graph"  // P1 reserved, falls back to RAG
)

func (m QAMode) IsValid() bool {
    switch m {
    case QAModeRAG, QAModeWiki, QAModeHybrid, QAModeGraph:
        return true
    }
    return false
}

func DefaultQAMode() QAMode { return QAModeRAG }
```

### 3.2 QARequest 修改

`internal/types/chat.go` 现有 `QARequest` 新增字段：

```go
type QARequest struct {
    // ... 现有字段保留 ...
    QAMode QAMode `json:"qa_mode,omitempty"`
}
```

### 3.3 WikiPage 字段补充（不新建表）

`internal/types/wiki_page.go` 现有 `WikiPage` 结构体新增 4 字段：

```go
type WikiPage struct {
    // ... 现有 22 字段保持不变 ...

    // Memory Layer metadata (新增 4 字段)
    LastAccessedAt time.Time  `json:"last_accessed_at" gorm:"index"`
    AccessCount    int        `json:"access_count" gorm:"default:0"`
    MemoryState    string     `json:"memory_state" gorm:"type:varchar(16);default:'hot'"`
    ExpiresAt      *time.Time `json:"expires_at,omitempty" gorm:"index"`
}
```

**MemoryState 状态机**：

```
            创建/写入                  30d 未访问           90d 未访问          180d 未访问
   [不存在] ─────────→ [hot] ──────────→ [warm] ──────────→ [cold] ──────────→ [archived]
                          ↑                                              │
                          └────── Retrieve 命中 ─────────────────────────┘
                                  (archived 也能被检索，自动升回 hot)
                                  (Forget 才会软删除 archived)
```

### 3.4 不新建表的理由

考虑过新建 `memory_records` 表（FK 到 wiki_pages），但放弃：
- 增加 1 张表 + 1 个 repo + 1 套 CRUD 测试
- Memory Layer 元数据与 WikiPage 是 1:1 关系，无独立查询需求
- WikiPage 加 4 个字段更简单，DB migration 只需 ALTER TABLE 加列
- TDD 测试更聚焦

### 3.5 复用 ChunkTypeWikiPage 常量

`internal/types/chunk.go:39` 的 `ChunkTypeWikiPage = "wiki_page"` 常量**复用，不改**。补齐 `upsertChunkForPage` 后，wiki_ingest 编译完一个页面就同步创建 `wp-<pageID>` 前缀的 chunk，写入 `weknora_embeddings_*` 表（修正 4）。

### 3.6 数据模型变更总结

| 改动类型 | 文件 / 表 | 内容 |
|---|---|---|
| 新增文件 | `internal/types/qa_mode.go` | QAMode 枚举 + 4 常量 + IsValid/DefaultQAMode |
| 新增文件 | `internal/types/memory_layer.go` | MemoryRetrieveRequest/Result 等 DTO |
| 新增文件 | `internal/types/interfaces/memory_layer.go` | MemoryLayer 接口 |
| 修改文件 | `internal/types/chat.go` | QARequest 加 QAMode 字段 |
| 修改文件 | `internal/types/wiki_page.go` | WikiPage 加 4 字段 |
| 修改文件 | `internal/types/interfaces/chunk.go` | ChunkRepository 加 SearchByChunkType / UpsertWikiChunk |
| DB migration | `wiki_pages` 表 | ALTER TABLE 加 4 列（GORM AutoMigrate） |

---

## 4. Pipeline 路由设计

### 4.1 新增 EventType 常量

```go
// internal/types/chat_manage.go 新增
WIKI_SEARCH          EventType = "wiki_search"
WIKI_RERANK          EventType = "wiki_rerank"
WIKI_MEMORY_ACCESS   EventType = "wiki_memory_access"
HYBRID_MERGE         EventType = "hybrid_merge"
```

### 4.2 新增 Pipeline 插件

| 插件 | 文件 | 监听事件 | 职责 |
|---|---|---|---|
| `PluginWikiSearch` | `chat_pipeline/wiki_search.go` | `WIKI_SEARCH` | 调用 `MemoryLayer.Retrieve()`，仅检索 `ChunkType=wiki_page` 的 chunk |
| `PluginWikiRerank` | `chat_pipeline/wiki_rerank.go` | `WIKI_RERANK` | 复用现有 `PluginRerank` 逻辑 + wiki_boost 加权 |
| `PluginWikiMemoryAccess` | `chat_pipeline/wiki_memory_access.go` | `WIKI_MEMORY_ACCESS` | 命中页面时更新 LastAccessedAt / AccessCount |
| `PluginHybridMerge` | `chat_pipeline/hybrid_merge.go` | `HYBRID_MERGE` | 合并 RAG SearchResult 与 Wiki SearchResult，去重 |

### 4.3 4 种 QA Mode 的 Pipeline 装配

**QAModeRAG**（默认，完全保留现有逻辑）：

```go
pipeline = types.NewPipelineBuilder().
    AddIf(hasHistory, types.LOAD_HISTORY).
    Add(types.QUERY_UNDERSTAND).
    Add(types.CHUNK_SEARCH_PARALLEL).
    Add(types.CHUNK_RERANK).
    AddIf(req.WebSearchEnabled, types.WEB_FETCH).
    Add(types.CHUNK_MERGE).
    Add(types.FILTER_TOP_K).
    AddIf(chatManage.DataAnalysisEnabled, types.DATA_ANALYSIS).
    Add(types.INTO_CHAT_MESSAGE).
    Add(types.CHAT_COMPLETION_STREAM).
    Build()
```

**QAModeWiki**（纯 Wiki 检索，绕过普通 chunk）：

```go
pipeline = types.NewPipelineBuilder().
    AddIf(hasHistory, types.LOAD_HISTORY).
    Add(types.QUERY_UNDERSTAND).
    Add(types.WIKI_SEARCH).
    Add(types.WIKI_RERANK).
    Add(types.WIKI_MEMORY_ACCESS).
    AddIf(req.WebSearchEnabled, types.WEB_FETCH).
    Add(types.CHUNK_MERGE).
    Add(types.FILTER_TOP_K).
    Add(types.INTO_CHAT_MESSAGE).
    Add(types.CHAT_COMPLETION_STREAM).
    Build()
```

**QAModeHybrid**（RAG + Wiki 并行 + 合并）：

```go
pipeline = types.NewPipelineBuilder().
    AddIf(hasHistory, types.LOAD_HISTORY).
    Add(types.QUERY_UNDERSTAND).
    Add(types.CHUNK_SEARCH_PARALLEL).
    Add(types.WIKI_SEARCH).
    Add(types.HYBRID_MERGE).
    Add(types.CHUNK_RERANK).
    AddIf(req.WebSearchEnabled, types.WEB_FETCH).
    Add(types.CHUNK_MERGE).
    Add(types.FILTER_TOP_K).
    Add(types.WIKI_MEMORY_ACCESS).
    Add(types.INTO_CHAT_MESSAGE).
    Add(types.CHAT_COMPLETION_STREAM).
    Build()
```

**QAModeGraph**（P1 暂未实现，fallback 到 RAG）：

```go
// 暂走 QAModeRAG pipeline，并在 chatManage 上记录 warning
```

### 4.4 KnowledgeQA 主入口改造

`session_knowledge_qa.go:158-198` 改造：

```go
qaMode := s.resolveQAMode(ctx, req, chatManage)
chatManage.QAMode = qaMode
logger.Infof(ctx, "KnowledgeQA QAMode resolved: %s", qaMode)

switch qaMode {
case types.QAModeRAG, types.QAModeGraph:  // Graph 暂 fallback
    pipeline = s.buildRAGPipeline(ctx, chatManage, req, hasHistory)
case types.QAModeWiki:
    pipeline = s.buildWikiPipeline(ctx, chatManage, req, hasHistory)
case types.QAModeHybrid:
    pipeline = s.buildHybridPipeline(ctx, chatManage, req, hasHistory)
}
```

### 4.5 插件注册顺序

`internal/container/container.go:294-309` 新增：

```go
NewPluginWikiSearch(WIKI_SEARCH)
NewPluginWikiRerank(WIKI_RERANK)
NewPluginWikiMemoryAccess(WIKI_MEMORY_ACCESS)
NewPluginHybridMerge(HYBRID_MERGE)
```

---

## 5. Memory Layer Service 接口设计

### 5.1 接口定义

新文件：`internal/types/interfaces/memory_layer.go`

```go
package interfaces

import (
    "context"
    "time"
    "github.com/Tencent/WeKnora/internal/types"
)

// MemoryLayer implements the five-stage memory lifecycle:
// Write → Retrieve → Compact → Forget → Associate.
type MemoryLayer interface {
    // Write compiles documents into wiki pages and syncs ChunkTypeWikiPage chunks.
    Write(ctx context.Context, kbID string, docIDs []string) (*types.WriteResult, error)

    // Retrieve searches only wiki_page chunks. When updateAccess=true,
    // updates LastAccessedAt / AccessCount on hit.
    Retrieve(ctx context.Context, req *types.MemoryRetrieveRequest) (*types.MemoryRetrieveResult, error)

    // Compact merges duplicate pages and downgrades cold data by MemoryState.
    // Idempotent; safe to call from cron or manually.
    Compact(ctx context.Context, kbID string, opts *types.CompactOptions) (*types.CompactResult, error)

    // Forget archives or deletes pages whose ExpiresAt is past AND MemoryState=archived.
    Forget(ctx context.Context, kbID string, opts *types.ForgetOptions) (*types.ForgetResult, error)

    // Associate returns the Wiki link graph around a given page (InLinks/OutLinks).
    Associate(ctx context.Context, pageID string, depth int) (*types.WikiGraphData, error)
}
```

### 5.2 辅助结构体

新文件：`internal/types/memory_layer.go`

```go
package types

import "time"

type MemoryRetrieveRequest struct {
    KnowledgeBaseID string
    TenantID        uint64
    Query           string
    TopK            int       // default 10 if <=0
    MinScore        float64   // default 0.0 if <=0
    UpdateAccess    bool
}

type MemoryRetrieveResult struct {
    Pages  []*WikiPage
    Chunks []*SearchResult
    Total  int
}

type WriteResult struct {
    PagesCompiled  int
    ChunksUpserted int
    Duration       time.Duration
}

type CompactOptions struct {
    WarmThresholdDays    int  // default 30
    ColdThresholdDays    int  // default 90
    ArchiveThresholdDays int  // default 180
    MaxPagesBeforeMerge  int  // default 1000
    DryRun               bool
}

func DefaultCompactOptions() *CompactOptions {
    return &CompactOptions{
        WarmThresholdDays:    30,
        ColdThresholdDays:    90,
        ArchiveThresholdDays: 180,
        MaxPagesBeforeMerge:  1000,
    }
}

type CompactResult struct {
    DowngradedToWarm     int
    DowngradedToCold     int
    DowngradedToArchived int
    MergedDuplicatePages int
    Duration             time.Duration
}

type ForgetOptions struct {
    DryRun bool
}

type ForgetResult struct {
    ArchivedPages int
    DeletedPages  int
    DeletedChunks int
    Duration      time.Duration
}
```

### 5.3 实现依赖注入

```go
// internal/application/service/memory_layer.go
type memoryLayerService struct {
    wikiIngestService interfaces.WikiIngestService
    wikiPageService   interfaces.WikiPageService
    chunkRepo         interfaces.ChunkRepository
    embeddingService  interfaces.EmbeddingService
    llmService        interfaces.LLMService
    eventBus          *event.EventBus
}
```

### 5.4 ChunkRepository 新增方法

`internal/types/interfaces/chunk.go` 新增：

- `SearchByChunkType(ctx, kbID, tenantID, chunkType, query, topK, minScore)` — 仅查指定 ChunkType
- `UpsertWikiChunk(ctx, page)` — 创建/更新 `wp-<pageID>` chunk，ChunkType=ChunkTypeWikiPage

### 5.5 API 路由

新文件：`internal/router/memory_router.go`，所有 endpoint 挂 `OwnedKnowledgeBaseOrAdmin` 守卫：

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/v1/knowledge_bases/:id/memory/compact` | 触发 Compact |
| POST | `/api/v1/knowledge_bases/:id/memory/forget` | 触发 Forget |
| POST | `/api/v1/knowledge_bases/:id/memory/rebuild` | 主动触发 Write() |
| GET | `/api/v1/knowledge_bases/:id/memory/stats` | 返回 MemoryState 分布 |

支持 query 参数 `?dry_run=true`。

### 5.6 Cron 触发

新文件：`internal/cron/memory_compact.go`：每天凌晨 03:00 对所有 WikiEnabled 的 KB 触发 `Compact(default opts)`。

---

## 6. Compact 策略详细设计

### 6.1 两个子任务

- **6.2 降级（Downgrade）**：状态机驱动，无 LLM 调用
- **6.3 合并（Merge）**：LLM 驱动，识别重复页面

### 6.2 降级逻辑

#### 6.2.1 降级 SQL（一条 SQL 完成 3 级降级）

```sql
UPDATE wiki_pages
SET memory_state = CASE
    WHEN last_accessed_at < NOW() - INTERVAL '180 days' AND memory_state = 'cold' THEN 'archived'
    WHEN last_accessed_at < NOW() - INTERVAL '90 days'  AND memory_state = 'warm' THEN 'cold'
    WHEN last_accessed_at < NOW() - INTERVAL '30 days'  AND memory_state = 'hot'  THEN 'warm'
    ELSE memory_state
END
WHERE knowledge_base_id = $1 AND deleted_at IS NULL;
```

#### 6.2.2 检索时自动升级

`PluginWikiMemoryAccess.OnEvent` 命中页面时：
- `LastAccessedAt = now()`
- `AccessCount += 1`
- 若 `MemoryState == 'archived'`，升级为 `hot`

### 6.3 合并逻辑

#### 6.3.1 触发条件

```go
func (s *memoryLayerService) shouldMerge(ctx, kbID, opts) bool {
    total := s.wikiPageRepo.CountByKB(ctx, kbID)
    return total > opts.MaxPagesBeforeMerge  // 默认 1000
}
```

#### 6.3.2 候选对识别（两阶段预筛）

**阶段 A：同 PageType + slug 模糊匹配**（similarity > 0.6，LIMIT 50）
**阶段 B：向量相似度**（embedding 余弦相似度 >= 0.85）

#### 6.3.3 PageType 合并白名单

| PageType | 允许合并 | 策略 |
|---|---|---|
| Summary / Concept / Index / Synthesis / Comparison | ✅ | 合并 |
| Log / Entity | ❌ | 不合并 |

#### 6.3.4 LLM 合并 Prompt 模板

新文件：`config/prompt_templates/wiki_compact_merge.yaml`，定义 system/user prompt，输出 STRICT JSON：

```json
{
  "slug": "string",
  "title": "string",
  "summary": "string",
  "content": "string (full markdown)",
  "aliases": ["string", ...],
  "merge_notes": "string (≤ 200 chars)"
}
```

参数：`temperature: 0.2`, `max_tokens: 4096`

#### 6.3.5 合并执行流程

1. 选择主页面（AccessCount 更高者；相同则 slug 更短者）
2. 调用 LLM 合并 → JSON 解析
3. 更新主页面（Slug/Title/Summary/Content/Aliases + Version++）
4. 处理链接图（TransferLinks：把 PageB 的 InLinks/OutLinks 转移到 PageA）
5. 同步 chunk（upsertChunkForPage(PageA) + deleteChunkForPage(PageB)）
6. 软删除 PageB（PageB.PageMetadata["merged_into"] = PageA.ID）
7. 发事件（WikiPageMerged）

### 6.4 并发与幂等

- **Redis 锁**：`memory:compact:<kbID>`，TTL 10 分钟
- **幂等**：降级 SQL 幂等；合并软删除被合并页面，重复合并自动跳过

### 6.5 错误处理

| 错误 | 处理 |
|---|---|
| 锁获取失败 | 返回错误，调用方重试 |
| 降级 SQL 失败 | 全部回滚 |
| 单个合并对失败 | best-effort，继续下一个 |
| LLM 调用失败 | 该对跳过，记录日志 |
| 链接图更新失败 | 该对回滚（事务） |

---

## 7. TDD 测试策略

### 7.1 测试金字塔

| 层 | 文件命名约定 | 数量目标 | 工具 |
|---|---|---|---|
| 单元测试 | `*_test.go` | 60+ | go test + testify |
| 集成测试 | `*_integration_test.go` (build tag `integration`) | 15+ | testcontainers |
| API 契约测试 | `*_api_test.go` (build tag `integration`) | 8+ | httptest |
| 端到端 | 手动 + curl 脚本 | 5 场景 | docs/specs/e2e.md |

### 7.2 单元测试用例清单

#### 模块 A：QAMode（10 个）

| ID | 测试名 | 验证点 |
|---|---|---|
| QA-001 | TestQAMode_IsValid | 4 个常量 IsValid=true；空串/未知 false |
| QA-002 | TestDefaultQAMode_ReturnsRAG | DefaultQAMode() == QAModeRAG |
| QA-003 | TestResolveQAMode_RequestExplicitWins | QARequest.QAMode 优先 |
| QA-004 | TestResolveQAMode_AgentPresetFallback | Agent.QAMode fallback |
| QA-005 | TestResolveQAMode_KBAllWiki | 所有 KB WikiEnabled → Wiki |
| QA-006 | TestResolveQAMode_KBMixed | 部分 WikiEnabled → Hybrid |
| QA-007 | TestResolveQAMode_KBNoneWiki | 全部 WikiEnabled=false → RAG |
| QA-008 | TestResolveQAMode_DefaultRAG | 全空 → RAG |
| QA-009 | TestResolveQAMode_GraphFallsBackToRAG | Graph fallback + warning |
| QA-010 | TestResolveQAMode_IMForcesRAG | IM 渠道强制 RAG |

#### 模块 B：WikiPage + upsertChunkForPage（6 个）

| ID | 测试名 | 验证点 |
|---|---|---|
| WP-001 | TestWikiPage_NewMemoryFields | 4 新字段默认值 |
| WP-002 | TestUpsertChunkForPage_CreatesNewChunk | 首次创建 ChunkType=wiki_page |
| WP-003 | TestUpsertChunkForPage_UpdatesExistingChunk | 二次更新不新增 |
| WP-004 | TestUpsertChunkForPage_ChunkIDFormat | chunk.ID == "wp-"+page.ID |
| WP-005 | TestUpsertChunkForPage_DeletesOnPageDelete | 删除 page 后 chunk 不存在 |
| WP-006 | TestWikiBoost_FiresAfterUpsert | upsert 后 wiki_boost 不走 fast-path |

#### 模块 C：Pipeline 路由与插件（8 个）

| ID | 测试名 | 验证点 |
|---|---|---|
| PP-001 | TestBuildRAGPipeline_BackwardCompat | QAModeRAG 与现有一致 |
| PP-002 | TestBuildWikiPipeline | QAModeWiki 含 WIKI_* 事件 |
| PP-003 | TestBuildHybridPipeline | QAModeHybrid 含两路 + HYBRID_MERGE |
| PP-004 | TestBuildGraphPipeline_FallsBackToRAG | Graph fallback |
| PP-005 | TestPluginWikiSearch_OnlyReturnsWikiChunks | 仅返回 wiki_page chunk |
| PP-006 | TestPluginWikiMemoryAccess_UpdatesMetadata | 命中后元数据更新 + archived→hot |
| PP-007 | TestPluginHybridMerge_DeduplicatesByChunkID | 去重保留一份 |
| PP-008 | TestPluginWikiRerank_AppliesBoost | wiki chunk * 1.3，重排正确 |

#### 模块 D：MemoryLayer service（20 个）

| ID | 测试名 | 验证点 |
|---|---|---|
| ML-001 | TestMemoryLayer_Write_CallsIngest | Write 调 wikiIngestService.ProcessWikiIngest |
| ML-002 | TestMemoryLayer_Write_UpsertsChunks | Write 后所有 page 有 wp- chunk |
| ML-003 | TestMemoryLayer_Retrieve_OnlyWikiChunks | 返回全部 ChunkType=wiki_page |
| ML-004 | TestMemoryLayer_Retrieve_UpdatesAccess | updateAccess=true 时更新元数据 |
| ML-005 | TestMemoryLayer_Retrieve_NoAccess_NoUpdate | updateAccess=false 不修改 |
| ML-006 | TestMemoryLayer_Retrieve_ArchivedUpgradesToHot | archived 命中后变 hot |
| ML-007 | TestMemoryLayer_Compact_DowngradesHot2Warm | 31 天 → warm |
| ML-008 | TestMemoryLayer_Compact_DowngradesWarm2Cold | 91 天 → cold |
| ML-009 | TestMemoryLayer_Compact_DowngradesCold2Archived | 181 天 → archived |
| ML-010 | TestMemoryLayer_Compact_DryRun | DryRun=true 不修改 |
| ML-011 | TestMemoryLayer_Compact_MergesDuplicateSummary | 两个相似 Summary → 合并 |
| ML-012 | TestMemoryLayer_Compact_NoMergeEntity | 两个 Entity 不合并 |
| ML-013 | TestMemoryLayer_Compact_TransfersLinks | PageB 链接转移到 PageA |
| ML-014 | TestMemoryLayer_Compact_LockContention | 锁竞争返回错误 |
| ML-015 | TestMemoryLayer_Forget_ArchivedExpired | archived+过期 → 软删除+删 chunk |
| ML-016 | TestMemoryLayer_Forget_DryRun | DryRun 仅返回统计 |
| ML-017 | TestMemoryLayer_Forget_NotArchived | warm 即使过期也不删 |
| ML-018 | TestMemoryLayer_Associate_ReturnsGraph | 返回 WikiGraphData |
| ML-019 | TestMemoryLayer_Associate_Depth | depth=2 返回二度链接 |
| ML-020 | TestMemoryLayer_Compact_Idempotent | 连续 2 次结果相同 |

#### 模块 E：API 路由与 RBAC（8 个）

| ID | 测试名 | 验证点 |
|---|---|---|
| API-001 | TestMemoryCompact_RequiresAdmin | viewer/contributor → 403 |
| API-002 | TestMemoryCompact_AdminOK | admin/owner → 200 |
| API-003 | TestMemoryCompact_DryRun | ?dry_run=true 不修改 |
| API-004 | TestMemoryRebuild_TriggersWrite | POST /rebuild 调 MemoryLayer.Write |
| API-005 | TestMemoryStats_ReturnsDistribution | 返回 {hot, warm, cold, archived} 分布 |
| API-006 | TestMemoryForget_RequiresAdmin | viewer → 403 |
| API-007 | TestMemoryForget_DryRun | ?dry_run=true 仅返回统计 |
| API-008 | TestMemoryEndpoints_UnderKnowledgeBases | 路径符合 /api/v1/knowledge_bases/:id/memory/* |

### 7.3 集成测试用例清单（8 个）

| ID | 测试名 | 验证点 |
|---|---|---|
| INT-001 | TestE2E_WikiIngestProducesBoostableChunks | 入库 → wiki_page chunk 存在 → wiki_boost 加权 |
| INT-002 | TestE2E_PureWikiQA | QAMode=Wiki → 仅检索 wiki_page chunk → 返回答案 |
| INT-003 | TestE2E_HybridQA | QAMode=Hybrid → 两路并行 → 合并 → 答案 |
| INT-004 | TestE2E_CompactFullCycle | 写入 1000 页面 → 30 天后 Compact → 降级 |
| INT-005 | TestE2E_ForgetFullCycle | 设置 ExpiresAt → Compact → Forget 删除 |
| INT-006 | TestE2E_MergeDuplicates | 两个相似 Summary → Compact → LLM 合并 |
| INT-007 | TestE2E_RetrieveRevivesArchived | archived 命中后升级 hot |
| INT-008 | TestE2E_IMIntegrationForcesRAG | IM 渠道 QARequest 走 RAG |

### 7.4 TDD 红绿循环纪律

每个用例严格按 **RED → GREEN → REFACTOR**：

1. **RED**：先写测试，运行确认失败
2. **GREEN**：写最小实现让测试通过（不超工程化）
3. **REFACTOR**：清理代码，再次运行确认 PASS

**禁止**：先写实现再补测试。每个 PR 必须包含完整 RED-GREEN-REFACTOR 历史。

### 7.5 测试覆盖率目标

| 模块 | 覆盖率 |
|---|---|
| `internal/types/qa_mode.go` | 100% |
| `wiki_page.go`（upsertChunkForPage） | 90%+ |
| `memory_layer.go` | 85%+ |
| `chat_pipeline/wiki_search.go` | 85%+ |
| `chat_pipeline/wiki_rerank.go` | 85%+ |
| `chat_pipeline/wiki_memory_access.go` | 85%+ |

---

## 8. 待审阅事项（TODO）

> 以下 5 项在 spec 评审时尚未充分论证，作为待办事项记录。在 TDD 实施前需逐项确认；如确认有调整，需同步更新对应章节。

### 8.1 [待确认] 第 1.4 节：5 个兼容性修正是否完整

- **状态**：⏳ 待确认
- **特别关注**：修正 1（IM 集成强制 RAG）
- **疑问**：IM 渠道强制 `QAMode=QAModeRAG` 是否会损害 IM 用户的 wiki 体验？是否应允许 IM Agent 显式 opt-in 到 QAModeWiki？
- **影响范围**：`internal/im/handler.go`、`QARequest` 默认值
- **决策方式**：审阅 IM 集成现有行为后决定

### 8.2 [待确认] 第 3.3 节：WikiPage 4 个新字段是否合理 + MemoryState 索引

- **状态**：⏳ 待确认
- **疑问 1**：`LastAccessedAt` / `AccessCount` / `MemoryState` / `ExpiresAt` 4 字段是否足够？是否需要 `CompactAt`（记录上次 Compact 时间）？
- **疑问 2**：`MemoryState` 是否需要单独索引？Compact 查询 `WHERE memory_state = 'hot'` 频率较高，加索引可加速
- **当前设计**：`MemoryState` 字段已含 `gorm:"index"` 隐式声明？需复核
- **影响范围**：`internal/types/wiki_page.go`、DB migration
- **决策方式**：在 Phase 1（数据模型落地）前通过 EXPLAIN 验证查询计划

### 8.3 [待确认] 第 4.3 节：4 种 QA Mode 的 pipeline 装配顺序

- **状态**：⏳ 待确认
- **特别关注**：QAModeHybrid 的两路并行 + HYBRID_MERGE 顺序
- **疑问 1**：`CHUNK_SEARCH_PARALLEL` 和 `WIKI_SEARCH` 是否真正并行执行？当前 `PipelineBuilder.Add` 是顺序追加，EventManager 按 chain 串行触发——若需要真并行，需改 Pipeline 执行模型
- **疑问 2**：`HYBRID_MERGE` 在 `CHUNK_RERANK` 之前是否正确？合并后应统一 rerank，但合并的去重逻辑是否影响 rerank 的 MMR 算法？
- **疑问 3**：`WIKI_MEMORY_ACCESS` 在 Hybrid 模式下放在 `FILTER_TOP_K` 之后是否合理？被滤掉的页面不应更新元数据
- **影响范围**：`session_knowledge_qa.go`、`chat_pipeline/hybrid_merge.go`
- **决策方式**：写 PP-003 测试时验证执行顺序；如需真并行，需扩展 PipelineBuilder 支持 `AddParallel(events...)`

### 8.4 [待确认] 第 6.3 节：Compact 合并策略 + PageType 白名单

- **状态**：⏳ 待确认
- **特别关注**：Entity 不合并的规则
- **疑问 1**：两个 Entity 页面 slug 完全相同（同一实体被多次抽取）是否应合并？当前白名单一刀切禁止 Entity 合并可能造成重复实体页
- **疑问 2**：候选对预筛阶段 A 的 `similarity(slug) > 0.6` 阈值是否合理？太松会引入大量噪声候选对，太严会漏合并
- **疑问 3**：阶段 B 的向量相似度 `0.85` 阈值是否合理？应基于实际数据分布调优
- **疑问 4**：LLM 合并失败时的回滚策略是否清晰？当前文档说"该对回滚（事务）"，但 TransferLinks 跨多页面更新，事务边界如何定义？
- **影响范围**：`memory_layer.go`、`wiki_compact_merge.yaml`
- **决策方式**：ML-011 / ML-012 / ML-013 测试时验证；阈值用真实数据校准

### 8.5 [待确认] 第 7.2 节：52 个测试用例覆盖度

- **状态**：⏳ 待确认
- **疑问 1**：是否遗漏了 `QAModeHybrid + WebSearchEnabled` 组合的测试？
- **疑问 2**：是否遗漏了并发场景测试（如 Compact 进行中触发 Forget）？
- **疑问 3**：是否需要补充 `CompactOptions` 边界值测试（如 `WarmThresholdDays=0` 全部立即降级）？
- **疑问 4**：是否需要 Chaos 测试（如 LLM 超时、Redis 锁过期）？
- **疑问 5**：API 测试是否需要补充 rate limiting 场景（防止 Compact 被频繁触发）？
- **影响范围**：所有 `*_test.go`
- **决策方式**：Phase 0（基线测试）完成后评估覆盖率，按需补充

### 8.6 待办事项跟踪

| TODO ID | 章节 | 状态 | 决策时点 |
|---|---|---|---|
| TODO-8.1 | 1.4 兼容性修正完整性 | ⏳ 待确认 | Phase 0 前 |
| TODO-8.2 | 3.3 WikiPage 字段 + 索引 | ⏳ 待确认 | Phase 1 前 |
| TODO-8.3 | 4.3 Pipeline 装配顺序 | ⏳ 待确认 | Phase 2（写 PP-003 测试时） |
| TODO-8.4 | 6.3 Compact 合并策略 | ⏳ 待确认 | Phase 3（写 ML-011 测试时） |
| TODO-8.5 | 7.2 测试用例覆盖度 | ⏳ 待确认 | Phase 0 完成后 |

---

## 9. 文档同步更新清单（TDD 最后阶段）

落地后需同步更新以下 wiki 文档：

| 文档 | 更新内容 |
|---|---|
| [版本路线图.md](../../wiki/项目概述/版本路线图.md) | 第 48 行"探索知识库与 Memory 结合"从规划改为已落地 |
| [API文档概览.md](../../wiki/API参考/API文档概览.md) | 新增"记忆层"分类（4 个 endpoint） |
| `docs/wiki/核心功能/Memory Layer.md` | 新增文档，描述五阶段生命周期 |
| [常见问题.md](../../wiki/运维排障/常见问题.md) | 补充"wiki_boost 不生效的原因"（写入侧未实现） |
| [architecture_deep_analysis.md](../architecture_deep_analysis.md) | 第 3.7 节差距 1（无独立 Wiki QA 模式）标记为已解决 |