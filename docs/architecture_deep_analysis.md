# WeKnora 架构深度分析报告

> 本文档基于对 WeKnora 全局代码的深度审查，从四个维度展开分析：
> 1. 用户权限系统与 UUM 接入能力
> 2. 多模态文档解析能力
> 3. Wiki 知识库 QA 链路
> 4. ReAct 智能体问答链路
>
> 每个维度均包含：现状梳理、能力评估、问题诊断、改进建议。
>
> 落盘路径：`docs/architecture_deep_analysis.md`
> 配套文档：`docreader/docs/code_review_analysis.md`、`docreader/docs/refactor_plan.md`
>
> **v1.2 修订摘要**（基于代码逐行核查）：
> - Principal 常量：3 个 embed 类名称修正（embed_kb→embed_channel / embed_agent→embed_session / embed_chat→embed_visitor），类型名 PrincipalType 不存在
> - ReAct 四阶段：think/act/observe/finalize 修正为 think/analyze/act/observe（analyze 替代 finalize）
> - 工具数量：21 个修正为 22 个（AvailableToolDefinitions）+ 2 个条件注册的 Web 工具 = 24 个
> - Wiki 工具：7 个（wiki_index/wiki_get/...）修正为 10 个（wiki_read_page/wiki_write_page/...）
> - MCP 文件路径：mcp_loader.go 修正为 mcp_tool.go
> - 最大迭代数：补充多层默认值说明（绝对上限 100，引擎默认 20，自定义 Agent 默认 10，配置校验默认 5）
> - 权限代码行数：约 4000 行修正为约 12000+ 行，散落在 7 层 25+ 文件
> - OIDC 接口方法：5 个接口方法修正为 2 个公开接口方法 + 3 个私有实现方法
> - Studio 工具：补充 UI 可见 14 项（配置 20 项，隐藏 6 项）
> - DeepResearcher：补充同类预留常量（KnowledgeGraphExpert / DocumentAssistant）

---

## 目录

