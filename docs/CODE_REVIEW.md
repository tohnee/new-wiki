# WeKnora 全项目代码审查报告

> **审查范围**:`/Users/tohnee/Trae/github/WeKnora/` 全部代码
> **审查方式**:静态只读分析,未修改任何代码
> **审查模块**:CLI、Client SDK、Docreader、Frontend、Internal 核心(三批)、CMD/Config/Deploy
> **项目定位**:腾讯开源企业级 RAG 知识框架,Go 后端 + Vue 前端 + Python 文档解析 + 多 IM 渠道集成
> **审查日期**:2026-07-03

---

## 一、整体评价

WeKnora 是一个**架构成熟度高、工程化程度深**的企业级开源项目。整体代码质量**高于业界平均水平**。

| 维度 | 评分 | 说明 |
|------|------|------|
| **架构设计** | A- | 模块分层清晰、DI 容器、ReAct 引擎、事件总线、IM 适配器抽象、多租户 RBAC |
| **安全防护** | B | 防护意识到位(AES-256-GCM、SSRF、沙箱、RBAC),但存在多个具体绕过点 |
| **代码质量** | B+ | Go 习惯用法良好,注释充分,但有拼写错误、死代码、log.Printf 混用 |
| **测试覆盖** | C+ | 核心路径有覆盖,但 Router RBAC、IM 适配器、Sandbox validator 关键缺口 |
| **并发安全** | B- | 大部分并发设计周全,但多处共享 map/state 无锁保护是高危点 |
| **可维护性** | B | 版本管理多处不一致,文档完整但部分滞后 |
| **bug 隐患** | B | 存在路径遍历、TOCTOU、goroutine 泄露、字符串错误分类等隐患 |

---

## 二、🔴 高严重度问题汇总(必须立即修复)

### 2.1 安全漏洞类

#### S1. CORS `AllowOrigins: ["*"]` + `AllowCredentials: true`
- **位置**:`internal/router/router.go:107-114`
- **问题**:`AllowOrigins: ["*"]` 与 `AllowCredentials: true` 同时设置。根据 CORS 规范(Fetch spec),当 `AllowCredentials=true` 时,`Access-Control-Allow-Origin` 不能为 `*`,浏览器会拒绝带凭证的跨域请求。gin-contrib/cors 库会在运行时把 `*` 改写为请求的 Origin 回显,这等于"允许任意来源携带凭证访问",**形同关闭同源策略**。结合 Authorization/X-API-Key 头,任意第三方网站可发起已认证请求。
- **影响**:CSRF/凭证窃取风险。
- **建议**:改为显式白名单(从配置读 `WEKNORA_CORS_ORIGINS`),或在 `AllowCredentials=false` 时才用 `*`。

#### S2. `.env.example` 硬编码弱密码/密钥
- **位置**:`.env.example:208, 218, 232, 235, 282`
- **问题**:
  - `DB_PASSWORD=postgres123!@#` 硬编码弱密码
  - `REDIS_PASSWORD=redis123!@#` 硬编码弱密码
  - `TENANT_AES_KEY=weknorarag-api-key-secret-secret` 硬编码 AES 密钥(不足 32 字节)
  - `SYSTEM_AES_KEY=weknora-system-aes-key-32bytes!!` 硬编码 AES-256 密钥(已公开在仓库)
  - `JWT_SECRET=weknora-jwt-secret` 硬编码 JWT 签名密钥
- **影响**:用户复制 `.env.example` 为 `.env` 后若忘记修改,生产数据库即用此密码;SYSTEM_AES_KEY 已公开,任何人可用其解密数据库中所有加密的 API Key/向量库凭证;JWT_SECRET 可伪造任意用户登录态。
- **建议**:`.env.example` 中所有密钥/密码应改为占位符(如 `DB_PASSWORD=CHANGE_ME_TO_STRONG_PASSWORD`)或留空并加注释 `# REQUIRED`。

#### S3. SSRF 白名单优先级绕过
- **位置**:`docreader/utils/ssrf.py:210-211`
- **问题**:`_is_whitelisted` 在 `RESTRICTED_HOSTNAMES`、`RESTRICTED_SUFFIXES`、`_is_restricted_ip` 之前 return,意味着只要主机名命中白名单(如配置 `*.example.com`),即便该域名解析到 `169.254.169.254`(云厂商元数据服务)也直接放行。
- **影响**:管理员误配 SSRF_WHITELIST 后,攻击者可借助 DNS rebinding 或 CNAME 投毒访问云元数据端点窃取 IAM 凭据。
- **建议**:白名单只应跳过 hostname 风格检查,仍需对解析后的 IP 做 `_is_restricted_ip` 校验。

