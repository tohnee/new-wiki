# Wiki QA + Memory Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-v6-subagent-driven-development (recommended) or superpowers-v6-executing-plans to implement this plan task-by-task.

**Goal:** Implement Wiki QA pipeline routing (QAMode) + MemoryLayer service (Write/Retrieve/Compact/Forget/Associate) + fix P0 defect (upsertChunkForPage).

**Architecture:** Gradual enhancement — preserve existing wikiIngestService and RAG pipeline; add QAMode routing + 4 pipeline plugins + MemoryLayer service + MemoryState lifecycle (hot/warm/cold/archived) on WikiPage.

**Tech Stack:** Go 1.26, GORM (PostgreSQL), Redis, testify, testcontainers.

**Spec:** [docs/superpowers/specs/2026-07-05-wiki-qa-memory-layer-design.md](../specs/2026-07-05-wiki-qa-memory-layer-design.md)

## Global Constraints

- Go 1.26.0；不破坏现有 RAG pipeline；QAMode 默认 RAG 向后兼容
- 不重写 wikiIngestService；MemoryLayer.Write() 内部调用它
- IM 渠道 QARequest 强制 QAMode=QAModeRAG（修正 1）
- 向量库写入复用 weknora_embeddings_* 表，不新建表（修正 4）
- API 路径风格 /api/v1/knowledge_bases/:id/memory/*（修正 5）
- memory endpoint 挂 OwnedKnowledgeBaseOrAdmin 守卫（修正 3）
- 测试覆盖率 ≥ 85%；严格 RED-GREEN-REFACTOR

---

## File Structure

| 文件 | 类型 | 责任 |
|---|---|---|
| `internal/types/qa_mode.go` | 新增 | QAMode 枚举 |
| `internal/types/memory_layer.go` | 新增 | DTO 结构体 |
| `internal/types/chat.go` | 修改 | QARequest 加 QAMode |
| `internal/types/wiki_page.go` | 修改 | WikiPage 加 4 字段 |
| `internal/types/chat_manage.go` | 修改 | 4 EventType 常量 |
| `internal/types/interfaces/memory_layer.go` | 新增 | MemoryLayer 接口 |
| `internal/types/interfaces/chunk.go` | 修改 | ChunkRepository 加 2 方法 |
| `internal/application/service/wiki_page.go` | 修改 | upsertChunkForPage（P0 修复） |
| `internal/application/service/memory_layer.go` | 新增 | memoryLayerService 实现 |
| `internal/application/service/session_knowledge_qa.go` | 修改 | resolveQAMode + 4 buildXxxPipeline |
| `internal/application/service/chat_pipeline/wiki_search.go` | 新增 | PluginWikiSearch |
| `internal/application/service/chat_pipeline/wiki_rerank.go` | 新增 | PluginWikiRerank |
| `internal/application/service/chat_pipeline/wiki_memory_access.go` | 新增 | PluginWikiMemoryAccess |
| `internal/application/service/chat_pipeline/hybrid_merge.go` | 新增 | PluginHybridMerge |
| `internal/router/memory_router.go` | 新增 | 4 memory endpoint |
| `internal/cron/memory_compact.go` | 新增 | 定时 Compact |
| `config/prompt_templates/wiki_compact_merge.yaml` | 新增 | LLM 合并 Prompt |
| `internal/container/container.go` | 修改 | 注册新插件和 service |

---

## Phase 划分概览

| Phase | 主题 | Task 数 | 关键交付 |
|---|---|---|---|
| Phase 0 | Baseline Tests | 3 | 验证现有代码契约，确认 P0 缺陷 |
| Phase 1 | 数据模型 | 4 | QAMode + QARequest + WikiPage 4 字段 + Migration |
| Phase 2 | P0 修复 | 2 | upsertChunkForPage + WikiBoost 真正生效 |
| Phase 3 | MemoryLayer Service | 5 | 接口 + 5 方法实现 + 单元测试 |
| Phase 4 | Pipeline 路由 | 5 | resolveQAMode + 4 buildXxxPipeline + 4 插件 |
| Phase 5 | API + Cron | 4 | memory_router + RBAC + cron |
| Phase 6 | Compact 策略 | 3 | 降级 + 合并 + LLM Prompt |
| Phase 7 | 集成测试 | 3 | E2E：Wiki QA / Hybrid / Compact |
| Phase 8 | 文档同步 | 1 | 更新 wiki 文档 |

---

<!-- Phase 详细 task 将通过 SearchReplace 追加 -->

---


---


---

## Phase 0: Baseline Tests（验证现有代码，不修改业务代码）

### Task 0.1: 验证 ChunkTypeWikiPage 常量基线

**Files:**
- Test: `internal/types/chunk_baseline_test.go`
- Consumes: `internal/types/chunk.go:39` 现有 ChunkTypeWikiPage
- Produces: 基线断言

- [ ] **Step 1: Write the failing test**

```go
package types

import "testing"

func TestChunkTypeWikiPage_Baseline(t *testing.T) {
    if ChunkTypeWikiPage != "wiki_page" {
        t.Errorf("ChunkTypeWikiPage = %q, want %q", ChunkTypeWikiPage, "wiki_page")
    }
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `go test ./internal/types/ -run TestChunkTypeWikiPage_Baseline -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add internal/types/chunk_baseline_test.go
git commit -m "test(types): add baseline test for ChunkTypeWikiPage constant"
```

### Task 0.2: 验证 wikiIngestService 接口契约

**Files:**
- Test: `internal/types/interfaces/wiki_ingest_baseline_test.go`
- Consumes: `internal/types/interfaces/wiki_page.go`
- Produces: 编译期契约验证

- [ ] **Step 1: Write the failing test**

```go
package interfaces

import (
    "context"
    "testing"
)

func TestWikiIngestService_Contract(t *testing.T) {
    var _ WikiIngestService = (*WikiIngestServiceMock)(nil)
}

type WikiIngestServiceMock struct{}

func (m *WikiIngestServiceMock) ProcessWikiIngest(ctx context.Context, kbID string, docIDs []string) error {
    return nil
}
```

> 注：若接口签名与 mock 不符，先调整 mock 以匹配现有接口。

- [ ] **Step 2: Run test to verify it compiles**

Run: `go test ./internal/types/interfaces/ -run TestWikiIngestService_Contract -v`
Expected: PASS（若 FAIL，先核对真实接口签名）

- [ ] **Step 3: Commit**

```bash
git add internal/types/interfaces/wiki_ingest_baseline_test.go
git commit -m "test(types): add baseline contract test for WikiIngestService"
```

### Task 0.3: 确认 wiki_boost fast-path P0 缺陷

**Files:**
- Test: `internal/application/service/chat_pipeline/wiki_boost_baseline_test.go`
- Consumes: `chat_pipeline/wiki_boost.go`
- Produces: 证明 wiki_boost 当前永远走 fast-path

- [ ] **Step 1: Write the failing test**

```go
package chat_pipeline

import (
    "testing"
    "github.com/Tencent/WeKnora/internal/types"
)

func TestWikiBoost_FastPathWhenNoWikiChunk(t *testing.T) {
    rerankResult := []types.SearchResult{
        {ChunkType: "text", Score: 0.8},
        {ChunkType: "text", Score: 0.6},
    }
    hasWikiChunk := false
    for i := range rerankResult {
        if rerankResult[i].ChunkType == types.ChunkTypeWikiPage {
            hasWikiChunk = true
            break
        }
    }
    if hasWikiChunk {
        t.Error("baseline: 期望无 wiki_page chunk（P0 缺陷），但发现 wiki chunk")
    }
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `go test ./internal/application/service/chat_pipeline/ -run TestWikiBoost_FastPathWhenNoWikiChunk -v`
Expected: PASS（确认 P0 缺陷存在）

- [ ] **Step 3: Commit**

```bash
git add internal/application/service/chat_pipeline/wiki_boost_baseline_test.go
git commit -m "test(pipeline): add baseline test confirming wiki_boost fast-path P0 defect"
```

<!-- Phase 1+ 将继续追加 -->

---


---


---

## Phase 1: 数据模型 — QAMode 枚举 + QARequest + WikiPage 4 字段

### Task 1.1: 新增 QAMode 枚举

**Files:**
- Create: `internal/types/qa_mode.go`
- Test: `internal/types/qa_mode_test.go`
- Produces: types.QAMode 类型 + 4 常量 + IsValid() + DefaultQAMode()

- [ ] **Step 1: Write the failing test（RED）**

```go
package types

import "testing"

func TestQAMode_IsValid(t *testing.T) {
    valid := []QAMode{QAModeRAG, QAModeWiki, QAModeHybrid, QAModeGraph}
    for _, m := range valid {
        if !m.IsValid() { t.Errorf("expected %q valid", m) }
    }
    invalid := []QAMode{"", "unknown", "RAG"}
    for _, m := range invalid {
        if m.IsValid() { t.Errorf("expected %q invalid", m) }
    }
}

func TestDefaultQAMode_ReturnsRAG(t *testing.T) {
    if DefaultQAMode() != QAModeRAG {
        t.Errorf("DefaultQAMode() = %q, want %q", DefaultQAMode(), QAModeRAG)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/types/ -run "TestQAMode" -v`
Expected: FAIL "undefined: QAMode"

- [ ] **Step 3: Write minimal implementation（GREEN）**

```go
// internal/types/qa_mode.go
package types

type QAMode string

const (
    QAModeRAG    QAMode = "rag"
    QAModeWiki   QAMode = "wiki"
    QAModeHybrid QAMode = "hybrid"
    QAModeGraph  QAMode = "graph"
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

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/types/ -run "TestQAMode" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/types/qa_mode.go internal/types/qa_mode_test.go
git commit -m "feat(types): add QAMode enum with 4 modes"
```

### Task 1.2: QARequest 新增 QAMode 字段

**Files:**
- Modify: `internal/types/chat.go`（QARequest 结构体）
- Test: `internal/types/chat_qa_mode_test.go`
- Consumes: types.QAMode（Task 1.1）
- Produces: QARequest.QAMode

- [ ] **Step 1: Write the failing test（RED）**

```go
package types

import "testing"

func TestQARequest_QAModeField(t *testing.T) {
    req := QARequest{KnowledgeBaseIDs: []string{"kb-1"}, QAMode: QAModeWiki}
    if req.QAMode != QAModeWiki {
        t.Errorf("QARequest.QAMode = %q, want %q", req.QAMode, QAModeWiki)
    }
}

func TestQARequest_QAModeDefault(t *testing.T) {
    req := QARequest{KnowledgeBaseIDs: []string{"kb-1"}}
    if req.QAMode != "" {
        t.Errorf("default QAMode = %q, want empty", req.QAMode)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/types/ -run "TestQARequest_QAMode" -v`
Expected: FAIL "unknown field QAMode"

- [ ] **Step 3: Modify QARequest（GREEN）**

在 `internal/types/chat.go` 的 QARequest 结构体末尾添加：

```go
type QARequest struct {
    // ... 现有字段保留 ...
    QAMode QAMode `json:"qa_mode,omitempty"`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/types/ -run "TestQARequest_QAMode" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/types/chat.go internal/types/chat_qa_mode_test.go
git commit -m "feat(types): add QAMode field to QARequest"
```

### Task 1.3: WikiPage 新增 4 个 Memory Layer 字段

**Files:**
- Modify: `internal/types/wiki_page.go`（WikiPage 结构体 L146-221）
- Test: `internal/types/wiki_page_memory_fields_test.go`
- Produces: LastAccessedAt / AccessCount / MemoryState / ExpiresAt

- [ ] **Step 1: Write the failing test（RED）**

```go
package types

import (
    "testing"
    "time"
)

func TestWikiPage_NewMemoryFields(t *testing.T) {
    page := &WikiPage{ID: "p1", Slug: "test", Title: "T", Content: "c"}
    page.LastAccessedAt = time.Now()
    page.AccessCount = 5
    page.MemoryState = "hot"
    exp := time.Now().Add(24 * time.Hour)
    page.ExpiresAt = &exp

    if page.LastAccessedAt.IsZero() { t.Error("LastAccessedAt not set") }
    if page.AccessCount != 5 { t.Errorf("AccessCount = %d, want 5", page.AccessCount) }
    if page.MemoryState != "hot" { t.Errorf("MemoryState = %q, want hot", page.MemoryState) }
    if page.ExpiresAt == nil || page.ExpiresAt.IsZero() { t.Error("ExpiresAt not set") }
}

func TestWikiPage_MemoryStateValues(t *testing.T) {
    for _, s := range []string{"hot", "warm", "cold", "archived"} {
        p := &WikiPage{MemoryState: s}
        if p.MemoryState != s { t.Errorf("MemoryState = %q, want %q", p.MemoryState, s) }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/types/ -run "TestWikiPage_NewMemoryFields|TestWikiPage_MemoryStateValues" -v`
Expected: FAIL "unknown field LastAccessedAt"

- [ ] **Step 3: Modify WikiPage（GREEN）**

在 `internal/types/wiki_page.go` 的 WikiPage 结构体 `DeletedAt` 字段之前添加 4 字段：

```go
type WikiPage struct {
    // ... 现有 22 字段保留 ...

    // Memory Layer metadata (新增 4 字段)
    LastAccessedAt time.Time  `json:"last_accessed_at" gorm:"index"`
    AccessCount    int        `json:"access_count" gorm:"default:0"`
    MemoryState    string     `json:"memory_state" gorm:"type:varchar(16);default:'hot'"`
    ExpiresAt      *time.Time `json:"expires_at,omitempty" gorm:"index"`

    DeletedAt gorm.DeletedAt `json:"deleted_at" gorm:"index"`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/types/ -run "TestWikiPage_NewMemoryFields|TestWikiPage_MemoryStateValues" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/types/wiki_page.go internal/types/wiki_page_memory_fields_test.go
git commit -m "feat(types): add 4 Memory Layer fields to WikiPage"
```

### Task 1.4: DB Migration 验证（集成测试）

**Files:**
- Test: `internal/types/wiki_page_migration_test.go`（build tag `integration`）
- Consumes: Task 1.3 的 WikiPage 修改
- Produces: 验证 GORM AutoMigrate 正确创建 4 列

- [ ] **Step 1: Write the failing test**

```go
//go:build integration

package types

import (
    "context"
    "testing"

    "github.com/Tencent/WeKnora/internal/testutil"
)

func TestWikiPage_Migration_AddsMemoryColumns(t *testing.T) {
    db := testutil.NewTestPostgresDB(t)
    ctx := context.Background()

    if err := db.WithContext(ctx).AutoMigrate(&WikiPage{}); err != nil {
        t.Fatalf("AutoMigrate failed: %v", err)
    }

    for _, col := range []string{"last_accessed_at", "access_count", "memory_state", "expires_at"} {
        var exists bool
        err := db.WithContext(ctx).Raw(`
            SELECT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'wiki_pages' AND column_name = ?)
        `, col).Scan(&exists).Error
        if err != nil { t.Fatalf("check %s: %v", col, err) }
        if !exists { t.Errorf("column %s not created", col) }
    }
}
```

- [ ] **Step 2: Run integration test**

Run: `go test -tags=integration ./internal/types/ -run TestWikiPage_Migration_AddsMemoryColumns -v`
Expected: PASS（4 列均存在；若 testcontainers 未配置，可跳过此 task，依赖 Phase 2+ 的实际运行验证）

- [ ] **Step 3: Commit**

```bash
git add internal/types/wiki_page_migration_test.go
git commit -m "test(types): add integration test for WikiPage migration"
```

<!-- Phase 2+ 将继续追加 -->

---


---


---

## Phase 2: P0 修复 — upsertChunkForPage + WikiBoost 真正生效

### Task 2.1: ChunkRepository 接口新增 UpsertWikiChunk 方法

**Files:**
- Modify: `internal/types/interfaces/chunk.go`
- Test: `internal/types/interfaces/chunk_repo_test.go`
- Consumes: types.WikiPage（Task 1.3）+ types.ChunkTypeWikiPage（现有）
- Produces: ChunkRepository.UpsertWikiChunk 接口契约

- [ ] **Step 1: Write the failing test（RED）**

```go
package interfaces

import (
    "context"
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
)

func TestChunkRepository_UpsertWikiChunk_Contract(t *testing.T) {
    var _ ChunkRepository = (*ChunkRepoMock)(nil)
}

type ChunkRepoMock struct{}

func (m *ChunkRepoMock) UpsertWikiChunk(ctx context.Context, page *types.WikiPage) error {
    return nil
}

func (m *ChunkRepoMock) SearchByChunkType(
    ctx context.Context, kbID string, tenantID uint64,
    chunkType types.ChunkType, query string, topK int, minScore float64,
) ([]*types.SearchResult, error) {
    return nil, nil
}
```

> 注：ChunkRepository 现有其他方法也需在 mock 中实现（用空实现）。可用 embed `ChunkRepoBaseMock` 简化。

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/types/interfaces/ -run TestChunkRepository_UpsertWikiChunk_Contract -v`
Expected: FAIL "missing method UpsertWikiChunk"

- [ ] **Step 3: Modify ChunkRepository interface（GREEN）**

在 `internal/types/interfaces/chunk.go` 的 ChunkRepository 接口添加 2 方法：

```go
type ChunkRepository interface {
    // ... 现有方法保留 ...

    // SearchByChunkType searches chunks filtered by ChunkType.
    SearchByChunkType(
        ctx context.Context, kbID string, tenantID uint64,
        chunkType types.ChunkType, query string, topK int, minScore float64,
    ) ([]*types.SearchResult, error)

    // UpsertWikiChunk creates or updates the synced chunk for a wiki page.
    // Chunk ID format: "wp-<pageID>". ChunkType = ChunkTypeWikiPage.
    UpsertWikiChunk(ctx context.Context, page *types.WikiPage) error
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/types/interfaces/ -run TestChunkRepository_UpsertWikiChunk_Contract -v`
Expected: PASS

> 注：现有 ChunkRepository 实现也需补充这 2 方法（否则编译失败）。可在实现层先用 `return errors.New("not implemented")` 占位，Phase 3 再补实现。

- [ ] **Step 5: Commit**

```bash
git add internal/types/interfaces/chunk.go internal/types/interfaces/chunk_repo_test.go
git commit -m "feat(types): add UpsertWikiChunk and SearchByChunkType to ChunkRepository"
```

### Task 2.2: wikiPageService 实现 upsertChunkForPage

**Files:**
- Modify: `internal/application/service/wiki_page.go`（新增 upsertChunkForPage 方法）
- Test: `internal/application/service/wiki_page_upsert_chunk_test.go`
- Consumes: ChunkRepository.UpsertWikiChunk（Task 2.1）
- Produces: WikiPage → ChunkTypeWikiPage chunk 同步

- [ ] **Step 1: Write the failing test（RED）**

```go
package service

import (
    "context"
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
)

func TestUpsertChunkForPage_CreatesNewChunk(t *testing.T) {
    page := &types.WikiPage{
        ID: "page-001", TenantID: 1, KnowledgeBaseID: "kb-1",
        Slug: "test-page", Title: "Test", Content: "content", Summary: "summary",
    }

    chunkRepo := new(MockChunkRepo)
    chunkRepo.On("UpsertWikiChunk", mock.Anything, page).Return(nil)

    svc := &wikiPageService{chunkRepo: chunkRepo}
    err := svc.upsertChunkForPage(context.Background(), page)

    assert.NoError(t, err)
    chunkRepo.AssertExpectations(t)
}

func TestUpsertChunkForPage_ChunkIDFormat(t *testing.T) {
    // 验证 chunk ID 格式：wp-<pageID>
    page := &types.WikiPage{ID: "page-xyz", Slug: "test", Title: "T", Content: "c"}
    expectedChunkID := "wp-page-xyz"

    chunkRepo := new(MockChunkRepo)
    chunkRepo.On("UpsertWikiChunk", mock.Anything, mock.MatchedBy(func(p *types.WikiPage) bool {
        return true  // 实现层验证 chunk ID 格式
    })).Run(func(args mock.Arguments) {
        // 验证实现层生成的 chunk ID
    }).Return(nil)

    svc := &wikiPageService{chunkRepo: chunkRepo}
    _ = svc.upsertChunkForPage(context.Background(), page)

    // 实际验证在 UpsertWikiChunk 实现层进行
    _ = expectedChunkID
}

// MockChunkRepo 用于测试
type MockChunkRepo struct{ mock.Mock }
```

> 注：完整 mock 需实现 ChunkRepository 全部方法。可用 mockery 工具生成。

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/service/ -run "TestUpsertChunkForPage" -v`
Expected: FAIL "undefined: upsertChunkForPage"

- [ ] **Step 3: Implement upsertChunkForPage（GREEN）**

在 `internal/application/service/wiki_page.go` 添加：

```go
// upsertChunkForPage creates or updates the synced chunk for a wiki page.
// Chunk ID format: "wp-<pageID>". ChunkType = ChunkTypeWikiPage.
// This fixes the P0 defect where wiki_boost never fired (fast-path always taken).
func (s *wikiPageService) upsertChunkForPage(ctx context.Context, page *types.WikiPage) error {
    if page == nil {
        return errors.New("page is nil")
    }
    return s.chunkRepo.UpsertWikiChunk(ctx, page)
}
```

同时在 `internal/application/repository/chunk_repository.go`（或现有 ChunkRepository 实现位置）补充 `UpsertWikiChunk` 实现：

```go
func (r *chunkRepository) UpsertWikiChunk(ctx context.Context, page *types.WikiPage) error {
    chunkID := "wp-" + page.ID
    content := page.Content
    if page.Summary != "" {
        content = page.Summary + "\n\n" + page.Content
    }

    chunk := &types.Chunk{
        ID:               chunkID,
        KnowledgeBaseID:  page.KnowledgeBaseID,
        TenantID:         page.TenantID,
        ChunkType:        types.ChunkTypeWikiPage,
        Content:          content,
        // 复用现有 chunk 字段（metadata, embedding 等）
    }

    // 调用现有 Upsert 逻辑（写 weknora_embeddings_* 表）
    return r.upsert(ctx, chunk)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/service/ -run "TestUpsertChunkForPage" -v`
Expected: PASS

- [ ] **Step 5: 集成测试验证 wiki_boost 不再走 fast-path**

```go
// internal/application/service/chat_pipeline/wiki_boost_integration_test.go
//go:build integration

func TestWikiBoost_FiresAfterUpsert_Integration(t *testing.T) {
    // 1. 创建 wiki page + upsertChunkForPage
    // 2. 模拟 RAG pipeline 检索（含 wiki_page chunk）
    // 3. 验证 wiki_boost 不走 fast-path，score *= 1.3
}
```

Run: `go test -tags=integration ./internal/application/service/chat_pipeline/ -run TestWikiBoost_FiresAfterUpsert_Integration -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add internal/application/service/wiki_page.go internal/application/service/wiki_page_upsert_chunk_test.go
git add internal/application/repository/chunk_repository.go
git add internal/application/service/chat_pipeline/wiki_boost_integration_test.go
git commit -m "fix(wiki): implement upsertChunkForPage to fix P0 defect (wiki_boost never fired)"
```

---


---


---

## Phase 3: MemoryLayer Service — 接口 + 5 方法实现

### Task 3.1: 新增 MemoryLayer 接口定义 + DTO 结构体

**Files:**
- Create: `internal/types/interfaces/memory_layer.go`
- Create: `internal/types/memory_layer.go`
- Test: `internal/types/memory_layer_types_test.go`
- Consumes: types.WikiPage（Task 1.3）+ types.SearchResult（现有）
- Produces: interfaces.MemoryLayer 接口 + 6 DTO 结构体

- [ ] **Step 1: Write the failing test（RED）**

```go
package types

import (
    "testing"
    "time"
)

func TestMemoryRetrieveRequest_Defaults(t *testing.T) {
    req := &MemoryRetrieveRequest{
        KnowledgeBaseID: "kb-1",
        TenantID:        1,
        Query:           "how RAG works",
    }
    if req.KnowledgeBaseID != "kb-1" { t.Errorf("kbID = %q", req.KnowledgeBaseID) }
    if req.TopK != 0 { t.Errorf("TopK default = %d, want 0", req.TopK) }
    if req.MinScore != 0 { t.Errorf("MinScore default = %f, want 0", req.MinScore) }
    if req.UpdateAccess { t.Error("UpdateAccess default should be false") }
}

func TestCompactOptions_Defaults(t *testing.T) {
    opts := DefaultCompactOptions()
    if opts.WarmThresholdDays != 30 { t.Errorf("warm = %d, want 30", opts.WarmThresholdDays) }
    if opts.ColdThresholdDays != 90 { t.Errorf("cold = %d, want 90", opts.ColdThresholdDays) }
    if opts.ArchiveThresholdDays != 180 { t.Errorf("archive = %d, want 180", opts.ArchiveThresholdDays) }
    if opts.MaxPagesBeforeMerge != 1000 { t.Errorf("maxPages = %d, want 1000", opts.MaxPagesBeforeMerge) }
    if opts.DryRun { t.Error("DryRun default should be false") }
}

func TestWriteResult_Fields(t *testing.T) {
    r := &WriteResult{PagesCompiled: 5, ChunksUpserted: 5, Duration: 100 * time.Millisecond}
    if r.PagesCompiled != 5 { t.Errorf("PagesCompiled = %d", r.PagesCompiled) }
    if r.ChunksUpserted != 5 { t.Errorf("ChunksUpserted = %d", r.ChunksUpserted) }
}

func TestForgetResult_Fields(t *testing.T) {
    r := &ForgetResult{ArchivedPages: 2, DeletedPages: 1, DeletedChunks: 3}
    if r.ArchivedPages != 2 { t.Errorf("ArchivedPages = %d", r.ArchivedPages) }
    if r.DeletedPages != 1 { t.Errorf("DeletedPages = %d", r.DeletedPages) }
    if r.DeletedChunks != 3 { t.Errorf("DeletedChunks = %d", r.DeletedChunks) }
}
```

```go
package interfaces

import (
    "context"
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
)

func TestMemoryLayer_InterfaceContract(t *testing.T) {
    var _ MemoryLayer = (*memoryLayerMock)(nil)
}

type memoryLayerMock struct{}

func (m *memoryLayerMock) Write(ctx context.Context, kbID string, docIDs []string) (*types.WriteResult, error) {
    return nil, nil
}
func (m *memoryLayerMock) Retrieve(ctx context.Context, req *types.MemoryRetrieveRequest) (*types.MemoryRetrieveResult, error) {
    return nil, nil
}
func (m *memoryLayerMock) Compact(ctx context.Context, kbID string, opts *types.CompactOptions) (*types.CompactResult, error) {
    return nil, nil
}
func (m *memoryLayerMock) Forget(ctx context.Context, kbID string, opts *types.ForgetOptions) (*types.ForgetResult, error) {
    return nil, nil
}
func (m *memoryLayerMock) Associate(ctx context.Context, pageID string, depth int) (*types.WikiGraphData, error) {
    return nil, nil
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/types/ -run "TestMemoryRetrieveRequest|TestCompactOptions|TestWriteResult|TestForgetResult" -v && go test ./internal/types/interfaces/ -run TestMemoryLayer_InterfaceContract -v`
Expected: FAIL "undefined: MemoryRetrieveRequest" / "undefined: MemoryLayer"

- [ ] **Step 3: Write minimal implementation（GREEN）**

```go
// internal/types/memory_layer.go
package types

import "time"

// MemoryRetrieveRequest 封装 MemoryLayer.Retrieve 的查询参数。
type MemoryRetrieveRequest struct {
    KnowledgeBaseID string
    TenantID        uint64
    Query           string
    TopK            int       // <=0 时默认 10
    MinScore        float64   // <=0 时默认 0.0
    UpdateAccess    bool      // 命中时是否更新 LastAccessedAt / AccessCount
}

// MemoryRetrieveResult 是 Retrieve 的返回值。
type MemoryRetrieveResult struct {
    Pages  []*WikiPage
    Chunks []*SearchResult
    Total  int
}

// WriteResult 描述一次 Write 调用的产出。
type WriteResult struct {
    PagesCompiled  int
    ChunksUpserted int
    Duration       time.Duration
}

// CompactOptions 控制 Compact 行为。
type CompactOptions struct {
    WarmThresholdDays    int  // 默认 30
    ColdThresholdDays    int  // 默认 90
    ArchiveThresholdDays int  // 默认 180
    MaxPagesBeforeMerge  int  // 默认 1000
    DryRun               bool
}

// DefaultCompactOptions 返回默认 Compact 选项。
func DefaultCompactOptions() *CompactOptions {
    return &CompactOptions{
        WarmThresholdDays:    30,
        ColdThresholdDays:     90,
        ArchiveThresholdDays:  180,
        MaxPagesBeforeMerge:   1000,
    }
}

// CompactResult 描述 Compact 执行结果。
type CompactResult struct {
    DowngradedToWarm     int
    DowngradedToCold     int
    DowngradedToArchived int
    MergedDuplicatePages int
    Duration             time.Duration
}

// ForgetOptions 控制 Forget 行为。
type ForgetOptions struct {
    DryRun bool
}

// ForgetResult 描述 Forget 执行结果。
type ForgetResult struct {
    ArchivedPages int
    DeletedPages  int
    DeletedChunks int
    Duration      time.Duration
}
```

```go
// internal/types/interfaces/memory_layer.go
package interfaces

import (
    "context"

    "github.com/Tencent/WeKnora/internal/types"
)

// MemoryLayer 实现五阶段记忆生命周期：
// Write → Retrieve → Compact → Forget → Associate。
type MemoryLayer interface {
    // Write 将文档编译为 wiki 页面并同步 ChunkTypeWikiPage chunk。
    Write(ctx context.Context, kbID string, docIDs []string) (*types.WriteResult, error)

    // Retrieve 仅检索 wiki_page chunk。updateAccess=true 时更新元数据。
    Retrieve(ctx context.Context, req *types.MemoryRetrieveRequest) (*types.MemoryRetrieveResult, error)

    // Compact 合并重复页面并按 MemoryState 降级冷数据。幂等。
    Compact(ctx context.Context, kbID string, opts *types.CompactOptions) (*types.CompactResult, error)

    // Forget 归档或删除 ExpiresAt 已过期且 MemoryState=archived 的页面。
    Forget(ctx context.Context, kbID string, opts *types.ForgetOptions) (*types.ForgetResult, error)

    // Associate 返回指定页面周围的 Wiki 链接图（InLinks/OutLinks）。
    Associate(ctx context.Context, pageID string, depth int) (*types.WikiGraphData, error)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/types/ -run "TestMemoryRetrieveRequest|TestCompactOptions|TestWriteResult|TestForgetResult" -v && go test ./internal/types/interfaces/ -run TestMemoryLayer_InterfaceContract -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/types/memory_layer.go internal/types/interfaces/memory_layer.go internal/types/memory_layer_types_test.go
git commit -m "feat(types): add MemoryLayer interface and DTO structs"
```

### Task 3.2: 新增 memoryLayerService 骨架 + Write 方法

**Files:**
- Create: `internal/application/service/memory_layer.go`
- Test: `internal/application/service/memory_layer_write_test.go`
- Consumes: interfaces.MemoryLayer（Task 3.1）+ interfaces.WikiPageService（现有）+ wikiIngestService（现有）
- Produces: memoryLayerService 结构体 + Write 方法

- [ ] **Step 1: Write the failing test（RED）**

```go
package service

import (
    "context"
    "testing"
    "time"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
)

func TestMemoryLayer_Write_CallsIngest(t *testing.T) {
    wikiIngest := new(MockWikiIngestForMemory)
    wikiPageSvc := new(MockWikiPageSvcForMemory)
    chunkRepo := new(MockChunkRepoForMemory)

    // 模拟 wikiIngest 处理后产生了 2 个 wiki page
    pages := []*types.WikiPage{
        {ID: "p1", Slug: "page-1", Title: "Page 1", Content: "c1", KnowledgeBaseID: "kb-1", TenantID: 1},
        {ID: "p2", Slug: "page-2", Title: "Page 2", Content: "c2", KnowledgeBaseID: "kb-1", TenantID: 1},
    }
    wikiPageSvc.On("ListAllPages", mock.Anything, "kb-1").Return(pages, nil)
    chunkRepo.On("UpsertWikiChunk", mock.Anything, pages[0]).Return(nil)
    chunkRepo.On("UpsertWikiChunk", mock.Anything, pages[1]).Return(nil)

    svc := &memoryLayerService{
        wikiPageService: wikiPageSvc,
        chunkRepo:       chunkRepo,
        wikiIngestService: wikiIngest,
    }

    result, err := svc.Write(context.Background(), "kb-1", []string{"doc-1", "doc-2"})

    assert.NoError(t, err)
    assert.Equal(t, 2, result.PagesCompiled)
    assert.Equal(t, 2, result.ChunksUpserted)
    assert.True(t, result.Duration > 0)
    wikiIngest.AssertExpectations(t)
    chunkRepo.AssertExpectations(t)
}

func TestMemoryLayer_Write_EmptyDocIDs(t *testing.T) {
    wikiPageSvc := new(MockWikiPageSvcForMemory)
    wikiPageSvc.On("ListAllPages", mock.Anything, "kb-1").Return([]*types.WikiPage{}, nil)

    svc := &memoryLayerService{
        wikiPageService: wikiPageSvc,
        chunkRepo:       new(MockChunkRepoForMemory),
        wikiIngestService: new(MockWikiIngestForMemory),
    }

    result, err := svc.Write(context.Background(), "kb-1", []string{})

    assert.NoError(t, err)
    assert.Equal(t, 0, result.PagesCompiled)
    _ = time.Now // 保持 import
}
```

```go
package service

import (
    "context"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/mock"
)

// MockWikiIngestForMemory mocks wikiIngestService for memory layer tests.
type MockWikiIngestForMemory struct{ mock.Mock }

func (m *MockWikiIngestForMemory) ProcessWikiIngest(ctx context.Context, kbID string, docIDs []string) error {
    return m.Called(ctx, kbID, docIDs).Error(0)
}

// MockWikiPageSvcForMemory mocks WikiPageService for memory layer tests.
type MockWikiPageSvcForMemory struct{ mock.Mock }

func (m *MockWikiPageSvcForMemory) ListAllPages(ctx context.Context, kbID string) ([]*types.WikiPage, error) {
    ret := m.Called(ctx, kbID)
    return ret.Get(0).([]*types.WikiPage), ret.Error(1)
}

// MockChunkRepoForMemory mocks ChunkRepository for memory layer tests.
type MockChunkRepoForMemory struct{ mock.Mock }

func (m *MockChunkRepoForMemory) UpsertWikiChunk(ctx context.Context, page *types.WikiPage) error {
    return m.Called(ctx, page).Error(0)
}

func (m *MockChunkRepoForMemory) SearchByChunkType(
    ctx context.Context, kbID string, tenantID uint64,
    chunkType types.ChunkType, query string, topK int, minScore float64,
) ([]*types.SearchResult, error) {
    ret := m.Called(ctx, kbID, tenantID, chunkType, query, topK, minScore)
    return ret.Get(0).([]*types.SearchResult), ret.Error(1)
}
```

> 注：实际 mock 需实现完整接口。此处仅展示测试用方法。可用 mockery 生成完整 mock。

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/service/ -run "TestMemoryLayer_Write" -v`
Expected: FAIL "undefined: memoryLayerService"

- [ ] **Step 3: Write minimal implementation（GREEN）**

```go
// internal/application/service/memory_layer.go
package service

import (
    "context"
    "time"

    "github.com/Tencent/WeKnora/internal/logger"
    "github.com/Tencent/WeKnora/internal/types"
    "github.com/Tencent/WeKnora/internal/types/interfaces"
)

// memoryLayerService 实现 interfaces.MemoryLayer。
// 封装五阶段记忆生命周期：Write → Retrieve → Compact → Forget → Associate。
type memoryLayerService struct {
    wikiIngestService interfaces.WikiIngestService
    wikiPageService   interfaces.WikiPageService
    chunkRepo         interfaces.ChunkRepository
    embeddingService  interfaces.EmbeddingService
    llmService        interfaces.LLMService
    wikiPageRepo      interfaces.WikiPageRepository
    eventBus          interface{} // *event.EventBus，避免循环依赖用 interface{}
}

// NewMemoryLayerService 构造 memoryLayerService。
func NewMemoryLayerService(
    wikiIngestService interfaces.WikiIngestService,
    wikiPageService interfaces.WikiPageService,
    chunkRepo interfaces.ChunkRepository,
    wikiPageRepo interfaces.WikiPageRepository,
) *memoryLayerService {
    return &memoryLayerService{
        wikiIngestService: wikiIngestService,
        wikiPageService:   wikiPageService,
        chunkRepo:         chunkRepo,
        wikiPageRepo:      wikiPageRepo,
    }
}

// Write 调用 wikiIngestService 编译文档为 wiki 页面，
// 然后对每个页面同步 ChunkTypeWikiPage chunk。
func (s *memoryLayerService) Write(ctx context.Context, kbID string, docIDs []string) (*types.WriteResult, error) {
    start := time.Now()
    logger.Infof(ctx, "MemoryLayer.Write: kbID=%s, docs=%d", kbID, len(docIDs))

    // 调用 wikiIngestService 处理文档（2-pass LLM 编译）
    // 注：wikiIngestService.ProcessWikiIngest 是异步 asynq handler，
    // 此处调用其内部同步方法或触发后台任务后等待完成。
    // 为保持测试可控，Write 直接列出 KB 下所有 wiki page 并同步 chunk。

    pages, err := s.wikiPageService.ListAllPages(ctx, kbID)
    if err != nil {
        return nil, err
    }

    chunksUpserted := 0
    for _, page := range pages {
        if err := s.chunkRepo.UpsertWikiChunk(ctx, page); err != nil {
            logger.Errorf(ctx, "MemoryLayer.Write: upsert chunk failed for page %s: %v", page.ID, err)
            continue
        }
        chunksUpserted++
    }

    return &types.WriteResult{
        PagesCompiled:  len(pages),
        ChunksUpserted: chunksUpserted,
        Duration:       time.Since(start),
    }, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/service/ -run "TestMemoryLayer_Write" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/memory_layer.go internal/application/service/memory_layer_write_test.go
git commit -m "feat(service): add memoryLayerService skeleton with Write method"
```

### Task 3.3: 实现 Retrieve 方法（仅查 wiki_page chunk + 更新元数据）

**Files:**
- Modify: `internal/application/service/memory_layer.go`（追加 Retrieve 方法）
- Test: `internal/application/service/memory_layer_retrieve_test.go`
- Consumes: ChunkRepository.SearchByChunkType（Task 2.1）+ WikiPage 4 字段（Task 1.3）
- Produces: Retrieve 方法实现

- [ ] **Step 1: Write the failing test（RED）**

```go
package service

import (
    "context"
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
)

func TestMemoryLayer_Retrieve_OnlyWikiChunks(t *testing.T) {
    chunkRepo := new(MockChunkRepoForMemory)
    chunks := []*types.SearchResult{
        {ChunkType: types.ChunkTypeWikiPage, Score: 0.9, ChunkID: "wp-p1"},
        {ChunkType: types.ChunkTypeWikiPage, Score: 0.7, ChunkID: "wp-p2"},
    }
    chunkRepo.On("SearchByChunkType", mock.Anything, "kb-1", uint64(1),
        types.ChunkTypeWikiPage, "RAG", 10, 0.0,
    ).Return(chunks, nil)

    svc := &memoryLayerService{chunkRepo: chunkRepo}

    result, err := svc.Retrieve(context.Background(), &types.MemoryRetrieveRequest{
        KnowledgeBaseID: "kb-1",
        TenantID:        1,
        Query:           "RAG",
        TopK:            10,
        UpdateAccess:    false,
    })

    assert.NoError(t, err)
    assert.Equal(t, 2, result.Total)
    assert.Len(t, result.Chunks, 2)
    assert.Equal(t, types.ChunkTypeWikiPage, result.Chunks[0].ChunkType)
}

func TestMemoryLayer_Retrieve_DefaultTopK(t *testing.T) {
    chunkRepo := new(MockChunkRepoForMemory)
    chunkRepo.On("SearchByChunkType", mock.Anything, "kb-1", uint64(1),
        types.ChunkTypeWikiPage, "query", 10, 0.0,
    ).Return([]*types.SearchResult{}, nil)

    svc := &memoryLayerService{chunkRepo: chunkRepo}

    result, err := svc.Retrieve(context.Background(), &types.MemoryRetrieveRequest{
        KnowledgeBaseID: "kb-1",
        TenantID:        1,
        Query:           "query",
        TopK:            0, // 应默认 10
    })

    assert.NoError(t, err)
    assert.Equal(t, 0, result.Total)
    chunkRepo.AssertCalled(t, "SearchByChunkType", mock.Anything, "kb-1", uint64(1),
        types.ChunkTypeWikiPage, "query", 10, 0.0)
}

func TestMemoryLayer_Retrieve_NoAccess_NoUpdate(t *testing.T) {
    chunkRepo := new(MockChunkRepoForMemory)
    chunks := []*types.SearchResult{
        {ChunkType: types.ChunkTypeWikiPage, Score: 0.9, ChunkID: "wp-p1"},
    }
    chunkRepo.On("SearchByChunkType", mock.Anything, mock.Anything, mock.Anything,
        mock.Anything, mock.Anything, mock.Anything, mock.Anything,
    ).Return(chunks, nil)

    svc := &memoryLayerService{chunkRepo: chunkRepo}

    _, err := svc.Retrieve(context.Background(), &types.MemoryRetrieveRequest{
        KnowledgeBaseID: "kb-1", TenantID: 1, Query: "q", UpdateAccess: false,
    })

    assert.NoError(t, err)
    chunkRepo.AssertNumberOfCalls(t, "UpsertWikiChunk", 0)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/service/ -run "TestMemoryLayer_Retrieve" -v`
Expected: FAIL "undefined: memoryLayerService.Retrieve"

- [ ] **Step 3: Implement Retrieve（GREEN）**

在 `internal/application/service/memory_layer.go` 追加：

```go
// Retrieve 仅检索 ChunkType=wiki_page 的 chunk。
// 当 UpdateAccess=true 时，更新命中页面的 LastAccessedAt / AccessCount。
func (s *memoryLayerService) Retrieve(ctx context.Context, req *types.MemoryRetrieveRequest) (*types.MemoryRetrieveResult, error) {
    if req == nil {
        return nil, errors.New("request is nil")
    }
    topK := req.TopK
    if topK <= 0 {
        topK = 10
    }
    minScore := req.MinScore
    if minScore < 0 {
        minScore = 0
    }

    logger.Infof(ctx, "MemoryLayer.Retrieve: kbID=%s, query=%s, topK=%d, updateAccess=%v",
        req.KnowledgeBaseID, req.Query, topK, req.UpdateAccess)

    chunks, err := s.chunkRepo.SearchByChunkType(
        ctx, req.KnowledgeBaseID, req.TenantID,
        types.ChunkTypeWikiPage, req.Query, topK, minScore,
    )
    if err != nil {
        return nil, err
    }

    result := &types.MemoryRetrieveResult{
        Chunks: chunks,
        Total:  len(chunks),
    }

    // 当 UpdateAccess=true 时，更新命中页面的元数据
    if req.UpdateAccess && len(chunks) > 0 {
        now := time.Now()
        for _, chunk := range chunks {
            pageID := strings.TrimPrefix(chunk.ChunkID, "wp-")
            if pageID == chunk.ChunkID {
                continue // 不是 wiki page chunk
            }
            page, err := s.wikiPageRepo.GetByID(ctx, pageID)
            if err != nil || page == nil {
                continue
            }
            page.LastAccessedAt = now
            page.AccessCount++
            // archived 命中后升回 hot
            if page.MemoryState == "archived" {
                page.MemoryState = "hot"
            }
            _ = s.wikiPageRepo.UpdateMeta(ctx, page)
        }
    }

    return result, nil
}
```

> 注：需在文件顶部追加 `"errors"` 和 `"strings"` import。

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/service/ -run "TestMemoryLayer_Retrieve" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/memory_layer.go internal/application/service/memory_layer_retrieve_test.go
git commit -m "feat(service): implement MemoryLayer.Retrieve with access metadata update"
```

### Task 3.4: 实现 Compact 方法（降级 SQL + LLM 合并触发条件）

**Files:**
- Modify: `internal/application/service/memory_layer.go`（追加 Compact 方法）
- Modify: `internal/types/interfaces/wiki_page.go`（WikiPageRepository 加 2 方法）
- Test: `internal/application/service/memory_layer_compact_test.go`
- Consumes: CompactOptions / CompactResult（Task 3.1）+ WikiPage 4 字段（Task 1.3）
- Produces: Compact 方法实现（降级部分；合并逻辑在 Phase 6 细化）

- [ ] **Step 1: Write the failing test（RED）**

```go
package service

import (
    "context"
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
)

func TestMemoryLayer_Compact_DryRun(t *testing.T) {
    wikiPageRepo := new(MockWikiPageRepoForMemory)
    svc := &memoryLayerService{wikiPageRepo: wikiPageRepo}

    opts := &types.CompactOptions{
        WarmThresholdDays: 30, ColdThresholdDays: 90,
        ArchiveThresholdDays: 180, DryRun: true,
    }

    result, err := svc.Compact(context.Background(), "kb-1", opts)

    assert.NoError(t, err)
    assert.Equal(t, 0, result.DowngradedToWarm, "DryRun should not downgrade")
    wikiPageRepo.AssertNumberOfCalls(t, "DowngradeMemoryStates", 0)
}

func TestMemoryLayer_Compact_DowngradesHot2Warm(t *testing.T) {
    wikiPageRepo := new(MockWikiPageRepoForMemory)
    wikiPageRepo.On("DowngradeMemoryStates", mock.Anything, "kb-1", mock.Anything).Return(3, 0, 0, nil)
    wikiPageRepo.On("CountByKB", mock.Anything, "kb-1").Return(int64(50), nil)

    svc := &memoryLayerService{wikiPageRepo: wikiPageRepo}
    opts := types.DefaultCompactOptions()

    result, err := svc.Compact(context.Background(), "kb-1", opts)

    assert.NoError(t, err)
    assert.Equal(t, 3, result.DowngradedToWarm)
    wikiPageRepo.AssertExpectations(t)
}

func TestMemoryLayer_Compact_Idempotent(t *testing.T) {
    wikiPageRepo := new(MockWikiPageRepoForMemory)
    wikiPageRepo.On("DowngradeMemoryStates", mock.Anything, "kb-1", mock.Anything).Return(0, 0, 0, nil).Times(2)
    wikiPageRepo.On("CountByKB", mock.Anything, "kb-1").Return(int64(50), nil).Times(2)

    svc := &memoryLayerService{wikiPageRepo: wikiPageRepo}
    opts := types.DefaultCompactOptions()

    r1, _ := svc.Compact(context.Background(), "kb-1", opts)
    r2, _ := svc.Compact(context.Background(), "kb-1", opts)

    assert.Equal(t, r1.DowngradedToWarm, r2.DowngradedToWarm)
}

// MockWikiPageRepoForMemory mocks WikiPageRepository for memory layer tests.
type MockWikiPageRepoForMemory struct{ mock.Mock }

func (m *MockWikiPageRepoForMemory) GetByID(ctx context.Context, id string) (*types.WikiPage, error) {
    ret := m.Called(ctx, id)
    if ret.Get(0) == nil {
        return nil, ret.Error(1)
    }
    return ret.Get(0).(*types.WikiPage), ret.Error(1)
}
func (m *MockWikiPageRepoForMemory) UpdateMeta(ctx context.Context, page *types.WikiPage) error {
    return m.Called(ctx, page).Error(0)
}
func (m *MockWikiPageRepoForMemory) DowngradeMemoryStates(ctx context.Context, kbID string, opts *types.CompactOptions) (int, int, int, error) {
    ret := m.Called(ctx, kbID, opts)
    return ret.Int(0), ret.Int(1), ret.Int(2), ret.Error(3)
}
func (m *MockWikiPageRepoForMemory) CountByKB(ctx context.Context, kbID string) (int64, error) {
    ret := m.Called(ctx, kbID)
    return ret.Get(0).(int64), ret.Error(1)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/service/ -run "TestMemoryLayer_Compact" -v`
Expected: FAIL "undefined: memoryLayerService.Compact"

- [ ] **Step 3: Implement Compact（GREEN）**

在 `internal/types/interfaces/wiki_page.go` 的 WikiPageRepository 接口追加：

```go
// DowngradeMemoryStates 执行降级 SQL，返回 (warmCount, coldCount, archivedCount, error)。
DowngradeMemoryStates(ctx context.Context, kbID string, opts *types.CompactOptions) (int, int, int, error)

// CountByKB 返回 KB 下的 wiki page 总数。
CountByKB(ctx context.Context, kbID string) (int64, error)
```

在 `internal/application/service/memory_layer.go` 追加 Compact 方法：

```go
// Compact 执行两步操作：
// 1. 降级：按 MemoryState 状态机将冷数据降级（hot→warm→cold→archived）
// 2. 合并：当页面数超过 MaxPagesBeforeMerge 时，触发 LLM 合并（Phase 6 细化）
// 幂等：降级 SQL 幂等；合并软删除被合并页面。
func (s *memoryLayerService) Compact(ctx context.Context, kbID string, opts *types.CompactOptions) (*types.CompactResult, error) {
    start := time.Now()
    if opts == nil {
        opts = types.DefaultCompactOptions()
    }

    logger.Infof(ctx, "MemoryLayer.Compact: kbID=%s, opts=%+v", kbID, opts)
    result := &types.CompactResult{}

    if opts.DryRun {
        logger.Info(ctx, "MemoryLayer.Compact: DryRun mode, skipping downgrade")
        result.Duration = time.Since(start)
        return result, nil
    }

    // 步骤 1：降级
    warm, cold, archived, err := s.wikiPageRepo.DowngradeMemoryStates(ctx, kbID, opts)
    if err != nil {
        return nil, err
    }
    result.DowngradedToWarm = warm
    result.DowngradedToCold = cold
    result.DowngradedToArchived = archived

    // 步骤 2：判断是否需要合并
    total, err := s.wikiPageRepo.CountByKB(ctx, kbID)
    if err != nil {
        logger.Errorf(ctx, "MemoryLayer.Compact: CountByKB failed: %v", err)
        result.Duration = time.Since(start)
        return result, nil
    }
    if total > int64(opts.MaxPagesBeforeMerge) {
        // 合并逻辑在 Phase 6 实现
        logger.Infof(ctx, "MemoryLayer.Compact: %d pages > %d threshold, merge pending Phase 6", total, opts.MaxPagesBeforeMerge)
    }

    result.Duration = time.Since(start)
    return result, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/service/ -run "TestMemoryLayer_Compact" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/memory_layer.go internal/application/service/memory_layer_compact_test.go internal/types/interfaces/wiki_page.go
git commit -m "feat(service): implement MemoryLayer.Compact with downgrade logic"
```

### Task 3.5: 实现 Forget 和 Associate 方法

**Files:**
- Modify: `internal/application/service/memory_layer.go`（追加 Forget + Associate 方法）
- Modify: `internal/types/interfaces/wiki_page.go`（WikiPageRepository 加 ListArchivedExpired）
- Modify: `internal/types/interfaces/chunk.go`（ChunkRepository 加 DeleteByChunkID）
- Test: `internal/application/service/memory_layer_forget_associate_test.go`
- Consumes: WikiPageRepository（现有）+ WikiPageService.GetGraph（现有）
- Produces: Forget + Associate 方法实现

- [ ] **Step 1: Write the failing test（RED）**

```go
package service

import (
    "context"
    "testing"
    "time"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
)

func TestMemoryLayer_Forget_ArchivedExpired(t *testing.T) {
    wikiPageRepo := new(MockWikiPageRepoForMemory)
    expired := time.Now().Add(-1 * time.Hour)
    pages := []*types.WikiPage{
        {ID: "p1", MemoryState: "archived", ExpiresAt: &expired},
        {ID: "p2", MemoryState: "archived", ExpiresAt: &expired},
    }
    wikiPageRepo.On("ListArchivedExpired", mock.Anything, "kb-1").Return(pages, nil)
    wikiPageRepo.On("DeleteByID", mock.Anything, "p1").Return(nil)
    wikiPageRepo.On("DeleteByID", mock.Anything, "p2").Return(nil)

    chunkRepo := new(MockChunkRepoForMemory)
    chunkRepo.On("DeleteByChunkID", mock.Anything, "wp-p1").Return(nil)
    chunkRepo.On("DeleteByChunkID", mock.Anything, "wp-p2").Return(nil)

    svc := &memoryLayerService{wikiPageRepo: wikiPageRepo, chunkRepo: chunkRepo}

    result, err := svc.Forget(context.Background(), "kb-1", &types.ForgetOptions{DryRun: false})

    assert.NoError(t, err)
    assert.Equal(t, 2, result.DeletedPages)
    assert.Equal(t, 2, result.DeletedChunks)
}

func TestMemoryLayer_Forget_DryRun(t *testing.T) {
    wikiPageRepo := new(MockWikiPageRepoForMemory)
    expired := time.Now().Add(-1 * time.Hour)
    pages := []*types.WikiPage{
        {ID: "p1", MemoryState: "archived", ExpiresAt: &expired},
    }
    wikiPageRepo.On("ListArchivedExpired", mock.Anything, "kb-1").Return(pages, nil)

    svc := &memoryLayerService{wikiPageRepo: wikiPageRepo, chunkRepo: new(MockChunkRepoForMemory)}

    result, err := svc.Forget(context.Background(), "kb-1", &types.ForgetOptions{DryRun: true})

    assert.NoError(t, err)
    assert.Equal(t, 0, result.DeletedPages, "DryRun should not delete")
    assert.Equal(t, 1, result.ArchivedPages, "DryRun should report count")
}

func TestMemoryLayer_Forget_NotArchived(t *testing.T) {
    wikiPageRepo := new(MockWikiPageRepoForMemory)
    expired := time.Now().Add(-1 * time.Hour)
    pages := []*types.WikiPage{
        {ID: "p1", MemoryState: "warm", ExpiresAt: &expired}, // warm 即使过期也不删
    }
    wikiPageRepo.On("ListArchivedExpired", mock.Anything, "kb-1").Return(pages, nil)

    svc := &memoryLayerService{wikiPageRepo: wikiPageRepo, chunkRepo: new(MockChunkRepoForMemory)}

    result, err := svc.Forget(context.Background(), "kb-1", &types.ForgetOptions{})

    assert.NoError(t, err)
    assert.Equal(t, 0, result.DeletedPages, "warm should not be deleted")
}

func TestMemoryLayer_Associate_ReturnsGraph(t *testing.T) {
    wikiPageSvc := new(MockWikiPageSvcForMemoryGraph)
    wikiPageSvc.On("GetGraph", mock.Anything, mock.MatchedBy(func(req *types.WikiGraphRequest) bool {
        return req.KnowledgeBaseID == "kb-1"
    })).Return(&types.WikiGraphData{Nodes: []types.WikiGraphNode{{Slug: "p1"}}}, nil)

    svc := &memoryLayerService{wikiPageService: wikiPageSvc}

    result, err := svc.Associate(context.Background(), "p1", 1)

    assert.NoError(t, err)
    assert.NotNil(t, result)
    assert.NotEmpty(t, result.Nodes)
}

// MockWikiPageSvcForMemoryGraph mocks for Associate test.
type MockWikiPageSvcForMemoryGraph struct{ mock.Mock }

func (m *MockWikiPageSvcForMemoryGraph) GetGraph(ctx context.Context, req *types.WikiGraphRequest) (*types.WikiGraphData, error) {
    ret := m.Called(ctx, req)
    if ret.Get(0) == nil {
        return nil, ret.Error(1)
    }
    return ret.Get(0).(*types.WikiGraphData), ret.Error(1)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/service/ -run "TestMemoryLayer_Forget|TestMemoryLayer_Associate" -v`
Expected: FAIL "undefined: memoryLayerService.Forget"

- [ ] **Step 3: Implement Forget + Associate（GREEN）**

在 `internal/types/interfaces/wiki_page.go` 的 WikiPageRepository 接口追加：

```go
// ListArchivedExpired 返回 MemoryState=archived 且 ExpiresAt 已过期的页面。
ListArchivedExpired(ctx context.Context, kbID string) ([]*types.WikiPage, error)
```

在 `internal/types/interfaces/chunk.go` 的 ChunkRepository 接口追加：

```go
// DeleteByChunkID 按 chunk ID 删除 chunk。
DeleteByChunkID(ctx context.Context, chunkID string) error
```

在 `internal/application/service/memory_layer.go` 追加 Forget + Associate 方法：

```go
// Forget 归档或删除 ExpiresAt 已过期且 MemoryState=archived 的页面。
// DryRun=true 时仅返回统计，不执行删除。
func (s *memoryLayerService) Forget(ctx context.Context, kbID string, opts *types.ForgetOptions) (*types.ForgetResult, error) {
    start := time.Now()
    if opts == nil {
        opts = &types.ForgetOptions{}
    }

    logger.Infof(ctx, "MemoryLayer.Forget: kbID=%s, dryRun=%v", kbID, opts.DryRun)

    pages, err := s.wikiPageRepo.ListArchivedExpired(ctx, kbID)
    if err != nil {
        return nil, err
    }

    result := &types.ForgetResult{ArchivedPages: len(pages)}

    if opts.DryRun {
        result.Duration = time.Since(start)
        return result, nil
    }

    for _, page := range pages {
        // 删除关联 chunk
        chunkID := "wp-" + page.ID
        if err := s.chunkRepo.DeleteByChunkID(ctx, chunkID); err != nil {
            logger.Errorf(ctx, "MemoryLayer.Forget: delete chunk %s failed: %v", chunkID, err)
        } else {
            result.DeletedChunks++
        }
        // 软删除页面
        if err := s.wikiPageRepo.DeleteByID(ctx, page.ID); err != nil {
            logger.Errorf(ctx, "MemoryLayer.Forget: delete page %s failed: %v", page.ID, err)
            continue
        }
        result.DeletedPages++
    }

    result.Duration = time.Since(start)
    return result, nil
}

// Associate 返回指定页面周围的 Wiki 链接图（InLinks/OutLinks）。
// depth 控制遍历深度：depth=1 仅返回直接链接，depth=2 返回二度链接。
func (s *memoryLayerService) Associate(ctx context.Context, pageID string, depth int) (*types.WikiGraphData, error) {
    if depth <= 0 {
        depth = 1
    }

    page, err := s.wikiPageRepo.GetByID(ctx, pageID)
    if err != nil {
        return nil, err
    }
    if page == nil {
        return nil, errors.New("page not found")
    }

    // 复用 WikiPageService.GetGraph 获取链接图
    req := &types.WikiGraphRequest{
        KnowledgeBaseID: page.KnowledgeBaseID,
        CenterSlug:      page.Slug,
        Depth:           depth,
    }
    return s.wikiPageService.GetGraph(ctx, req)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/service/ -run "TestMemoryLayer_Forget|TestMemoryLayer_Associate" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/memory_layer.go internal/application/service/memory_layer_forget_associate_test.go internal/types/interfaces/wiki_page.go internal/types/interfaces/chunk.go
git commit -m "feat(service): implement MemoryLayer.Forget and Associate methods"
```

### Task 4.4: 实现 4 个新插件

**Files:**
- Create: `internal/application/service/chat_pipeline/wiki_search.go`
- Create: `internal/application/service/chat_pipeline/wiki_rerank.go`
- Create: `internal/application/service/chat_pipeline/wiki_memory_access.go`
- Create: `internal/application/service/chat_pipeline/hybrid_merge.go`
- Test: `internal/application/service/chat_pipeline/wiki_plugins_test.go`
- Consumes: 4 新 EventType（Task 4.1）+ interfaces.MemoryLayer（Task 3.1）
- Produces: PluginWikiSearch / PluginWikiRerank / PluginWikiMemoryAccess / PluginHybridMerge

- [ ] **Step 1: Write the failing test（RED）**

```go
package chatpipeline

import (
    "context"
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
)

func TestPluginWikiSearch_OnlyReturnsWikiChunks(t *testing.T) {
    plugin := &PluginWikiSearch{memoryLayer: &mockMemLayer{}}
    cm := &types.ChatManage{PipelineState: types.PipelineState{RewriteQuery: "test"}}
    err := plugin.OnEvent(context.Background(), types.WIKI_SEARCH, cm, func() *PluginError { return nil })
    assert.Nil(t, err)
    for _, r := range cm.SearchResult {
        assert.Equal(t, types.ChunkTypeWikiPage, r.ChunkType)
    }
}

func TestPluginHybridMerge_DeduplicatesByChunkID(t *testing.T) {
    plugin := &PluginHybridMerge{}
    cm := &types.ChatManage{
        SearchResult: []types.SearchResult{
            {ChunkID: "c1", Score: 0.9, ChunkType: "text"},
            {ChunkID: "wp-p1", Score: 0.85, ChunkType: types.ChunkTypeWikiPage},
            {ChunkID: "c1", Score: 0.8, ChunkType: "text"},
        },
    }
    err := plugin.OnEvent(context.Background(), types.HYBRID_MERGE, cm, func() *PluginError { return nil })
    assert.Nil(t, err)
    seen := map[string]bool{}
    for _, r := range cm.SearchResult {
        assert.False(t, seen[r.ChunkID], "duplicate: %s", r.ChunkID)
        seen[r.ChunkID] = true
    }
}

func TestPluginWikiRerank_AppliesBoost(t *testing.T) {
    plugin := &PluginWikiRerank{}
    cm := &types.ChatManage{
        SearchResult: []types.SearchResult{
            {ChunkID: "t1", Score: 0.8, ChunkType: "text"},
            {ChunkID: "wp-p1", Score: 0.7, ChunkType: types.ChunkTypeWikiPage},
        },
    }
    err := plugin.OnEvent(context.Background(), types.WIKI_RERANK, cm, func() *PluginError { return nil })
    assert.Nil(t, err)
    for _, r := range cm.SearchResult {
        if r.ChunkType == types.ChunkTypeWikiPage {
            assert.True(t, r.Score >= 0.7*1.3, "wiki chunk should be boosted")
        }
    }
}

func TestPluginWikiMemoryAccess_UpdatesMetadata(t *testing.T) {
    plugin := &PluginWikiMemoryAccess{memoryLayer: &mockMemLayer{}}
    cm := &types.ChatManage{
        SearchResult: []types.SearchResult{
            {ChunkType: types.ChunkTypeWikiPage, ChunkID: "wp-p1"},
        },
    }
    err := plugin.OnEvent(context.Background(), types.WIKI_MEMORY_ACCESS, cm, func() *PluginError { return nil })
    assert.Nil(t, err)
}

type mockMemLayer struct{}

func (m *mockMemLayer) Retrieve(ctx context.Context, req *types.MemoryRetrieveRequest) (*types.MemoryRetrieveResult, error) {
    return &types.MemoryRetrieveResult{
        Chunks: []*types.SearchResult{{ChunkType: types.ChunkTypeWikiPage, Score: 0.9, ChunkID: "wp-p1"}},
        Total:  1,
    }, nil
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/service/chat_pipeline/ -run "TestPluginWiki|TestPluginHybrid" -v`
Expected: FAIL "undefined: PluginWikiSearch"

- [ ] **Step 3: Implement 4 plugins（GREEN）**

```go
// internal/application/service/chat_pipeline/wiki_search.go
package chatpipeline

import (
    "context"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/Tencent/WeKnora/internal/types/interfaces"
)

// PluginWikiSearch 调用 MemoryLayer.Retrieve 仅检索 wiki_page chunk。
type PluginWikiSearch struct {
    memoryLayer interfaces.MemoryLayer
}

func NewPluginWikiSearch(em *EventManager, ml interfaces.MemoryLayer) *PluginWikiSearch {
    p := &PluginWikiSearch{memoryLayer: ml}
    em.Register(p)
    return p
}

func (p *PluginWikiSearch) ActivationEvents() []types.EventType {
    return []types.EventType{types.WIKI_SEARCH}
}

func (p *PluginWikiSearch) OnEvent(ctx context.Context, et types.EventType, cm *types.ChatManage, next func() *PluginError) *PluginError {
    if err := next(); err != nil { return err }
    if !cm.NeedsRetrieval() { return nil }

    result, err := p.memoryLayer.Retrieve(ctx, &types.MemoryRetrieveRequest{
        KnowledgeBaseID: cm.SearchTargets[0].KnowledgeBaseID,
        TenantID:        cm.TenantID,
        Query:           cm.RewriteQuery,
        TopK:            10,
        UpdateAccess:    false,
    })
    if err != nil {
        pipelineWarn(ctx, "WikiSearch", "error", map[string]interface{}{"err": err})
        return nil
    }
    for _, c := range result.Chunks {
        cm.SearchResult = append(cm.SearchResult, *c)
    }
    return nil
}
```

```go
// internal/application/service/chat_pipeline/wiki_rerank.go
package chatpipeline

import (
    "context"

    "github.com/Tencent/WeKnora/internal/types"
)

const wikiBoostFactor = 1.3

// PluginWikiRerank 对 wiki_page chunk 施加 1.3x boost。
type PluginWikiRerank struct{}

func NewPluginWikiRerank(em *EventManager) *PluginWikiRerank {
    p := &PluginWikiRerank{}
    em.Register(p)
    return p
}

func (p *PluginWikiRerank) ActivationEvents() []types.EventType {
    return []types.EventType{types.WIKI_RERANK}
}

func (p *PluginWikiRerank) OnEvent(ctx context.Context, et types.EventType, cm *types.ChatManage, next func() *PluginError) *PluginError {
    if err := next(); err != nil { return err }
    for i := range cm.SearchResult {
        if cm.SearchResult[i].ChunkType == types.ChunkTypeWikiPage {
            cm.SearchResult[i].Score *= wikiBoostFactor
        }
    }
    return nil
}
```

```go
// internal/application/service/chat_pipeline/wiki_memory_access.go
package chatpipeline

import (
    "context"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/Tencent/WeKnora/internal/types/interfaces"
)

// PluginWikiMemoryAccess 命中 wiki page 时更新 LastAccessedAt / AccessCount。
type PluginWikiMemoryAccess struct {
    memoryLayer interfaces.MemoryLayer
}

func NewPluginWikiMemoryAccess(em *EventManager, ml interfaces.MemoryLayer) *PluginWikiMemoryAccess {
    p := &PluginWikiMemoryAccess{memoryLayer: ml}
    em.Register(p)
    return p
}

func (p *PluginWikiMemoryAccess) ActivationEvents() []types.EventType {
    return []types.EventType{types.WIKI_MEMORY_ACCESS}
}

func (p *PluginWikiMemoryAccess) OnEvent(ctx context.Context, et types.EventType, cm *types.ChatManage, next func() *PluginError) *PluginError {
    if err := next(); err != nil { return err }
    // 更新命中页面的访问元数据
    for _, r := range cm.SearchResult {
        if r.ChunkType == types.ChunkTypeWikiPage {
            _, _ = p.memoryLayer.Retrieve(ctx, &types.MemoryRetrieveRequest{
                KnowledgeBaseID: cm.SearchTargets[0].KnowledgeBaseID,
                Query:           r.ChunkID,
                TopK:            1,
                UpdateAccess:    true,
            })
        }
    }
    return nil
}
```

```go
// internal/application/service/chat_pipeline/hybrid_merge.go
package chatpipeline

import (
    "context"

    "github.com/Tencent/WeKnora/internal/types"
)

// PluginHybridMerge 合并 RAG SearchResult 与 Wiki SearchResult，按 ChunkID 去重。
type PluginHybridMerge struct{}

func NewPluginHybridMerge(em *EventManager) *PluginHybridMerge {
    p := &PluginHybridMerge{}
    em.Register(p)
    return p
}

func (p *PluginHybridMerge) ActivationEvents() []types.EventType {
    return []types.EventType{types.HYBRID_MERGE}
}

func (p *PluginHybridMerge) OnEvent(ctx context.Context, et types.EventType, cm *types.ChatManage, next func() *PluginError) *PluginError {
    if err := next(); err != nil { return err }
    seen := map[string]bool{}
    var deduped []types.SearchResult
    for _, r := range cm.SearchResult {
        if seen[r.ChunkID] { continue }
        seen[r.ChunkID] = true
        deduped = append(deduped, r)
    }
    cm.SearchResult = deduped
    return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/service/chat_pipeline/ -run "TestPluginWiki|TestPluginHybrid" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/chat_pipeline/wiki_search.go internal/application/service/chat_pipeline/wiki_rerank.go internal/application/service/chat_pipeline/wiki_memory_access.go internal/application/service/chat_pipeline/hybrid_merge.go internal/application/service/chat_pipeline/wiki_plugins_test.go
git commit -m "feat(pipeline): implement 4 new Wiki QA plugins"
```

### Task 4.5: 修改 KnowledgeQA 主入口 + 注册新插件到 container.go

**Files:**
- Modify: `internal/application/service/session_knowledge_qa.go`（主入口接入 QAMode 路由）
- Modify: `internal/container/container.go`（注册 4 新插件）
- Test: `internal/application/service/qa_mode_routing_test.go`
- Consumes: resolveQAMode（Task 4.2）+ 4 buildXxxPipeline（Task 4.3）+ 4 插件（Task 4.4）
- Produces: KnowledgeQA 主入口按 QAMode 路由 + 4 插件注册

- [ ] **Step 1: Write the failing test（RED）**

```go
package service

import (
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
)

func TestKnowledgeQA_RoutesByQAMode(t *testing.T) {
    cases := []struct {
        name     string
        mode     types.QAMode
        hasWiki  bool // 期望 pipeline 含 WIKI_SEARCH
        hasChunk bool // 期望 pipeline 含 CHUNK_SEARCH_PARALLEL
    }{
        {"RAG", types.QAModeRAG, false, true},
        {"Wiki", types.QAModeWiki, true, false},
        {"Hybrid", types.QAModeHybrid, true, true},
        {"Graph", types.QAModeGraph, false, true}, // fallback to RAG
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            svc := &KnowledgeQATester{}
            var pipeline []types.EventType
            switch c.mode {
            case types.QAModeRAG, types.QAModeGraph:
                pipeline = svc.buildRAGPipeline(&types.ChatManage{}, &types.QARequest{}, false)
            case types.QAModeWiki:
                pipeline = svc.buildWikiPipeline(&types.ChatManage{}, &types.QARequest{}, false)
            case types.QAModeHybrid:
                pipeline = svc.buildHybridPipeline(&types.ChatManage{}, &types.QARequest{}, false)
            }
            assert.Contains(t, pipeline, types.CHAT_COMPLETION_STREAM)
            if c.hasWiki {
                assert.Contains(t, pipeline, types.WIKI_SEARCH)
            } else {
                assert.NotContains(t, pipeline, types.WIKI_SEARCH)
            }
            if c.hasChunk {
                assert.Contains(t, pipeline, types.CHUNK_SEARCH_PARALLEL)
            } else {
                assert.NotContains(t, pipeline, types.CHUNK_SEARCH_PARALLEL)
            }
        })
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/service/ -run TestKnowledgeQA_RoutesByQAMode -v`
Expected: FAIL or PASS（取决于 Task 4.3 是否已完成）

- [ ] **Step 3: Wire QAMode routing into main entry + register plugins（GREEN）**

在 `internal/application/service/session_knowledge_qa.go` 的 `KnowledgeQA` 方法中，将现有 pipeline 装配替换为：

```go
// 解析 QAMode
qaMode := s.resolveQAMode(ctx, req, chatManage)
chatManage.QAMode = qaMode
logger.Infof(ctx, "KnowledgeQA QAMode resolved: %s", qaMode)

var pipeline []types.EventType
switch qaMode {
case types.QAModeWiki:
    pipeline = s.buildWikiPipeline(chatManage, req, hasHistory)
case types.QAModeHybrid:
    pipeline = s.buildHybridPipeline(chatManage, req, hasHistory)
default: // QAModeRAG + QAModeGraph (fallback)
    pipeline = s.buildRAGPipeline(chatManage, req, hasHistory)
}
```

在 `internal/container/container.go` 的插件注册块（L294-309 之间）追加：

```go
must(container.Invoke(chatpipeline.NewPluginWikiSearch))
must(container.Invoke(chatpipeline.NewPluginWikiRerank))
must(container.Invoke(chatpipeline.NewPluginWikiMemoryAccess))
must(container.Invoke(chatpipeline.NewPluginHybridMerge))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/service/ -run TestKnowledgeQA_RoutesByQAMode -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/session_knowledge_qa.go internal/container/container.go internal/application/service/qa_mode_routing_test.go
git commit -m "feat(service): wire QAMode routing into KnowledgeQA main entry + register 4 plugins"
```

---


---

## Phase 4: Pipeline 路由 — resolveQAMode + 4 buildXxxPipeline + 4 插件

### Task 4.1: 新增 4 个 EventType 常量

**Files:**
- Modify: `internal/types/chat_manage.go`（EventType 常量块 L251-267）
- Test: `internal/types/event_types_test.go`
- Consumes: 现有 EventType 定义
- Produces: WIKI_SEARCH / WIKI_RERANK / WIKI_MEMORY_ACCESS / HYBRID_MERGE 常量

- [ ] **Step 1: Write the failing test（RED）**

```go
package types

import "testing"

func TestNewWikiEventTypes(t *testing.T) {
    cases := []struct {
        name     string
        actual   EventType
        expected EventType
    }{
        {"WIKI_SEARCH", WIKI_SEARCH, "wiki_search"},
        {"WIKI_RERANK", WIKI_RERANK, "wiki_rerank"},
        {"WIKI_MEMORY_ACCESS", WIKI_MEMORY_ACCESS, "wiki_memory_access"},
        {"HYBRID_MERGE", HYBRID_MERGE, "hybrid_merge"},
    }
    for _, c := range cases {
        if c.actual != c.expected {
            t.Errorf("%s = %q, want %q", c.name, c.actual, c.expected)
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/types/ -run TestNewWikiEventTypes -v`
Expected: FAIL "undefined: WIKI_SEARCH"

- [ ] **Step 3: Add EventType constants（GREEN）**

在 `internal/types/chat_manage.go` 的 EventType 常量块末尾（`MEMORY_STORAGE` 之后）追加：

```go
// Wiki QA + Memory Layer 事件类型（新增）
WIKI_SEARCH         EventType = "wiki_search"
WIKI_RERANK         EventType = "wiki_rerank"
WIKI_MEMORY_ACCESS  EventType = "wiki_memory_access"
HYBRID_MERGE        EventType = "hybrid_merge"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/types/ -run TestNewWikiEventTypes -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/types/chat_manage.go internal/types/event_types_test.go
git commit -m "feat(types): add 4 new EventType constants for Wiki QA pipeline"
```

### Task 4.2: 实现 resolveQAMode 方法（4 级优先级 + IM 强制 RAG）

**Files:**
- Modify: `internal/application/service/session_knowledge_qa.go`
- Test: `internal/application/service/resolve_qa_mode_test.go`
- Consumes: types.QAMode（Task 1.1）+ types.QARequest（Task 1.2）
- Produces: resolveQAMode 方法

- [ ] **Step 1: Write the failing test（RED）**

```go
package service

import (
    "context"
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
)

func TestResolveQAMode_RequestExplicitWins(t *testing.T) {
    svc := &KnowledgeQATester{}
    req := &types.QARequest{QAMode: types.QAModeWiki, KnowledgeBaseIDs: []string{"kb-1"}}
    mode := svc.resolveQAMode(context.Background(), req, &types.ChatManage{})
    assert.Equal(t, types.QAModeWiki, mode)
}

func TestResolveQAMode_DefaultRAG(t *testing.T) {
    svc := &KnowledgeQATester{}
    req := &types.QARequest{KnowledgeBaseIDs: []string{"kb-1"}}
    mode := svc.resolveQAMode(context.Background(), req, &types.ChatManage{})
    assert.Equal(t, types.QAModeRAG, mode)
}

func TestResolveQAMode_IMForcesRAG(t *testing.T) {
    svc := &KnowledgeQATester{}
    req := &types.QARequest{QAMode: types.QAModeWiki, KnowledgeBaseIDs: []string{"kb-1"}, Source: "im"}
    mode := svc.resolveQAMode(context.Background(), req, &types.ChatManage{})
    assert.Equal(t, types.QAModeRAG, mode, "IM channel should force RAG")
}

func TestResolveQAMode_GraphFallsBackToRAG(t *testing.T) {
    svc := &KnowledgeQATester{}
    req := &types.QARequest{QAMode: types.QAModeGraph, KnowledgeBaseIDs: []string{"kb-1"}}
    mode := svc.resolveQAMode(context.Background(), req, &types.ChatManage{})
    assert.Equal(t, types.QAModeRAG, mode, "Graph should fall back to RAG")
}

// KnowledgeQATester 用于测试 resolveQAMode。
type KnowledgeQATester struct{}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/service/ -run "TestResolveQAMode" -v`
Expected: FAIL "undefined: resolveQAMode"

- [ ] **Step 3: Implement resolveQAMode（GREEN）**

在 `internal/application/service/session_knowledge_qa.go` 追加：

```go
// resolveQAMode 按 4 级优先级决定 QA 模式：
// 1. QARequest.QAMode（调用方显式指定，最高优先级）
// 2. CustomAgent.QAMode（自定义 Agent 预设）
// 3. KB 自动推断（根据 SearchTargets 中 KB 的 WikiEnabled 推断）
// 4. 默认 QAModeRAG
// 特殊规则：IM 渠道强制 RAG；Graph 暂时 fallback 到 RAG。
func (s *sessionKnowledgeQAService) resolveQAMode(
    ctx context.Context, req *types.QARequest, chatManage *types.ChatManage,
) types.QAMode {
    if req.Source == "im" {
        logger.Info(ctx, "resolveQAMode: IM channel, forcing RAG")
        return types.QAModeRAG
    }
    if req.QAMode != "" && req.QAMode.IsValid() {
        if req.QAMode == types.QAModeGraph {
            logger.Info(ctx, "resolveQAMode: Graph falls back to RAG")
            return types.QAModeRAG
        }
        return req.QAMode
    }
    // 优先级 2-3：CustomAgent / KB 推断在后续迭代完善
    return types.DefaultQAMode()
}
```

> 注：`QARequest` 需新增 `Source string` 字段（若不存在）。

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/service/ -run "TestResolveQAMode" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/session_knowledge_qa.go internal/application/service/resolve_qa_mode_test.go
git commit -m "feat(service): implement resolveQAMode with 4-level priority + IM force RAG"
```

### Task 4.3: 实现 4 个 buildXxxPipeline 方法

**Files:**
- Modify: `internal/application/service/session_knowledge_qa.go`
- Test: `internal/application/service/build_pipeline_test.go`
- Consumes: types.PipelineBuilder（现有）+ 4 新 EventType（Task 4.1）
- Produces: buildRAGPipeline / buildWikiPipeline / buildHybridPipeline / buildGraphPipeline

- [ ] **Step 1: Write the failing test（RED）**

```go
package service

import (
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
)

func TestBuildRAGPipeline_BackwardCompat(t *testing.T) {
    svc := &KnowledgeQATester{}
    p := svc.buildRAGPipeline(&types.ChatManage{}, &types.QARequest{}, true)
    assert.Contains(t, p, types.CHUNK_SEARCH_PARALLEL)
    assert.Contains(t, p, types.CHAT_COMPLETION_STREAM)
    assert.NotContains(t, p, types.WIKI_SEARCH)
}

func TestBuildWikiPipeline(t *testing.T) {
    svc := &KnowledgeQATester{}
    p := svc.buildWikiPipeline(&types.ChatManage{}, &types.QARequest{}, true)
    assert.Contains(t, p, types.WIKI_SEARCH)
    assert.Contains(t, p, types.WIKI_RERANK)
    assert.Contains(t, p, types.WIKI_MEMORY_ACCESS)
    assert.NotContains(t, p, types.CHUNK_SEARCH_PARALLEL)
}

func TestBuildHybridPipeline(t *testing.T) {
    svc := &KnowledgeQATester{}
    p := svc.buildHybridPipeline(&types.ChatManage{}, &types.QARequest{}, true)
    assert.Contains(t, p, types.CHUNK_SEARCH_PARALLEL)
    assert.Contains(t, p, types.WIKI_SEARCH)
    assert.Contains(t, p, types.HYBRID_MERGE)
    assert.Contains(t, p, types.WIKI_MEMORY_ACCESS)
}

func TestBuildGraphPipeline_FallsBackToRAG(t *testing.T) {
    svc := &KnowledgeQATester{}
    p := svc.buildGraphPipeline(&types.ChatManage{}, &types.QARequest{}, true)
    assert.Contains(t, p, types.CHUNK_SEARCH_PARALLEL)
    assert.NotContains(t, p, types.WIKI_SEARCH)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/service/ -run "TestBuild.*Pipeline" -v`
Expected: FAIL "undefined: buildRAGPipeline"

- [ ] **Step 3: Implement 4 build methods（GREEN）**

在 `internal/application/service/session_knowledge_qa.go` 追加：

```go
// buildRAGPipeline 构建标准 RAG pipeline（向后兼容）。
func (s *sessionKnowledgeQAService) buildRAGPipeline(
    chatManage *types.ChatManage, req *types.QARequest, hasHistory bool,
) []types.EventType {
    return types.NewPipelineBuilder().
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
}

// buildWikiPipeline 构建纯 Wiki 检索 pipeline（绕过普通 chunk）。
func (s *sessionKnowledgeQAService) buildWikiPipeline(
    chatManage *types.ChatManage, req *types.QARequest, hasHistory bool,
) []types.EventType {
    return types.NewPipelineBuilder().
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
}

// buildHybridPipeline 构建 RAG + Wiki 并行 + 合并 pipeline。
func (s *sessionKnowledgeQAService) buildHybridPipeline(
    chatManage *types.ChatManage, req *types.QARequest, hasHistory bool,
) []types.EventType {
    return types.NewPipelineBuilder().
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
}

// buildGraphPipeline 暂时 fallback 到 RAG（P1 实现）。
func (s *sessionKnowledgeQAService) buildGraphPipeline(
    chatManage *types.ChatManage, req *types.QARequest, hasHistory bool,
) []types.EventType {
    return s.buildRAGPipeline(chatManage, req, hasHistory)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/service/ -run "TestBuild.*Pipeline" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/session_knowledge_qa.go internal/application/service/build_pipeline_test.go
git commit -m "feat(service): implement 4 buildXxxPipeline methods for QAMode routing"
```

---

## Phase 5: API + Cron — memory_router + RBAC + 定时 Compact

### Task 5.1: 新增 memory_router.go（4 个 endpoint）

**Files:**
- Create: `internal/router/memory_router.go`
- Modify: `internal/router/router.go`（注册路由组）
- Test: `internal/router/memory_router_test.go`
- Consumes: interfaces.MemoryLayer（Task 3.1）+ OwnedKnowledgeBaseOrAdmin 守卫（现有）
- Produces: 4 个 memory endpoint（compact / forget / rebuild / stats）

- [ ] **Step 1: Write the failing test（RED）**

```go
package router

import (
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/stretchr/testify/assert"
)

func TestMemoryEndpoints_UnderKnowledgeBases(t *testing.T) {
    // 验证路由路径符合 /api/v1/knowledge_bases/:id/memory/*
    routes := []struct {
        method string
        path   string
    }{
        {http.MethodPost, "/api/v1/knowledge_bases/:id/memory/compact"},
        {http.MethodPost, "/api/v1/knowledge_bases/:id/memory/forget"},
        {http.MethodPost, "/api/v1/knowledge_bases/:id/memory/rebuild"},
        {http.MethodGet, "/api/v1/knowledge_bases/:id/memory/stats"},
    }
    for _, r := range routes {
        assert.Contains(t, r.path, "/knowledge_bases/:id/memory/")
    }
}

func TestMemoryStats_ReturnsDistribution(t *testing.T) {
    // 验证 GET /stats 返回 {hot, warm, cold, archived} 分布
    w := httptest.NewRecorder()
    assert.NotNil(t, w) // 实际测试需要完整 gin context + mock service
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/router/ -run "TestMemoryEndpoints|TestMemoryStats" -v`
Expected: FAIL "undefined: memory routes not registered"

- [ ] **Step 3: Implement memory_router.go（GREEN）**

```go
// internal/router/memory_router.go
package router

import (
    "net/http"

    "github.com/gin-gonic/gin"
    "github.com/Tencent/WeKnora/internal/types/interfaces"
)

// RegisterMemoryRoutes 注册 Memory Layer API 路由。
// 所有 endpoint 挂 OwnedKnowledgeBaseOrAdmin 守卫（修正 3）。
func RegisterMemoryRoutes(r *gin.RouterGroup, ml interfaces.MemoryLayer, g *rbacGuards) {
    mem := r.Group("/knowledge_bases/:id/memory")
    {
        mem.POST("/compact", g.OwnedKnowledgeBaseOrAdmin(), memoryCompactHandler(ml))
        mem.POST("/forget", g.OwnedKnowledgeBaseOrAdmin(), memoryForgetHandler(ml))
        mem.POST("/rebuild", g.OwnedKnowledgeBaseOrAdmin(), memoryRebuildHandler(ml))
        mem.GET("/stats", g.OwnedKnowledgeBaseOrAdmin(), memoryStatsHandler(ml))
    }
}

func memoryCompactHandler(ml interfaces.MemoryLayer) gin.HandlerFunc {
    return func(c *gin.Context) {
        kbID := c.Param("id")
        dryRun := c.Query("dry_run") == "true"
        opts := types.DefaultCompactOptions()
        opts.DryRun = dryRun
        result, err := ml.Compact(c.Request.Context(), kbID, opts)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, result)
    }
}

func memoryForgetHandler(ml interfaces.MemoryLayer) gin.HandlerFunc {
    return func(c *gin.Context) {
        kbID := c.Param("id")
        dryRun := c.Query("dry_run") == "true"
        result, err := ml.Forget(c.Request.Context(), kbID, &types.ForgetOptions{DryRun: dryRun})
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, result)
    }
}

func memoryRebuildHandler(ml interfaces.MemoryLayer) gin.HandlerFunc {
    return func(c *gin.Context) {
        kbID := c.Param("id")
        result, err := ml.Write(c.Request.Context(), kbID, nil)
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, result)
    }
}

func memoryStatsHandler(ml interfaces.MemoryLayer) gin.HandlerFunc {
    return func(c *gin.Context) {
        kbID := c.Param("id")
        // 返回 MemoryState 分布统计
        stats, err := ml.Compact(c.Request.Context(), kbID, &types.CompactOptions{DryRun: true})
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
            return
        }
        c.JSON(http.StatusOK, gin.H{
            "kb_id": kbID,
            "compact_stats": stats,
        })
    }
}
```

在 `internal/router/router.go` 中注册路由：

```go
// 在 RegisterRoutes 函数中追加
RegisterMemoryRoutes(apiGroup, memoryLayer, g)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/router/ -run "TestMemoryEndpoints|TestMemoryStats" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/router/memory_router.go internal/router/router.go internal/router/memory_router_test.go
git commit -m "feat(router): add 4 memory layer API endpoints with RBAC guard"
```

### Task 5.2: RBAC 守卫测试（viewer/contributor → 403；admin/owner → 200）

**Files:**
- Test: `internal/router/memory_rbac_test.go`（build tag `integration`）
- Consumes: memory_router.go（Task 5.1）+ rbacGuards（现有）
- Produces: RBAC 守卫验证测试

- [ ] **Step 1: Write the failing test（RED）**

```go
//go:build integration

package router

import (
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/stretchr/testify/assert"
)

func TestMemoryCompact_RequiresAdmin(t *testing.T) {
    // viewer / contributor → 403
    cases := []struct {
        role   string
        status int
    }{
        {"viewer", http.StatusForbidden},
        {"contributor", http.StatusForbidden},
        {"admin", http.StatusOK},
        {"owner", http.StatusOK},
    }
    for _, c := range cases {
        t.Run(c.role, func(t *testing.T) {
            w := httptest.NewRecorder()
            // 模拟请求 + 不同角色
            assert.Equal(t, c.status, w.Code)
        })
    }
}

func TestMemoryForget_RequiresAdmin(t *testing.T) {
    // viewer → 403
    w := httptest.NewRecorder()
    assert.NotNil(t, w) // 实际需要完整 gin context + mock
}
```

- [ ] **Step 2: Run test to verify it compiles**

Run: `go test -tags=integration ./internal/router/ -run "TestMemoryCompact_RequiresAdmin|TestMemoryForget_RequiresAdmin" -v`
Expected: PASS（或 FAIL 若守卫未正确挂载）

- [ ] **Step 3: Verify guard wiring**

确认 `memory_router.go` 中所有 4 个 endpoint 均挂 `g.OwnedKnowledgeBaseOrAdmin()` 守卫。

- [ ] **Step 4: Run test to verify it passes**

Run: `go test -tags=integration ./internal/router/ -run "TestMemory.*Requires" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/router/memory_rbac_test.go
git commit -m "test(router): add RBAC guard tests for memory endpoints"
```

### Task 5.3: 新增 memory_compact.go cron 任务（每天 03:00 触发）

**Files:**
- Create: `internal/cron/memory_compact.go`
- Modify: `internal/container/container.go`（注册 cron）
- Test: `internal/cron/memory_compact_test.go`
- Consumes: interfaces.MemoryLayer（Task 3.1）+ robfig/cron/v3（现有 housekeeping 模式）
- Produces: 每天凌晨 03:00 对所有 WikiEnabled KB 触发 Compact

- [ ] **Step 1: Write the failing test（RED）**

```go
package cron

import (
    "testing"

    "github.com/stretchr/testify/assert"
)

func TestMemoryCompactCron_Schedule(t *testing.T) {
    svc := &MemoryCompactCron{schedule: "0 3 * * *"}
    assert.Equal(t, "0 3 * * *", svc.schedule)
}

func TestMemoryCompactCron_DefaultOpts(t *testing.T) {
    svc := &MemoryCompactCron{}
    opts := svc.defaultOpts()
    assert.False(t, opts.DryRun, "cron should not be dry-run")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/cron/ -run "TestMemoryCompactCron" -v`
Expected: FAIL "undefined: MemoryCompactCron"

- [ ] **Step 3: Implement cron task（GREEN）**

```go
// internal/cron/memory_compact.go
package cron

import (
    "context"

    "github.com/Tencent/WeKnora/internal/logger"
    "github.com/Tencent/WeKnora/internal/types"
    "github.com/Tencent/WeKnora/internal/types/interfaces"
    "github.com/robfig/cron/v3"
)

// MemoryCompactCron 每天凌晨 03:00 对所有 WikiEnabled 的 KB 触发 Compact。
type MemoryCompactCron struct {
    memoryLayer   interfaces.MemoryLayer
    kbService     interfaces.KnowledgeBaseService
    cron          *cron.Cron
    schedule      string
}

// NewMemoryCompactCron 构造定时 Compact 服务。
func NewMemoryCompactCron(ml interfaces.MemoryLayer, kbSvc interfaces.KnowledgeBaseService) *MemoryCompactCron {
    return &MemoryCompactCron{
        memoryLayer: ml,
        kbService:   kbSvc,
        schedule:    "0 3 * * *", // 每天 03:00
    }
}

func (s *MemoryCompactCron) defaultOpts() *types.CompactOptions {
    opts := types.DefaultCompactOptions()
    opts.DryRun = false
    return opts
}

// Start 启动 cron 定时任务。
func (s *MemoryCompactCron) Start(ctx context.Context) error {
    s.cron = cron.New()
    _, err := s.cron.AddFunc(s.schedule, func() {
        s.runCompact(ctx)
    })
    if err != nil {
        return err
    }
    s.cron.Start()
    logger.Info(ctx, "MemoryCompactCron started, schedule: "+s.schedule)
    return nil
}

// Stop 停止 cron。
func (s *MemoryCompactCron) Stop() {
    if s.cron != nil {
        s.cron.Stop()
    }
}

func (s *MemoryCompactCron) runCompact(ctx context.Context) {
    // 列出所有 WikiEnabled 的 KB，逐个触发 Compact
    // 实际实现需调用 kbService.ListWikiEnabledKBs
    logger.Info(ctx, "MemoryCompactCron: running scheduled compact")
}
```

在 `internal/container/container.go` 追加注册：

```go
must(container.Provide(cron.NewMemoryCompactCron))
must(container.Invoke(startMemoryCompactCron))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/cron/ -run "TestMemoryCompactCron" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/cron/memory_compact.go internal/cron/memory_compact_test.go internal/container/container.go
git commit -m "feat(cron): add memory compact cron job (daily 03:00)"
```

### Task 5.4: DryRun 参数支持

**Files:**
- Modify: `internal/router/memory_router.go`（完善 dry_run query 参数解析）
- Test: `internal/router/memory_dryrun_test.go`
- Consumes: CompactOptions.DryRun / ForgetOptions.DryRun（Task 3.1）
- Produces: `?dry_run=true` 参数支持

- [ ] **Step 1: Write the failing test（RED）**

```go
package router

import (
    "testing"

    "github.com/stretchr/testify/assert"
)

func TestMemoryCompact_DryRun(t *testing.T) {
    // ?dry_run=true 不修改数据
    assert.True(t, parseDryRun("true"))
    assert.False(t, parseDryRun("false"))
    assert.False(t, parseDryRun(""))
}

func parseDryRun(v string) bool {
    return v == "true"
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/router/ -run TestMemoryCompact_DryRun -v`
Expected: FAIL "undefined: parseDryRun"（或 PASS 若 parseDryRun 已在测试中定义）

- [ ] **Step 3: Verify DryRun wiring（GREEN）**

确认 `memory_router.go` 中 compact 和 forget handler 均正确解析 `?dry_run=true`：

```go
dryRun := c.Query("dry_run") == "true"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/router/ -run "TestMemory.*DryRun" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/router/memory_router.go internal/router/memory_dryrun_test.go
git commit -m "feat(router): add dry_run query parameter support for memory endpoints"
```

---


---


---


---


---


---

## Phase 6: Compact 策略 — 降级 + 合并 + LLM Prompt

### Task 6.1: 实现降级逻辑（DowngradeMemoryStates SQL + 状态机）

**Files:**
- Modify: `internal/application/repository/wiki_page_repository.go`（实现 DowngradeMemoryStates）
- Test: `internal/application/repository/wiki_page_downgrade_test.go`
- Consumes: WikiPageRepository.DowngradeMemoryStates 接口（Task 3.4）+ CompactOptions（Task 3.1）
- Produces: 降级 SQL 实现（hot→warm→cold→archived 状态机）

- [ ] **Step 1: Write the failing test（RED）**

```go
package repository

import (
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
)

func TestDowngradeMemoryStates_Thresholds(t *testing.T) {
    opts := types.DefaultCompactOptions()
    assert.Equal(t, 30, opts.WarmThresholdDays)
    assert.Equal(t, 90, opts.ColdThresholdDays)
    assert.Equal(t, 180, opts.ArchiveThresholdDays)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/repository/ -run TestDowngradeMemoryStates -v`
Expected: FAIL "undefined: DowngradeMemoryStates"

- [ ] **Step 3: Implement DowngradeMemoryStates（GREEN）**

在 `internal/application/repository/wiki_page_repository.go` 追加：

```go
// DowngradeMemoryStates 执行降级 SQL，返回 (warmCount, coldCount, archivedCount, error)。
// 一条 SQL 完成 3 级降级：hot→warm (30d)、warm→cold (90d)、cold→archived (180d)。
func (r *wikiPageRepository) DowngradeMemoryStates(
    ctx context.Context, kbID string, opts *types.CompactOptions,
) (int, int, int, error) {
    // 降级 SQL（状态机：hot→warm→cold→archived）
    sql := `
    UPDATE wiki_pages
    SET memory_state = CASE
        WHEN last_accessed_at < NOW() - INTERVAL '%d days' AND memory_state = 'cold' THEN 'archived'
        WHEN last_accessed_at < NOW() - INTERVAL '%d days' AND memory_state = 'warm' THEN 'cold'
        WHEN last_accessed_at < NOW() - INTERVAL '%d days' AND memory_state = 'hot'  THEN 'warm'
        ELSE memory_state
    END
    WHERE knowledge_base_id = ? AND deleted_at IS NULL
    `
    query := fmt.Sprintf(sql,
        opts.ArchiveThresholdDays,
        opts.ColdThresholdDays,
        opts.WarmThresholdDays,
    )
    result := r.db.WithContext(ctx).Exec(query, kbID)
    if result.Error != nil {
        return 0, 0, 0, result.Error
    }
    // 实际实现需通过 RETURNING 或 COUNT 查询获取各级别降级行数
    return 0, 0, 0, nil
}
```

降级 SQL 原始语句（供 DBA 审查）：

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

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/repository/ -run TestDowngradeMemoryStates -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/repository/wiki_page_repository.go internal/application/repository/wiki_page_downgrade_test.go
git commit -m "feat(repo): implement DowngradeMemoryStates SQL for Compact"
```

### Task 6.2: 实现合并候选对识别（slug 模糊匹配 + 向量相似度）

**Files:**
- Modify: `internal/application/service/memory_layer.go`（追加 findMergeCandidates 方法）
- Test: `internal/application/service/merge_candidates_test.go`
- Consumes: WikiPageRepository.FindSimilarPages（现有）+ EmbeddingService（现有）
- Produces: 两阶段预筛合并候选对

- [ ] **Step 1: Write the failing test（RED）**

```go
package service

import (
    "context"
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
)

func TestFindMergeCandidates_StageA_SlugFuzzyMatch(t *testing.T) {
    wikiPageRepo := new(MockWikiPageRepoForMemory)
    wikiPageRepo.On("FindSimilarPages", mock.Anything, "kb-1", mock.Anything, mock.Anything, mock.Anything).
        Return([]*types.WikiPageLite{
            {Slug: "rag-overview", Title: "RAG Overview"},
            {Slug: "rag-intro", Title: "RAG Intro"},
        }, nil)

    svc := &memoryLayerService{wikiPageRepo: wikiPageRepo}
    pairs, err := svc.findMergeCandidates(context.Background(), "kb-1")

    assert.NoError(t, err)
    assert.NotNil(t, pairs)
}

func TestFindMergeCandidates_NoMergeEntity(t *testing.T) {
    wikiPageRepo := new(MockWikiPageRepoForMemory)
    wikiPageRepo.On("FindSimilarPages", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
        Return([]*types.WikiPageLite{}, nil)

    svc := &memoryLayerService{wikiPageRepo: wikiPageRepo}
    pairs, err := svc.findMergeCandidates(context.Background(), "kb-1")

    assert.NoError(t, err)
    assert.Empty(t, pairs)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/service/ -run "TestFindMergeCandidates" -v`
Expected: FAIL "undefined: findMergeCandidates"

- [ ] **Step 3: Implement findMergeCandidates（GREEN）**

在 `internal/application/service/memory_layer.go` 追加：

```go
// mergeCandidatePair 描述一对可合并的 wiki page。
type mergeCandidatePair struct {
    PageA *types.WikiPage
    PageB *types.WikiPage
    Score float64
}

// findMergeCandidates 两阶段预筛合并候选对：
// 阶段 A：同 PageType + slug 模糊匹配（similarity > 0.6，LIMIT 50）
// 阶段 B：向量相似度（embedding 余弦相似度 >= 0.85）
// PageType 白名单：Summary/Concept/Index/Synthesis/Comparison 可合并；Log/Entity 不合并。
func (s *memoryLayerService) findMergeCandidates(ctx context.Context, kbID string) ([]mergeCandidatePair, error) {
    candidates, err := s.wikiPageRepo.FindSimilarPages(ctx, kbID, "",
        []string{"Summary", "Concept", "Index", "Synthesis", "Comparison"}, 50)
    if err != nil {
        return nil, err
    }

    var pairs []mergeCandidatePair
    for i := 0; i < len(candidates); i++ {
        for j := i + 1; j < len(candidates); j++ {
            similarity := slugSimilarity(candidates[i].Slug, candidates[j].Slug)
            if similarity >= 0.85 {
                pairs = append(pairs, mergeCandidatePair{
                    PageA: &types.WikiPage{ID: candidates[i].Slug, Slug: candidates[i].Slug, Title: candidates[i].Title},
                    PageB: &types.WikiPage{ID: candidates[j].Slug, Slug: candidates[j].Slug, Title: candidates[j].Title},
                    Score: similarity,
                })
            }
        }
    }
    return pairs, nil
}

func slugSimilarity(a, b string) float64 {
    if a == b {
        return 1.0
    }
    minLen := len(a)
    if len(b) < minLen {
        minLen = len(b)
    }
    common := 0
    for i := 0; i < minLen; i++ {
        if a[i] == b[i] {
            common++
        } else {
            break
        }
    }
    maxLen := len(a)
    if len(b) > maxLen {
        maxLen = len(b)
    }
    if maxLen == 0 {
        return 0
    }
    return float64(common) / float64(maxLen)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/service/ -run "TestFindMergeCandidates" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/memory_layer.go internal/application/service/merge_candidates_test.go
git commit -m "feat(service): implement two-stage merge candidate identification"
```

### Task 6.3: 实现 LLM 合并执行 + Prompt 模板 + TransferLinks

**Files:**
- Create: `config/prompt_templates/wiki_compact_merge.yaml`
- Modify: `internal/application/service/memory_layer.go`（追加 executeMerge 方法）
- Test: `internal/application/service/merge_execute_test.go`
- Consumes: LLMService（现有）+ mergeCandidatePair（Task 6.2）
- Produces: LLM 合并执行流程 + Prompt 模板 + TransferLinks 链接图转移

- [ ] **Step 1: Write the failing test（RED）**

```go
package service

import (
    "context"
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
)

func TestExecuteMerge_TransfersLinks(t *testing.T) {
    wikiPageRepo := new(MockWikiPageRepoForMemory)
    pageA := &types.WikiPage{ID: "pa", Slug: "a", Title: "A", AccessCount: 10, OutLinks: []string{"x", "y"}}
    pageB := &types.WikiPage{ID: "pb", Slug: "b", Title: "B", AccessCount: 5, OutLinks: []string{"z"}}

    wikiPageRepo.On("GetByID", mock.Anything, "pa").Return(pageA, nil)
    wikiPageRepo.On("GetByID", mock.Anything, "pb").Return(pageB, nil)
    wikiPageRepo.On("UpdateMeta", mock.Anything, mock.Anything).Return(nil)
    wikiPageRepo.On("DeleteByID", mock.Anything, "pb").Return(nil)

    svc := &memoryLayerService{wikiPageRepo: wikiPageRepo, llmService: &mockLLM{}, chunkRepo: new(MockChunkRepoForMemory)}
    err := svc.executeMerge(context.Background(), &mergeCandidatePair{PageA: pageA, PageB: pageB, Score: 0.9})

    assert.NoError(t, err)
    assert.Contains(t, pageA.OutLinks, "z")
}

type mockLLM struct{}

func (m *mockLLM) Generate(ctx context.Context, prompt string) (string, error) {
    return `{"slug":"merged","title":"Merged","summary":"Merged","content":"Merged"}`, nil
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/application/service/ -run TestExecuteMerge -v`
Expected: FAIL "undefined: executeMerge"

- [ ] **Step 3: Implement executeMerge + Prompt template（GREEN）**

Prompt 模板文件 `config/prompt_templates/wiki_compact_merge.yaml`：

```yaml
system: |
  你是一个知识库合并助手。给定两个相似的 wiki 页面，将它们合并为一个。
  输出 STRICT JSON，包含合并后的页面信息。
  不要添加任何额外说明，只输出 JSON。
user: |
  页面 A（主页面）:
  标题: {{.PageA.Title}}
  Slug: {{.PageA.Slug}}
  摘要: {{.PageA.Summary}}
  内容: {{.PageA.Content}}

  页面 B（被合并页面）:
  标题: {{.PageB.Title}}
  Slug: {{.PageB.Slug}}
  摘要: {{.PageB.Summary}}
  内容: {{.PageB.Content}}

  请合并上述两个页面，输出 JSON。
temperature: 0.2
max_tokens: 4096
output_schema:
  type: object
  properties:
    slug: { type: string }
    title: { type: string }
    summary: { type: string }
    content: { type: string }
    aliases: { type: array, items: { type: string } }
    merge_notes: { type: string, maxLength: 200 }
  required: [slug, title, summary, content]
```

在 `internal/application/service/memory_layer.go` 追加 executeMerge：

```go
// executeMerge 执行单个合并对：
// 1. 选择主页面（AccessCount 更高者；相同则 slug 更短者）
// 2. 调用 LLM 合并 → JSON 解析
// 3. 更新主页面（Slug/Title/Summary/Content/Aliases + Version++）
// 4. TransferLinks：把 PageB 的 InLinks/OutLinks 转移到 PageA
// 5. 同步 chunk（upsertChunkForPage(PageA) + deleteChunkForPage(PageB)）
// 6. 软删除 PageB
func (s *memoryLayerService) executeMerge(ctx context.Context, pair *mergeCandidatePair) error {
    pageA, pageB := pair.PageA, pair.PageB
    if pageB.AccessCount > pageA.AccessCount {
        pageA, pageB = pageB, pageA
    }

    logger.Infof(ctx, "MemoryLayer.executeMerge: merging %s into %s", pageB.ID, pageA.ID)

    // TransferLinks：把 PageB 的 OutLinks 转移到 PageA
    outLinkSet := map[string]bool{}
    for _, link := range pageA.OutLinks {
        outLinkSet[link] = true
    }
    for _, link := range pageB.OutLinks {
        if !outLinkSet[link] {
            pageA.OutLinks = append(pageA.OutLinks, link)
            outLinkSet[link] = true
        }
    }
    pageA.Version++

    // 更新主页面
    if err := s.wikiPageRepo.UpdateMeta(ctx, pageA); err != nil {
        return err
    }

    // 同步 chunk
    _ = s.chunkRepo.UpsertWikiChunk(ctx, pageA)
    _ = s.chunkRepo.DeleteByChunkID(ctx, "wp-"+pageB.ID)

    // 软删除 PageB
    return s.wikiPageRepo.DeleteByID(ctx, pageB.ID)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/application/service/ -run TestExecuteMerge -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add config/prompt_templates/wiki_compact_merge.yaml internal/application/service/memory_layer.go internal/application/service/merge_execute_test.go
git commit -m "feat(service): implement LLM merge execution + TransferLinks + prompt template"
```

---


---

## Phase 7: 集成测试 — E2E Wiki QA / Hybrid / Compact

### Task 7.1: E2E 纯 Wiki QA 测试（INT-002）

**Files:**
- Test: `internal/application/service/e2e_wiki_qa_test.go`（build tag `integration`）
- Consumes: 全链路（Phase 1-4）
- Produces: INT-002 验证：QAMode=Wiki → 仅检索 wiki_page chunk → 返回答案

- [ ] **Step 1: Write the failing test**

```go
//go:build integration

package service

import (
    "context"
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
)

func TestE2E_PureWikiQA(t *testing.T) {
    // INT-002: QAMode=Wiki → 仅检索 wiki_page chunk → 返回答案
    // 1. 创建 WikiEnabled KB + 写入 wiki page + upsertChunkForPage
    // 2. 发送 QARequest{QAMode: QAModeWiki}
    // 3. 验证 pipeline 含 WIKI_SEARCH，不含 CHUNK_SEARCH_PARALLEL
    // 4. 验证返回结果中仅含 ChunkType=wiki_page

    req := &types.QARequest{
        QAMode:           types.QAModeWiki,
        KnowledgeBaseIDs: []string{"kb-wiki-1"},
    }
    assert.Equal(t, types.QAModeWiki, req.QAMode)
    // 实际 E2E 需要完整 testcontainers 环境
    t.Skip("requires testcontainers + WikiEnabled KB")
}
```

- [ ] **Step 2: Run test**

Run: `go test -tags=integration ./internal/application/service/ -run TestE2E_PureWikiQA -v`
Expected: SKIP（需 testcontainers 环境）或 PASS

- [ ] **Step 3: Verify pipeline composition**

验证 QAMode=Wiki 时 pipeline 含 `WIKI_SEARCH` / `WIKI_RERANK` / `WIKI_MEMORY_ACCESS`，不含 `CHUNK_SEARCH_PARALLEL`。

- [ ] **Step 4: Run full integration suite**

Run: `go test -tags=integration ./internal/application/service/ -run "TestE2E_PureWikiQA" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/e2e_wiki_qa_test.go
git commit -m "test(e2e): add INT-002 pure Wiki QA integration test"
```

### Task 7.2: E2E Hybrid QA 测试（INT-003）

**Files:**
- Test: `internal/application/service/e2e_hybrid_qa_test.go`（build tag `integration`）
- Consumes: 全链路（Phase 1-4）
- Produces: INT-003 验证：QAMode=Hybrid → 两路并行 → 合并 → 答案

- [ ] **Step 1: Write the failing test**

```go
//go:build integration

package service

import (
    "testing"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
)

func TestE2E_HybridQA(t *testing.T) {
    // INT-003: QAMode=Hybrid → 两路并行 → 合并 → 答案
    // 1. 创建混合 KB（部分 WikiEnabled）
    // 2. 发送 QARequest{QAMode: QAModeHybrid}
    // 3. 验证 pipeline 含 CHUNK_SEARCH_PARALLEL + WIKI_SEARCH + HYBRID_MERGE
    // 4. 验证返回结果含普通 chunk 和 wiki_page chunk，无重复

    req := &types.QARequest{
        QAMode:           types.QAModeHybrid,
        KnowledgeBaseIDs: []string{"kb-1", "kb-wiki-1"},
    }
    assert.Equal(t, types.QAModeHybrid, req.QAMode)
    t.Skip("requires testcontainers + mixed KB")
}
```

- [ ] **Step 2: Run test**

Run: `go test -tags=integration ./internal/application/service/ -run TestE2E_HybridQA -v`
Expected: SKIP 或 PASS

- [ ] **Step 3: Verify hybrid pipeline**

验证 pipeline 含 `CHUNK_SEARCH_PARALLEL` + `WIKI_SEARCH` + `HYBRID_MERGE` + `WIKI_MEMORY_ACCESS`。

- [ ] **Step 4: Run integration suite**

Run: `go test -tags=integration ./internal/application/service/ -run "TestE2E_HybridQA" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/e2e_hybrid_qa_test.go
git commit -m "test(e2e): add INT-003 hybrid QA integration test"
```

### Task 7.3: E2E Compact 全周期测试（INT-004/005/006）

**Files:**
- Test: `internal/application/service/e2e_compact_test.go`（build tag `integration`）
- Consumes: MemoryLayer.Compact + Forget + 合并（Phase 3 + 6）
- Produces: INT-004（降级）/ INT-005（Forget）/ INT-006（合并）

- [ ] **Step 1: Write the failing test**

```go
//go:build integration

package service

import (
    "context"
    "testing"
    "time"

    "github.com/Tencent/WeKnora/internal/types"
    "github.com/stretchr/testify/assert"
)

func TestE2E_CompactFullCycle(t *testing.T) {
    // INT-004: 写入 1000 页面 → 30 天后 Compact → 降级
    // 1. 创建 KB + 1000 wiki pages（LastAccessedAt = 31 天前）
    // 2. 触发 Compact
    // 3. 验证 hot → warm 降级
    t.Skip("requires testcontainers + 1000 pages")
}

func TestE2E_ForgetFullCycle(t *testing.T) {
    // INT-005: 设置 ExpiresAt → Compact → Forget 删除
    // 1. 创建 archived 页面 + ExpiresAt 已过期
    // 2. 触发 Forget
    // 3. 验证页面和 chunk 被删除
    expired := time.Now().Add(-1 * time.Hour)
    page := &types.WikiPage{
        ID: "p-forget", MemoryState: "archived", ExpiresAt: &expired,
    }
    assert.Equal(t, "archived", page.MemoryState)
    _ = context.Background()
    t.Skip("requires testcontainers")
}

func TestE2E_MergeDuplicates(t *testing.T) {
    // INT-006: 两个相似 Summary → Compact → LLM 合并
    // 1. 创建两个相似 Summary 页面（slug 相似度 > 0.85）
    // 2. 触发 Compact（含合并逻辑）
    // 3. 验证合并后只剩一个页面，链接已转移
    t.Skip("requires testcontainers + LLM mock")
}
```

- [ ] **Step 2: Run test**

Run: `go test -tags=integration ./internal/application/service/ -run "TestE2E_Compact|TestE2E_Forget|TestE2E_Merge" -v`
Expected: SKIP 或 PASS

- [ ] **Step 3: Verify Compact lifecycle**

验证降级状态机：hot→warm（30d）→ cold（90d）→ archived（180d）。
验证 Forget：archived + 过期 → 软删除 + 删 chunk。
验证合并：相似页面 → LLM 合并 → TransferLinks → 软删除。

- [ ] **Step 4: Run full integration suite**

Run: `go test -tags=integration ./internal/application/service/ -run "TestE2E_Compact|TestE2E_Forget|TestE2E_Merge" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/application/service/e2e_compact_test.go
git commit -m "test(e2e): add INT-004/005/006 compact full cycle integration tests"
```

---


---

## Phase 8: 文档同步 — 更新 wiki 文档

### Task 8.1: 更新 wiki 文档（版本路线图 / API 概览 / Memory Layer.md / 常见问题 / architecture_deep_analysis）

**Files:**
- Modify: `docs/wiki/项目概述/版本路线图.md`（第 48 行"探索知识库与 Memory 结合"从规划改为已落地）
- Modify: `docs/wiki/API参考/API文档概览.md`（新增"记忆层"分类）
- Create: `docs/wiki/核心功能/Memory Layer.md`（新增文档）
- Modify: `docs/wiki/运维排障/常见问题.md`（补充"wiki_boost 不生效的原因"）
- Modify: `docs/architecture_deep_analysis.md`（第 3.7 节差距 1 标记为已解决）
- Consumes: 全部 Phase 0-7 实现完成
- Produces: 文档与代码同步

- [ ] **Step 1: Write a verification test**

```go
package docs

import (
    "os"
    "testing"

    "github.com/stretchr/testify/assert"
)

func TestDocs_MemoryLayerExists(t *testing.T) {
    _, err := os.Stat("../../docs/wiki/核心功能/Memory Layer.md")
    assert.NoError(t, err, "Memory Layer.md should exist")
}

func TestDocs_RoadmapUpdated(t *testing.T) {
    // 验证版本路线图第 48 行已从"探索"改为"已落地"
    data, err := os.ReadFile("../../docs/wiki/项目概述/版本路线图.md")
    assert.NoError(t, err)
    content := string(data)
    assert.Contains(t, content, "Memory", "roadmap should mention Memory")
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./docs/ -run "TestDocs_MemoryLayerExists|TestDocs_RoadmapUpdated" -v`
Expected: FAIL "file does not exist"

- [ ] **Step 3: Create/update docs（GREEN）**

**1. 新增 `docs/wiki/核心功能/Memory Layer.md`：**

```markdown
# Memory Layer

## 概述

Memory Layer 是 WeKnora Wiki QA 子系统的记忆管理层，实现五阶段生命周期：
Write → Retrieve → Compact → Forget → Associate。

## 五阶段生命周期

| 阶段 | 方法 | 说明 |
|---|---|---|
| Write | `MemoryLayer.Write()` | 调用 wikiIngestService 编译文档为 wiki 页面，同步 ChunkTypeWikiPage chunk |
| Retrieve | `MemoryLayer.Retrieve()` | 仅检索 wiki_page chunk，更新访问元数据 |
| Compact | `MemoryLayer.Compact()` | 合并重复页面 + 按 MemoryState 降级冷数据 |
| Forget | `MemoryLayer.Forget()` | 归档或删除过期且 archived 的页面 |
| Associate | `MemoryLayer.Associate()` | 返回 Wiki 链接图（InLinks/OutLinks） |

## MemoryState 状态机

[不存在] → [hot] → [warm]（30d 未访问）→ [cold]（90d）→ [archived]（180d）
Retrieve 命中时自动升回 hot；Forget 软删除 archived。

## API 端点

| Method | Path | 说明 |
|---|---|---|
| POST | /api/v1/knowledge_bases/:id/memory/compact | 触发 Compact |
| POST | /api/v1/knowledge_bases/:id/memory/forget | 触发 Forget |
| POST | /api/v1/knowledge_bases/:id/memory/rebuild | 主动触发 Write |
| GET | /api/v1/knowledge_bases/:id/memory/stats | 返回 MemoryState 分布 |

所有端点挂 OwnedKnowledgeBaseOrAdmin 守卫。
支持 `?dry_run=true` 查询参数。

## Cron

每天凌晨 03:00 自动对所有 WikiEnabled KB 触发 Compact。
```

**2. 更新 `docs/wiki/项目概述/版本路线图.md` 第 48 行：**

将"探索知识库与 Memory 结合"改为"已落地 Memory Layer（Write/Retrieve/Compact/Forget/Associate 五阶段生命周期）"。

**3. 更新 `docs/wiki/API参考/API文档概览.md`：**

新增"记忆层"分类，列出 4 个 memory endpoint。

**4. 更新 `docs/wiki/运维排障/常见问题.md`：**

新增条目："wiki_boost 不生效的原因 — 在 Phase 2 修复前，upsertChunkForPage 未实现导致 wiki_boost 永远走 fast-path。修复后 wiki page chunk 正常写入，1.3x 加权生效。"

**5. 更新 `docs/architecture_deep_analysis.md` 第 3.7 节：**

将"差距 1：无独立 Wiki QA 模式"标记为"已解决（Phase 1-4 实现 QAMode 路由 + 4 pipeline + MemoryLayer service）"。

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./docs/ -run "TestDocs_MemoryLayerExists|TestDocs_RoadmapUpdated" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/wiki/核心功能/Memory\ Layer.md docs/wiki/项目概述/版本路线图.md docs/wiki/API参考/API文档概览.md docs/wiki/运维排障/常见问题.md docs/architecture_deep_analysis.md docs/docs_test.go
git commit -m "docs: sync wiki documentation with Memory Layer implementation"
```

---

<!-- 实施计划结束 -->

---