- [一、用户权限系统与 UUM 接入能力](#一用户权限系统与-uum-接入能力)
  - [1.1 权限模型全景](#11-权限模型全景)
  - [1.2 认证机制](#12-认证机制)
  - [1.3 Principal 抽象与 API Key 模式](#13-principal-抽象与-api-key-模式)
  - [1.4 模块独立性评估](#14-模块独立性评估)
  - [1.5 UUM 接入能力评估](#15-uum-接入能力评估)
  - [1.6 问题诊断](#16-问题诊断)
  - [1.7 改造路线图](#17-改造路线图)
- [二、多模态文档解析能力](#二多模态文档解析能力)
  - [2.1 架构分层](#21-架构分层)
  - [2.2 docreader 服务定位](#22-docreader-服务定位)
  - [2.3 Go App 解析引擎矩阵](#23-go-app-解析引擎矩阵)
  - [2.4 VLM 多模态能力](#24-vlm-多模态能力)
  - [2.5 支持文件类型](#25-支持文件类型)
  - [2.6 扩展机制](#26-扩展机制)
  - [2.7 性能与瓶颈](#27-性能与瓶颈)
  - [2.8 能力评估](#28-能力评估)
- [三、Wiki 知识库 QA 链路](#三wiki-知识库-qa-链路)
  - [3.1 Wiki 概念定位](#31-wiki-概念定位)
  - [3.2 Wiki 编译链路](#32-wiki-编译链路)
  - [3.3 Wiki 检索链路](#33-wiki-检索链路)
  - [3.4 Wiki 生成链路](#34-wiki-生成链路)
  - [3.5 知识图谱构建](#35-知识图谱构建)
  - [3.6 与参考实现对比](#36-与参考实现对比)
  - [3.7 差距分析](#37-差距分析)
  - [3.8 改进建议](#38-改进建议)
- [四、ReAct 智能体问答链路](#四react-智能体问答链路)
  - [4.1 ReAct 引擎架构](#41-react-引擎架构)
  - [4.2 工具系统](#42-工具系统)
  - [4.3 LLM 抽象层](#43-llm-抽象层)
  - [4.4 Claude Code SDK 接入可行性](#44-claude-code-sdk-接入可行性)
  - [4.5 OpenCode SDK 接入可行性](#45-opencode-sdk-接入可行性)
  - [4.6 推荐集成路径](#46-推荐集成路径)
- [五、综合结论](#五综合结论)
- [六、联网搜索与 Deep Research 能力](#六联网搜索与-deep-research-能力)
  - [6.1 联网搜索架构](#61-联网搜索架构)
  - [6.2 支持的搜索引擎](#62-支持的搜索引擎)
  - [6.3 企业搜索服务接入能力](#63-企业搜索服务接入能力)
  - [6.4 缓存、去重、限流](#64-缓存去重限流)
  - [6.5 搜索能力使用场景](#65-搜索能力使用场景)
  - [6.6 Deep Research 能力](#66-deep-research-能力)
  - [6.7 能力评估](#67-能力评估)
  - [6.8 改进建议](#68-改进建议)
- [七、Notebook Studio 生成能力](#七notebook-studio-生成能力)
  - [7.1 架构定位](#71-架构定位)
  - [7.2 20 项生成工具清单](#72-20-项生成工具清单)
  - [7.3 统一实现路径](#73-统一实现路径)
  - [7.4 Studio 与对话框的关系](#74-studio-与对话框的关系)
  - [7.5 与 NotebookLM 对比](#75-与-notebooklm-对比)
  - [7.6 三大严重缺陷](#76-三大严重缺陷)
  - [7.7 改进建议](#77-改进建议)
- [八、补充综合结论](#八补充综合结论)

---

## 一、用户权限系统与 UUM 接入能力

### 1.1 权限模型全景

WeKnora 采用 **RBAC + 资源归属（creator_id）** 的混合权限模型，覆盖三个层次：

| 层次 | 模型 | 角色 / 维度 | 主要文件 |
|------|------|------------|----------|
| 租户层 | RBAC | Owner(40) / Admin(30) / Contributor(20) / Viewer(10) | `internal/types/tenant_member.go` |
| 组织层 | RBAC | admin(3) / editor(2) / viewer(1) | `internal/types/organization.go` |
| 资源层 | 所有权 | `creator_id` 字段 + `RequireOwnershipOrRole` | `internal/middleware/rbac.go` |

**租户角色权限矩阵**：

```
Owner(40)        : 全部权限 + 危险操作（删除租户、转让所有权）
Admin(30)        : 用户管理 + KB/Agent 管理 + 系统配置
Contributor(20)  : 创建/编辑自有资源
Viewer(10)       : 只读
```

**组织层共享模型**：通过 `KBShare` / `AgentShare` 字段控制知识库与 Agent 是否对组织内可见，组织角色决定成员对组织共享资源的操作权限。

**资源层所有权**：每个 KB / Agent / 文档均带 `creator_id`，`RequireOwnershipOrRole` 中间件允许"创作者本人 OR 拥有对应角色的用户"访问，是非 RBAC 的补充机制。

### 1.2 认证机制

WeKnora 支持 **双认证通道**：

#### 1.2.1 JWT Bearer 认证（Web 用户）

- 入口：`Authorization: Bearer <jwt>`
- 中间件：`internal/middleware/auth.go` 的 `Auth()`
- 流程：解析 JWT → 加载 User → 解析 TenantRole → 解析 APIPrincipal → 注入 context

#### 1.2.2 OIDC SSO（已实现）

- 配置：`internal/config/config.go` 的 `OIDCAuthConfig`
- 流程文档：`docs/OIDC认证调用流程.md`
- 三步流程：
  1. `GetOIDCAuthorizationURL` — 生成授权 URL + state nonce
  2. Provider 回调到 `/auth/oidc/callback`
  3. `LoginWithOIDC` — code 交换 + 用户 provisioning
- provisioning 策略：`provisionOIDCUser` 按 sub/email 自动创建用户并绑定默认租户
- Dex 代理支持：可通过 Dex 间接接入 SAML / LDAP / AD（未在代码中显式实现，但 OIDC 标准兼容）

#### 1.2.3 API Key 认证（外部系统接入）

- 入口：`X-API-Key` 头
- 3 种模式（`APIPrincipalConfig`）：
  - `tenant`：API Key 绑定租户，继承租户角色权限
  - `direct_header`：API Key 直接携带用户身份
  - `signed_token`：签名 token 模式，含过期时间

### 1.3 Principal 抽象与 API Key 模式

`internal/types/principal.go` 定义了 7 种 Principal（纯 string 常量，无独立类型）：

```go
const (
    PrincipalWebUser         = "web_user"
    PrincipalAPITenant       = "api_tenant"
    PrincipalAPIExternalUser = "api_external_user"
    PrincipalIMUser          = "im_user"
    PrincipalEmbedChannel    = "embed_channel"
    PrincipalEmbedSession    = "embed_session"
    PrincipalEmbedVisitor    = "embed_visitor"
)
```

`Principal` 结构体统一抽象了"是谁在访问"，由 `resolveAPIPrincipal` 在 `Auth()` 中间件中解析。这一抽象是接入外部身份系统的关键扩展点。

### 1.4 模块独立性评估

**评分：5/10（中等偏低）**

权限相关代码分布如下：

| 层 | 文件 | 行数估算 | 职责 |
|----|------|----------|------|
| Types | `user.go` / `tenant.go` / `organization.go` / `principal.go` / `tenant_member.go` | ~1700 | 模型定义 |
| Interfaces | `user.go` / `organization.go` / `tenant_member_service.go` / `tenant.go` | ~470 | 接口定义 |
| Middleware | `auth.go` / `rbac.go` / `access.go` / `kb_access.go` / `embed_auth.go` / `auth_public_ratelimit.go` | ~1900 | 请求级守卫 |
| Router | `internal/router/rbac.go` | ~400 | 路由级守卫注册 |
| Service | `internal/application/service/user.go` / `organization.go` / `tenant_member.go` | ~2600 | 业务逻辑（含 OIDC） |
| Repository | `organization.go` / `tenant_member.go` | ~630 | 数据访问 |
| Handler | `auth.go` / `tenant.go` / `organization.go` / `tenant_member.go` | ~4900 | HTTP 入口 |
| Config | `internal/config/config.go` | ~150 | OIDC / 租户配置 |

**总计约 12000+ 行代码，散落在 7 层 25+ 文件中，无独立 `auth` 模块**。

**关键问题**：
- `UserService` 接口（`internal/types/interfaces/user.go`）混入了 2 个 OIDC 公开方法（`GetOIDCAuthorizationURL` / `LoginWithOIDC`），导致用户管理与身份认证耦合。另有 3 个 OIDC 私有实现方法（`exchangeOIDCCode` / `resolveOIDCUserInfo` / `provisionOIDCUser`）虽不在接口中，但也写在 `user.go` service 实现内。
- 没有 `IdentityProvider` 接口抽象，OIDC 实现直接写在 `user.go` service 中。
- 没有组织架构（部门 / 上级 / 下级）模型，无法承接企业 UUM 的层级关系。
- 没有用户同步机制（SCIM / 增量拉取），OIDC 是按需 provisioning，不支持批量同步。

### 1.5 UUM 接入能力评估

**评分：6/10（中等）**

#### 已具备的能力

| 能力 | 实现情况 | 接入友好度 |
|------|---------|-----------|
| OIDC SSO | ✅ 完整实现 | 高 — 标准 OIDC 协议，企业 IdP 普遍支持 |
| 多 Principal 类型 | ✅ 7 种 | 高 — `api_external_user` 可承接外部用户 |
| API Key 认证 | ✅ 3 模式 | 高 — `tenant` 模式适合服务对服务 |
| 多租户隔离 | ✅ 强制 | 高 — 天然支持企业多团队场景 |
| RBAC 角色体系 | ✅ 4 级 + 3 级 | 中 — 角色 ID 硬编码，无角色模板 |
| 资源所有权 | ✅ creator_id | 中 — 简单但够用 |

#### 缺失的能力

| 能力 | 状态 | 影响 |
|------|------|------|
| IdentityProvider 接口抽象 | ❌ 无 | 无法切换 IdP，OIDC 实现侵入 service 层 |
| 组织架构（部门树） | ❌ 无 | 无法承接企业 UUM 的层级关系 |
| 用户同步（SCIM / LDAP 拉取） | ❌ 无 | 仅按需 provisioning，无法批量同步 |
| 角色管理 API | ❌ 无 | 角色是常量，无法动态创建 / 编辑 |
| 权限策略引擎 | ❌ 无 | 权限是代码硬编码，无策略文件 / ABAC |
| 审计日志 | ⚠️ 部分 | 仅登录日志，无权限变更审计 |
| 用户组 / 用户组角色 | ❌ 无 | 仅支持个人角色，不支持组级授权 |

### 1.6 问题诊断

#### 问题 1：身份认证与用户管理强耦合

`UserService` 接口同时承担"用户 CRUD"和"OIDC 认证"两类职责，导致：
- 切换 IdP 必须修改 `user.go` service
- 无法同时支持多个 IdP（如企业既有 OIDC 又有 SAML）
- 单元测试需要 mock 整个 UserService 才能测 OIDC

#### 问题 2：权限决策散落

权限决策发生在三个层次：
- Middleware（`Auth` / `RequireRole` / `RequireKBAccess`）
- Router（`rbacGuards` 注册表）
- Service（业务层再次校验）

无统一的 `PermissionService`，权限规则难以审计。

#### 问题 3：无组织架构模型

企业 UUM 通常包含部门树（部门 → 子部门 → 员工），WeKnora 的 `Organization` 是平铺的，无父子关系，无法表达"研发中心 → 应用一组 → 张三"。

### 1.7 改造路线图

建议 6 阶段渐进式改造，目标是将权限系统独立为可单独部署的模块。

#### 阶段 1：IdentityProvider 接口抽象（P0）

```go
// internal/auth/identity_provider.go (新建)
type IdentityProvider interface {
    GetAuthorizationURL(ctx context.Context, redirectURI string) (*OIDCURLResponse, error)
    ExchangeCode(ctx context.Context, code, redirectURI string) (*TokenResponse, error)
    GetUserInfo(ctx context.Context, token string) (*UserInfo, error)
}

// 实现：OIDCProvider / SAMLProvider / LDAPProvider / SCIMProvider
```

将 `user.go` service 中的 OIDC 逻辑迁移到 `internal/auth/oidc_provider.go`，`UserService` 仅保留用户 CRUD。

#### 阶段 2：PermissionService Facade（P0）

```go
// internal/auth/permission.go (新建)
type PermissionService interface {
    CanAccess(ctx context.Context, principal Principal, resource Resource, action Action) (bool, error)
    GetUserRoles(ctx context.Context, userID string) ([]Role, error)
    AssignRole(ctx context.Context, userID, roleID string) error
}
```

收口 Middleware + Router + Service 三层权限决策。

#### 阶段 3：组织架构模型（P1）

```go
// internal/types/department.go (新建)
type Department struct {
    ID        string
    ParentID  string  // 父部门，构建部门树
    Name      string
    Managers  []string // 部门管理者
    Members   []string // 部门成员
}
```

支持从企业 UUM 同步部门树，并按部门授权。

#### 阶段 4：用户同步机制（P1）

实现 SCIM 2.0 端点 `/scim/v2/Users` `/scim/v2/Groups`，支持企业 IdP 主动推送用户变更。

#### 阶段 5：多 IdP 并存（P2）

支持同时配置多个 IdP，用户登录时选择 IdP，每个 IdP 独立配置。

#### 阶段 6：模块独立化（P2）

将 `internal/auth/` 抽离为独立 Go module，可单独编译为 `weknora-auth` 服务，通过 gRPC 对外提供认证 / 授权服务，企业可独立部署。

---

## 二、多模态文档解析能力

### 2.1 架构分层

WeKnora 的文档解析采用 **两层架构**：

```
┌─────────────────────────────────────────────┐
│  Go App (主应用)                              │
│  internal/infrastructure/docparser/          │
│  ┌──────────────────────────────────────┐   │
│  │  Engine Registry (7 引擎)             │   │
│  │  builtin / simple / weknoracloud      │   │
│  │  mineru / mineru_cloud                │   │
│  │  paddleocr_vl / paddleocr_vl_cloud    │   │
│  └──────────────────────────────────────┘   │
│  ┌──────────────────────────────────────┐   │
│  │  VLM 任务队列 (image:multimodal)      │   │
│  │  Ollama / RemoteAPI / WeKnoraCloud    │   │
│  └──────────────────────────────────────┘   │
└──────────────────┬──────────────────────────┘
                   │ gRPC (StreamReader)
                   ▼
┌─────────────────────────────────────────────┐
│  docreader (Python 微服务)                    │
│  docreader/docreader/                         │
│  ┌──────────────────────────────────────┐   │
│  │  Lightweight Facade                   │   │
│  │  - markitdown (PDF/DOCX/XLSX/HTML)    │   │
│  │  - pypdf / pypdfium2                   │   │
│  │  - python-docx / openpyxl              │   │
│  │  - textract / trafilatura              │   │
│  │  - playwright (网页渲染)                │   │
│  │  - ebooklib (EPUB)                     │   │
│  │  - opendataloader-pdf                  │   │
│  │  明确不做 OCR / VLM                    │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 2.2 docreader 服务定位

**docreader 是轻量级 facade，自身无多模态能力**。

依据 `docker/Dockerfile.docreader` 第 2 行注释：
> 构建阶段（轻量化：仅文档解析 + 图片提取，无 OCR/VLM）

依赖（`docreader/pyproject.toml`）：
- `markitdown[docx,pdf,xls,xlsx]` — Microsoft 文档
- `pypdf` / `pypdfium2` — PDF
- `python-docx` / `openpyxl` / `xlrd` / `pandas` — Office
- `textract` — 多格式文本提取
- `trafilatura` — 网页正文提取
- `playwright` — 网页渲染（含 webkit 浏览器）
- `ebooklib` — EPUB
- `opendataloader-pdf` — PDF 解析增强
- `beautifulsoup4` / `lxml` / `markdownify` — HTML/XML

**关键定位**：docreader 只负责"结构化文本提取 + 图片抽取"，OCR / VLM / 表格识别 / 公式识别全部委托给 Go App 调用的外部引擎。

### 2.3 Go App 解析引擎矩阵

`internal/infrastructure/docparser/engine_registry.go` 注册了 7 个引擎：

| 引擎 | 类型 | 能力 | 部署方式 |
|------|------|------|---------|
| `builtin` | 本地 | markitdown + pypdf 基础解析 | docreader 容器内 |
| `simple` | 本地 | 简化版解析（无图片） | docreader 容器内 |
| `weknoracloud` | 云服务 | WeKnora 官方云解析 | HTTP API |
| `mineru` | 自托管 | OCR + 表格 + 公式 + 版面 | MinerU 服务 |
| `mineru_cloud` | 云服务 | 同 mineru | 云 API |
| `paddleocr_vl` | 自托管 | 版面 + 印章 + 图表 + 跨页表格 | PaddleOCR-VL 服务 |
| `paddleocr_vl_cloud` | 云服务 | 同 paddleocr_vl | 云 API |

#### 2.3.1 MinerU 引擎

文件：`internal/infrastructure/docparser/mineru_converter.go`

- 端点：`/file_parse`
- 能力：
  - OCR（中文 / 英文 / 多语言）
  - 表格识别（HTML 结构化输出）
  - 公式识别（LaTeX 输出）
  - 版面分析（段落 / 标题 / 图片 / 表格区域）
- 输出：Markdown + 图片引用

#### 2.3.2 PaddleOCR-VL 引擎

文件：`internal/infrastructure/docparser/paddleocr_vl_converter.go`

- 端点：`/layout-parsing`
- 能力（MinerU 之外的能力补充）：
  - 版面分析（更精细）
  - 印章识别
  - 图表识别
  - **跨页表格合并**（MinerU 不支持）
  - **多级标题重建**（MinerU 不支持）
- 输出：Markdown + 图片引用

#### 2.3.3 引擎路由

`internal/application/service/knowledge_process.go` 的 `resolveDocReader` 用 switch-case 路由到 7 个引擎，路由依据是 KB 配置中的 `parser_engine` 字段。

### 2.4 VLM 多模态能力

除文档解析引擎外，WeKnora 还有独立的 **VLM 异步任务系统**，用于对图片进行多模态理解。

#### 2.4.1 VLM 接口

文件：`internal/models/vlm/vlm.go`

```go
type VLM interface {
    AnalyzeImage(ctx context.Context, req ImageAnalysisRequest) (*ImageAnalysisResult, error)
}
```

#### 2.4.2 三种实现

| 实现 | 类型 | 用途 |
|------|------|------|
| `OllamaVLM` | 本地 | 通过 Ollama 调用本地 VLM（如 LLaVA / Qwen-VL） |
| `RemoteAPIVLM` | 远程 | 调用任意 OpenAI 兼容 API |
| `WeKnoraCloudVLM` | 云服务 | WeKnora 官方云 VLM |

#### 2.4.3 任务流程

`enqueueImageMultimodalTasks`（`knowledge_process.go`）：
1. 文档解析后提取所有 `ImageRef`
2. 过滤 icon / logo / 小图（`image_resolver.go` 的 `isIconLike`）
3. 为每张大图创建 `image:multimodal` 异步任务
4. 任务消费时调用 VLM 接口生成图片描述
5. 描述写回 chunk 的 `images[].description` 字段

### 2.5 支持文件类型

| 类型 | 扩展名 | 解析器 | 多模态能力 |
|------|--------|--------|-----------|
| PDF | .pdf | markitdown / pypdf / pypdfium2 / opendataloader-pdf / MinerU / PaddleOCR-VL | ✅ OCR + 表格 + 公式 + 版面 |
| Word | .docx | python-docx / markitdown | ❌ |
| Word (旧) | .doc | antiword / textract | ❌ |
| Excel | .xlsx | openpyxl / markitdown | ❌ |
| Excel (旧) | .xls | xlrd / textract | ❌ |
| PowerPoint | .pptx | markitdown | ❌ |
| HTML | .html / .htm | beautifulsoup4 / trafilatura / markdownify | ❌ |
| 网页 URL | http(s):// | playwright (webkit 渲染) + trafilatura | ❌ |
| Markdown | .md | 原生 | ❌ |
| TXT | .txt | 原生 | ❌ |
| CSV | .csv | pandas | ❌ |
| EPUB | .epub | ebooklib | ❌ |
| 图片 | .png / .jpg / .jpeg / .bmp / .tiff / .webp | VLM 异步任务 | ✅ 图像理解 |
| RTF | .rtf | textract | ❌ |
| ODT | .odt | textract | ❌ |

### 2.6 扩展机制

#### 2.6.1 双层注册表

**Python 端**（docreader）：
```python
# docreader/docreader/registry.py
registry.register("builtin", BuiltinReader)
registry.register("simple", SimpleReader)
```

**Go 端**：
```go
// internal/infrastructure/docparser/engine_registry.go
RegisterEngine("mineru", &MinerUEngine{})
RegisterEngine("paddleocr_vl", &PaddleOCRvLEngine{})
```

#### 2.6.2 扩展步骤

新增一个解析引擎的步骤：
1. 实现 `ParserEngine` 接口（Go 端）或继承 `BaseReader`（Python 端）
2. 在 `engine_registry.go` 注册
3. 在 `resolveDocReader` 的 switch-case 添加分支
4. 在 KB 配置中新增引擎选项
5. （可选）在 `internal/infrastructure/docparser/` 添加 converter 实现

#### 2.6.3 VLM 扩展

新增 VLM 实现：
1. 实现 `VLM` 接口
2. 在 `internal/models/vlm/vlm.go` 工厂方法添加 case
3. 在配置中新增 provider 选项

### 2.7 性能与瓶颈

#### 2.7.1 SSRF 防护

`NewSSRFSafeHTTPClient` + `ValidateURLForSSRF` 对所有外部 HTTP 调用做安全校验，防止内网探测。

#### 2.7.2 gRPC 流式传输

`grpc_parser.go` 优先使用 `ReadStream`（流式），避免大文档一次性加载到内存。

#### 2.7.3 瓶颈

- **MinerU / PaddleOCR-VL 自托管**：需要 GPU，部署成本高
- **图片 VLM 任务**：异步执行，大批量文档入库时任务队列可能积压
- **Playwright 网页渲染**：内存占用高，并发受限

### 2.8 能力评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 多模态能力 | 8/10 | OCR + 表格 + 公式 + 版面 + 印章 + 图表 + VLM 图片理解，覆盖主流场景 |
| 文件类型覆盖 | 9/10 | 15+ 类型，含网页渲染 |
| 扩展性 | 8/10 | 双层注册表 + 接口抽象，新增引擎成本低 |
| 部署灵活性 | 8/10 | 本地 / 自托管 / 云服务三档可选 |
| 性能 | 7/10 | 异步任务 + 流式传输，但 VLM 任务可能积压 |

---

## 三、Wiki 知识库 QA 链路

### 3.1 Wiki 概念定位

**Wiki 不是独立的 QA 模式，而是 RAG 的索引策略增强**。

依据 `internal/types/knowledgebase.go` L627-634：

```go
func (kb *KnowledgeBase) IsWikiEnabled() bool {
    if kb.IndexingStrategy == nil {
        return false
    }
    return kb.IndexingStrategy.WikiEnabled
}
```

`IndexingStrategy`（`internal/types/indexing_strategy.go`）是 KB 的索引策略配置：

```go
type IndexingStrategy struct {
    WikiEnabled  bool
    GraphEnabled bool
    // ... 其他策略
}
```

**QA 默认是 RAG**（向量 + 关键词 + rerank），Wiki 开启后：
- 文档入库时额外生成 Wiki 页面（编译）
- Wiki 页面作为特殊 chunk 参与检索
- Wiki chunk 在 rerank 阶段获得 **×1.3 加权**（`wikiBoostFactor=1.3`，`chat_pipeline/wiki_boost.go` L15）

### 3.2 Wiki 编译链路

Wiki 编译由 `wikiIngestService`（`internal/application/service/wiki_ingest.go`）负责。

#### 3.2.1 整体流程

```
文档入库
   │
   ▼
ProcessWikiIngest (wiki_ingest_batch.go L55)
   │
   ├─ Pass 0: extractCandidateSlugs (wiki_ingest_cite.go L71)
   │  └─ LLM 调用：从文档提取候选 Wiki 页面 slug
   │
   ├─ Pass 1..N: mapOneDocument (wiki_ingest_batch.go L772)
   │  └─ 对每个 chunk 调用 LLM，分类引用到哪些 Wiki 页面
   │
   ├─ Reduce: reduceSlugUpdates (wiki_ingest_batch.go L1292)
   │  └─ 合并所有 chunk 的引用结果，更新 Wiki 页面内容
   │
   └─ Taxonomy: planBatchTaxonomy (wiki_ingest_taxonomy.go L32)
      └─ 规划 Wiki 页面分类结构
```

#### 3.2.2 关键设计

**2-pass LLM 编译**：
- Pass 0：候选 slug 提取（先验，决定要更新哪些 Wiki 页面）
- Pass 1..N：chunk 引用分类（每个 chunk 引用到哪些 slug）
- Map-Reduce：map 阶段并行处理 chunk，reduce 阶段合并

**分布式协调**：
- Redis 分布式锁：防止同一 Wiki 页面被并发更新
- 死信队列：失败的 chunk 任务进入死信队列重试
- Pass 0 fallback：候选 slug 提取失败时，降级为按 chunk 标题生成

**去重**（`wiki_ingest_dedup.go`）：
- `dedupCandidateTopK=20`：候选 slug 去重取 top 20
- `dedupCandidateScoreFloor=0.08`：相似度低于 0.08 的候选丢弃

#### 3.2.3 Wiki 页面类型

`internal/types/wiki_page.go` 定义 7 种页面类型：

| 类型 | 用途 |
|------|------|
| Summary | 概念总结页 |
| Entity | 实体页（人物 / 组织 / 产品等） |
| Concept | 概念页（抽象概念） |
| Index | 索引页（链接到其他页面） |
| Log | 事件日志页 |
| Synthesis | 综合页（多源合成） |
| Comparison | 对比页（多实体对比） |

### 3.3 Wiki 检索链路

Wiki 检索发生在 RAG pipeline 的 rerank 阶段。

#### 3.3.1 检索流程

```
用户 Query
   │
   ▼
向量检索 + 关键词检索 (Hybrid Search)
   │
   ▼
Rerank (chat_pipeline/wiki_boost.go)
   │
   ├─ 普通 chunk: score × 1.0
   └─ Wiki chunk: score × 1.3 (wikiBoostFactor)
   │
   ▼
Top-K 返回
```

#### 3.3.2 Wiki Chunk 识别

`chat_pipeline/wiki_boost.go` L57 / L83：

```go
if chunk.ChunkType == ChunkTypeWikiPage {
    score *= wikiBoostFactor  // 1.3
}
```

Wiki chunk 在入库时被打上 `ChunkTypeWikiPage` 标记，rerank 阶段识别该标记并加权。

#### 3.3.3 Agent Wiki 工具

`internal/agent/tools/definitions.go` 定义了 10 个 Wiki 工具供 Agent 使用：

| 工具 | 功能 |
|------|------|
| wiki_read_page | 读取指定 Wiki 页面内容 |
| wiki_write_page | 创建或更新 Wiki 页面 |
| wiki_search | 搜索 Wiki 页面 |
| wiki_replace_text | 替换 Wiki 页面中的文本片段 |
| wiki_rename_page | 重命名 Wiki 页面 |
| wiki_delete_page | 删除 Wiki 页面 |
| wiki_read_source_doc | 查看 Wiki 页面关联的原始文档 |
| wiki_flag_issue | 标记 Wiki 页面问题 |
| wiki_read_issue | 查看 Wiki 页面问题 |
| wiki_update_issue | 更新 Wiki 页面问题 |

### 3.4 Wiki 生成链路

Wiki 生成发生在 ReAct Agent 的工具调用阶段。

#### 3.4.1 Agent 决策

Agent 在 think 阶段决定是否调用 wiki 工具：

```
用户: "对比 React 和 Vue 的差异"
   │
   ▼
Agent think: 需要对比，调用 wiki_compare
   │
   ▼
Agent act: wiki_compare(slugs=["react", "vue"])
   │
   ▼
Agent observe: 返回两个 Wiki 页面的对比内容
   │
   ▼
Agent finalize: 基于对比内容生成最终答案
```

#### 3.4.2 Prompt 模板

`internal/agent/prompts_wiki.go` 定义了 Wiki 相关的 prompt 模板，引导 Agent 在合适场景调用 wiki 工具。

### 3.5 知识图谱构建

#### 3.5.1 Graph 构建

`internal/application/service/graph.go` 的 `graphBuilder`：

- 后端：Neo4j
- 节点：实体（从文档抽取）
- 边：实体关系
- 权重公式：`weight = PMI × 0.6 + Strength × 0.4`
  - PMI（Pointwise Mutual Information）：实体共现频率
  - Strength：关系强度（LLM 判断）

#### 3.5.2 Graph 检索

`internal/agent/tools/query_knowledge_graph.go` 的 `QueryKnowledgeGraphTool`：

**关键发现**：`query_knowledge_graph` 实际是 **HybridSearch**，不是 Cypher 查询。

```go
// 当前实现：调用 HybridSearch，返回相关 chunk
// Cypher 查询：开发中（TODO 注释）
```

#### 3.5.3 Wiki 与 Graph 的关系

**Wiki 与 Graph 相互独立**：
- Wiki 是文档级合成（生成 Wiki 页面）
- Graph 是实体级关系（构建知识图谱）
- 两者共享 `IndexingStrategy` 配置，但数据流独立
- Wiki 页面不会自动进入 Graph，Graph 实体不会自动进入 Wiki

### 3.6 与参考实现对比

#### 3.6.1 与 rohitg00 gist 对比

参考：`https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2`

**gist 核心**：LLM Wiki v2，3 层架构
- Layer 1: raw sources（原始资料）
- Layer 2: wiki（LLM 生成的 wiki 页面）
- Layer 3: schema（结构化知识）
- memory lifecycle：写入 → 检索 → 更新 → 遗忘

| 维度 | WeKnora | gist |
|------|---------|------|
| 定位 | 工业级产品 | 原型 / 思路 |
| 编译 | 2-pass LLM + Map-Reduce + Redis 锁 + 死信队列 | 单次 LLM 调用 |
| 检索 | Hybrid Search + Rerank + Wiki Boost | 简单向量检索 |
| 页面类型 | 7 种（Summary/Entity/Concept/Index/Log/Synthesis/Comparison） | 1 种（通用 wiki 页面） |
| Schema 层 | ❌ 无独立 schema 层 | ✅ Layer 3 schema |
| Memory lifecycle | ❌ 无遗忘机制 | ✅ 写入 / 检索 / 更新 / 遗忘 |
| Agent 工具 | ✅ 7 个 wiki 工具 | ❌ 无 Agent |
| RAG 集成 | ✅ Wiki chunk 进入 RAG | ❌ 独立 wiki 检索 |
| 分布式 | ✅ Redis 锁 + 死信队列 | ❌ 单机 |
| 规模 | 工业级（百万级 chunk） | 原型级 |

**WeKnora 优势**：工业级、分布式、Agent 集成、RAG 融合
**gist 优势**：3 层架构清晰、memory lifecycle 完整（含遗忘）、schema 层独立

#### 3.6.2 与 nashsu/llm_wiki 对比

参考：`https://github.com/nashsu/llm_wiki`

**llm_wiki 核心**：开源项目，含
- `mcp-server`：MCP 协议的 wiki 服务
- `extension`：浏览器扩展
- `plans`：规划文档
- 版本：v0.5.4

| 维度 | WeKnora | llm_wiki |
|------|---------|----------|
| 定位 | 全功能知识库平台 | 轻量 wiki 工具 |
| 部署 | 服务端（Docker） | MCP server + 浏览器扩展 |
| 编译 | 2-pass LLM + Map-Reduce | 单次 LLM |
| 检索 | Hybrid + Rerank + Boost | MCP tool 调用 |
| chunk 溯源 | ✅ 每个 wiki 内容可追溯到原 chunk | ❌ 无溯源 |
| Agent 工具 | ✅ 7 个内置工具 | ✅ MCP tools |
| 知识图谱 | ✅ Neo4j | ❌ 无 |
| 多租户 | ✅ | ❌ |
| MCP 协议 | ✅ 已有 MCP server | ✅ 原生 MCP |
| 浏览器扩展 | ❌ | ✅ |
| 轻量性 | 重 | 轻 |

**WeKnora 优势**：功能完整、chunk 溯源、知识图谱、多租户
**llm_wiki 优势**：MCP 原生、浏览器扩展、轻量易部署

### 3.7 差距分析

#### 差距 1：无独立 Wiki QA 模式

**现状**：Wiki 只能作为 RAG 的增强，不能独立 QA。
**差距**：用户期望"纯 Wiki QA"（仅从 Wiki 页面回答，不查原 chunk），当前不支持。
**影响**：对已经编译好的 Wiki，无法快速问答（必须走完整 RAG）。

#### 差距 2：Cypher 图查询开发中

**现状**：`query_knowledge_graph` 实际是 HybridSearch，Cypher 查询未实现。
**差距**：无法做图谱遍历查询（如"列出 A 的所有合作者"）。
**影响**：知识图谱的图结构价值未被充分利用。

#### 差距 3：Wiki 与 Graph 数据割裂

**现状**：Wiki 页面不进入 Graph，Graph 实体不进入 Wiki。
**差距**：Wiki 中的实体不会自动建图，Graph 中的实体不会自动生成 Wiki 页面。
**影响**：两个系统各自为战，未形成"Wiki 即图谱视图"的统一知识表示。

#### 差距 4：无 Schema 层

**现状**：Wiki 页面是 Markdown 文本，无结构化 schema。
**差距**：gist 的 Layer 3 schema 提供结构化知识表示，WeKnora 无此层。
**影响**：无法做结构化查询（如"列出所有成立时间晚于 2020 年的公司"）。

#### 差距 5：无 Memory Lifecycle

**现状**：Wiki 页面只增不删（除非手动），无遗忘机制。
**差距**：gist 有完整的 memory lifecycle（写入 / 检索 / 更新 / 遗忘）。
**影响**：长期运行后 Wiki 可能积累过时内容。

### 3.8 改进建议

#### 建议 1：增加纯 Wiki QA 模式（P0）

在 `session_knowledge_qa.go` 的 `KnowledgeQA` pipeline 中增加 `QAMode` 配置：

```go
type QAMode string
const (
    QAModeRAG       QAMode = "rag"        // 默认，向量 + 关键词
    QAModeWiki      QAMode = "wiki"       // 纯 Wiki 检索
    QAModeGraph     QAMode = "graph"      // 图谱遍历
    QAModeHybrid    QAMode = "hybrid"     // RAG + Wiki + Graph
)
```

#### 建议 2：实现 Cypher 图查询（P1）

在 `query_knowledge_graph` 工具中增加 Cypher 查询模式：
- LLM 生成 Cypher
- Neo4j 执行
- 返回子图

#### 建议 3：Wiki-Graph 联动（P1）

- Wiki 页面入库时，自动抽取实体并加入 Graph
- Graph 实体可一键生成 Wiki 页面
- Wiki 页面的链接关系作为 Graph 的边

#### 建议 4：增加 Schema 层（P2）

为 Wiki 页面增加结构化 schema：
- Entity 页面：`{name, type, attributes: {key: value}}`
- Comparison 页面：`{entities: [], dimensions: []}`
- 支持结构化查询

#### 建议 5：Memory Lifecycle（P2）

- 过期机制：长时间未被检索的 Wiki 页面标记为"冷数据"
- 更新机制：原 chunk 更新时，关联的 Wiki 页面自动重编译
- 遗忘机制：冷数据超过阈值后归档或删除

---

## 四、ReAct 智能体问答链路

### 4.1 ReAct 引擎架构

WeKnora 实现了完整的 **ReAct（Reasoning + Acting）** 循环。

#### 4.1.1 四阶段循环

文件：`internal/agent/engine.go` 的 `runReActIteration`（L443）

```
┌─────────────────────────────────────┐
│         AgentEngine 主循环           │
└─────────────────────────────────────┘
         │
         ▼
    ┌─────────┐
    │  think  │ ◄── 调用 LLM 生成函数调用决策
    │         │     含流式思考输出
    └────┬────┘
         │
         ▼
    ┌─────────┐
    │ analyze │ ◄── 检查停止条件（自然停止且无工具调用时结束）
    │         │     决定是否继续循环
    └────┬────┘
         │
         ▼
    ┌─────────┐
    │  act    │ ◄── 并行执行工具调用
    │         │
    └────┬────┘
         │
         ▼
    ┌─────────┐
    │ observe │ ◄── 将工具结果加入消息上下文
    │         │     进入下一轮 think
    └─────────┘
```

#### 4.1.2 架构特征

- **单 Agent + 多工具**：非多 Agent 编排
- **流式输出**：think 阶段通过 EventBus 流式输出思考过程，`streamFinalAnswerToEventBus` 在循环结束时合成最终答案
- **工具并行**：act 阶段支持并行执行（`errgroup` + goroutine），条件为 `ParallelToolCalls=true` 且工具调用数 ≥ 2，否则顺序执行
- **最大迭代数**：有上限保护（绝对上限 `MAX_ITERATIONS = 100`），引擎层默认 `DefaultAgentMaxIterations = 20`，自定义 Agent 默认 10，配置校验回退默认 5
- **死循环检测**：连续返回相同内容（`maxRepeatedResponseRounds`）时自动终止
- **空响应重试**：LLM 返回空内容时自动重试（`maxEmptyResponseRetries`）

### 4.2 工具系统

#### 4.2.1 内置工具

文件：`internal/agent/tools/definitions.go`

`AvailableToolDefinitions()` 返回 **22 个内置工具**，此外还有 `web_search` 和 `web_fetch` 两个条件注册的工具（共 24 个），覆盖：

| 类别 | 工具 |
|------|------|
| 推理 | thinking |
| 计划 | todo_write |
| RAG | grep_chunks / knowledge_search / list_knowledge_chunks / query_knowledge_graph / get_document_info |
| 数据 | database_query / data_analysis / data_schema |
| Wiki | wiki_read_page / wiki_search / wiki_read_source_doc / wiki_write_page / wiki_replace_text / wiki_rename_page / wiki_delete_page / wiki_flag_issue / wiki_read_issue / wiki_update_issue |
| 技能 | read_skill / execute_skill_script |
| Web（条件注册） | web_search / web_fetch |

#### 4.2.2 动态工具

- **MCP 工具**：运行时从 MCP server 动态加载（`internal/agent/tools/mcp_tool.go` 的 `RegisterMCPTools`）
- **Skills 系统**：可扩展的技能系统，类似 Claude 的 Skills

#### 4.2.3 工具能力声明

`internal/agent/tools/capabilities.go` 的 `ToolCapabilityRequirements`：
- 声明工具需要的权限级别
- 声明工具是否需要网络 / 文件系统 / 数据库访问
- 用于运行时能力校验

#### 4.2.4 工具注册表

`internal/agent/tools/registry.go`：
- `ToolRegistry`：全局工具注册表
- `ExecuteTool`（L104）：统一工具执行入口，含超时 / 错误处理 / 审计日志

### 4.3 LLM 抽象层

#### 4.3.1 Chat 接口

文件：`internal/models/chat/chat.go` L87

```go
type Chat interface {
    StreamMessage(ctx context.Context, req ChatRequest) (<-chan ChatStreamEvent, error)
    // ...
}
```

#### 4.3.2 providerAdapter 模式

文件：`internal/models/chat/provider.go`

```go
type providerAdapter interface {
    streamMessage(ctx context.Context, req ChatRequest) (<-chan ChatStreamEvent, error)
}
```

`NewChat` 工厂方法根据配置选择 adapter，支持 **25 家 LLM provider**：

| Provider | 支持工具调用 |
|----------|------------|
| OpenAI | ✅ |
| DeepSeek | ✅ |
| Qwen (通义千问) | ✅ |
| Moonshot (Kimi) | ✅ |
| Zhipu (智谱) | ✅ |
| Baichuan | ✅ |
| MiniMax | ✅ |
| Yi (零一万物) | ✅ |
| Spark (讯飞星火) | ✅ |
| Hunyuan (腾讯混元) | ✅ |
| ERNIE (百度文心) | ✅ |
| Doubao (豆包) | ✅ |
| Anthropic (Claude) | ❌ **不支持** |
| Ollama | ✅ |
| vLLM | ✅ |
| ... | ... |

#### 4.3.3 关键短板：Anthropic 不支持工具调用

文件：`internal/models/chat/anthropic.go`

**Anthropic provider 是独立实现，不走 `providerAdapter` 接口**。

`chat.go` L161-162 确认：当 `providerName == provider.ProviderAnthropic` 时，`NewChat` 工厂直接返回 `NewAnthropicChat(config)`，绕过所有 `providerAdapter` 适配器逻辑。

`AnthropicChat` 结构体实现了 `Chat` 接口的 `ChatStream` 方法（独立实现 Anthropic Messages API 协议），但：
- 请求结构体（`anthropicRequest`）无 `tools` / `tool_choice` 字段
- 消息结构体（`anthropicMessage`）无 `tool_calls` / `tool_call_id`
- 流式事件仅处理 `text_delta`，无 `tool_use` 事件

这意味着：
- 不能把 Claude 作为 ReAct Agent 的 LLM
- Claude 只能用于"纯对话"场景
- 无法利用 Claude 的强推理能力驱动 Agent

### 4.4 Claude Code SDK 接入可行性

#### 4.4.1 Claude Code SDK 简介

Claude Code SDK 是 Anthropic 提供的命令行 / SDK，支持：
- 流式对话
- 工具调用
- 文件系统操作
- 代码执行
- MCP 集成

#### 4.4.2 接入难度评估

**评分：7/10（中高难度）**

#### 4.4.3 接入路径

**路径 A：补全 Anthropic provider 的工具调用（推荐）**

1. 在 `anthropic.go` 实现工具调用接口
2. Anthropic API 原生支持 tool use（`tools` 参数）
3. 将 WeKnora 的工具定义转换为 Anthropic 格式
4. 把 Claude 当作 ReAct 引擎的 LLM

**优点**：保留 WeKnora 自有 ReAct 引擎 + 21 个工具 + MCP 集成
**难点**：需要理解 Anthropic tool use 协议，与 OpenAI 格式有差异

**路径 B：接入 Claude Code SDK 作为外部 Agent**

1. 将 WeKnora 的工具暴露为 MCP server（已有 `cli/internal/mcp/server.go`）
2. Claude Code SDK 通过 MCP 调用 WeKnora 工具
3. WeKnora 不再驱动 ReAct 循环，由 Claude Code 驱动

**优点**：利用 Claude Code 的强推理 + 文件系统 + 代码执行
**难点**：WeKnora 退化为工具提供者，失去 Agent 主导权

**路径 C：双模式**

1. 保留自有 ReAct 引擎（用其他 LLM）
2. 同时支持 Claude Code SDK 模式（用户可选）
3. 通过配置切换

**优点**：灵活性最高
**难点**：维护两套链路

#### 4.4.4 推荐路径

**推荐路径 A**（补全 Anthropic provider），理由：
- 保留 WeKnora 完整的 Agent 架构
- 复用 21 个工具 + MCP + Skills
- Claude 的推理能力可显著提升 Agent 质量
- 改动最小（仅需完善 `anthropic.go`）

### 4.5 OpenCode SDK 接入可行性

#### 4.5.1 OpenCode SDK 简介

OpenCode 是开源的代码生成 SDK，支持：
- 多 LLM provider
- 工具调用
- 代码执行
- MCP 集成

#### 4.5.2 接入难度评估

**评分：7/10（中高难度）**

#### 4.5.3 接入路径

与 Claude Code SDK 类似，有三种路径：

**路径 A**：补全 OpenCode provider 的工具调用（如果 WeKnora 的 OpenAI 兼容 adapter 已支持，则成本低）
**路径 B**：通过 MCP 反向暴露工具
**路径 C**：双模式

#### 4.5.4 推荐路径

**推荐路径 B**（MCP 反向暴露），理由：
- OpenCode SDK 原生支持 MCP
- WeKnora 已有 MCP server
- 无需修改 LLM 抽象层

### 4.6 推荐集成路径

#### 4.6.1 短期（P0）

1. **补全 Anthropic provider 的工具调用**
   - 在 `anthropic.go` 实现 `providerAdapter` 的工具调用
   - 转换 WeKnora 工具定义为 Anthropic 格式
   - 测试 Claude 驱动 ReAct 循环

2. **完善 MCP server**
   - 确保 21 个工具都能通过 MCP 暴露
   - 测试 Claude Code / OpenCode 通过 MCP 调用

#### 4.6.2 中期（P1）

1. **双模式支持**
   - 配置项 `agent.engine: native | claude_code | opencode`
   - native：自有 ReAct 引擎
   - claude_code：Claude Code SDK 驱动
   - opencode：OpenCode SDK 驱动

2. **工具能力对齐**
   - 确保 Claude Code / OpenCode 能调用全部 21 个工具
   - 补齐 MCP 协议缺失的能力

#### 4.6.3 长期（P2）

1. **多 Agent 编排**
   - 支持多 Agent 协作
   - Claude Code / OpenCode 作为子 Agent

2. **Skills 互通**
   - WeKnora Skills 与 Claude Skills 互通
   - 共享技能生态

---

## 五、综合结论

### 5.1 四维度能力评分

| 维度 | 评分 | 关键结论 |
|------|------|---------|
| 权限系统 | 5.5/10 | RBAC 模型完整，但模块独立性差，UUM 接入需 6 阶段改造 |
| 多模态解析 | 8/10 | 双引擎互补，扩展性好，docreader 自身无多模态 |
| Wiki QA | 7.7/10 | 工业级编译链路，但无独立 QA 模式，Graph 查询未完成 |
| ReAct 智能体 | 8/10 | 完整 ReAct（think/analyze/act/observe），22 个内置工具 + 2 个 Web 工具，但 Anthropic 不支持工具调用是关键短板 |

### 5.2 优先改进项

| 优先级 | 改进项 | 维度 | 预期收益 |
|--------|--------|------|---------|
| P0 | 补全 Anthropic provider 工具调用 | ReAct | 解锁 Claude 作为 Agent LLM |
| P0 | 增加纯 Wiki QA 模式 | Wiki | 支持纯 Wiki 问答 |
| P0 | IdentityProvider 接口抽象 | 权限 | 解耦认证与用户管理 |
| P1 | PermissionService Facade | 权限 | 统一权限决策 |
| P1 | Cypher 图查询实现 | Wiki | 释放图谱价值 |
| P1 | Wiki-Graph 联动 | Wiki | 统一知识表示 |
| P1 | 组织架构模型 | 权限 | 承接企业 UUM 层级 |
| P2 | 双模式 Agent（native + SDK） | ReAct | 灵活选择引擎 |
| P2 | Schema 层 | Wiki | 结构化查询 |
| P2 | 模块独立化 | 权限 | 独立部署 auth 服务 |

### 5.3 架构成熟度

| 维度 | 成熟度 | 说明 |
|------|--------|------|
| 权限系统 | 产品级（但耦合） | 功能完整，可承接生产场景，但难以独立复用 |
| 多模态解析 | 产品级 | 双引擎 + VLM，覆盖主流场景 |
| Wiki QA | 准产品级 | 编译链路工业级，但 QA 模式单一 |
| ReAct 智能体 | 准产品级 | 完整 ReAct，但 LLM 支持有短板 |

### 5.4 总体建议

WeKnora 在四个维度均已达到"产品级"或"准产品级"成熟度，可承接生产场景。主要改进方向：

1. **解耦**：权限系统需要从主应用中解耦，形成独立模块
2. **补全**：Anthropic 工具调用、Cypher 查询、纯 Wiki QA 是三个关键短板
3. **统一**：Wiki 与 Graph 需要联动，形成统一知识表示
4. **开放**：通过 MCP 暴露能力，支持 Claude Code / OpenCode 等外部 Agent 接入

---

## 六、联网搜索与 Deep Research 能力

### 6.1 联网搜索架构

WeKnora 的联网搜索能力**作为独立模块存在**，具有清晰的接口抽象。

#### 6.1.1 工具层

**web_search 工具**（`internal/agent/tools/web_search.go`）：
- ReAct Agent 的可选工具，由 `WebSearchEnabled` 配置控制
- 强制 "KB First Rule"：必须先尝试 KB 检索（grep_chunks + knowledge_search）后才能联网
- 输出格式：title / URL / snippet / content（截断到 500 字符）/ published_at

**web_fetch 工具**（`internal/agent/tools/web_fetch.go`）：
- web_search 的配套，用于抓取完整网页内容
- 双引擎抓取：chromedp（headless Chrome）优先，失败回退 HTTP
- LLM 摘要：调用 chatModel 按 user prompt 摘要网页内容（温度 0.3，MaxTokens 1024）
- 内容限制：最大 100000 字符，超时 60 秒

#### 6.1.2 Service 层

**WebSearchService 接口**（`internal/types/interfaces/web_search.go`）：
```go
type WebSearchService interface {
    Search(ctx, providerID, config, query) ([]*WebSearchResult, error)
    CompressWithRAG(ctx, sessionID, tempKBID, ...) // RAG 压缩
}
```

#### 6.1.3 Provider 抽象（关键扩展点）

**WebSearchProvider 接口**（`internal/types/interfaces/web_search_provider.go`）：
```go
type WebSearchProvider interface {
    Name() string
    Search(ctx, query, maxResults, includeDate) ([]*WebSearchResult, error)
}
```

**Registry 工厂注册模式**（`internal/infrastructure/web_search/registry.go`）：
```go
type ProviderFactory func(params WebSearchProviderParameters) (WebSearchProvider, error)
```

### 6.2 支持的搜索引擎

注册位置：`internal/container/container.go:1326-1334`

| Provider | API Key | 自定义 Endpoint | 备注 |
|----------|---------|----------------|------|
| DuckDuckGo | 不需要 | 否（硬编码） | 免费，HTML 抓取 + API fallback |
| Bing | 需要 | 否（硬编码） | Azure 提供 |
| Google | 需要 + EngineID | 否（硬编码） | Google CSE |
| Tavily | 需要 | 否（硬编码） | AI 搜索优化 |
| Ollama | 需要 | 否 | Ollama Cloud |
| Baidu | 需要 | 否 | 百度 AI 搜索 |
| **SearXNG** | 不需要 | **是（BaseURL 必填）** | 自托管元搜索 |

**关键发现**：除 SearXNG 外，所有商业搜索 API 的 endpoint 都**硬编码**在代码中，从源头消除 SSRF 风险，但也意味着**不能直接配置为企业内部搜索 endpoint**。

### 6.3 企业搜索服务接入能力

#### 6.3.1 接入方式

企业可通过两种方式接入内部搜索：
1. **实现 WebSearchProvider 接口**：在 `container.go` 注册自定义 provider
2. **使用 SearXNG**：部署 SearXNG 元搜索服务，配置 BaseURL 指向企业实例

文档 `docs/添加新的网络搜索引擎.md` 详细说明了新增 provider 的步骤。

#### 6.3.2 代理配置

`internal/infrastructure/web_search/proxy.go`：
- 每个 provider 实例可独立配置 `proxy_url`
- 回退到环境变量 `HTTP_PROXY` / `HTTPS_PROXY`
- proxy_url 本身经过 SSRF 校验

#### 6.3.3 SSRF 防护（多层）

`internal/utils/security.go` 实现了**多层 SSRF 防护**：

| 层 | 实现 | 说明 |
|----|------|------|
| URL 校验 | `ValidateURLForSSRF` | 解析 hostname，校验私有 IP / loopback / 链路本地 |
| DNS Pinning | web_fetch 锁定 DNS 解析结果 | 防 DNS rebinding |
| Dial 控制 | `SSRFSafeDialContext` | 拨号阶段再次校验 |
| 重定向校验 | `ssrfSafeRedirect` | 每次重定向目标做 SSRF 校验 |
| 白名单机制 | `SSRF_WHITELIST` 环境变量 | 允许配置例外主机 |

**企业内网搜索限制**：默认情况下内网 IP 会被拦截，需将内网搜索主机加入 `SSRF_WHITELIST`。

#### 6.3.4 搜索结果过滤

`WebSearchService.filterBlacklist`（service 层）支持：
- **glob 模式**：`*://*.example.com/*`
- **正则表达式**：`/example\.(net|org)/`
- 配置在 `WebSearchConfig.Blacklist` 字段，租户级

### 6.4 缓存、去重、限流

| 能力 | 实现情况 | 说明 |
|------|---------|------|
| 会话级缓存 | ✅ | Redis 临时 KB，`CompressWithRAG` 时复用 |
| URL 去重 | ✅ | `seenURLs map[string]bool` 跨查询去重 |
| 跨会话缓存 | ❌ | 无 |
| 结果级去重 | ❌ | 依赖 provider 自身 |
| 搜索限流 | ❌ | 仅超时控制，无 QPS 限流 |

### 6.5 搜索能力使用场景

#### 6.5.1 ReAct Agent 的 web_search 工具

由 `WebSearchEnabled` 配置控制，Agent 通过 function calling 自主决定何时调用。

#### 6.5.2 QA Pipeline 的并行搜索

`internal/application/service/chat_pipeline/search.go` 的 `PluginSearch.OnEvent`：
- 在 `CHUNK_SEARCH` 事件中**并行执行 KB 搜索和 Web 搜索**
- web_fetch 阶段：`CHUNK_RERANK` 之后、`CHUNK_MERGE` 之前，对 top N（默认 3）的 web 结果抓取全文

#### 6.5.3 自动判断是否需要联网

**否**。联网搜索由 `WebSearchEnabled` 配置 flag 控制，没有 LLM 自动判断逻辑。一旦启用，每次 QA 都会触发 web search（与 KB 搜索并行）。

### 6.6 Deep Research 能力

#### 6.6.1 现状：基本缺失

**关键发现**：`internal/types/custom_agent.go:17-18` 预留了常量：
```go
BuiltinDeepResearcherID = "builtin-deep-researcher"
```

但 `config/builtin_agents.yaml` 中**没有对应的配置条目**。前端 i18n 文件有文案，但实际无法使用。

**同类情况**：`BuiltinKnowledgeGraphExpertID`（`builtin-knowledge-graph-expert`）和 `BuiltinDocumentAssistantID`（`builtin-document-assistant`）也仅在 `custom_agent.go` 中定义了常量并列入 `builtinAgentIDsOrdered`，但 yaml 中同样没有配置。`builtin_agents.yaml` 中实际仅有 5 个已配置的内置 Agent：`builtin-quick-answer`、`builtin-smart-reasoning`、`builtin-data-analyst`、`builtin-wiki-researcher`、`builtin-wiki-fixer`。

**不存在的特性**：
- 无多轮迭代研究循环
- 无研究计划自动生成
- 无多源合成模块
- 无报告撰写模块
- 无多视角提问机制

#### 6.6.2 现有架构的近似能力

ReAct Agent 理论上可通过工具组合近似 deep research：
- `todo_write`：制定研究计划
- `thinking`：顺序思维与反思
- `knowledge_search` + `grep_chunks`：KB 检索
- `web_search` + `web_fetch`：联网搜索
- `wiki_*`：Wiki 导航

**Progressive RAG Prompt**（`config/prompt_templates/agent_system_prompt.yaml`）设计了四阶段研究流程：
- Phase 1: Initial Reconnaissance
- Phase 2: Strategy Decision
- Phase 3: Disciplined Execution & Deep Reflection
- Phase 4: Final Synthesis

但这只是 **prompt 层面的指引**，没有代码层面的研究编排。

#### 6.6.3 与主流方案对比

| 维度 | OpenAI Deep Research | GPT Researcher | STORM | Perplexity Pro | **WeKnora** |
|------|---------------------|----------------|-------|----------------|-------------|
| 多轮浏览 | ✅ 5-30 分钟 | ✅ 迭代搜索 | ✅ 多视角对话 | ✅ 多步检索 | ❌ ReAct 可近似 |
| 研究计划 | ✅ 自动生成 | ✅ planner 模块 | ✅ 大纲生成 | ⚠️ 隐式 | ⚠️ todo_write 工具 |
| 多源合成 | ✅ | ✅ synthesizer | ✅ 多源合并 | ✅ | ⚠️ 依赖 LLM |
| 报告撰写 | ✅ 结构化报告 | ✅ report generator | ✅ 文章生成 | ⚠️ 简短 | ❌ 无 |
| 状态持久化 | ✅ 长任务可恢复 | ⚠️ 有限 | ⚠️ 有限 | ❌ | ❌ engine stateless |
| 搜索深度 | 深度（数十次） | 中度（4-10 次） | 深度（多视角） | 中度（3-5 次） | **浅度**（单次+可选 fetch） |
| 最大迭代 | 无上限 | 配置驱动 | 配置驱动 | 配置驱动 | **默认 20 轮，最大 50** |

### 6.7 能力评估

#### 6.7.1 联网搜索能力评分

| 子能力 | 评分 | 说明 |
|--------|------|------|
| Provider 多样性 | 8/10 | 7 个 provider 覆盖主流方案 |
| Provider 抽象 | 9/10 | 清晰接口 + 工厂注册 + 文档完善 |
| 企业接入能力 | 7/10 | 接口可替换，但商业 API endpoint 硬编码 |
| SSRF 防护 | 9/10 | 多层防护 + 白名单机制 |
| 代理支持 | 8/10 | per-provider + 环境变量回退 |
| 结果质量 | 5/10 | content 多为空，需 web_fetch 二次抓取 |
| 缓存去重 | 6/10 | 会话级 temp KB + URL 去重 |
| 限流 | 2/10 | 仅超时控制，无 QPS 限流 |
| 黑名单过滤 | 7/10 | 支持 glob + 正则 |
| RAG 压缩 | 7/10 | 临时 KB + hybrid search |

**联网搜索综合评分：6.8/10**

#### 6.7.2 Deep Research 能力评分

| 子能力 | 评分 | 说明 |
|--------|------|------|
| 独立研究模块 | 1/10 | 仅 ID 常量，无实现 |
| 多轮迭代搜索 | 3/10 | ReAct 可近似，无编排 |
| 研究计划生成 | 4/10 | todo_write + prompt 指引 |
| 多源合成 | 3/10 | 完全依赖 LLM |
| 报告撰写 | 1/10 | 无 |
| 长上下文管理 | 6/10 | token 估算 + memory consolidator |
| 状态管理 | 3/10 | 轮次记录，无跨会话持久化 |
| 工具组合能力 | 7/10 | 丰富工具集可组合 |
| Prompt 研究指引 | 7/10 | Progressive RAG 四阶段 |

**Deep Research 综合评分：3.9/10**

### 6.8 改进建议

#### 短期（联网搜索 P0-P1）

1. **丰富搜索结果内容**：让 web_search 直接返回完整 content（参考 Tavily `include_raw_content`），避免强制二次 web_fetch
2. **增加搜索限流**：在 WebSearchService 层实现 token bucket 限流
3. **跨会话结果缓存**：按 query hash 缓存到 Redis，TTL 1-24 小时
4. **查询分解**：在搜索层实现 query decomposition，复杂查询拆分为子查询并行搜索

#### 中期（企业搜索 P1）

1. **企业搜索 Provider 模板**：提供 Elasticsearch / OpenSearch 的 Provider 实现模板
2. **搜索结果审核 hook**：增加 post-search filter 接口，允许企业插入内容审核逻辑
3. **SSRF 白名单动态配置**：从环境变量改为 DB 配置，支持租户级白名单

#### 长期（Deep Research P2）

1. **实现 BuiltinDeepResearcher**：在 `builtin_agents.yaml` 补全配置，启用更大 max_iterations（如 100）
2. **研究编排服务**：新增 `internal/application/service/research/` 模块，实现 plan → search → reflect → synthesize → report
3. **多轮迭代搜索**：实现 `IterativeSearchService`，基于初步结果生成子查询，迭代深入 2-5 轮
4. **报告生成模块**：新增 `report_writer` 工具，将多源信息合成为结构化报告（带引用）
5. **研究状态持久化**：研究计划、已搜索查询、已获取内容持久化到 DB，支持断点续传

---

## 七、Notebook Studio 生成能力

### 7.1 架构定位

**关键发现：Studio 是前端壳子，后端零实现**。

| 维度 | 现状 |
|------|------|
| 后端 handler | ❌ 无 `notebook.go` / `studio.go` |
| 后端 service | ❌ 无 |
| 后端 router | ❌ 无 `RegisterStudioRoutes` / `RegisterNotebookRoutes` |
| 数据库表 | ❌ 无 `notebook_artifacts` 表 |
| 后端 prompt 模板 | ❌ 无 `GenerateBrief` / `GenerateMindMap` 等 |
| 实际复用接口 | `/api/v1/agent-chat/:session_id` / `/api/v1/knowledge-chat/:session_id` |

所有 20 项生成工具共用同一个 chat SSE 流式接口，没有独立的生成后端。

### 7.2 20 项生成工具清单

定义在 `frontend/src/config/studioTools.ts`，类型在 `frontend/src/types/notebook.ts`。

> **UI 可见性说明**：配置层共定义 20 项工具，但 `StudioPanel.vue` 通过 `HIDDEN_CATEGORIES` 和 `HIDDEN_TOOL_TYPES` 临时隐藏了「学习」分类（5 项）和 `video_script`（1 项），实际用户可见 **14 项**。

#### 7.2.1 洞察类（insight，4 项）

| 工具 | prompt 摘要 | 输出 | 评分 |
|------|------------|------|------|
| `audio_overview` | 生成 2-3 分钟语音播客风格概览 | Markdown 文字稿 | 3/10 — 无 TTS 集成，仅文字稿 |
| `report` | 结构化深度研究报告（摘要/背景/发现/数据/结论） | Markdown | 8/10 — 完整可用 |
| `video_script` (PRO) | 3-5 分钟视频脚本（场景/旁白/画面） | Markdown | 6/10 — 仅文字稿 |
| `briefing` | 一页纸简报（核心结论/数据/行动建议） | Markdown | 7/10 — 完整可用 |

#### 7.2.2 整理类（organize，5 项）

| 工具 | prompt 摘要 | 输出 | 评分 |
|------|------------|------|------|
| `outline` | 多级标题大纲 | Markdown #/##/### | 7/10 — 缺拖拽排序 |
| `mind_map` | 缩进列表思维导图 | Markdown 缩进列表 | **3/10 — 严重缺陷：不渲染脑图** |
| `timeline` | 时间线（日期-事件-意义） | Markdown 列表 | 6/10 — 无视觉化时间轴 |
| `data_table` | 关键信息表格 | Markdown table | 8/10 — 完整可用 |
| `glossary` | 术语表 | Markdown 加粗列表 | 7/10 — 完整可用 |

#### 7.2.3 创作类（create，4 项）

| 工具 | prompt 摘要 | 输出 | 评分 |
|------|------------|------|------|
| `presentation` (PRO) | 10-15 页演示文稿大纲 | Markdown 大纲 | 5/10 — 无 PPTX 导出 |
| `infographic` (PRO) | Mermaid 图表信息图 | Markdown + Mermaid | **3/10 — 严重缺陷：Mermaid 不渲染** |
| `summary` | 300 字摘要 | Markdown | 7/10 — 完整可用 |
| `transcript` | 音视频转写文字稿 | Markdown | 4/10 — 不调 ASR，依赖 KB 已转写 |

#### 7.2.4 学习类（study，5 项）

| 工具 | prompt 摘要 | 输出 | 评分 |
|------|------------|------|------|
| `flashcards` | 10-15 张学习闪卡 | Markdown Q&A | 6/10 — 无翻卡 UI |
| `quiz` | 10 道选择题 | Markdown 选择题 | 6/10 — 无答题 UI |
| `study_guide` | 系统学习指南 | Markdown | 7/10 — 完整可用 |
| `faq` | 8-12 个 FAQ | Markdown Q&A | 7/10 — 不写回 FAQ-KB |
| `key_quotes` | 10-15 条原文引语 | Markdown 引文列表 | 6/10 — 无 citation 跳转 |

#### 7.2.5 分享类（share，2 项）

| 工具 | prompt 摘要 | 输出 | 评分 |
|------|------------|------|------|
| `comparison` | 对比分析表格 | Markdown table | 8/10 — 完整可用 |
| `action_items` | 行动项提取 | Markdown checkbox | 5/10 — 缺负责人/截止时间注入 |

**整体均分：6.0/10**

### 7.3 统一实现路径

所有 20 个工具走**同一条代码路径**，差别只在 prompt 文本：

```
用户点击工具卡
   ↓
triggerStudioTool(toolType)
   ↓
1. 找到 tool 配置（含 prompt 模板）
2. buildStudioPrompt(tool, sourceCount)  // 追加"基于已选的 N 个来源"
3. buildStudioJob(tool, ...) → status='generating'
4. store.addJob(job)
5. store.setPendingJob(sessionId, jobId)
6. store.triggerSendPrompt(prompt)        // 注入对话框输入框
   ↓
NotebookChat.sendMsg
   ↓
POST /api/v1/agent-chat/:session_id  (SSE)
   ↓
onReplyComplete(content)
   ↓
consumePendingJob(sessionId) → updateJob(id, {status:'completed', content})
```

**关键代码位置**：
- 触发：`frontend/src/composables/useStudioToolTrigger.ts:90-113`
- 回填：`frontend/src/components/notebook/NotebookChat.vue:276-288`

### 7.4 Studio 与对话框的关系

#### 7.4.1 共享上下文（完全共享）

| 维度 | 共享情况 |
|------|---------|
| session | ✅ 共享同一个 chatSessionId |
| KB 上下文 | ✅ 共享 selectedSourceIds |
| 消息历史 | ✅ Studio prompt 进入 messagesList |
| 选中文档/chunk | ✅ 共享 |

#### 7.4.2 数据流

| 维度 | 现状 |
|------|------|
| 生成结果存储 | 仅前端 localStorage（max 50 条） |
| 生成结果编辑 | ❌ 不可编辑 |
| 生成结果参与 RAG | ❌ 不参与 |
| 版本管理 | ❌ 多次生成平铺，无版本树 |
| 流式渲染 | ❌ 右栏一次性显示（complete 事件回填） |

#### 7.4.3 生成结果能否发送到对话框继续讨论？

**不能直接发送**。Studio 结果展示在右栏，没有"插入到对话框"按钮。用户只能下载或复制后手动粘贴。

#### 7.4.4 对话框能否触发生成？

**能**。两条路径：
1. StudioPanel 工具卡点击
2. NotebookHeader "分析"下拉（4 个 insight 类工具）

### 7.5 与 NotebookLM 对比

| 维度 | WeKnora Studio | Google NotebookLM | 差距 |
|------|----------------|-------------------|------|
| 工具数量 | 20 个 | ~10 个 | WeKnora 多 |
| 后端持久化 | ❌ 仅 localStorage | ✅ 服务端 artifact 表 | 巨大 |
| 多人协作 | ❌ | ✅ 共享 notebook | 巨大 |
| 富媒体渲染 | ❌ Mermaid 不渲染、无脑图 | ✅ markmap + Mermaid | 大 |
| 引用溯源 | ❌ 无 citation 跳转 | ✅ 每段引用可点击跳原文 | 大 |
| 音频概览 | ❌ 仅文字稿 | ✅ 真实 TTS 双人对谈 | 巨大 |
| 版本管理 | ❌ 多次生成平铺 | ✅ 版本树 | 大 |
| 编辑生成结果 | ❌ 只读 | ✅ 可编辑 | 大 |
| 流式渲染 | ❌ 右栏一次性显示 | ✅ 实时流式 | 中 |
| 模型路由 | ❌ 全工具同模型 | ✅ 不同工具配不同模型 | 中 |
| 结构化输出 | ❌ 纯 Markdown | ✅ JSON Schema | 中 |
| 任务队列 | ❌ 前端 setTimeout | ✅ 后端 job queue | 大 |

**整体完成度：约 25%（UI 壳 90%，状态机 70%，后端 0%）**

### 7.6 三大严重缺陷

#### 缺陷 1：Mind Map 不渲染脑图

- **现状**：`mind_map` 工具输出 Markdown 缩进列表，StudioPanel 用 `marked.parse` 渲染后只是缩进文字
- **差距**：NotebookLM 用 markmap 渲染真实脑图
- **影响**：3/10 评分，核心体验缺失

#### 缺陷 2：Audio Overview 无 TTS

- **现状**：`audio_overview` 仅生成文字稿，无 TTS 集成
- **差距**：NotebookLM 有真实 Google TTS 双人对话音频
- **影响**：3/10 评分，与 NotebookLM 标杆差距巨大

#### 缺陷 3：Infographic 不渲染 Mermaid

- **现状**：`infographic` 输出 Mermaid 代码块，但 StudioPanel 未集成 mermaid.js runtime，Mermaid 代码以纯文本展示
- **影响**：3/10 评分，PRO 工具收费但功能不完整

### 7.7 改进建议

#### P0（阻断性）

1. **后端建表 + API**：新增 `notebook_artifacts` 表（id / tenant_id / session_id / type / content / status / version / parent_id），新增 `/api/v1/studio/jobs` CRUD 路由
2. **Mind Map 真渲染**：在 StudioPanel 集成 `mermaid` 与 `markmap`，让 `mind_map` 输出真实脑图，`infographic` 输出真实图
3. **结构化输出**：为 `flashcards / quiz / faq / data_table / timeline / glossary / action_items` 7 项定义 JSON Schema，让 LLM 用 function calling 返回结构化数据

#### P1（核心体验）

4. **流式渲染到右栏**：改为 `onChunk` 增量写入 `job.content`，让右栏实时显示
5. **引用溯源**：扩展 `StudioJob` 加 `citations` 字段，后端返回引用元数据，前端渲染可点击引用气泡
6. **模型路由**：在 `studioTools.ts` 加 `recommendedModel` 字段，让 `quiz` 用便宜模型、`report` 用强模型

#### P2（完善性）

7. **版本管理**：`StudioJob` 加 `parent_id` / `version`，"重新生成"时基于 `parent_id` 创建新版本
8. **编辑能力**：StudioPanel 加 "编辑" 按钮，contenteditable + 保存到后端
9. **写入 KB**：增加"保存为知识库文档"按钮，让生成结果参与后续 RAG
10. **Audio Overview 真实 TTS**：接入 TTS 服务，把文字稿转成真实音频
11. **PRO 工具后端校验**：当前 `useProToolGate` 仅前端校验 admin 角色，后端无 Studio 路由，PRO 校验纯前端可绕过
12. **prompt 模板配置化**：将 `studioTools.ts` 的硬编码 prompt 迁移到 `internal/config/config.go` 的 `PromptTemplate` 体系，让租户管理员可覆盖

---

## 八、补充综合结论

### 8.1 六维度能力评分总览

| 维度 | 评分 | 关键结论 |
|------|------|---------|
| 权限系统 | 5.5/10 | RBAC 完整，但模块独立性差，UUM 接入需 6 阶段改造 |
| 多模态解析 | 8/10 | 双引擎互补，扩展性好 |
| Wiki QA | 7.7/10 | 工业级编译，但无独立 QA 模式 |
| ReAct 智能体 | 8/10 | 完整 ReAct，但 Anthropic 不支持工具调用 |
| 联网搜索 | 6.8/10 | Provider 抽象好，但结果质量有限、无限流 |
| Deep Research | 3.9/10 | 仅预留 ID 常量，无实现 |
| Notebook Studio | 6.0/10 | 前端壳完整，后端零实现，UI 可见 14 项工具（配置 20 项） |

### 8.2 补充优先改进项

| 优先级 | 改进项 | 维度 | 预期收益 |
|--------|--------|------|---------|
| P0 | Studio 后端建表 + API | Studio | 让生成结果持久化 |
| P0 | Mind Map / Mermaid 真渲染 | Studio | 修复三大缺陷之二 |
| P0 | 实现 BuiltinDeepResearcher 配置 | Research | 启用预留的 deep researcher |
| P0 | 联网搜索结果内容补全 | 搜索 | 避免 web_fetch 二次调用 |
| P1 | Studio 结构化输出 | Studio | 支持 JSON Schema |
| P1 | Studio 引用溯源 | Studio | 对齐 NotebookLM |
| P1 | Deep Research 编排服务 | Research | 多轮迭代 + 报告生成 |
| P1 | 搜索限流 + 跨会话缓存 | 搜索 | 降本提效 |
| P2 | Studio 版本管理 + 编辑 | Studio | 对齐 NotebookLM |
| P2 | Studio 写入 KB | Studio | 生成结果参与 RAG |

### 8.3 整体架构成熟度

| 维度 | 成熟度 | 说明 |
|------|--------|------|
| 权限系统 | 产品级（但耦合） | 功能完整，难以独立复用 |
| 多模态解析 | 产品级 | 双引擎 + VLM |
| Wiki QA | 准产品级 | 编译工业级，QA 模式单一 |
| ReAct 智能体 | 准产品级 | 完整 ReAct，LLM 支持有短板 |
| 联网搜索 | 准产品级 | Provider 抽象好，结果质量待提升 |
| Deep Research | 规划级 | 仅预留 ID，无实现 |
| Notebook Studio | 原型级 | 前端壳完整，后端零实现 |

### 8.4 总体建议（更新版）

WeKnora 在权限/多模态/Wiki/ReAct 四个核心维度已达"产品级"或"准产品级"，可承接生产场景。但联网搜索、Deep Research、Notebook Studio 三个延伸维度存在明显短板：

1. **解耦**：权限系统需要从主应用中解耦，形成独立模块
2. **补全**：Anthropic 工具调用、Cypher 查询、纯 Wiki QA、Deep Researcher 配置是关键短板
3. **统一**：Wiki 与 Graph 需要联动，形成统一知识表示
4. **开放**：通过 MCP 暴露能力，支持外部 Agent 接入
5. **后端化**：Notebook Studio 必须补齐后端（建表 + API + 结构化输出），否则无法对齐 NotebookLM
6. **深化**：联网搜索需要补全结果内容、增加限流缓存；Deep Research 需要实现独立编排服务

---

> **文档版本**：v1.2（基于代码核查修正：Principal 常量、ReAct 阶段名称、工具数量、Wiki 工具清单、MCP 文件路径、迭代默认值、行数估算）
> **生成时间**：2026-07-05
> **最后修订**：2026-07-05（v1.2 代码核查修正）
> **分析范围**：WeKnora 全局代码
> **配套文档**：
> - `docreader/docs/code_review_analysis.md`（docreader 代码审查）
> - `docreader/docs/refactor_plan.md`（docreader 重构计划）
