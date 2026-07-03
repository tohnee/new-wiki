# WeKnora 三大核心模块深度审查报告

> **审查范围**:Wiki 知识库模块 / 租户与用户权限模块 / Agent 开发体系
> **审查方式**:静态只读分析 + 对比业界方案(Karpathy LLM-Wiki、Anthropic Claude Agent SDK)
> **审查日期**:2026-07-03
> **信息源约束**:仅引用官方文档、官方 GitHub 仓库、Hugging Face、ModelScope 等正规渠道

---

## 目录

- [一、Wiki 知识库模块完整审查](#一wiki-知识库模块完整审查)
  - [1.1 模块全景](#11-模块全景)
  - [1.2 完整数据流](#12-完整数据流)
  - [1.3 关键设计决策](#13-关键设计决策)
  - [1.4 与 Karpathy LLM-Wiki 对比](#14-与-karpathy-llm-wiki-对比)
  - [1.5 Claude Code Agent SDK 集成可行性](#15-claude-code-agent-sdk-集成可行性)
- [二、租户与用户权限模块完整审查](#二租户与用户权限模块完整审查)
  - [2.1 架构全景](#21-架构全景)
  - [2.2 角色权限矩阵](#22-角色权限矩阵)
  - [2.3 认证流程](#23-认证流程)
  - [2.4 数据隔离机制](#24-数据隔离机制)
  - [2.5 模块解耦评估](#25-模块解耦评估)
  - [2.6 企业 IDP/UM 接入方案](#26-企业-idpum-接入方案)
- [三、Agent 开发体系完整审查](#三agent-开发体系完整审查)
  - [3.1 ReAct 引擎架构](#31-react-引擎架构)
  - [3.2 工具系统设计](#32-工具系统设计)
  - [3.3 MCP 集成深度分析](#33-mcp-集成深度分析)
  - [3.4 Skill 沙箱机制](#34-skill-沙箱机制)
  - [3.5 自定义 Agent 扩展机制](#35-自定义-agent-扩展机制)
  - [3.6 与 Claude Code Agent SDK 对比](#36-与-claude-code-agent-sdk-对比)
  - [3.7 高级自定义能力评估](#37-高级自定义能力评估)
- [四、关键文件路径索引](#四关键文件路径索引)

---

## 一、Wiki 知识库模块完整审查

### 1.1 模块全景

WeKnora 的 Wiki 模块是一个**自动化知识合成与组织系统**,将上传的原始文档通过 LLM 抽取、去重、分类、合成,生成结构化的、可双向链接的 Wiki 页面,并作为 RAG 检索的增强信号源。

**核心特征**:
- 基于 slug 寻址的页面体系(`entity/xxx`、`concept/xxx`、`summary/xxx`、`index`、`log`、`synthesis`、`comparison`)
- 两遍 LLM 抽取流水线(Pass 0 候选 slug + Pass 1..N chunk 级引用分类)
- Map-Reduce 批处理架构支持 40k 文档规模
- 持久化任务队列 + 死信队列(DLQ)防丢失
- 双向链接(InLinks/OutLinks)+ 文件夹层级导航(混合邻接表 + 物化路径)
- pg_trgm 相似度搜索 + 死链模糊匹配
- 结构化索引视图(替代多 MB 目录 markdown)
- 完整的 ReAct 工具集,Agent 可创建/读取/搜索/重命名/删除/替换/标记问题

**架构图(文字描述)**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                          前端层(Vue 3 + TDesign)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ NotebookView │  │ WikiBrowser  │  │ WikiEditResult│              │
│  │ (三栏布局)   │  │ (浏览/图谱)  │  │ (工具结果渲染)│              │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘              │
│         │                 │                                          │
│         ▼                 ▼                                          │
│  api/wiki/index.ts (REST 封装)                                       │
└─────────────────────┼───────────────────────────────────────────────┘
                      │ HTTP /api/v1/knowledgebase/:kb_id/wiki/*
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       API 路由层(Gin)                                │
│  RegisterWikiPageRoutes                                             │
│  - GET/POST/PUT/DELETE /pages, /folders                             │
│  - GET /index, /log, /graph, /stats, /search, /lint                 │
│  - POST /rebuild-links, /auto-fix, /issues/:id/status               │
│  RBAC: Viewer+ 可读(KBAccessRead), OwnedWikiKBOrAdmin 可写          │
└─────────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Service 层(application/service/wiki_*.go)              │
│  WikiPageService          WikiIngestService         WikiLintService │
│  (CRUD/链接/文件夹树)     (Map-Reduce/队列/锁)       (健康检查/修复) │
│                          WikiTaxonomyPlan             WikiLogEntry  │
│                          WikiDedup                    WikiLinkify   │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│            数据层(PostgreSQL + Redis + Asynq)                       │
│  wiki_pages (slug 唯一索引, version 乐观锁, folder_id,             │
│              category_path jsonb, in_links/out_links,              │
│              source_refs, chunk_refs, page_metadata)               │
│  wiki_folders (邻接表 parent_id + 物化路径 path + depth 缓存)       │
│  wiki_log_entries (操作日志, pages_affected JSON)                   │
│  wiki_page_issues (问题追踪)                                        │
│  task_pending_ops (持久化任务队列, 替代 Redis 列表)                  │
│  task_dead_letters (DLQ, 失败 5 次归档)                             │
│  Redis: wiki:active:<kbID> (60s TTL 互斥锁, 20s renew)             │
│         wiki:deleted:<kbID>:<kid> (1h TTL 删除墓碑)                │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 完整数据流

#### 文档上传触发 Wiki 生成

```
1. 用户上传文档 → Knowledge 创建 → Chunk 切分 → 向量化
2. 知识处理完成 → EnqueueWikiIngest(kbID, knowledgeID, "ingest")
   - INSERT task_pending_ops 行
   - asynq.Enqueue(TypeWikiIngest, ProcessIn(30s))  // debounce
3. 30s 后 asynq worker 调用 ProcessWikiIngest
4. 获取 Redis 锁(60s TTL + 20s renew)
5. peekPendingList(按 KnowledgeID 去重)
6. MAP PHASE(并行 mapOneDocument):
   a. ListChunksByKnowledgeID
   b. reconstructEnrichedContent(内联图像 OCR/caption)
   c. Pass 0: extractCandidateSlugs(候选 slug 骨架)
   d. 并行:
      - WikiSummaryPrompt 生成 summary 页面
      - classifyChunkCitations(Pass 1..N chunk 引用分类)
   e. mergeCitationsIntoItems
   f. 构建 SlugUpdate 列表
7. planBatchTaxonomy(单次 LLM 分配目录路径)
8. resolvePlannedFolders(reify 文件夹行)
9. REDUCE PHASE(并行 reduceSlugUpdates):
   a. filterLiveUpdates
   b. summary 分支:直接覆盖
   c. addition 分支:resolveCitedChunks + WikiPageModifyPrompt
   d. retract 分支:构建 deletedContent
   e. CreatePage 或 UpdatePage
10. sanitizeDeadSummaryLinks
11. AppendBatch log entries
12. rebuildIndexPage
13. cleanDeadLinks(批次范围)
14. injectCrossLinks(批次范围)
15. publishDraftPages(draft → published)
16. 向量化 wiki pages → chunk 表(ChunkType = "wiki_page")
17. trim pending list
18. requeueFailedOps(失败 5 次归档 DLQ)
19. scheduleFollowUp(若 pending > 0)
```

#### RAG 检索增强

```
1. 用户提问 → Chat 模型
2. RAG 检索 chunks(包含 wiki_page chunks)
3. Rerank
4. PluginWikiBoost.OnEvent(CHUNK_RERANK):
   - 检测 wiki_page chunks
   - 乘以 1.3 倍分数(wikiBoostFactor)
   - 重新排序
5. Top-K chunks → LLM 上下文
```

#### Agent 编辑 Wiki

```
1. 用户对话 → ReAct Agent
2. Agent 调用 wiki_search 找相关页面
3. Agent 调用 wiki_read_page 读取详情
4. Agent 调用 wiki_read_source_doc 下钻源文档
5. Agent 调用 wiki_write_page / wiki_replace_text / wiki_rename_page / wiki_delete_page 编辑
6. 工具执行后自动 InjectCrossLinks + RebuildIndexPage
7. WikiEditResult 组件渲染工具结果卡片
```

### 1.3 关键设计决策

| 决策 | 问题 | 方案 |
|------|------|------|
| 持久化队列替代 Redis 列表 | Redis 24h TTL 在 4w 文档规模下丢任务 | `task_pending_ops` + `task_dead_letters` 表 |
| 两遍抽取替代单次 | 旧 `WikiKnowledgeExtractPrompt` 长文档截断 | Pass 0(候选 slug)+ Pass 1..N(chunk 引用) |
| 结构化索引视图 | 旧 markdown 目录多 MB,4w 页面 round-trip 浪费 | `GetIndexView` + `ListByTypeLight` 轻量投影 |
| 三种 version 更新路径 | 机器写入频繁递增 version 误导消费者 | Update(递增)/UpdateMeta(不递增)/UpdateAutoLinkedContent(不递增) |
| 批次范围死链清理 | 全 KB 扫描在 4w 页面上太慢 | `cleanDeadLinks` 仅处理批次内页面 |
| 分类法批次规划 | per-page 并发目录发明无法收敛 | `planBatchTaxonomy` 单次 LLM 调用 |
| Redis 锁 + Lite 模式 | Redis 不可用时 Wiki 失效 | `sync.Map` 进程内锁 fallback |
| WikiScope 服务端强制 | LLM 可能绕过文档白名单 | `scopeKnowledgeFilter` 从 agent scope 派生,绝不暴露给模型 |

### 1.4 与 Karpathy LLM-Wiki 对比

**Karpathy LLM-Wiki 概览**(来源:GitHub 仓库 + 公开博客):

Karpathy 在 GitHub 发布的 `llm-wiki` 项目,自我定位为 "self-maintaining personal knowledge base powered by LLMs"。核心思想:从一个原始材料(`karpathy-llm-wiki-original.md`)出发,LLM 把原始材料逐步编译进 `llm-wiki/` 目录,自动长出 `index`、`log`、概念页、对比页和综合页。强调的不是"做一次总结",而是"如何把原始材料转化为自维护的知识库"。

**详细对比**:

| 维度 | WeKnora Wiki | Karpathy LLM-Wiki |
|------|--------------|-------------------|
| **定位** | 企业级 Wiki 服务,多租户 RBAC | 个人知识库,单用户 |
| **部署形态** | 云服务/私有部署,服务端 Go 后端 | 本地文件系统驱动 |
| **数据源** | 多源文档(上传/飞书/Notion/语雀/RSS) | 单一起始 markdown 文件 |
| **抽取策略** | 两遍流水线(Pass 0 候选 slug + Pass 1..N chunk 引用) | 单次 LLM 编译,逐步增量 |
| **页面类型** | entity/concept/summary/index/log/synthesis/comparison | 概念页/对比页/综合页/index/log |
| **存储** | PostgreSQL(slug 唯一索引,version 乐观锁,JSONB metadata) | 文件系统(markdown 文件) |
| **链接机制** | 双向链接(InLinks/OutLinks)+ pg_trgm 模糊匹配 | Markdown wikilinks `[[...]]` |
| **规模能力** | 40k 文档(Map-Reduce + 持久化队列 + DLQ) | 个人规模(无任务队列) |
| **Agent 编辑** | ReAct 工具集(创建/读取/搜索/重命名/删除/替换/标记问题) | LLM 自主迭代重写文件 |
| **RAG 集成** | WikiPage 向量化 + PluginWikiBoost 1.3x 加权 | 无 RAG 检索层 |
| **协作** | 多租户 RBAC,跨租户共享 KB | 单用户,无协作 |
| **可观测性** | Langfuse span 追踪 + 操作日志 | 无 |
| **文件夹层级** | 邻接表 + 物化路径,深度 3 | 文件系统目录树 |
| **健康检查** | WikiLint(orphan/broken/empty/stale/missing)+ AutoFix | 无 |

**异同总结**:

- **相同点**:两者都采用"LLM 自主编译知识库"的核心理念,都生成 index/log/概念页/对比页,都强调"自维护"而非"一次性总结"。
- **关键差异**:WeKnora 是企业级服务化实现,Karpathy 是个人文件系统原型;WeKnora 增加了两遍抽取流水线、Map-Reduce 批处理、持久化队列、RAG 增强、多租户 RBAC、Agent 工具集、健康检查等工程化能力。
- **理念继承**:WeKnora 的 PageType 设计(summary/entity/concept/index/log/synthesis/comparison)与 Karpathy 的页面分类高度相似,可视为 Karpathy LLM-Wiki 理念的企业级落地。

### 1.5 Claude Code Agent SDK 集成可行性

**Claude Agent SDK 概览**(来源:Anthropic 官方文档 code.claude.com):

Anthropic 官方 Agent SDK 提供 Python 和 TypeScript 两种实现,将 Claude Code 的 agent loop、内置工具、上下文管理能力打包为可编程库。核心能力包括:内置工具(Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch/AskUserQuestion)、Hooks、Subagents、MCP、Permissions、Sessions、Skills、Plugins。

**集成可行性评估**:

| 集成场景 | 可行性 | 实现路径 |
|---------|--------|---------|
| **作为 WeKnora 的 LLM 后端** | ❌ 不推荐 | WeKnora 已有完整 ReAct 引擎,Agent SDK 是替代品而非补充,双引擎会冲突 |
| **作为 Wiki 生成的外部 Agent** | ⚠️ 可行但冗余 | WeKnora 已有 wiki_write_page 等工具,可通过 MCP 暴露给 Agent SDK,但 WeKnora 内置 Agent 已能完成相同任务 |
| **作为 Wiki 工具的 MCP 客户端** | ✅ 推荐 | 将 WeKnora Wiki 工具集(wiki_search/wiki_read_page/wiki_write_page 等)封装为 MCP server,Agent SDK 作为 MCP client 调用 |
| **作为外部知识库消费方** | ✅ 推荐 | Agent SDK 通过 MCP 连接 WeKnora,将 WeKnora 作为外部知识源,Agent SDK 在本地文件系统执行任务时检索 WeKnora Wiki |
| **Skills 互通** | ✅ 可行 | WeKnora Skills 和 Claude Agent SDK Skills 都采用 Progressive Disclosure 模式,SKILL.md 格式可互通 |
| **Subagent 委托** | ✅ 可行 | Agent SDK 的 Subagents 可通过 MCP 调用 WeKnora Wiki 工具,实现"主 Agent + Wiki 研究 Subagent"模式 |

**推荐集成方案:WeKnora Wiki as MCP Server**

```
┌─────────────────────────┐         ┌─────────────────────────┐
│  Claude Agent SDK       │         │  WeKnora Wiki Service   │
│  (本地 Python/TS)        │         │  (服务端 Go)             │
│                         │  MCP    │                         │
│  ┌─────────────────┐    │ ◄─────► │  wiki_search            │
│  │ Subagent:       │    │  SSE/   │  wiki_read_page         │
│  │ wiki-researcher │    │  HTTP   │  wiki_read_source_doc   │
│  └─────────────────┘    │         │  wiki_write_page        │
│                         │         │  wiki_replace_text       │
│  Skills (共享 SKILL.md) │         │  wiki_rename_page       │
│                         │         │  wiki_delete_page       │
└─────────────────────────┘         └─────────────────────────┘
```

**工作量估算**:
- 实现 MCP server 包装 WeKnora Wiki 工具:约 1-2 周
- OAuth2 PKCE 授权流程:WeKnora 已有 MCP OAuth2 实现,可复用
- Skills 格式适配:1-2 天(两者格式相近)

**限制**:
- WeKnora 的 `stdio` transport 已禁用(安全原因),Agent SDK 需使用 SSE 或 HTTP Streamable
- WeKnora WikiScope 服务端过滤逻辑不会暴露给 Agent SDK,过滤在 WeKnora 服务端静默执行
- 跨租户访问需通过 WeKnora 的 SystemAdmin 双开关,不能在 Agent SDK 侧绕过

---

## 二、租户与用户权限模块完整审查

### 2.1 架构全景

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            客户端层 (Client)                              │
│  Web 前端 / CLI / Embed Chat / 第三方系统(API Key)                       │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ Authorization: Bearer <JWT> / X-API-Key
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Gin Middleware Pipeline                            │
│  CORS → RequestID → Language → Logger → Recovery → ErrorHandler         │
│         → Auth(主认证) → AuditServiceProvider(注入审计器)              │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                  RBAC 守卫层 (rbacGuards 工厂, router/rbac.go)           │
│  RequireRole / RequireOwnershipOrRole / RequireCrossTenantAccess         │
│  KBAccess(共享空间门)                                                   │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Handler 层 (业务编排)                              │
│  + dto/role.go: RoleFromContext + CanViewIntegrationSecrets              │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                Repository 层 (GORM, 数据隔离 + 事务保护)                 │
│  tenant_id WHERE 过滤 / FOR UPDATE 行锁 / 原子操作                       │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│            PostgreSQL / SQLite (migrations 000000 - 000064)              │
│  tenants / tenant_members / tenant_invitations / users / audit_logs /   │
│  organizations / organization_tenant_members / system_settings /        │
│  auth_tokens / knowledge_bases / agents / ...                           │
└──────────────────────────────────────────────────────────────────────────┘
```

**核心设计原则:双闸门 + 正交模型**
- **纵向闸门**:租户 RBAC(RequireRole / RequireOwnershipOrRole),决定用户在租户内的角色和资源归属
- **横向闸门**:共享空间 KBAccess,决定用户能否访问某个被共享的 KB
- 跨租户写操作必须同时穿过两道闸

### 2.2 角色权限矩阵

#### 租户角色矩阵(4-tier)

| 角色 | 数值 | HasPermission 阈值 | 能力范围 | 典型场景 |
|------|------|---------------------|----------|----------|
| **Owner** | 40 | required <= 40 | 全部租户操作 + 删除租户 + 转让所有权 + 管理 Owner | 创始人/出资方 |
| **Admin** | 30 | required <= 30 | 成员/邀请/KB/Agent/集成 全部 CRUD,不能管理 Owner、不能删租户 | IT 管理员 |
| **Contributor** | 20 | required <= 20 | 创建/编辑/删除**自己创建**的 KB/Agent/文档,对他人资源只读 | 内容创作者 |
| **Viewer** | 10 | required <= 10 | 只读所有租户资源,不能创建/修改/删除 | 审阅者/外部观察 |

**归属守卫核心语义**:`RequireOwnershipOrRole(types.TenantRoleAdmin, lookup, cfg)` —— 是 creator 或拥有 Admin 角色即可通过。"Contributor 在自己的 KB 里像 Owner,在别人的 KB 里像 Viewer"。

#### 共享空间角色矩阵(3-tier,Plan 3)

| 角色 | 能力 | 说明 |
|------|------|------|
| **admin** | 管理组织成员、添加/移除租户、删除组织 | 仅 OwnerTenant 可担任 |
| **editor** | 在组织内创建/编辑共享 KB | 通过 join request 升级 |
| **viewer** | 只读访问组织内共享 KB | 默认加入角色 |

#### 跨租户超级管理员

| 维度 | 实现 |
|------|------|
| 用户属性 | `User.CanAccessAllTenants bool` |
| 集群开关 | `system_settings.enable_cross_tenant_access` |
| 双开关语义 | **必须同时为 true 才能跨租户访问**(fail-closed) |
| API Key 限制 | API Key **显式拒绝**担任 SystemAdmin 角色 |

### 2.3 认证流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    Auth 中间件 (middleware/auth.go)             │
│                                                                 │
│  1. 提取凭证:                                                   │
│     - Authorization: Bearer <JWT>                               │
│     - X-API-Key: <api_key>                                      │
│     - Cookie (OIDC 回跳场景)                                    │
│                                                                 │
│  2. 认证路径选择:                                               │
│     ┌─ Bearer → JWT 解析 (HS256)                                │
│     ├─ API Key → AES-GCM 解密 → synthetic user (固定 Admin 角色)│
│     └─ OIDC → code exchange → ID Token 验证 → 用户映射         │
│                                                                 │
│  3. resolveTenantRole 四步决策:                                 │
│     a. 系统超管 → 'admin' fallback                              │
│     b. 路径含 tenant_id → 查 TenantMember                      │
│     c. Header X-Tenant-ID → 查 TenantMember                    │
│     d. 默认 home tenant → 查 TenantMember                      │
│                                                                 │
│  4. 注入 Context:                                               │
│     - UserID / TenantID / TenantRole / Principal               │
└─────────────────────────────────────────────────────────────────┘
```

**JWT**:HS256 对称密钥,payload 含 user_id/tenant_id/issued_at/expires_at,refresh_token 独立存储可撤销。

**API Key**:AES-GCM 认证加密,存储 `enc:v1:` 前缀 + 密文,明文仅在 `AfterFind` 钩子解密驻留内存,固定 Admin 角色,显式拒绝 SystemAdmin。

**OIDC**:完整 code exchange + ID Token 验证 + 用户映射,issuer URL 经 SSRF 校验。

### 2.4 数据隔离机制

**tenant_id 传递链**:

```
HTTP 请求 (路径 / Header)
  → Auth 中间件 resolveTenantRole
  → Context 注入 (ContextKeyTenantID)
  → Handler 从 Context 取出 tenant_id
  → Service 层传递 tenant_id 作为查询参数
  → Repository 层 WHERE tenant_id = ? 过滤
```

**关键隔离保障**:
- API Key 角色固定,防止伪造 Header 越权
- `RequirePathTenantMatch` 防止路径 tenant_id 与认证 tenant 不匹配
- 跨租户双开关:CanAccessAllTenants + EnableCrossTenantAccess 必须同时为 true
- DTO 角色感知脱敏:即使数据被读出,字段可见性也受调用者角色约束

### 2.5 模块解耦评估

#### 紧耦合模块

| 模块 | 耦合点 | 影响 |
|------|--------|------|
| `tenantService` ↔ `userService` | API Key 解密依赖 userRepo 验证 synthetic user | 修改认证逻辑需同步修改两处 |
| `rbacGuards` ↔ `handler/rbac_lookups.go` | 6 个 CreatorLookup 闭包直接引用 handler 方法 | 新增资源类型需同时修改 rbac.go 和 handler |
| `organizationService` ↔ `tenantService` | OwnerTenantID 不可变,强依赖租户生命周期 | 租户删除需级联处理组织成员 |
| `auditLogService` ↔ `gin.Context` | 使用 gin FullPath 作为 dedup key | 框架迁移成本高 |
| `middleware/Auth` ↔ `systemSettingService` | 认证流程依赖 system_settings 读取配置 | 配置服务不可用时认证受阻 |

#### 可独立替换模块

| 模块 | 独立性 | 替换建议 |
|------|--------|----------|
| Repository 层 | 高 | 通过接口抽象,可替换为其他 ORM 或 NoSQL |
| `auditLogService` | 中 | 审计日志可独立为微服务,通过事件总线解耦 |
| `organizationService` | 中 | 共享空间是可选功能,可通过 feature flag 禁用 |
| OIDC 认证 | 高 | 可替换为 SAML/LDAP,只需实现相同的 User 映射接口 |
| API Key 认证 | 高 | 加解密逻辑独立,可替换为其他加密方案 |
| 前端权限控制 | 高 | `currentTenantRole`/`hasRole` 是纯前端逻辑,可独立调整 |

#### 解耦改进建议

1. **CreatorLookup 抽象化**:将 6 个闭包改为接口 + 注册表模式,新增资源类型无需修改 rbac.go
2. **审计事件总线化**:引入异步事件队列,auditLogService 订阅事件而非直接调用
3. **配置服务降级**:systemSettingService 不可用时应有 fallback 默认值,避免认证阻断

### 2.6 企业 IDP/UM 接入方案

#### 现有支持评估

| 维度 | 现状 | 评分 |
|------|------|------|
| OIDC 支持 | 完整实现(code exchange + ID Token 验证 + 用户映射) | 9/10 |
| SAML 支持 | 无原生支持,需自行实现或通过 OIDC 桥接 | 3/10 |
| LDAP 支持 | 无原生支持 | 2/10 |
| SCIM 配置 | 无原生支持(用户生命周期管理需手动) | 2/10 |
| 多 IdP 并存 | 单一 OIDC 配置,不支持多 IdP 路由 | 4/10 |
| 用户映射 | email/username 匹配,自动创建本地 User | 7/10 |
| 组/角色映射 | 无 IdP 组到租户角色的自动映射 | 3/10 |
| JIT 配置 | 部分支持(首次登录自动创建用户),但不支持自动加入租户 | 5/10 |
| 审计合规 | 完整的 append-only 审计日志,支持 1 分钟去重 | 8/10 |
| API Key 管理 | AES-GCM 加密存储,支持撤销 | 8/10 |
| 跨租户管理 | SystemAdmin 双开关模型,可控 | 7/10 |

#### 企业接入所需改造

| 改造项 | 优先级 | 工作量 | 说明 |
|--------|--------|--------|------|
| **多 IdP 路由** | 高 | 中 | 根据 email domain 路由到不同 IdP |
| **SCIM 2.0 端点** | 高 | 高 | 实现用户/组的 CRUD,支持自动配置和停用 |
| **组到角色映射** | 高 | 中 | IdP 组 → 租户角色(Owner/Admin/...)的自动映射规则 |
| **JIT 自动入组** | 高 | 中 | 首次登录时根据 IdP 声明自动加入指定租户 |
| **会话生命周期** | 中 | 低 | 支持 SLO(Single Logout)和会话超时策略 |
| **SAML 支持** | 中 | 高 | 通过 OIDC 桥接或原生实现 |
| **合规报告** | 中 | 中 | SOC2/ISO27001 所需的合规报告导出 |
| **密码策略** | 中 | 低 | 复杂度、过期、历史密码检查(本地用户场景) |
| **MFA 强制** | 中 | 中 | 基于 role/tenant 的 MFA 强制策略 |
| **用户停用同步** | 高 | 中 | IdP 停用用户后自动禁用本地账户和撤销 token |

#### 推荐接入方案

**方案 A:OIDC + SCIM 混合模式**(推荐,中大型企业)

1. **认证层**:保留现有 OIDC 实现,扩展支持多 IdP 路由(根据 email domain)
2. **配置层**:新增 SCIM 2.0 端点(`/scim/v2/Users`, `/scim/v2/Groups`)
3. **映射层**:在 `userService` 中新增 GroupRoleMapper,将 IdP 组映射到 (tenant_id, role)
4. **生命周期**:监听 SCIM 事件,自动创建/禁用/删除本地用户和成员关系

**优势**:复用现有 OIDC 基础设施;SCIM 标准化用户生命周期管理;组映射实现自动化配置

**工作量估算**:约 4-6 周(2 人团队)

**方案 B:纯 OIDC + 手动管理**(中小企业)

保留现有邀请流程,仅扩展多 IdP 路由。工作量约 1-2 周。

#### 模块适配开发可行性

**结论:可以解耦并单独进行模块适配开发,但需要遵循以下原则**:

1. **接口边界清晰**:Repository 层接口抽象完善,可独立替换数据访问层
2. **认证层可插拔**:OIDC/API Key/JWT 三种认证方式独立实现,新增认证方式只需实现相同接口
3. **审计日志可外挂**:auditLogService 可通过事件总线解耦,外挂到企业 SIEM 系统
4. **RBAC 守卫可扩展**:rbacGuards 工厂模式支持新增资源类型,但需同步修改 handler 层 CreatorLookup
5. **前端权限控制独立**:`currentTenantRole`/`hasRole` 是纯前端逻辑,可独立调整

**改造重点**:
- 解耦 `rbacGuards` 与 `handler/rbac_lookups.go` 的闭包耦合(改为接口注册表)
- 引入审计事件总线(异步队列)
- systemSettingService 增加降级 fallback

---

## 三、Agent 开发体系完整审查

### 3.1 ReAct 引擎架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          WeKnora Agent Engine 总体架构                       │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────────┐
                              │  HTTP / SSE 入口  │
                              │ (handler/agent.go)│
                              └────────┬─────────┘
                                       │
                                       ▼
                         ┌──────────────────────────┐
                         │   AgentEngine.Execute    │  (engine.go)
                         │  ─────────────────────   │
                         │ • 加载 AgentConfig       │
                         │ • 构建 SystemPrompt      │
                         │ • 注入 Skills Metadata   │
                         │ • SetPinnedMentions      │
                         │ • 初始化 tokenEstimator  │
                         └────────────┬─────────────┘
                                      │
                                      ▼
            ┌───────────────────────────────────────────────────┐
            │            executeLoop (主 ReAct 循环)             │
            │  while iteration < maxIterations:                 │
            │    ┌─────────────────────────────────────────┐    │
            │    │  runReActIteration (单次迭代)            │    │
            │    └────────┬────────────────────────────────┘    │
            │     ┌───────▼────────┐  ┌───────────────────┐    │
            │     │  THINK 阶段     │  │   ACT 阶段         │    │
            │     │ (think.go)      │  │  (act.go)         │    │
            │     │ • streamLLM     │  │ • parseToolCalls  │    │
            │     │ • ThinkSplitter │  │ • RepairJSON      │    │
            │     │ • thinking策略  │  │ • parallel exec   │    │
            │     │ • callLLMRetry  │  │ • errgroup+Mutex  │    │
            │     └───────┬────────┘  └────────┬──────────┘    │
            │             └────────┬───────────┘                │
            │                      ▼                            │
            │     ┌────────────────────────────────────────┐    │
            │     │         OBSERVE 阶段 (observe.go)       │    │
            │     │ • manageContextWindow (Consolidator)    │    │
            │     │ • responseVerdict (是否需继续)          │    │
            │     │ • buildRuntimeContextBlock (XML 注入)   │    │
            │     │ • buildMustUseBlock (@mention 强制)     │    │
            │     │ • redactHistoryKBResults (历史瘦身)     │    │
            │     └────────────────┬───────────────────────┘    │
            │             ┌────────▼─────────┐                  │
            │             │  iterOutcome     │                  │
            │             │  sentinel 判定   │                  │
            │             └────────┬─────────┘                  │
            │       ┌──────────────┼──────────────┐             │
            │       ▼              ▼              ▼             │
            │   continue        finalize      abort/err         │
            └───────────────────────────────────────────────────┘
                                      │
                                      ▼
                         ┌──────────────────────────┐
                         │   finalize.go            │
                         │ • 流式最终答案            │
                         │ • EventAgentFinalAnswer  │
                         │ • EventAgentComplete     │
                         └──────────────────────────┘
```

**关键常量**:
- `DefaultAgentMaxIterations = 20`
- `defaultLLMCallTimeout = 120s`
- `maxRepeatedResponseRounds = 2`(防止 LLM 重复无工具调用的响应)

**关键发现:没有 `final_answer` 工具**。`finalize.go` 中明确注释:agent 通过自然停止结束循环。当 LLM 返回 `finish_reason=stop` 且无 `tool_calls` 时,进入 finalize 阶段流式输出最终答案。

**思考模式策略**(4 种 `ThinkingStrategy`):
1. `noThinking` - 不发送任何 thinking 字段
2. `enableThinking` - Qwen 的 `enable_thinking` boolean
3. `thinkingTypeField` - LKEAP/Volcengine 的 `{"thinking":{"type":"enabled|disabled"}}`
4. `chatTemplateKwargs` - vLLM 的 `chat_template_kwargs.enable_thinking`

### 3.2 工具系统设计

#### 内置工具完整清单(20+)

**推理类**:
- `thinking` - 思考工具,thoughtHistory + branches
- `todo_write` - 任务规划,仅跟踪检索/研究任务

**RAG 检索类**:
- `knowledge_search` - 语义搜索,1-5 查询,rerank + MMR
- `grep_chunks` - POSIX 正则搜索(PostgreSQL `~*`),MMR 去冗余
- `list_knowledge_chunks` - 分块列表,支持 FAQ/文档/单 chunk
- `query_knowledge_graph` - 知识图谱查询,并发多 KB
- `get_document_info` - 文档元数据,支持 FAQ entries
- `database_query` - SQL 查询,自动 tenant_id 注入 + 安全校验

**Wiki 工具**:
- `wiki_search` / `wiki_read_page` - POSIX 正则搜索 + 页面读取
- `wiki_read_source_doc` - 源文档深读,支持 regex/range
- `wiki_write_page` - 创建/覆写页面,自动 cross-links
- `wiki_replace_text` - 精确文本替换
- `wiki_rename_page` / `wiki_delete_page` - 页面重命名/删除
- `wiki_flag_issue` / `wiki_read_issue` / `wiki_update_issue` - Issue 管理

**数据分析**:
- `data_schema` - 获取 CSV/Excel 表 schema
- `data_analysis` - DuckDB 数据分析

**Web 工具**:
- `web_search` - Web 搜索,"KB First Rule"(必须先查 KB)
- `web_fetch` - Web 页面抓取,SSRF 防护(DNS pinning + chromedp)

**Skill 工具**:
- `skill_read` - Skill 按需加载(Progressive Disclosure Level 2/3)
- `skill_execute` - Skill 脚本执行

**MCP 工具**:动态注册,通过 `mcp_tool.go` 包装为 `types.Tool`

#### 工具能力需求系统

5 种 `KBCapability`:vector/keyword/wiki/graph/faq

`ToolRequirement` 三种声明:
- `AnyOf` - KB 至少具备一个能力
- `AllOf` - KB 必须具备所有能力
- `ConsumesFiles` - 是否消费用户 @file 引用

#### 工具输出处理

- **截断**:`DefaultMaxToolOutput = 16000` runes,70% head + 30% tail
- **持久化压缩**:按 display_type 剥离大负载,历史回放时生成简短摘要
- **参数处理**:`CastParams` 类型修正 + `ValidateParams` Schema 校验 + `RepairJSON` 修复 LLM JSON 错误
- **消息清理**:修复连续同角色消息、孤儿 tool result、空内容消息

### 3.3 MCP 集成深度分析

#### 传输与协议

- **stdio transport 已禁用**(安全原因):`manager.go` 返回错误 "stdio transport is disabled for security reasons"
- 支持 SSE 和 HTTP Streamable 两种传输
- **OAuth2 with PKCE**:遵循 RFC 9728 protected-resource metadata

#### MCP 工具包装

- **不可信前缀**:MCP 工具名添加前缀防止与内置工具冲突
- **HITL 审批门控**:每个 MCP 工具调用前检查是否需要用户审批
- **默认 fail-close**:未审批则拒绝执行

#### OAuth 会话管理

- `getOrCreateMCPClientWithOAuthRetry` - 连接失败时暂停等待用户 OAuth 授权后重试
- `waitForMCPOAuthAuthorization` - 检测 `OAuthRequiredError` → `RequestOAuthAndWait` → 重试
- **非交互渠道**(IM bots)不阻塞,发送 `emitMCPOAuthRequiredNotice`
- 可配置 MCP OAuth 等待超时(per agent)

#### HITL 审批门控

- **Redis Pub/Sub 跨实例 fan-out**:多副本部署审批决策同步
- `EventToolApprovalRequired` / `EventToolApprovalResolvedData` 事件
- `ApprovalCtx` - 不受 defaultToolExecTimeout 限制的父 ctx
- 前端 `ToolApprovalCard.vue` 展示审批 UI

### 3.4 Skill 沙箱机制

#### Skill 定义(Progressive Disclosure 三级)

1. **Level 1 - Metadata**:name/description/when_to_use,注入 system prompt
2. **Level 2 - Instructions**:SKILL.md 内容,通过 `skill_read` 工具按需加载
3. **Level 3 - Resources**:脚本/配置文件,通过 `skill_read` + `skill_execute` 按需加载

#### 沙箱后端

**Docker 沙箱**安全措施:
- `--user 1000:1000` 非 root 运行
- `--cap-drop ALL` 移除所有 capabilities
- `--read-only` 只读根文件系统(可选)
- `--memory` + `--memory-swap` 内存限制(禁用 swap)
- `--cpus` CPU 限制
- `--network none` 网络隔离(默认)
- `--pids-limit 100` 进程数限制
- `--security-opt no-new-privileges` 禁止提权

**本地沙箱**(fallback):
- 命令白名单验证(python3/node/bash/sh 等)
- 工作目录限制
- 超时 enforcement
- 危险环境变量过滤(LD_PRELOAD/LD_LIBRARY_PATH/PYTHONPATH/NODE_OPTIONS/BASH_ENV 等)
- 进程组管理

**ScriptValidator 防注入**:
- 危险命令检测(rm -rf /, mkfs, dd, shutdown, fork bombs 等)
- 危险模式检测(base64 解码、eval、os.system、pickle.loads、yaml.unsafe_load 等)
- 网络访问检测(curl/wget/nc/ssh/requests.get 等)
- 反向 shell 检测(/dev/tcp/, bash -i, python pty.spawn 等)
- 参数注入检测(路径遍历、环境变量注入、shell 操作符、命令替换)
- Stdin 注入检测

### 3.5 自定义 Agent 扩展机制

#### 内置 Agent

1. `builtin-quick-answer` - RAG 模式,temperature=0.7
2. `builtin-smart-reasoning` - ReAct 模式,max_iterations=50
3. `builtin-data-analyst` - 数据分析,temperature=0.3
4. `builtin-wiki-researcher` - Wiki 问答
5. `builtin-wiki-fixer` - Wiki 修订(含写入工具)

#### Agent 类型预设

1. `rag-qa` - system_prompt_id=progressive_rag_agent
2. `wiki-qa` - system_prompt_id=wiki_researcher
3. `hybrid-rag-wiki` - max_iterations=40,合并 RAG + Wiki 工具
4. `data-analysis` - temperature=0.3,kb_filter: none_of=[faq]
5. `custom` - 无预设,用户完全自定义

#### Custom Agent 创建

- `AgentEditorModal.vue` 提供完整 UI
- 可配置 agent_mode/agent_type/system_prompt/model/tools/mcp/skills/kb
- CRUD API 支持创建/编辑/复制/删除
- 支持集成到 IM/Embed 渠道
- `kb_filter` 支持 `any_of`/`all_of`/`none_of` 谓词

#### @mention Scope Restriction

**两层实现**:
1. **服务端静默过滤**:`searchTargetsAllowKnowledgeID` + `WikiScope`(KB 级 + knowledge_ids 白名单 + tag_ids 白名单),模型看不到过滤逻辑
2. **Prompt 注入**:`SetPinnedMentions` 设置 @mention 范围,`buildMustUseBlock` 注入 `<must_use>` XML 提示

### 3.6 与 Claude Code Agent SDK 对比

**Claude Agent SDK 概览**(来源:Anthropic 官方文档 code.claude.com/docs/en/agent-sdk/overview):

Anthropic 官方 Agent SDK 提供 Python 和 TypeScript 两种实现,核心能力:
- **内置工具**:Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch/Monitor/AskUserQuestion
- **Hooks**:PreToolUse/PostToolUse/Stop/SessionStart/SessionEnd/UserPromptSubmit
- **Subagents**:AgentDefinition 程序化定义或文件系统定义,context isolation + parallelization + tool restrictions
- **MCP**:完整 MCP 支持,stdio/SSE/HTTP
- **Permissions**:allowed_tools 控制工具白名单
- **Sessions**:JSONL 文件存储,resume/fork 会话
- **Skills**:`.claude/skills/*/SKILL.md`,Progressive Disclosure
- **Plugins**:programmatic via `plugins` option

| 维度 | WeKnora | Claude Agent SDK |
|------|---------|------------------|
| **架构** | 服务端 ReAct 引擎(Go) | 客户端 Agent SDK(Python/TS) |
| **工具系统** | 内置 + MCP + Skills | 内置 + MCP + Skills |
| **沙箱** | Docker + Local + ScriptValidator(完整) | 无内置沙箱(依赖宿主) |
| **HITL** | Redis Pub/Sub 跨实例 | 单进程回调 |
| **OAuth** | in-conversation prompt + 非交互渠道降级 | 需自行实现 |
| **Skills 加载** | Progressive Disclosure 三级 | 类似三级加载 |
| **流式** | SSE + EventBus | SDK 回调 |
| **多租户** | 原生支持(tenant_id 注入) | 无 |
| **@mention** | 服务端静默过滤 + Prompt 注入 | 无原生支持 |
| **自定义工具** | MCP + Skills 脚本 + 代码扩展 | MCP + Skills + in-process 函数 |
| **部署形态** | 云服务(多副本) | 本地 CLI/库 |
| **会话存储** | PostgreSQL + Redis | JSONL 文件 |
| **Subagent** | 无原生 Subagent 概念 | AgentDefinition 原生支持 |
| **Hooks** | 无显式 Hooks,通过 EventBus 实现 | 显式 Hooks API |

**关键差异分析**:

1. **WeKnora 的优势**:
   - 多租户原生支持(tenant_id 自动注入,跨租户 RBAC)
   - Redis Pub/Sub 跨实例 HITL(企业级分布式部署)
   - 服务端静默过滤(模型不可见,安全最佳实践)
   - 完整沙箱(Docker 隔离 + ScriptValidator 防注入)
   - 非交互渠道(IM bots)OAuth 降级处理

2. **Claude Agent SDK 的优势**:
   - 原生 Subagent 模式(AgentDefinition + Agent tool,context isolation + parallelization)
   - 显式 Hooks API(PreToolUse/PostToolUse/Stop 等)
   - 本地文件系统操作(Read/Write/Edit/Bash)
   - Sessions JSONL resume/fork
   - 无需服务端部署,本地即可运行

3. **可借鉴点**:
   - WeKnora 可借鉴 Subagent 模式,实现主 Agent + 专门 Subagent 委托
   - WeKnora 可借鉴显式 Hooks API,提供更清晰的扩展点
   - Claude Agent SDK 可借鉴 WeKnora 的多租户隔离、Redis HITL、服务端静默过滤

### 3.7 高级自定义能力评估

#### 用户能否添加自定义工具?

**通过 MCP**:✅ 完全支持
- 配置 MCP 服务(SSE/HTTP Streamable)
- OAuth2 PKCE 自动授权
- HITL 审批门控
- 动态注册为 `types.Tool`

**通过 Skills 脚本**:✅ 支持(受限)
- `skill_execute` 工具执行 Python/Bash/Node 脚本
- 沙箱隔离(Docker/Local)
- ScriptValidator 防注入
- **限制**:无法直接注册为 LLM 可见的 tool schema(需通过 `skill_read` 暴露)

**直接代码扩展**:✅ 支持
- 实现 `BaseTool` 接口(Name/Description/Schema/Execute)
- 通过 `toolRegistry.Register` 注册
- 需重新编译部署

#### 用户能否添加自定义技能?

✅ 完全支持
- 文件系统加载器扫描 Skills 目录
- 三级 Progressive Disclosure(Metadata/Instructions/Resources)
- SKILL.md 定义技能元数据
- 脚本文件通过 `skill_execute` 执行
- 路径遍历防护

#### 用户能否添加自定义 Agent 类型?

**通过预设**:⚠️ 部分支持
- `agent_type_presets.yaml` 定义预设,但需要重新部署
- `custom` 类型允许用户完全自定义配置

**通过 Custom Agent**:✅ 完全支持
- `AgentEditorModal.vue` 提供完整 UI
- 可配置 agent_mode/agent_type/system_prompt/model/tools/mcp/skills/kb
- CRUD API 支持创建/编辑/复制/删除
- 支持集成到 IM/Embed 渠道

**限制**:
- 无法定义新的 `agent_type` 枚举值(需改代码)
- 无法添加新的内置 Agent(需改 yaml + 重新部署)
- 无法自定义 ReAct 循环逻辑(引擎固定)

#### 综合评估

| 自定义维度 | 能力 | 评分 |
|-----------|------|------|
| 自定义工具(MCP) | 完整支持,OAuth2 + HITL | 9/10 |
| 自定义工具(Skills 脚本) | 受限支持,沙箱隔离 | 7/10 |
| 自定义工具(代码扩展) | 需重新编译 | 6/10 |
| 自定义技能 | 完整支持,三级加载 | 9/10 |
| 自定义 Agent 配置 | 完整支持,UI 编辑器 | 9/10 |
| 自定义 Agent 类型 | 部分支持,需重新部署 | 6/10 |
| 自定义 ReAct 逻辑 | 不支持,引擎固定 | 3/10 |
| 自定义 LLM 提供商 | 完整支持,20+ 集成 | 9/10 |
| 自定义向量数据库 | 完整支持,8 种后端 | 9/10 |
| 自定义 IM 渠道 | 完整支持,7 种渠道 | 9/10 |

**总结**:WeKnora 的 Agent 高级自定义能力在**工具/技能/Agent 配置**层面非常强大(9/10),但在**引擎逻辑自定义**层面较弱(3/10)。对于需要完全控制 ReAct 循环的高级用户,需要 fork 代码修改;对于通过配置和工具扩展满足需求的用户,WeKnora 提供了完整的低代码/无代码扩展路径。

---

## 四、关键文件路径索引

### Wiki 模块

**核心数据模型与接口**:
- [wiki_page.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/wiki_page.go)
- [wiki_log_entry.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/wiki_log_entry.go)
- [interfaces/wiki_page.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/interfaces/wiki_page.go)

**LLM 提示词**:
- [prompts_wiki.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/prompts_wiki.go)

**Service 层**:
- [wiki_ingest.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/wiki_ingest.go)(队列/锁/LLM 重试)
- [wiki_ingest_batch.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/wiki_ingest_batch.go)(Map-Reduce 主流程)
- [wiki_ingest_cite.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/wiki_ingest_cite.go)(chunk 引用流水线)
- [wiki_ingest_taxonomy.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/wiki_ingest_taxonomy.go)(分类法规划)
- [wiki_ingest_dedup.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/wiki_ingest_dedup.go)(去重预过滤)
- [wiki_page.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/wiki_page.go)(CRUD/链接/文件夹树)
- [wiki_lint.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/wiki_lint.go)(健康检查/自动修复)
- [wiki_linkify.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/wiki_linkify.go)(跨链接注入)
- [wiki_boost.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/chat_pipeline/wiki_boost.go)(RAG 增强)

**Agent 工具**:
- [wiki_write_page.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/wiki_write_page.go)
- [wiki_tools.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/wiki_tools.go)(read_page + search)
- [wiki_read_source_doc.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/wiki_read_source_doc.go)
- [wiki_rename_page.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/wiki_rename_page.go)
- [wiki_delete_page.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/wiki_delete_page.go)
- [wiki_replace_text.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/wiki_replace_text.go)
- [wiki_flag_issue.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/wiki_flag_issue.go)

**Handler / Router / RBAC**:
- [wiki_page.go](file:///Users/tohnee/Trae/github/WeKnora/internal/handler/wiki_page.go)
- [wiki_fixer_scope.go](file:///Users/tohnee/Trae/github/WeKnora/internal/handler/session/wiki_fixer_scope.go)
- [router.go](file:///Users/tohnee/Trae/github/WeKnora/internal/router/router.go)(RegisterWikiPageRoutes)
- [task.go](file:///Users/tohnee/Trae/github/WeKnora/internal/router/task.go)(asynq 注册)
- [rbac.go](file:///Users/tohnee/Trae/github/WeKnora/internal/router/rbac.go)(OwnedWikiKBOrAdmin)

**前端**:
- [NotebookView.vue](file:///Users/tohnee/Trae/github/WeKnora/frontend/src/views/notebook/NotebookView.vue)
- [StudioPanel.vue](file:///Users/tohnee/Trae/github/WeKnora/frontend/src/components/notebook/StudioPanel.vue)
- [SourcePanel.vue](file:///Users/tohnee/Trae/github/WeKnora/frontend/src/components/notebook/SourcePanel.vue)
- [WikiBrowser.vue](file:///Users/tohnee/Trae/github/WeKnora/frontend/src/views/knowledge/wiki/WikiBrowser.vue)
- [WikiEditResult.vue](file:///Users/tohnee/Trae/github/WeKnora/frontend/src/views/chat/components/tool-results/WikiEditResult.vue)
- [api/wiki/index.ts](file:///Users/tohnee/Trae/github/WeKnora/frontend/src/api/wiki/index.ts)

### 租户与权限模块

**Types 层**:
- [tenant.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/tenant.go)
- [tenant_member.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/tenant_member.go)
- [tenant_invitation.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/tenant_invitation.go)
- [user.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/user.go)
- [principal.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/principal.go)
- [audit_log.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/audit_log.go)
- [organization.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/organization.go)

**Middleware 层**:
- [auth.go](file:///Users/tohnee/Trae/github/WeKnora/internal/middleware/auth.go)
- [rbac.go](file:///Users/tohnee/Trae/github/WeKnora/internal/middleware/rbac.go)
- [access.go](file:///Users/tohnee/Trae/github/WeKnora/internal/middleware/access.go)
- [kb_access.go](file:///Users/tohnee/Trae/github/WeKnora/internal/middleware/kb_access.go)
- [audit_provider.go](file:///Users/tohnee/Trae/github/WeKnora/internal/middleware/audit_provider.go)

**Handler / Router**:
- [rbac_lookups.go](file:///Users/tohnee/Trae/github/WeKnora/internal/handler/rbac_lookups.go)
- [dto/role.go](file:///Users/tohnee/Trae/github/WeKnora/internal/handler/dto/role.go)
- [router/rbac.go](file:///Users/tohnee/Trae/github/WeKnora/internal/router/rbac.go)

**Service 层**:
- [tenant.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/tenant.go)
- [tenant_member.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/tenant_member.go)
- [user.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/user.go)
- [audit_log.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/audit_log.go)
- [system_setting.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/system_setting.go)
- [organization.go](file:///Users/tohnee/Trae/github/WeKnora/internal/application/service/organization.go)

**文档**:
- [RBAC说明.md](file:///Users/tohnee/Trae/github/WeKnora/docs/RBAC说明.md)
- [共享空间说明.md](file:///Users/tohnee/Trae/github/WeKnora/docs/共享空间说明.md)
- [OIDC认证调用流程.md](file:///Users/tohnee/Trae/github/WeKnora/docs/OIDC认证调用流程.md)

### Agent 模块

**引擎核心**:
- [engine.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/engine.go)
- [act.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/act.go)
- [think.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/think.go)
- [finalize.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/finalize.go)
- [observe.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/observe.go)
- [const.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/const.go)
- [prompts.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/prompts.go)

**工具系统**:
- [registry.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/registry.go)
- [tool.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/tool.go)
- [definitions.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/definitions.go)
- [capabilities.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/capabilities.go)
- [truncate.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/truncate.go)
- [persist.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/persist.go)
- [json_repair.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/json_repair.go)
- [scope_authorization.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/scope_authorization.go)

**MCP 集成**:
- [mcp/manager.go](file:///Users/tohnee/Trae/github/WeKnora/internal/mcp/manager.go)
- [mcp/client.go](file:///Users/tohnee/Trae/github/WeKnora/internal/mcp/client.go)
- [tools/mcp_tool.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/mcp_tool.go)
- [tools/mcp_oauth.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/tools/mcp_oauth.go)
- [approval/gate.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/approval/gate.go)

**Skills 与沙箱**:
- [skills/skill.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/skills/skill.go)
- [skills/manager.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/skills/manager.go)
- [skills/loader.go](file:///Users/tohnee/Trae/github/WeKnora/internal/agent/skills/loader.go)
- [sandbox/sandbox.go](file:///Users/tohnee/Trae/github/WeKnora/internal/sandbox/sandbox.go)
- [sandbox/docker.go](file:///Users/tohnee/Trae/github/WeKnora/internal/sandbox/docker.go)
- [sandbox/local.go](file:///Users/tohnee/Trae/github/WeKnora/internal/sandbox/local.go)
- [sandbox/validator.go](file:///Users/tohnee/Trae/github/WeKnora/internal/sandbox/validator.go)

**配置**:
- [builtin_agents.yaml](file:///Users/tohnee/Trae/github/WeKnora/config/builtin_agents.yaml)
- [agent_type_presets.yaml](file:///Users/tohnee/Trae/github/WeKnora/config/agent_type_presets.yaml)
- [types/agent.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/agent.go)
- [types/custom_agent.go](file:///Users/tohnee/Trae/github/WeKnora/internal/types/custom_agent.go)
- [handler/custom_agent.go](file:///Users/tohnee/Trae/github/WeKnora/internal/handler/custom_agent.go)

**前端**:
- [AgentList.vue](file:///Users/tohnee/Trae/github/WeKnora/frontend/src/views/agent/AgentList.vue)
- [AgentEditorModal.vue](file:///Users/tohnee/Trae/github/WeKnora/frontend/src/views/agent/AgentEditorModal.vue)
- [AgentStreamDisplay.vue](file:///Users/tohnee/Trae/github/WeKnora/frontend/src/views/chat/components/AgentStreamDisplay.vue)
- [tool-capabilities.ts](file:///Users/tohnee/Trae/github/WeKnora/frontend/src/utils/tool-capabilities.ts)

---

## 五、综合结论

### 5.1 Wiki 模块

WeKnora Wiki 是 Karpathy LLM-Wiki 理念的**企业级落地实现**。在保留"LLM 自主编译知识库"核心理念的基础上,增加了两遍抽取流水线、Map-Reduce 批处理、持久化队列、RAG 增强、多租户 RBAC、Agent 工具集、健康检查等工程化能力,可支持 40k 文档规模的企业知识库。Claude Code Agent SDK 集成推荐通过 MCP server 模式,将 WeKnora Wiki 工具集暴露给 Agent SDK,实现"主 Agent + Wiki 研究 Subagent"模式。

### 5.2 权限模块

WeKnora 的 RBAC 模块设计成熟,双闸门正交模型(纵向租户 RBAC + 横向共享空间 KBAccess)、fail-closed 语义、行级锁保护、事务原子性、令牌安全传输等设计严谨。模块解耦评估显示 Repository 层、OIDC/API Key 认证、前端权限控制可独立替换,但 `rbacGuards` 与 handler 的闭包耦合、`auditLogService` 与 gin.Context 的框架耦合需改进。企业 IDP/UM 接入推荐采用 OIDC + SCIM 混合模式,工作量约 4-6 周。

### 5.3 Agent 模块

WeKnora 的 Agent 开发体系是生产级企业级实现,完整的 ReAct 循环(THINK → ACT → OBSERVE)、20+ 内置工具、深度 MCP 集成(OAuth2 PKCE + HITL 跨实例)、安全的 Skill 沙箱(Docker + ScriptValidator)。高级自定义能力在**工具/技能/Agent 配置**层面非常强大(9/10),MCP 路径完整、Custom Agent UI 完善;但在**引擎逻辑自定义**层面较弱(3/10),无法自定义 ReAct 循环。与 Claude Code Agent SDK 相比,WeKnora 在多租户隔离、跨实例 HITL、服务端静默过滤方面有企业级优势,可借鉴 Agent SDK 的 Subagent 模式和显式 Hooks API。

---

**审查完成,未修改任何代码。** 所有文件路径均为绝对路径,可供后续深度分析参考。

**信息源声明**:本报告对比分析部分引用了以下正规渠道:
- Anthropic 官方文档:https://code.claude.com/docs/en/agent-sdk/overview
- Anthropic 官方 GitHub:https://github.com/anthropics/claude-agent-sdk-python
- Karpathy LLM-Wiki GitHub 仓库(公开)