#### S4. FileStore 路径遍历
- **位置**:`cli/internal/secrets/secrets.go:57-59`
- **问题**:`profile` 与 `key` 直接拼接到 `filepath.Join`,未做 sanitization。若 profile 名包含 `..`、绝对路径前缀(`/etc/...`)或 Windows 驱动器前缀(`C:\...`),可读写 secrets 根目录之外的任意路径。
- **影响**:配合 `config.yaml` 可被注入恶意 profile 名,凭证文件可被写到系统敏感位置,或读取其他 profile 的凭证。
- **建议**:在 `secrets.FileStore.path` 中校验 profile/key 不含 `..`、`/`、`\`;在 `profile add` 命令入口加 `^[a-zA-Z0-9_-]+$` 正则校验。

#### S5. ImageParser 路径遍历
- **位置**:`docreader/parser/image_parser.py:23`
- **问题**:`ref_path = f"images/{self.file_name}"`,`self.file_name` 来自 gRPC 请求 `ReadRequest.file_name`,若客户端传入 `../../../../etc/passwd`,`ref_path` 将逃逸 `images/` 目录;同时 markdown alt 文本可注入 XSS payload。
- **建议**:先 `os.path.basename(self.file_name)`,再对扩展名做白名单校验,再 sanitize alt 文本。

#### S6. 异常信息直传客户端
- **位置**:
  - `docreader/main.py:224, 242`
  - `internal/middleware/recovery.go:31-33`
  - `internal/handler/wiki_page.go`(多处 `c.JSON(500, gin.H{"error": err.Error()})`)
- **问题**:`str(e)` / `recover()` 消息直接通过 HTTP 响应体返回客户端,可能泄露内部栈信息、SQL 语句、文件路径等敏感信息。
- **建议**:对外只返回固定错误码 + 通用文案,详细错误写入日志。

#### S7. WeCom AES-CBC 解密 IV 复用 AES key
- **位置**:`internal/im/wecom/ws_adapter.go:131-180`
- **问题**:
  1. IV 直接取 AES key 前 16 字节,key 与 IV 同源,在 CBC 模式下若同一 key 加密多条消息会泄露明文 XOR。
  2. `aesKeyB64 + "="` 强行补 1 个 `=` 假设原始是 43 字符,若实际是 44 字符或已带 padding 会出错。
  3. PKCS#7 padding 校验失败时**返回明文 as-is**,可能让攻击者通过构造异常 padding 绕过完整性校验。
- **建议**:严格按 WeCom 文档校验 key 长度(应为 32 字节);padding 失败应返回错误而非明文。

#### S8. `WEKNORA_BASE_URL` 环境变量绕过 profile
- **位置**:`cli/cmd/doctor/doctor.go:404-406`
- **问题**:环境变量覆盖 profile 中的 host。在共享 CI 环境、容器逃逸或 .env 文件被注入的场景下,可将所有 SDK 流量重定向到攻击者控制的服务器,凭证(JWT/API key)随之泄露。
- **建议**:至少在 `weknora auth login` 路径上拒绝该环境变量;在 `weknora doctor` 中加 warning 输出;文档化该变量仅用于测试/开发。

#### S9. Helm Redis 探针密码泄露
- **位置**:`helm/templates/redis.yaml:71, 81`
- **问题**:`redis-cli -a $REDIS_PASSWORD ping`,`-a` 参数会使 Redis CLI 在启动时打印 `Warning: Using a password with '-a' or '-u' option on the command line interface may not be safe.`,密码可能出现在:
  - 容器进程列表(`ps`/`/proc`)
  - K8s event 日志(探针失败时)
  - 容器日志(warning 输出到 stderr)
- **建议**:改用 `REDISCLI_AUTH` 环境变量或 `--no-auth-warning` + stdin 传入密码。

### 2.2 并发安全类

#### C1. ConnectorRegistry 无锁保护
- **位置**:`internal/datasource/connector.go:55-94`
- **问题**:`Register`、`Get`、`List` 三个方法均直接读写 `r.connectors` map,未使用任何互斥锁保护。Go 的 map 不是并发安全的,当多个 goroutine 同时调用这些方法时,会触发 `fatal error: concurrent map read and map write`,导致进程崩溃。
- **对比**:同项目 `internal/datasource/scheduler.go:33-35` 的 `Scheduler` 正确使用了 `sync.Mutex` 保护 `entries` map,说明这是遗漏而非设计选择。
- **建议**:添加 `sync.RWMutex`,`Register` 用写锁,`Get`/`List` 用读锁。

#### C2. AssignChunkSeqIDs TOCTOU 竞态
- **位置**:`internal/types/chunk.go:190-216`
- **问题**:使用 `SELECT MAX(seq_id) + 1` 模式分配序列号,但查询与后续的 `CreateInBatches` 之间没有事务锁定。两个并发的 `AssignChunkSeqIDs` 调用可能读到相同的 `maxSeqID`,导致分配出重复的 SeqID。
- **建议**:使用数据库序列(PostgreSQL `SEQUENCE`)、`RETURNING` 子句,或在事务中使用 `SELECT ... FOR UPDATE`。

#### C3. AuthRetryTransport 持锁调用 refreshFn
- **位置**:`cli/internal/cmdutil/authrefresh.go:88-102`
- **问题**:`mu` 锁在 `refreshFn` 整个执行期间被持有。`refreshFn` 内部会调用 `RefreshAndPersist` → `RefreshToken`(网络往返)+ `store.Set`(磁盘 I/O)。**所有并发请求**在此期间都被阻塞。若 refresh 接口慢,所有 SDK 调用阻塞;若 refreshFn 死锁或 panic,transport 永久死锁。
- **建议**:用 `sync.Once` 或 channel-based singleflight,只在第一个 goroutine 持锁刷新,其他 goroutine 在 condvar/chan 上等待结果。

#### C4. event/global.go SetGlobalEventBus 无锁
- **位置**:`internal/event/global.go:26`
- **问题**:全局 EventBus 的 setter 无 mutex 保护,若运行时被并发调用(如热重载或多处初始化)会引发数据竞争。
- **建议**:使用 `sync.RWMutex` 保护,或改为一次性不可变注入。

#### C5. agent/skills/loader.go 缓存无锁
- **位置**:`internal/agent/skills/loader.go`
- **问题**:内存缓存(`loadedSkills` 等)和文件读取操作无 mutex 保护,而 Agent 引擎可能在多个 goroutine 中并发加载 skills。会导致数据竞争和未定义行为。
- **建议**:引入 `sync.RWMutex` 保护缓存读写。

#### C6. agent/tools/registry.go tools map 无锁
- **位置**:`internal/agent/tools/registry.go`
- **问题**:`tools` map 的读写无锁保护,而 `approval/gate.go` 和 MCP 工具注册可能在不同 goroutine 中并发操作。会导致并发 map 写入 panic。
- **建议**:使用 `sync.RWMutex`。

### 2.3 资源泄露/Bug 类

#### B1. SyncTaskExecutor goroutine 泄露 + 无 panic 恢复
- **位置**:`internal/router/sync_task.go:78-109`
- **问题**:
  1. **goroutine 泄露**:任务在后台 goroutine 跑,调用方无法等待/取消;Lite 模式下若进程关闭,在途任务直接丢失(无 WaitGroup/优雅退出)。
  2. **panic 会 Crash 进程**:`handler(ctx, task)` 无 `defer recover()`,任一 handler panic 会终止整个 Lite 进程。
  3. **无并发上限**:每次 Enqueue 都 `go func()`,无 worker pool,批量上传 100 文档会起 100 个 goroutine 同时跑解析,可能 OOM。
  4. **context.Background() 不可取消**:任务无法被 /stop 或超时取消。
- **建议**:加 worker pool + WaitGroup + recover + context 传递。

#### B2. approval/gate.go subscriber goroutine 泄露
- **位置**:`internal/agent/approval/gate.go:213`
- **问题**:Redis Pub/Sub 订阅器使用 `context.Background()` 创建,没有取消机制。进程关闭或 Gate 释放时,该 goroutine 无法被主动停止,导致 goroutine 泄露。
- **建议**:接受可取消的 context 并在 `Close()` 中触发取消。

#### B3. WeCom callback goroutine 无上限无超时
- **位置**:`internal/im/wecom/longconn.go:419-420`
- **问题**:每个 IM 消息都起一个 goroutine 处理,且 `context.WithoutCancel(ctx)` 使其脱离父 ctx 控制。若 handler 卡在下游,goroutine 不会随连接关闭而终止。无上限、无超时,Stop 后仍在跑。
- **建议**:用 bounded worker pool + per-message timeout context。

#### B4. MemoryStreamManager streams map 无限增长
- **位置**:`internal/stream/memory_manager.go`
- **问题**:`MemoryStreamManager.streams` map 只增不减,会话结束后流数据仍保留在内存中。长期运行会导致 OOM。
- **建议**:添加定期清理或 TTL 机制(类似 `ratelimit/limiter.go` 的 `startCleanup`)。

#### B5. docx_parser.py 相对导入错误
- **位置**:`docreader/parser/docx_parser.py:575`
- **问题**:`from utils.request import get_request_id`,`utils` 不是顶层包,正确路径应为 `from docreader.utils.request import get_request_id`。仅在 multiprocessing 子进程或被作为脚本运行时触发 ImportError。
- **建议**:改为 `from docreader.utils.request import get_request_id`。

#### B6. logger GetLogger 类型断言无 ok 校验
- **位置**:`internal/logger/logger.go:268-273`
- **问题**:若上游误把非 `*logrus.Entry` 塞进 `LoggerContextKey`,类型断言会 panic,且 panic 发生在日志路径上,会让本应"安全"的日志调用变成崩溃点。
- **建议**:改为 `if logger, ok := c.Value(...).(*logrus.Entry); ok && logger != nil { return logger }`。

### 2.4 版本/配置类

#### V1. Formula 版本 0.3.6-test 远落后 0.6.3
- **位置**:`Formula/weknora-lite.rb:4`
- **问题**:`version "0.3.6-test"` 与 `VERSION` 文件(`0.6.3`)严重不一致。这会导致 Homebrew 安装到错误版本。
- **建议**:建立发版 checklist,VERSION 更新时同步 Formula。

#### V2. Formula license Apache-2.0 与 LICENSE MIT 不一致
- **位置**:`Formula/weknora-lite.rb:5`
- **问题**:`license "Apache-2.0"` 与项目根目录 `LICENSE`(MIT)不一致。Homebrew 元数据声明 Apache-2.0 但实际分发 MIT 代码。
- **建议**:改为 `license "MIT"`。

#### V3. wails.json productVersion 1.0.0 与 VERSION 0.6.3 不一致
- **位置**:`cmd/desktop/wails.json`
- **问题**:Wails 桌面端版本 `1.0.0` 与 `VERSION`(`0.6.3`)不一致。桌面端 About 对话框、更新检查都依赖此版本号。
- **建议**:wails.json 改为从 VERSION 读取或发版脚本同步。

#### V4. GetMigrationVersion 硬编码 sslmode=disable
- **位置**:`internal/database/migration.go:302-325`
- **问题**:
  - 硬编码 `sslmode=disable`,强制禁用 SSL,生产环境数据库连接明文传输。
  - 通过 `fmt.Sprintf` 直接拼接环境变量构造 DB URL,未对凭证进行 URL 编码,存在凭证注入风险。
- **建议**:移除 `sslmode=disable` 硬编码,通过 config 获取 DB URL,支持 SSL。

#### V5. Sandbox validator 正则热路径反复编译
- **位置**:`internal/sandbox/validator.go:263-268, 295-300, 312-317`
- **问题**:`regexp.MatchString` 每次调用都重新编译正则。`hasNetworkAccess`/`hasReverseShellPattern`/`hasEmbeddedShellCommands` 在每次 `ValidateScript` 时遍历 31 个模式重新编译。沙箱执行是高频路径,显著拖慢吞吐。
- **建议**:把这些模式用 `compilePatterns` 预编译为 `[]*regexp.Regexp` 字段。

#### V6. 版本号不一致矩阵

| 位置 | 版本 | 应为 |
|------|------|------|
| `VERSION` | `0.6.3` | ✅ 基准 |
| `helm/Chart.yaml` appVersion | `v0.6.3` | ✅ |
| `README.md` badge | `0.6.3` | ✅ |
| `Formula/weknora-lite.rb:4` | `0.3.6-test` | ❌ 应为 `0.6.3` |
| `cmd/desktop/wails.json` productVersion | `1.0.0` | ❌ 应为 `0.6.3` |
| `helm/values.yaml:249` postgresql tag | `v0.18.9-pg17` | ❌ 应与 compose 同步 `v0.22.2-pg17` |
| `helm/values.yaml:295` redis tag | `7-alpine` | ❌ 应与 compose 同步 `7.0-alpine` |

---

## 三、🟠 中严重度问题汇总(近期修复)

### 3.1 架构与设计

- **Frontend `settings.ts` 上帝对象**:`frontend/src/stores/settings.ts`(627 行)单 store 同时管理 agent 配置、模型配置、Ollama、知识库选择、文件选择、标签、MCP、技能、网络搜索、记忆、自动更新、会话级状态快照/恢复。localStorage 读写散落在 30+ 个 action 中。建议拆分为 `useAgentConfigStore`、`useModelStore`、`useSelectionStore`、`useSessionStateStore`。
- **Frontend `menu.vue` 过大**:2061 行,单组件包含 logo、租户选择、菜单导航、会话列表、用户菜单入口。建议抽出 `useSessionBuckets()` composable。
- **IM service.go 过大**:`internal/im/service.go` 3300+ 行,违反单一职责。建议拆分为 service.go、leader.go、stop.go、stream.go、file_handler.go。
- **VectorStoreHandler 绕过 service 层**:`internal/handler/vectorstore.go` 多处直接调用 `h.repo.GetByID`、`h.repo.List`,绕过 service 层,违反分层架构。建议所有 DB 操作通过 `h.service` 进行。
- **CONFIG 模块级初始化**:`docreader/config.py:154` 中 `CONFIG = load_config()` 在 `import docreader.config` 时即执行,生产代码引用的 `CONFIG` 不可测试时替换。建议改为依赖注入或 lazy property。
- **包级全局可变状态**:`internal/runtime/container.go:11-17` 的 `init()` 创建全局 `container`、`internal/runtime/startup.go` 的 `serverStartedAt` 包级别变量,测试隔离困难。建议改用显式依赖注入。
- **Pinia store 风格不统一**:auth.ts、menu.ts、notebook.ts 用 setup store;knowledge.ts、settings.ts、ui.ts 用 options store。建议统一为 setup store。
- **模块级可变标志位**:`frontend/src/router/index.ts` 的 `autoSetupAttempted`、`liteDeepLinkRestoreDone`,HMR 时保留状态导致行为异常。建议移到 store 中作为 ref。

### 3.2 错误处理

#### 字符串错误分类泛滥
全项目大量使用 `strings.Contains(err.Error(), ...)` 而非 `errors.Is`/sentinel error:
- `internal/handler/mcp_service.go:528` — `strings.Contains(err.Error(), "not found")`
- `internal/handler/im.go:103, 236` — `strings.HasPrefix(err.Error(), "duplicate_bot:")`
- `internal/handler/organization.go:703, 840, 844, 848, 852` — error string 比较
- `internal/handler/system.go:1461` — 用 error string 分类"unknown key"
- `internal/datasource/scheduler.go:184` — `err == asynq.ErrTaskIDConflict` 应用 `errors.Is`
- `internal/common/db_retry.go:38-44` — `IsDeadlockError` 用字符串匹配,应改用 `errors.As(err, &mysqlErr)` + `mysqlErr.Number == 1213`
- `cli/internal/cmdutil/errors.go:385-414` — `ClassifyHTTPError` 依赖 SDK 错误消息字面量

#### Scan 方法对未知类型静默返回 nil
- `internal/types/agent.go:89-103`(`AgentConfig.Scan` 的 `default: return nil`)
- `internal/types/chat.go:138-146`(`References.Scan`)
- `internal/types/mcp.go:185-195, 231-255, 266-275, 286-295, 306-316`
- `internal/types/knowledgebase.go:207-216, 247-256`

**建议**:统一返回 `fmt.Errorf("unsupported type: %T", value)`。

#### IsAppError 用 type assertion 而非 errors.As
- **位置**:`internal/errors/errors.go:252-254`
- **问题**:`err.(*AppError)`,若错误被 `fmt.Errorf("%w", err)` 包装则无法识别。
- **建议**:改用 `errors.As(err, &appErr)`。

#### API 层错误处理风格不统一(Frontend)
- `frontend/src/api/auth/index.ts`:try/catch 返回 `{ success: false, message }`
- `frontend/src/api/model/index.ts`:catch 中 `console.error` 后 `reject`
- `frontend/src/api/chat/index.ts`:直接返回 promise,不 catch

**建议**:统一为"抛错 + 调用方 try/catch"或"返回 Result 类型"。

### 3.3 类型安全(Frontend)

- **大量 `as unknown as T` 绕过类型检查**:`frontend/src/utils/request.ts`、`frontend/src/stores/settings.ts`、`frontend/src/components/menu.vue`。`return res as unknown as T` 完全放弃运行时与编译时校验。
- **knowledge.ts `ref<any[]>`**:`frontend/src/stores/knowledge.ts:7-8`,`cardList: ref<any[]>([])` 完全无类型。
- **`@ts-ignore` 跳过 Wails 类型检查**:`frontend/src/App.vue`、`frontend/src/utils/caret.ts:22`。建议在 `env.d.ts` 中声明 Wails 桥接类型。
- **MentionItem 上帝对象**:`frontend/src/types/mention.ts:3-18`,15 个字段 12 个可选,应拆为 discriminated union。

### 3.4 性能

- **docx_parser.py 用 multiprocessing.Manager**:`docreader/parser/docx_parser.py`,Manager() 启动独立进程代理 dict/list,每次访问都跨进程 IPC,在多页 DOCX 解析时成为瓶颈。建议改为每个 worker 返回独立结果,主进程合并。
- **opendataloader_parser.py 集合推导在循环内**:`docreader/parser/opendataloader_parser.py:226`,`for ref in {aliases[k] for k in aliases}:` 每次循环都重建集合,复杂度 O(n²)。
- **Python 日志 f-string 提前求值**:`docreader/parser/docx_parser.py`、`doc_parser.go:74, 76, 107`、`markdown_parser.py:298, 342, 359`、`opendataloader_parser.py:85, 87, 89, 96`,大量 `logger.info(f"...")` 即使日志级别高于 INFO 也会先求值 f-string。
- **settings.ts 每次 action 全量 JSON.stringify**:`frontend/src/stores/settings.ts`(20+ 处),每次小改动都全量序列化 settings 对象。
- **caret.ts 每次测量创建/销毁 DOM**:`frontend/src/utils/caret.ts:7-57`,`getCaretCoordinates` 每次调用都 `document.createElement('div')` + `appendChild` + `removeChild`。

### 3.5 命名规范(Frontend)

- **项目名拼写错误**:`frontend/package.json:2`,`"name": "knowledage-base"` 应为 `knowledge-base`
- **方法名拼写错误**:
  - `frontend/src/components/menu.vue:82, 165`:`mouseenteMenu`(应为 `mouseenterMenu`)、`mouseenteBotDownr`
  - `frontend/src/stores/menu.ts:96, 107, 115`:`updatemenuArr`、`updataMenuChildren`、`updatasessionTitle`(均应为 `update*`)
- **`usemenuStore` 命名不规范**:应为 `useMenuStore`(驼峰首字母大写 M)

### 3.6 SDK(Client)

- **SSE 多行 data 解析不符合规范**:
  - `client/agent.go:148-150`
  - `client/session.go:339-341, 413-415`
  - 当前实现是覆盖 `dataBuffer = line[5:]` 而非拼接。应改为 `dataBuffer += "\n" + line[5:]`。
- **`debugLogger` 全局变量数据竞争**:`client/log.go:14, 24-37`,`SetDebugLevel` 直接赋值 `debugLogger`,无任何同步。建议使用 `atomic.Pointer[slog.Logger]`。
- **`Tenant` 结构体泄露 gorm/yaml tag**:`client/tenant.go:29-51`,客户端 SDK 中出现 `gorm` tag,泄露服务端 ORM 实现细节。`APIKey` 字段以 `json:"api_key"` 暴露,造成敏感信息扩散面。
- **README 引用已删除字段**:`client/README.md:99-100` 引用 `CreateSessionRequest.KnowledgeBaseID` 和 `SessionStrategy`,但实际只有 `Title`/`Description`。
- **`WithToken` 已 Deprecated 但 README/example 仍推荐使用**:`client/README.md:33, 46`、`client/README_EN.md:33, 46`、`client/example.go:27`。
- **测试覆盖严重不足**:28 个源文件只有 3 个 `_test.go` 文件,核心模块(auth、knowledge、faq、tenant)零单元测试。

### 3.7 配置/部署

- **Redis `--requirepass ${REDIS_PASSWORD}` 空密码行为不定**:`docker-compose.yml:313`,当用户 `.env` 中 `REDIS_PASSWORD` 为空时,`--requirepass ""` 会导致 Redis 启动失败。建议改为 `command: ["sh", "-c", "exec redis-server --appendonly yes ${REDIS_PASSWORD:+--requirepass \"$REDIS_PASSWORD\"}"]`。
- **Helm postgresql/redis 版本与 compose 不一致**:`helm/values.yaml:249` postgresql tag `v0.18.9-pg17`(compose 用 `v0.22.2-pg17`);`helm/values.yaml:295` redis tag `7-alpine`(compose 用 `7.0-alpine`)。
- **Helm frontend/docreader 用 `latest` 标签**:`helm/values.yaml:155, 202`,K8s 部署用 `latest` 标签无法保证滚动更新时拉到预期版本。应改为 `""`(默认取 Chart.appVersion)或固定版本。
- **桌面端 `time.Sleep(500ms)` race condition**:`cmd/desktop/main.go:260`,后端启动时间在不同机器/负载下可能 >500ms。应改为轮询后端 `/health` 端点直到就绪或超时。
- **Dockerfile nginx 以 root 运行**:`frontend/Dockerfile` 无 `USER` 指令。建议添加 `USER nginx`。
- **nginx.conf 缺少 CSP/HSTS**:`frontend/nginx.conf` 仅监听 80 端口,无 443/HTTPS 配置,缺少 `Content-Security-Policy` 和 `Strict-Transport-Security` 头。

---

## 四、🟢 低严重度问题汇总(迭代优化)

### 4.1 Go 习惯用法

- **`grpc.WithTimeout` deprecated**:`internal/container/container.go:1014`,应使用 `context.WithTimeout`。
- **`grpc.Dial` deprecated**:`docreader/client/client.go:64`,gRPC-Go v1.63+ 已 deprecated。应迁移到 `grpc.NewClient` + `grpc.WithBlock` + context 超时。
- **`example.go` 重新定义 `min` 函数**:`client/example.go:255-261`,与 Go 1.21+ builtin 冲突。
- **`context.WithoutCancel` 用法**:`internal/im/wecom/longconn.go:419-420`,虽是有意设计但应文档化风险。

### 4.2 死代码

- **Frontend `streame.ts` buffer/renderTimer**:`frontend/src/api/chat/streame.ts`,`buffer` 数组只 `push` 不 flush,`renderTimer` 设置后未真正用于节流渲染。
- **docreader `sandbox_methods` 单元素循环**:`docreader/parser/doc_parser.go:44-55`,`sandbox_methods` 仅一个方法,循环无意义。
- **splitter `_validate_chunks` 死代码**:`docreader/splitter/splitter.py:146`,在 `split_text` 中已被注释,但仍保留写入 /tmp 的能力。
- **doc_parser.py 重复 logger 定义**:`docreader/parser/doc_parser.go:16` 与 `:95`,同一模块内两次 `logger = logging.getLogger(__name__)`。
- **`dangerousCommands` 列表有重复项**:`internal/sandbox/validator.go:326-328`,`"rm -rf /"` 出现两次,注释说"with different spacing"但实际字符串一致。

### 4.3 Python 代码规范

- **assert 滥用**:`docreader/splitter/splitter.py:140, 303`,用 assert 做不变量检查,Python `-O` 模式下会被剥离。
- **日志格式错误**:`docreader/splitter/splitter.py:222-225, 244-247`,`logger.error(f"...")` 多参数误用。
- **Makefile 路径错误**:`docreader/Makefile:11, 16`,`go build -o bin/client ./src/client`(实际 client 在 `./client/`)、`python src/server/server.py`(实际 server 在 `./main.py`)。
- **pyproject.toml 描述未填写**:`docreader/pyproject.toml:4`,`description = "Add your description here"` 仍是模板默认值。
- **requires-python patch 版本过严**:`docreader/pyproject.toml:6`,`requires-python = ">=3.10.18"` 应改为 `>=3.10`。
- **`textract==1.5.0` 精确版本固定**:`docreader/pyproject.toml:28`,安全补丁无法应用,应改为 `textract>=1.5.0,<2.0.0`。

### 4.4 Frontend 其他

- **Deprecated 字段保留**:`internal/types/chat_manage.go:336`,`Pipline = Pipeline` 别名保留拼写错误。
- **`generateRandomString` 使用 `Math.random()`**:`frontend/src/utils/index.ts:20-29`,非密码学安全。
- **`formatStringDate` 使用 `any` 入参**:`frontend/src/utils/index.ts:31`。
- **i18n ko-KR 和 ru-RU 仅有部分翻译**:`frontend/src/i18n/embed.ts`。
- **`fonts.css` 仅声明一个字体且无 fallback**:`frontend/src/assets/fonts.css`,缺少 `font-display: swap`、缺少 woff2 格式、无 fallback 链。
- **`package.json` overrides 锁定 `lightningcss: "none"`**:非常规写法,应加注释说明原因。
- **使用本地 tgz 包 `xlsx-0.20.2.tgz`**:`frontend/package.json`,新成员 clone 后若该文件缺失则 `npm install` 失败。

### 4.5 其他

- **MD5 用于内容签名**:`internal/searchutil/textutil.go:14-24`,虽非安全用途但部分合规扫描工具会标记。
- **空 go.sum 文件**:`client/go.sum` 是空文件,应删除而非保留空文件。
- **proto 生成产物入库策略未明确**:`docreader/proto/docreader.pb.go`、`docreader_pb2.py`。
- **`SYSTEM_AES_KEY` 长度仅警告不阻止**:`internal/runtime/server.go:135-139`,生产环境可能使用弱密钥。
- **`log.Fatalf` 在 goroutine 中**:`internal/router/task.go:229-234`,会跳过所有 defer(包括 graceful shutdown)。

---

## 五、关键正面发现 ✅

1. **CLI wire 契约设计优秀**:对称 JSON envelope、typed error code、退出码映射表、dry-run 严格分离、exit-10 破坏性写确认协议、13 个 wire 场景的 acceptance contract test + golden 文件。
2. **AES-256-GCM 加密体系**:浅拷贝避免污染调用方内存;解密失败空白字段而非返回密文;`DecryptStoredSecretLenient` 优雅处理旧明文数据。
3. **Helm chart 质量高**:Secret lookup 防止 upgrade 时 AES 密钥轮换、required 强制关键密码、automountServiceAccountToken: false、seccompProfile RuntimeDefault、Recreate 策略保护有状态服务。
4. **Sandbox 三层验证**:脚本/参数/stdin,`--cap-drop ALL --pids-limit 100 --security-opt no-new-privileges`。
5. **多租户 RBAC 严谨**:四级角色矩阵(Owner/Admin/Contributor/Viewer)、KB 共享机制、Creator Lookup 防御纵深(`rbac_lookups.go` 即使 service 已 scope 仍显式比较租户)、DTO 层编译时脱敏。
6. **降级容错**:Redis 不可用时降级到 Lite 模式(local rate limiter + sync task executor + memory stream)、Langfuse/Neo4j 可选。
7. **Scheduler 双层去重**:DB `HasRunningSync` + Redis 确定性 TaskID,多实例部署下正确去重。
8. **事件总线设计**:同步+异步+中间件链。
9. **文档完整**:多语言 README(EN/CN/JA/KO)、详尽 CHANGELOG、AGENTS.md wire 契约文档化、`.env.example` 内嵌详细说明、helm/README 架构图。
10. **流式错误处理**:`SSEStreamError` + `errors.As/Is` + `Unwrap` 链式支持完善。
11. **审计日志完整**:管理员操作、OpenSearch 索引操作、系统设置变更均有审计记录。
12. **PDF 解析深度**:XY-cut 列检测、向量图裁剪、扫描页路由、进程池并行渲染、`_postprocess_pdf_text` 去除 arXiv 头/图表轴标签。
13. **资源清理**:`ResourceCleaner` 反向执行所有 cleanup,包括连接池、Langfuse flush、调度器停止。
14. **xdg.WriteAtomicYAML**:tmp+chmod+rename 模式是原子写的最佳实践,0600/0700 权限位选取恰当。
15. **`hmac.compare_digest` 防时序攻击**:`docreader/auth.py` token 比较使用常时比较。

---

## 六、模块评分总览

| 模块 | 评分 | 关键问题 |
|------|------|---------|
| **CLI (Go)** | B+ | path traversal、持锁刷新、字符串错误分类 |
| **Client SDK (Go)** | B | SSE 协议合规、并发安全、测试不足、gorm tag 泄露 |
| **Docreader (Python)** | 7/10 | SSRF 白名单绕过、信息泄露、路径遍历、测试缺失 |
| **Frontend (Vue/TS)** | B+ | 类型安全、命名拼写、store 拆分、token 存储 |
| **Internal - Agent/Event/Handler** | B+ | 并发安全缺口、错误分类脆弱、信息泄露 |
| **Internal - IM/MCP/Models/Sandbox** | 8/10 | CORS 矛盾、WeCom AES、goroutine 泄露、正则性能 |
| **Internal - Types/DB/Runtime** | B+ | ConnectorRegistry 无锁、TOCTOU、sslmode=disable |
| **CMD/Config/Deploy** | B | .env 弱密码、版本不一致、Helm 探针泄露 |

---

## 七、改进建议优先级

### P0 — 立即修复(安全 + 并发 + 版本)

1. **修复 CORS 配置**(S1)→ 改为白名单从 env 读 `WEKNORA_CORS_ORIGINS`
2. **`.env.example` 密码改为占位符**(S2)
3. **SSRF 白名单逻辑修正**(S3)→ 白名单只跳过 hostname,仍校验解析后 IP
4. **ConnectorRegistry 加 RWMutex**(C1)
5. **AssignChunkSeqIDs 用数据库序列或 FOR UPDATE**(C2)
6. **AuthRetryTransport 改 singleflight**(C3)
7. **event/skills/tools 三处共享状态加锁**(C4-C6)
8. **SyncTaskExecutor 加 recover + worker pool**(B1)
9. **approval gate subscriber 用可取消 context**(B2)
10. **MemoryStreamManager 加 TTL 清理**(B4)
11. **Formula 版本/license 同步**(V1, V2)
12. **GetMigrationVersion 移除 sslmode=disable**(V4)
13. **Sandbox validator 正则预编译**(V5)
14. **recovery.go 不返回 panic 消息给客户端**(S6)
15. **FileStore/ImageParser 路径遍历 sanitize**(S4, S5)

### P1 — 近期修复(错误处理 + 类型 + 测试)

1. 全面迁移 `strings.Contains(err.Error())` 到 `errors.Is`/sentinel error
2. Scan 方法对未知类型返回 error
3. Frontend 消除 `as unknown as T`/`@ts-ignore`,API 边界加 runtime 校验
4. Frontend 修复拼写错误(项目名、方法名)
5. Client SDK 修复 SSE 多行 data、debugLogger 并发、移除 gorm tag
6. 补齐 Router RBAC 表驱动测试、Sandbox validator 绕过用例测试
7. 桌面端 `time.Sleep` 改为轮询 `/health`
8. WeCom AES 解密 padding 失败返回错误
9. 拆分 IM service.go(3300 行)
10. `errors.IsAppError` 改用 `errors.As`
11. `internal/handler/im.go:153` `ListAllIMChannels` 走 `SummarizeIMChannels`
12. docx_parser.py 修正相对导入

### P2 — 中期优化(架构 + 性能)

1. Frontend 拆分 `settings.ts` 上帝对象、统一 Pinia setup store 风格
2. VectorStoreHandler 通过 service 层操作
3. CONFIG 改依赖注入
4. 移除包级全局可变状态,改显式 DI
5. docreader 日志 f-string 改 % 占位
6. nginx 加 CSP/HSTS、Dockerfile 加 USER nginx
7. 补齐 IM 平台适配器测试(slack/telegram/dingtalk)
8. 集成 Prometheus `/metrics` 端点
9. helm 加 `startupProbe` 分离启动期与运行期探测
10. 抽取 `listenWithRetry` 到共享包;删除废弃的 `supervisord.conf`

### P3 — 长期治理

1. Deprecated 字段清理时间表(`Pipline`、`SystemPromptWebEnabled` 等)
2. 统一 logger 使用(移除 `log.Printf`)
3. 拆分 AGENTS.md 为 wire-contract / command-sop / mcp 分文件
4. `.go-version` 文件锁定 Go 版本
5. proto 生成产物入库策略明确
6. 推动上游 cobra/SDK 暴露 typed error,摆脱字符串匹配耦合
7. i18n 翻译补全(ko-KR/ru-RU)
8. systemd 加固补全(AmbientCapabilities、MemoryDenyWriteExecute、RestrictSUIDSGID 等)

---

## 八、关键文件路径参考

### 安全相关
- `internal/router/router.go`(CORS)
- `.env.example`(弱密码)
- `docreader/utils/ssrf.py`(SSRF)
- `cli/internal/secrets/secrets.go`(路径遍历)
- `docreader/parser/image_parser.py`(路径遍历)
- `internal/im/wecom/ws_adapter.go`(AES-CBC)
- `internal/middleware/recovery.go`(信息泄露)

### 并发相关
- `internal/datasource/connector.go`(无锁 map)
- `internal/types/chunk.go`(TOCTOU)
- `cli/internal/cmdutil/authrefresh.go`(持锁刷新)
- `internal/event/global.go`(全局无锁)
- `internal/agent/skills/loader.go`(缓存无锁)
- `internal/agent/tools/registry.go`(tools map 无锁)

### 资源泄露
- `internal/router/sync_task.go`(goroutine 泄露)
- `internal/agent/approval/gate.go`(subscriber 泄露)
- `internal/im/wecom/longconn.go`(callback 无上限)
- `internal/stream/memory_manager.go`(streams 无限增长)

### 版本相关
- `Formula/weknora-lite.rb`(版本/license 不一致)
- `cmd/desktop/wails.json`(版本不一致)
- `internal/database/migration.go`(sslmode=disable)
- `internal/sandbox/validator.go`(正则性能)

---

**审查完成,未修改任何代码。** 所有问题均标注文件路径与行号,可直接定位修复。
