# docreader 模块代码实现与方案梳理

> 文档目的：基于 code-reviewer skill 对 docreader 模块全部代码的深度 review，输出完整的代码实现逻辑梳理与方案分析，作为后续重构的基线依据。
>
> 评审范围：docreader/ 全部 Python 源码 + Go 客户端 + Go 调用方 + Dockerfile + pyproject.toml + 测试代码
>
> 评审方法：5 个并行 review agent 分层评审（gRPC 服务层 / Parser 引擎层 / 具体文件 Parser / Go 客户端和调用方 / 部署配置和测试）
>
> 生成日期：2026-07-04

---

## 目录

1. [模块定位与职责边界](#1-模块定位与职责边界)
2. [gRPC 接口契约](#2-grpc-接口契约)
3. [认证机制](#3-认证机制)
4. [Go 端调用方清单与重构红线](#4-go-端调用方清单与重构红线)
5. [内部 Parser 引擎机制](#5-内部-parser-引擎机制)
6. [具体文件 Parser 实现梳理](#6-具体文件-parser-实现梳理)
7. [镜像体积根因分析](#7-镜像体积根因分析)
8. [Code Review 问题清单（按严重程度分级）](#8-code-review-问题清单按严重程度分级)
9. [死代码清单](#9-死代码清单)
10. [测试覆盖矩阵](#10-测试覆盖矩阵)
11. [架构合理性评估](#11-架构合理性评估)

---

## 1. 模块定位与职责边界

### 1.1 模块定位

docreader 是 WeKnora 项目中的**文档解析 sidecar 服务**，作为独立的 Python gRPC 微服务部署在主 Go 应用（WeKnora-app）容器旁，通过容器内网络（localhost:50051）通信。

**核心职责（严格边界）**：
- ✅ 输入：文件二进制内容 + 文件元信息（文件名、MIME 类型、URL 等）
- ✅ 输出：Markdown 文本 + 提取的图片引用（base64 或路径）
- ✅ 职责：将多种文档格式（PDF/DOCX/XLSX/PPTX/HTML/EPUB/Markdown/Image 等）统一转换为 Markdown + 图片
- ❌ 不负责：OCR（由 Go App 端调用外部 OCR 服务）
- ❌ 不负责：VLM 视觉语言模型推理（由 Go App 端调用）
- ❌ 不负责：Embedding 向量生成（由 Go App 端调用 Embedding 服务）
- ❌ 不负责：文本分块 Chunking（由 Go App 端 splitter 处理）
- ❌ 不负责：知识库存储（由 Go App 端写入 PostgreSQL + 向量库）

### 1.2 部署形态

```
┌─────────────────────────────────────────┐
│  WeKnora-app 容器（Go 主应用）            │
│  ┌──────────────┐   ┌─────────────────┐ │
│  │  HTTP/REST   │   │  GRPCDocument   │ │
│  │  Handler     │──→│  Reader (client)│─┼─→ localhost:50051
│  │              │   │                 │ │
│  └──────────────┘   └─────────────────┘ │
└─────────────────────────────────────────┘
                                          ↓ gRPC（明文 or mTLS）
┌─────────────────────────────────────────┐
│  WeKnora-docreader 容器（Python sidecar）│
│  ┌─────────────────────────────────────┐ │
│  │  DocReaderServicer (gRPC :50051)    │ │
│  │  ├─ Read (unary)                    │ │
│  │  ├─ ReadStream (server-streaming)   │ │
│  │  └─ ListEngines (unary)             │ │
│  └─────────────────────────────────────┘ │
│  ┌─────────────────────────────────────┐ │
│  │  ParserEngineRegistry               │ │
│  │  ├─ builtin (PDF/DOCX/XLSX/...)     │ │
│  │  ├─ markitdown                      │ │
│  │  └─ opendataloader                  │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 1.3 镜像体积现状

- 当前镜像大小：**约 1.5–1.9 GB**
- 目标镜像大小：**约 500–700 MB**（瘦身 ~990 MB，详见第 7 节）

---

## 2. gRPC 接口契约

### 2.1 proto 定义

**文件**：`docreader/proto/docreader.proto`

```protobuf
service DocReader {
  rpc Read(ReadRequest) returns (ReadResponse);          // unary
  rpc ReadStream(ReadRequest) returns (stream ReadResponseChunk);  // server-streaming
  rpc ListEngines(ListEnginesRequest) returns (ListEnginesResponse);  // unary
}
```

### 2.2 三个 RPC 方法详解

#### 2.2.1 Read（unary，阻塞式）

- **用途**：小文件同步解析，一次返回完整结果
- **请求字段**：
  - `file_content bytes` —— 文件二进制内容
  - `file_name string` —— 文件名
  - `file_type string` —— 显式文件类型（扩展名，如 pdf/docx，优先级高于 file_name 推断）
  - `url string` —— 文件 URL（与 file_content 二选一）
  - `title string` —— 可选标题（URL 模式下使用）
  - `config.parser_engine string` —— 指定 parser 引擎（builtin/markitdown/opendataloader），嵌套在 ReadConfig 中
  - `config.parser_engine_overrides map<string,string>` —— 引擎参数覆盖，嵌套在 ReadConfig 中
  - `request_id string` —— 请求追踪 ID
  - `storage_key string` —— proto 中保留字段，Python 端从未赋值，Go 端仅 pass-through 透传但无业务逻辑消费，等价于死字段，评估后可删除（需同步重新生成 Go pb.go）
- **响应字段**：
  - `markdown_content string` —— 解析后的 Markdown 文本
  - `image_refs repeated ImageRef` —— 提取的图片引用
  - `image_dir_path string` —— 图片目录路径（inline 模式下为空）
  - `metadata map<string,string>` —— 额外元数据
  - `error string` —— **反模式**：应使用 gRPC status code 而非自定义 error 字段
- **超时**：由 gRPC context 控制，Go 端默认 30 分钟（过长，见问题清单 P0-7）

#### 2.2.2 ReadStream（server-streaming，流式）

- **用途**：大文件流式解析，首帧返回 Markdown 元数据，后续每帧一张图片，避免 unary 单次响应过大（解决大扫描 PDF 数百张图片导致 RESOURCE_EXHAUSTED 的问题）
- **请求字段**：同 Read
- **响应帧结构**（ReadStreamResponse，oneof payload）：
  - 首帧 `meta`（ReadStreamMeta）：`markdown_content`、`image_dir_path`、`metadata`、`error`、`image_count`（图片总数 best-effort 估计，未知时为 0）
  - 后续帧 `image`（ImageRef）：每帧一张图片，逐个发送
- **降级逻辑**：若 server 返回 `codes.Unimplemented`，Go 客户端自动降级到 Read（**重构红线**，不可破坏）

#### 2.2.3 ListEngines（unary）

- **用途**：列出当前 docreader 支持的 parser 引擎清单，供前端 UI 展示引擎选择
- **请求字段**：空
- **响应字段**：
  - `engines repeated EngineInfo` —— 引擎列表（name + supported_file_types + description）

### 2.3 关键数据结构

```python
# docreader/models/document.py (实际返回使用 ImageRef proto，Document 是 parser 内部模型)
class Document:
    content: str               # Markdown 文本
    images: dict[str, str]     # {相对路径: base64 编码字符串}
    metadata: dict             # 额外元数据

# proto ImageRef（gRPC 传输用）
class ImageRef:
    filename: str              # 图片文件名
    original_ref: str          # 原始引用路径（相对路径/URL）
    mime_type: str             # 图片 MIME 类型
    storage_key: str           # 共享存储下载 URL（proto 保留字段，Python 端未赋值，Go 端透传无消费，等价于死字段）
    image_data: bytes          # 图片二进制数据（inline bytes fallback）
```

### 2.4 接口契约问题

| 问题 | 严重程度 | 位置 | 说明 |
|------|---------|------|------|
| `error` 字段反模式 | MEDIUM | proto L51/L59 | 应使用 gRPC status code，而非在响应体中嵌入 error 字段 |
| `storage_key` 死字段 | LOW | proto L42（保留字段，Python 未赋值，Go 透传未消费） | 定义了但从未使用，应删除 |
| 缺少 `parser_version` 字段 | LOW | proto | 无法区分引擎版本，调试困难 |

---

## 3. 认证机制

### 3.1 双层认证设计

**文件**：`docreader/auth.py`

docreader 支持两层可选认证，由环境变量控制：

#### 3.1.1 传输层：TLS / mTLS（可选）

- 环境变量：`GRPC_TLS_ENABLED`（默认 `false`）
- 启用后：加载 `GRPC_TLS_CERT_FILE` / `GRPC_TLS_KEY_FILE` 服务端证书
- mTLS：可选加载 `GRPC_TLS_CA_FILE` 客户端证书用于双向认证
- **问题**：默认关闭 TLS，且无 fail-fast 警告（P0-1）

#### 3.1.2 应用层：Bearer Token（可选）

- 环境变量：`GRPC_AUTH_TOKEN`（默认空）
- 启用后：客户端必须在 metadata 中携带 `authorization: Bearer <token>`
- **问题**：token < 16 字节时仅 warn 不 fail（P0-2）
- **问题**：metadata 键大小写敏感，应使用 lowercase（P1-2）

### 3.2 认证流程

```
Client → [TLS Handshake（可选）] → Server
       → [Metadata: authorization: Bearer <token>（可选）] → Server
                                                          ↓
                                                  AuthInterceptor
                                                  ├─ TLS 开启 + token 开启 → 双重校验
                                                  ├─ TLS 关闭 + token 开启 → 仅 token 校验（明文传输！）
                                                  ├─ TLS 开启 + token 关闭 → 仅 TLS
                                                  └─ TLS 关闭 + token 关闭 → 无认证（！）
```

### 3.3 Go 端认证守卫

**文件**：`docreader/client/auth.go` L132-134

```go
// RequireTransportSecurity 防止 token 明文泄漏
// 当 token 非空但 TLS 未开启时，客户端拒绝连接
func (a *AuthCredentials) RequireTransportSecurity() bool {
    return a.token != ""
}
```

**这是关键安全守卫，重构时必须保留。**

### 3.4 认证机制问题

| 编号 | 严重程度 | 位置 | 问题 | 影响 |
|------|---------|------|------|------|
| P0-1 | CRITICAL | auth.py L47-49 | 默认允许明文启动无 fail-fast | token 明文传输或无认证运行 |
| P0-2 | CRITICAL | auth.py L171-174 | token < 16B 仅 warn 不 fail | 弱 token 易被暴力破解 |
| P1-2 | HIGH | auth.py L187 | metadata 键大小写敏感 | 客户端大小写不匹配导致认证失败 |
| P1-4 | HIGH | main.py L319-323 | TLS 配置错误时仅 log 不 exit | 服务以不安全状态运行 |

---

## 4. Go 端调用方清单与重构红线

### 4.1 四个调用场景

**文件**：`internal/infrastructure/docparser/grpc_parser.go` + `internal/application/service/knowledge_process.go` + `internal/handler/system.go`

#### 场景 1：知识库文档导入

- **入口**：`knowledge_process.go` 中的 `ProcessDocument` 方法
- **流程**：上传文件 → 调用 `resolveDocReader` 选择引擎 → gRPC 调用 docreader → 拿到 Markdown → Chunking → Embedding → 入库
- **超时**：默认 30 分钟（P0-7，过长）
- **引擎路由**：`resolveDocReader` 7 种分支（重构红线，详见 4.3）

#### 场景 2：聊天附件处理

- **入口**：聊天消息携带附件时
- **流程**：附件暂存 → gRPC 调用 docreader → Markdown 注入对话上下文
- **引擎**：通常使用 builtin 或 simple

#### 场景 3：系统管理

- **入口**：`system.go` 中的 `resolveDocReader`
- **流程**：管理员配置文档解析引擎
- **问题**：WeKnoraCloud addr 绕过 SSRF 校验（P1-5）

#### 场景 4：初始化检测

- **入口**：服务启动时检测 docreader 可达性
- **流程**：调用 ListEngines 确认服务健康

### 4.2 GRPCDocumentReader 客户端逻辑

**文件**：`internal/infrastructure/docparser/grpc_parser.go`

```go
// 核心调用逻辑（重构红线，不可破坏）
func (g *GRPCDocumentReader) Read(ctx, req) (*Document, error) {
    // 1. 流式优先
    stream, err := g.client.ReadStream(ctx, req)
    if err != nil {
        // 2. 降级条件：Unimplemented
        if status.Code(err) == codes.Unimplemented {
            // 3. 降级到 unary Read
            resp, err := g.client.Read(ctx, req)
            // ...
        }
        return err
    }
    // 4. 流式接收 chunks，聚合
    for {
        chunk, err := stream.Recv()
        if err == io.EOF { break }
        // ...
    }
}
```

### 4.3 14 项重构红线清单（绝对不可破坏）

以下 14 项是 Go 端调用方与 docreader 的契约，重构时**必须保持向后兼容**：

| 编号 | 红线 | 位置 | 说明 |
|------|------|------|------|
| R-01 | gRPC 端口 50051 | docker-compose | 端口不可变 |
| R-02 | proto 服务名 `DocReader` | proto | 服务名不可变 |
| R-03 | 3 个 RPC 方法签名 | proto | Read/ReadStream/ListEngines 不可变 |
| R-04 | ReadRequest 字段 | proto | file_content/file_name/file_type/url/title/config.parser_engine/config.parser_engine_overrides/request_id 不可变 |
| R-05 | ReadResponse.markdown_content + ReadResponse.image_refs 字段 | proto | 不可变（原 document 结构已拆分） |
| R-06 | ReadStream 降级逻辑 | grpc_parser.go L131-146 | Unimplemented → Read 降级必须保留 |
| R-07 | resolveDocReader 7 种引擎分支 | knowledge_process.go L3261-3295 | simple/weknoracloud/mineru/mineru_cloud/paddleocr_vl/paddleocr_vl_cloud/builtin 不可变 |
| R-08 | ListEngines 返回格式 | proto | 引擎清单格式不可变 |
| R-09 | Bearer Token 认证机制 | auth.go + auth.py | metadata `authorization: Bearer <token>` 不可变 |
| R-10 | RequireTransportSecurity 守卫 | auth.go L132-134 | token 非空时强制 TLS 不可变 |
| R-11 | GRPC_AUTH_TOKEN 环境变量 | config.py | 环境变量名不可变 |
| R-12 | GRPC_TLS_* 环境变量 | config.py | TLS 相关环境变量名不可变 |
| R-13 | 健康检查 grpc_health_probe | Dockerfile | 健康检查机制不可变 |
| R-14 | ImageRef 数据结构 | proto | filename/original_ref/mime_type/storage_key/image_data 不可变（storage_key 为保留字段） |

> 注意：7 种引擎中，`mineru`/`mineru_cloud`/`paddleocr_vl`/`paddleocr_vl_cloud` 4 种由 Go 端直接实现（NewMinerUReader/NewMinerUCloudReader/NewPaddleOCRVLReader/NewPaddleOCRVLCloudReader），通过 HTTP 调用本地/云端模型服务，**完全不经过 Python docreader**；`simple`/`weknoracloud` 也在 Go 端实现；只有 `builtin` 引擎（以及 default 分支中对非 simple 格式的兜底）会走 Python gRPC docreader。

### 4.4 Go 客户端问题

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P0-5 | CRITICAL | client.go L61 | `resolver.SetDefaultScheme("dns")` 修改 gRPC 全局默认 scheme，污染所有 gRPC 连接 |
| P0-6 | CRITICAL | grpc_parser.go L65 | `resolver.SetDefaultScheme("dns")` 在 `connect()` 中重复执行 |
| P1-6 | HIGH | client.go L64 | `grpc.Dial` 缺少 `WithBlock`，连接未就绪即返回 |
| P1-7 | HIGH | grpc_parser.go L80-91 | Reconnect 缺少回滚机制（先关闭旧连接再建立新连接，中间状态无服务） |
| P0-7 | CRITICAL | knowledge_process.go L3217 | 默认 30 分钟超时过长，应可配置 |
| P1-5 | HIGH | system.go L355-365 | WeKnoraCloud addr 绕过 SSRF 校验 |

---

## 5. 内部 Parser 引擎机制

### 5.1 ParserEngineRegistry 注册表

**文件**：`docreader/parser/registry.py`

```python
class ParserEngineRegistry:
    """维护 engine_name → {file_type → parser_class} 映射"""
    _engines: dict[str, dict[str, type[BaseParser]]]
    _descriptions: dict[str, str]
    _check_available: dict[str, Callable]
    _unavailable_hint: dict[str, str]

    def register(self, name, file_types, description, check_available=None, unavailable_hint=""): ...
    def get_parser_class(self, engine, file_type) -> type[BaseParser]: ...  # 引擎不支持时自动 fallback 到 builtin
    def list_engines(self, overrides=None) -> list[dict]: ...
    def get_engine_names(self) -> list[str]: ...

# 模块级单例（注意是小写 registry，不是大写 REGISTRY）
registry = _build_default_registry()  # 注册 3 个引擎
```

#### 5.1.1 三个默认引擎

| 引擎名 | 支持文件类型 | 说明 |
|--------|-------------|------|
| `builtin` | pdf/docx/xlsx/pptx/html/epub/markdown/image/mhtml/txt | 内置引擎，覆盖最广 |
| `markitdown` | docx/pdf/xls/xlsx | Microsoft MarkItDown，轻量 |
| `opendataloader` | pdf | OpenDataLoader，重型，质量最高 |

> 注：Python 端仅注册 3 个引擎。`mineru`/`mineru_cloud`/`paddleocr_vl`/`paddleocr_vl_cloud`/`simple`/`weknoracloud` 共 6 个引擎由 **Go 端直接实现**（HTTP 调用本地/云端模型服务或 Go 原生解析），不经过 Python docreader gRPC 接口。Go 端 `resolveDocReader` 会先按引擎名路由，只有 `builtin` 和 `""`(默认非 simple 格式) 才会走到 Python gRPC docreader。参见 registry.py L168-171 注释。

#### 5.1.2 注册表问题

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P1-8 | HIGH | registry.py L32-55/118-173（全局单例在 import 时构建，非多线程注册场景，实际并发风险低） | 全局单例无并发保护（多线程并发注册可能 race） |
| P2-1 | LOW | registry.py L2（typing.Any 导入未使用） | `Any` 导入未使用 |

### 5.2 ChainParser 链式模式

**文件**：`docreader/parser/chain_parser.py`

#### 5.2.1 FirstParser（尝试链）

```python
class FirstParser(BaseParser):
    """依次尝试多个 parser，第一个成功即返回"""
    def __init__(self, parsers: list[BaseParser]): ...
    def parse_into_text(self, content: bytes) -> Document:
        for parser in self.parsers:
            try:
                document = parser.parse_into_text(content)
                if document.is_valid():  # L69: 增加了 is_valid 检查
                    return document
            except Exception:  # L62：过于宽泛
                continue
        return Document()  # L72：全失败返回空 Document，无法区分失败
```

#### 5.2.2 PipelineParser（流水链）⚠️ CRITICAL

```python
class PipelineParser(BaseParser):
    def parse_into_text(self, content: bytes) -> Document:
        images: Dict[str, str] = {}
        metadata: Dict = {}
        document = Document()
        for p in self._parsers:
            document = p.parse_into_text(content)
            # P0-3 BUG：将 markdown 文本用 UTF-8 编码为 bytes 传给下游 parser，
            # 但下游 parser 期望的是原始文件 bytes（如 PDF/DOCX bytes），
            # 会导致下游解析失败或产出垃圾结果。
            content = endecode.encode_bytes(document.content)
            images.update(document.images)
            metadata.update(document.metadata)
        document.images.update(images)
        document.metadata.update(metadata)
        return document
```

**严重问题 P0-3**：PipelineParser L122-151（`parse_into_text` 方法）链式逻辑设计缺陷。下游 parser 收到的是上一个 parser 输出的 Markdown 文本的 bytes（通过 `endecode.encode_bytes(document.content)` 将 UTF-8 文本重新编码为 bytes），而下游 parser 期望的是原始文件 bytes（如 PDF bytes）。这会导致下游 parser 解析失败或产出垃圾结果。**当前代码中 PipelineParser 实际未被使用，但 bug 存在。**

#### 5.2.3 ChainParser 问题清单

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P0-3 | CRITICAL | chain_parser.py L122-151 | PipelineParser 链式逻辑设计缺陷 |
| P1-9 | HIGH | chain_parser.py L62 | `except Exception` 过于宽泛，吞掉所有异常 |
| P1-10 | HIGH | chain_parser.py L72 | FirstParser 全失败返回空 Document，无法区分失败（现已通过 `document.is_valid()` 检查优化） |
| P2-2 | LOW | chain_parser.py L173-179 | `__main__` 块死代码 |

### 5.3 BaseParser 接口

**文件**：`docreader/parser/base_parser.py`

```python
class BaseParser(ABC):
    @abstractmethod
    def parse_into_text(self, content: bytes) -> Document: ...  # 抽象方法，子类实现

    def parse(self, content: bytes) -> Document: ...  # 具体方法：日志包装 + 调用 parse_into_text

    def __init__(self, file_name="", file_type=None, **kwargs): ...
```

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P1-11 | MEDIUM | base_parser.py L10 | `logger.setLevel(logging.INFO)` 反模式（应全局配置） |
| P2-3 | LOW | base_parser.py L25-28 | `**kwargs` 被静默吞掉，未传递给子类 |

### 5.4 并发控制

**文件**：`docreader/parser/concurrency.py`

```python
class ParserConcurrencyLimiter:
    """限制并发解析数量，防止 OOM"""
    def __init__(self, max_concurrent: int): ...
    def acquire(self): ...  # P1-12：无超时
    def release(self): ...
```

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P1-12 | HIGH | concurrency.py L35 | `limiter.acquire()` 无超时，可能导致线程永远阻塞 |

### 5.5 顶层入口

**文件**：`docreader/parser/parser.py`

```python
class Parser:
    """顶层解析 Facade 类（parser.py L11-82）"""

    def __init__(self):
        self.registry = registry  # 模块级单例

    def parse_file(self, file_name, file_type, content, parser_engine=None, engine_overrides=None) -> Document:
        """根据 file_type 和 parser_engine 路由到具体 parser（L25-63）"""
        cls = self.registry.get_parser_class(engine or "", file_type)
        parser = cls(file_name=file_name, file_type=file_type, **overrides)
        return parser.parse(content)

    def parse_url(self, url, title, parser_engine=None, engine_overrides=None) -> Document:
        """从 URL 下载并解析（L65-82）"""
        # P1-13 CONFIRMED：方法签名包含 parser_engine 和 engine_overrides 参数，
        # 但方法体内完全忽略这两个参数，始终创建 WebParser(title=title)
        parser = WebParser(title=title)
        return parser.parse(url.encode())
```

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P1-13 | HIGH | parser.py L65-82 | `parse_url` 完全忽略 `parser_engine` 和 `engine_overrides` 参数 |

---

## 6. 具体文件 Parser 实现梳理

### 6.1 pdf_parser.py（1548 行，最复杂）

**文件**：`docreader/parser/pdf_parser.py`

#### 6.1.1 核心流程

```
PDF bytes
  ↓
_page_classify（每页分类：text vs scanned）
  ↓
_text_page（文本页：提取文本 + 布局排序）
  ↓
_scanned_page（扫描页：渲染为图片 → 交给 OCR，但 docreader 不做 OCR）
  ↓
_extract_embedded_images（提取嵌入图）
  ↓
Markdown + images
```

#### 6.1.2 关键问题

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P0-4 | CRITICAL | pdf_parser.py L1211 | 用 MD5 做 image hash + `pil.tobytes()` 内存爆炸（大 PDF OOM） |
| P1-14 | HIGH | pdf_parser.py L1017 | `_WORKER_RENDER_DOC` 全局可变状态 + forkserver 风险 |
| P2-4 | MEDIUM | pdf_parser.py 全文 | 1548 行单文件，建议拆分为 6 个模块 |

#### 6.1.3 拆分建议

```
parser/pdf/
  ├── __init__.py          # 导出 PDFParser
  ├── classify.py          # _page_classify 页面分类
  ├── text_layout.py       # _text_page 文本布局
  ├── sanitize.py          # 文本清洗
  ├── render.py            # _scanned_page 渲染
  ├── figures.py           # _extract_embedded_images 图片提取
  └── parser.py            # PDFParser 主类，编排上述模块
```

### 6.2 docx_parser.py（1534 行）

**文件**：`docreader/parser/docx_parser.py`

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P0-8 | CRITICAL | docx_parser.py L11/L776 | L11 `from multiprocessing import Manager`；L776 Manager 跨进程 pickle PIL Image 会抛异常 |
| P1-15 | HIGH | docx_parser.py L1064 | 表格 HTML 不转义 XSS |
| P2-5 | LOW | docx_parser.py L298 | `picture_cache` 死代码 |
| P2-6 | LOW | docx_parser.py L302-342 | `get_picture` 死代码 |
| P2-7 | LOW | docx_parser.py L1085-1132 | `_safe_concat_images` 死代码 |

### 6.3 opendataloader_parser.py（360 行）

**文件**：`docreader/parser/opendataloader_parser.py`

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P0-9 | CRITICAL | opendataloader_parser.py L82 | `urllib.request.urlopen` 无 SSRF 校验（urlopen at L82，confirmed no SSRF） |
| P0-10 | CRITICAL | opendataloader_parser.py L279-281 | `hybrid_url` 直接透传未做 SSRF 校验 |
| P2-8 | LOW | opendataloader_parser.py L298 | `mineru_endpoint` / `mineru_api_key` 过滤逻辑死代码 |

### 6.4 web_parser.py（326 行）

**文件**：`docreader/parser/web_parser.py`

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P0-11 | CRITICAL | web_parser.py L174 | DNS rebinding 风险（解析后 IP 校验，但请求时 DNS 可能变；page.route L139 handler 未重新校验 IP，P0-11 confirmed） |
| P1-16 | HIGH | web_parser.py L139 | `page.route` 重定向处理（route handler 未重新校验 IP） |
| P1-17 | HIGH | web_parser.py L240 | `asyncio.run` 在已有 loop 时崩溃 |
| P2-9 | LOW | web_parser.py L295-326 | `__main__` 块死代码 |

### 6.5 doc_parser.py（362 行）

**文件**：`docreader/parser/doc_parser.py`

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P0-12 | CRITICAL | doc_parser.py L9 | `import textract` 仍存在（L116-117 已注释禁用 textract.process，但 import 未删除） |
| P2-10 | LOW | doc_parser.py L167-171 | `_parse_with_textract` 死代码（已禁用未调用，textract.process with method="antiword" 已被注释；实际 .doc 解析走 soffice→docx 或 antiword 子进程） |
| P2-11 | LOW | doc_parser.py L95 | 重复 logger |

### 6.6 markitdown_parser.py

**文件**：`docreader/parser/markitdown_parser.py`

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P2-12 | MEDIUM | markitdown_parser.py L32 | `MarkItDown()` 在 `__init__` 每次构造，应复用 |

### 6.7 image_parser.py（27 行）

**文件**：`docreader/parser/image_parser.py`

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P2-13 | LOW | image_parser.py L22 | `ext` 变量未使用 |

### 6.8 markdown_parser.py（469 行）

**文件**：`docreader/parser/markdown_parser.py`

| 编号 | 严重程度 | 位置 | 问题 |
|------|---------|------|------|
| P2-14 | LOW | markdown_parser.py L171-188 | `_self_test` 死代码 |
| P2-15 | LOW | markdown_parser.py L404-413 | `_self_test` 死代码 |

### 6.9 其他 parser（无重大问题）

- `epub_parser.py` —— EPUB 解析，正常
- `excel_parser.py` —— Excel 解析，正常（依赖 pandas 读取 + dataframe 处理）
- `mhtml_parser.py` —— MHTML 解析，正常
- `docx2_parser.py` —— DOCX 备用解析，正常
- `excel_convert.py` —— Excel 转换辅助（xls/ods→xlsx），通过 LibreOffice soffice 子进程实现
- `ppt_convert.py` —— PPT 转换辅助（ppt→pptx），通过 LibreOffice soffice 子进程实现
- `xlsx_merge.py` / `xlsx_repair.py` —— Excel 修复辅助，正常
- `pptx_media.py` —— PPTX 媒体提取，正常

---

## 7. 镜像体积根因分析

> **实测更正（2026-07-04 复核）**：
> - **pandas 实际被使用**：excel_parser.py L13 和 excel_convert.py L24 都 import pandas，不能简单替换为 openpyxl（pandas 用于 Excel 读取与 dataframe 处理）。因此 S-05（"pandas 换 openpyxl，省 80MB"）不成立，应删除。
> - **pypdf 依赖不存在**：代码中没有任何 `import pypdf`，实际使用的是 `pypdfium2`（pdf_parser.py L1022/1304/1416）。pyproject.toml 若有 pypdf 是残留，可直接删除，S-11 成立。
> - **LibreOffice (soffice) 被 3 处实际调用**：doc_parser.py（doc→docx 转换，L187-205）、excel_convert.py（xls/ods→xlsx，L49-105）、ppt_convert.py（ppt→pptx，L39-115），不能直接删除。Phase 3 必须通过 sidecar 或改用其他方案替换。
> - **antiword 被实际调用**：doc_parser.py L145-165，作为 soffice 失败后的 .doc 解析 fallback。

### 7.1 当前镜像体积分布

| 组件 | 估算体积 | 来源 | 必要性 |
|------|---------|------|--------|
| LibreOffice | ~500-700 MB | apt install libreoffice | doc_parser.py（doc→docx）、excel_convert.py（xls/ods→xlsx）、ppt_convert.py（ppt→pptx）3 处 soffice 子进程调用，以及 doc_parser.py L145-165 antiword fallback；可拆 sidecar |
| Playwright WebKit | ~200-300 MB | pip install playwright + webkit | 仅 web_parser.py 使用，可拆 sidecar |
| openjdk-17-jre-headless | ~150-200 MB | apt install | opendataloader 依赖，可拆 sidecar |
| pandas | ~80 MB | pip install | excel_parser/excel_convert 实际使用（Excel 读取与 dataframe 处理），不可删除 |
| opendataloader-pdf | ~50 MB | pip install | opendataloader 引擎使用 |
| Python 3.10 base | ~50 MB | python:3.10.18-bookworm | 必需 |
| grpcio + protobuf | ~30 MB | pip install | 必需 |
| pillow | ~20 MB | pip install | 必需 |
| 其他（lxml/bs4/markdownify 等） | ~50 MB | pip install | 必需 |
| **合计** | **~1330-1580 MB** | | |

### 7.2 镜像瘦身机会清单（合计 ~990 MB）

| 编号 | 瘦身项 | 估算节省 | 方案 | 风险 |
|------|--------|---------|------|------|
| S-01 | LibreOffice 拆 sidecar | ~400 MB | 拆分为独立 libreoffice sidecar 容器 | 中：doc_parser/excel_convert/ppt_convert 三处实际调用 soffice |
| S-02 | Playwright 拆 sidecar | ~300 MB | 拆分为独立 playwright sidecar，web_parser 通过 HTTP 调用 | 中：需新增 HTTP 接口 |
| S-03 | JRE 拆 sidecar | ~200 MB | opendataloader 独立 sidecar | 中：需重构 opendataloader 调用 |
| S-04 | 删除 textract 死依赖 | ~30 MB | pyproject.toml 移除 textract==1.5.0 | 低：已禁用 |
| ~~S-05~~ | ~~pandas 换 openpyxl~~ | ~~80 MB~~ | ~~excel_parser 改用 openpyxl（已在依赖中）~~ | ~~经核实 pandas 被 excel_parser/excel_convert 实际使用，不可删除~~ |
| S-06 | ImageMagick 评估移除 | ~20 MB | 评估是否仍有使用 | 低：需确认 |
| S-07 | 多阶段构建优化 | ~30 MB | builder 阶段不复制 .venv 到 runner | 低 |
| S-08 | 删除 markitdown 重型依赖 | ~40 MB | 评估是否仍需要 markitdown 引擎 | 中：需确认引擎使用率 |
| S-09 | 合并 apt 层 + 清理缓存 | ~10 MB | Dockerfile RUN 指令合并 | 低 |
| S-10 | 使用 python:3.10-slim | ~20 MB | bookworm → slim | 低 |
| S-11 | 删除 pypdf 死依赖 | ~5 MB | pyproject.toml 移除 pypdf | 低：未使用 |
| S-12 | protoc 在 builder 阶段 | ~10 MB | protoc 仅 builder 需要，runner 不需要 | 低：已正确 |

### 7.3 瘦身后目标镜像

| 组件 | 体积 |
|------|------|
| Python 3.10 slim | ~30 MB |
| grpcio + protobuf + grpc-health-checking | ~30 MB |
| pillow + lxml + bs4 + markdownify + python-docx + openpyxl | ~70 MB |
| pypdfium2 + pdfplumber（PDF 文本提取） | ~40 MB |
| trafilatura（HTML 提取，替代 playwright 轻量） | ~20 MB |
| ebooklib + markdown | ~10 MB |
| antiword（doc 解析，替代 libreoffice） | ~5 MB |
| 其他小依赖 | ~30 MB |
| **合计** | **~235 MB** |

**目标：从 1.5-1.9 GB 瘦身到 500-700 MB**（含 sidecar 拆分后主镜像 ~235 MB）。

---

## 8. Code Review 问题清单（按严重程度分级）

### 8.1 CRITICAL（P0，必须立即修复）

| 编号 | 文件 | 位置 | 问题 | 修复建议 |
|------|------|------|------|---------|
| P0-1 | auth.py | L47-49 | 默认允许明文启动无 fail-fast | 启动时若 TLS 关闭且 token 空，强制 fail-fast |
| P0-2 | auth.py | L171-174 | token < 16B 仅 warn 不 fail | token < 16B 时 fail-fast |
| P0-3 | chain_parser.py | L122-151 (parse_into_text 方法) | PipelineParser 链式逻辑设计缺陷 | 修正：下游 parser 接收原始 bytes，而非 markdown 编码 |
| P0-4 | pdf_parser.py | L1211 | MD5 hash + `pil.tobytes()` 内存爆炸 | 改用 sha256 + 流式处理 + 内存上限 |
| P0-5 | client.go | L61 | `resolver.SetDefaultScheme("dns")` 全局副作用（confirmed） | 改用 `grpc.WithResolvers(dns.NewResolver())` |
| P0-6 | grpc_parser.go | L65 | `resolver.SetDefaultScheme("dns")` 重复执行（confirmed） | 同 P0-5 |
| P0-7 | knowledge_process.go | L3217 | 默认 30 分钟超时过长 | 改为可配置，默认 5 分钟 |
| P0-8 | docx_parser.py | L776 | Manager 跨进程 pickle PIL Image 异常 | 改用共享文件路径而非 pickle |
| P0-9 | opendataloader_parser.py | L82 | `urllib.request.urlopen` 无 SSRF 校验 | 使用 utils/ssrf.py 校验 |
| P0-10 | opendataloader_parser.py | L288 | `hybrid_url` 未校验 SSRF | 使用 utils/ssrf.py 校验 |
| P0-11 | web_parser.py | L174 | DNS rebinding 风险 | 在 page.route 中重新校验 IP |
| P0-12 | doc_parser.py | L9 | `import textract` 仍存在 | 删除 import + 死代码 |
| P0-13 | docker/Dockerfile.docreader | - | 容器以 root 运行，无 `USER` 指令（confirmed：Dockerfile 中确实无 USER 指令） | 添加 `USER 65532:65532` |
| P0-14 | utils/ssrf.py | L229-245 | TOCTOU / DNS rebinding 漏洞 | 校验后立即 pin IP |
| P0-15 | utils/endecode.py | L23/L78 | 函数命名完全反转（confirmed：decode_image=encode, encode_image=decode） | 重命名：decode_image→encode_image，反之 |

### 8.2 HIGH（P1，重要，计划修复）

| 编号 | 文件 | 问题 |
|------|------|------|
| P1-1 | main.py L195-218 | 线程池饥饿风险 |
| P1-2 | auth.py L187 | metadata 键大小写敏感 |
| P1-3 | main.py L57-106 | `_resolve_images` 内存峰值失控 |
| P1-4 | main.py L319-323 | TLS 配置错误时仅 log 不 exit |
| P1-5 | system.go L355-365 | WeKnoraCloud addr 绕过 SSRF |
| P1-6 | client.go L64 | `grpc.Dial` 缺少 `WithBlock` |
| P1-7 | grpc_parser.go L80-91 | Reconnect 缺少回滚机制 |
| P1-8 | registry.py L32-55/118-173 | 全局单例无并发保护（import 时构建，实际并发风险低） |
| P1-9 | chain_parser.py L62 | `except Exception` 过于宽泛 |
| P1-10 | chain_parser.py L72 | FirstParser 全失败返回空 Document（已通过 is_valid() 检查优化） |
| P1-11 | base_parser.py L10 | `logger.setLevel` 反模式 |
| P1-12 | concurrency.py L35 | `limiter.acquire()` 无超时 |
| P1-13 | parser.py L65-82 | `parse_url` 忽略参数 |
| P1-14 | pdf_parser.py L1017 | 全局可变状态 + forkserver 风险 |
| P1-15 | docx_parser.py L1064 | 表格 HTML 不转义 XSS |
| P1-16 | web_parser.py L139 | `page.route` 重定向处理 |
| P1-17 | web_parser.py 全文 | `asyncio.run` 在已有 loop 时崩溃 |

### 8.3 MEDIUM（P2，次要）

| 编号 | 文件 | 问题 |
|------|------|------|
| P2-1 | registry.py L2 | `typing.Any` 导入未使用 |
| P2-2 | chain_parser.py L173-179 | `__main__` 块死代码 |
| P2-3 | base_parser.py L25-28 | `**kwargs` 静默吞掉 |
| P2-4 | pdf_parser.py 全文 | 1548 行单文件过大 |
| P2-5 | docx_parser.py L298 | `picture_cache` 死代码 |
| P2-6 | docx_parser.py L302-342 | `get_picture` 死代码 |
| P2-7 | docx_parser.py L1085-1132 | `_safe_concat_images` 死代码 |
| P2-8 | opendataloader_parser.py L298 | 过滤逻辑死代码 |
| P2-9 | web_parser.py L295-326 | `__main__` 块死代码 |
| P2-10 | doc_parser.py L167-171 | `_parse_with_textract` 死代码 |
| P2-11 | doc_parser.py L95 | 重复 logger |
| P2-12 | markitdown_parser.py L32 | `MarkItDown()` 每次构造 |
| P2-13 | image_parser.py L22 | `ext` 变量未使用 |
| P2-14 | markdown_parser.py L171-188 | `_self_test` 死代码 |
| P2-15 | markdown_parser.py L404-413 | `_self_test` 死代码 |

### 8.4 LOW（P3，长期优化）

- pdf_parser.py 拆分为 6 个模块
- docx_parser.py 拆分为多个模块
- 跨文件 DRY 违规 8 处（mime_map 重复、logger 重复等）
- Makefile 完全过时（`build:` 调用 `go build -o bin/client ./src/client`，Python 项目无此目录）
- helm image.tag: latest（应使用具体版本）

---

## 9. 死代码清单

| 编号 | 文件 | 位置 | 死代码内容 | 处理 |
|------|------|------|-----------|------|
| D-01 | doc_parser.py | L9 | `import textract` | 删除 |
| D-02 | doc_parser.py | L167-171 | `_parse_with_textract` 方法 | 删除 |
| D-03 | docx_parser.py | L298 | `picture_cache` | 删除 |
| D-04 | docx_parser.py | L302-342 | `get_picture` 方法 | 删除 |
| D-05 | docx_parser.py | L1085-1132 | `_safe_concat_images` 方法 | 删除 |
| D-06 | opendataloader_parser.py | L298 | `mineru_endpoint`/`mineru_api_key` 过滤 | 删除 |
| D-07 | web_parser.py | L295-326 | `__main__` 块 | 删除 |
| D-08 | chain_parser.py | L173-179 | `__main__` 块 | 删除 |
| D-09 | markdown_parser.py | L171-188 | `_self_test` | 删除 |
| D-10 | markdown_parser.py | L404-413 | `_self_test` | 删除 |
| D-11 | config.py | L40-45 | `_mask_secret` 函数 | 删除 |
| D-12 | config.py | `mask_secrets` 参数 | `mask_secrets` 死参数 | 删除 |
| D-13 | main.py | L57-106 | `_resolve_images.storage_map` 参数 | 删除 |
| D-14 | main.py | L76-83, L111-118 | 两处相同 `mime_map` 字典 | 抽取为常量 |
| D-15 | proto/docreader.proto | L42 | `storage_key` 字段 | 保留字段，Python 端未赋值、Go 端透传未消费，可删除但需同时重新生成 Go pb.go/pb2.py 并移除 Go 端 ImageRefInfo.StorageKey 字段（client.go L31/106, grpc_parser.go L188/223, types/docparser.go L34, http_parser.go L45/178） |
| D-16 | registry.py | L2 | `Any` 导入 | 删除 |
| D-17 | image_parser.py | L22 | `ext` 变量 | 删除 |
| D-18 | pyproject.toml | L28 | `textract==1.5.0` 依赖 | 删除 |
| D-19 | pyproject.toml | - | `pypdf` 依赖（若存在） | pyproject.toml 中若存在 pypdf 依赖则删除（代码中仅使用 pypdfium2，无 pypdf 导入） |
| D-20 | - | - | pptx_media.py/xlsx_merge.py/xlsx_repair.py/excel_convert.py 中的 soffice 依赖 | **不可删除**，属于正常业务代码（doc/xls/ppt 格式转换必需） |

---

## 10. 测试覆盖矩阵

### 10.1 现有测试清单

**目录**：`docreader/tests/`

| 测试文件 | 覆盖目标 | 测试数量估算 | 状态 |
|---------|---------|------------|------|
| test_config.py | config.py | ~10 | 正常 |
| test_epub_parser.py | epub_parser.py | ~5 | 正常 |
| test_excel_parser.py | excel_parser.py | ~8 | 正常 |
| test_markdown_table_util.py | markdown_parser.py 表格 | ~10 | 正常 |
| test_mhtml_parser.py | mhtml_parser.py | ~5 | 正常 |
| test_opendataloader_parser.py | opendataloader_parser.py | ~5 | 正常 |
| test_parser_concurrency.py | concurrency.py | ~5 | 正常 |
| test_pdf_router.py | pdf_parser.py 路由 | ~5 | 正常 |
| test_ppt_convert.py | ppt_convert.py | ~5 | 正常 |
| test_ssrf.py | utils/ssrf.py | ~10 | 正常 |
| test_web_parser.py | web_parser.py | ~5 | 正常 |
| client_test.go | client/ | ~5 | 正常 |

### 10.2 测试覆盖缺口

| 缺口 | 严重程度 | 说明 |
|------|---------|------|
| chain_parser.py 无测试 | HIGH | PipelineParser bug 未被测试发现 |
| docx_parser.py 无测试 | HIGH | 1534 行核心 parser 无单元测试 |
| doc_parser.py 无测试 | MEDIUM | textract 死代码未被测试发现 |
| markitdown_parser.py 无测试 | MEDIUM | - |
| image_parser.py 无测试 | LOW | 27 行，简单 |
| markdown_parser.py 仅表格测试 | MEDIUM | _self_test 死代码未被测试 |
| main.py 无测试 | HIGH | gRPC 服务层无测试 |
| auth.py 无测试 | HIGH | 认证机制无测试 |
| registry.py 无测试 | MEDIUM | 注册表无测试 |
| endecode.py 无测试 | HIGH | 命名反转 bug 未被测试发现 |

### 10.3 覆盖率估算

- **整体覆盖率**：约 30-35%
- **有测试的模块**：epub/excel/mhtml/pdf_router/ppt_convert/ssrf/web_parser/concurrency/config/opendataloader
- **无测试的模块**：main/auth/registry/chain_parser/docx_parser/doc_parser/markitdown_parser/image_parser/markdown_parser（核心）/endecode

---

## 11. 架构合理性评估

### 11.1 优点（符合设计预期）

| 编号 | 优点 | 说明 |
|------|------|------|
| A-01 | 职责边界清晰 | docreader 只做"文件→markdown+图片"，OCR/VLM/Embedding/Chunking 全部由 Go App 处理 |
| A-02 | 引擎可插拔 | ParserEngineRegistry 支持动态注册引擎，新增引擎不影响现有代码 |
| A-03 | 流式优先 + 优雅降级 | ReadStream 优先，Unimplemented 时降级到 Read，向后兼容 |
| A-04 | 双层认证 | TLS + Bearer Token，灵活适配不同部署环境 |
| A-05 | gRPC 契约稳定 | proto 定义清晰，Go 客户端与 Python 服务端解耦 |
| A-06 | SSRF 防护意识 | 已有 utils/ssrf.py 模块（虽有 bug） |
| A-07 | 并发控制 | concurrency.py 限制并发解析数量 |

### 11.2 问题（偏离设计预期）

| 编号 | 问题 | 影响 |
|------|------|------|
| B-01 | 镜像体积失控 | 1.5-1.9GB，部署慢，资源浪费 |
| B-02 | 死依赖未清理 | textract/pypdf/libreoffice 等占用大量空间 |
| B-03 | 单文件过大 | pdf_parser.py 1548 行、docx_parser.py 1534 行，维护困难 |
| B-04 | 命名反转 bug | endecode.py 函数命名完全反转，调用方极易误用 |
| B-05 | 全局副作用 | `resolver.SetDefaultScheme` 污染所有 gRPC 连接 |
| B-06 | 内存安全 | PDF 处理用 MD5 + `pil.tobytes()`，大文件 OOM |
| B-07 | SSRF 防护不完整 | opendataloader_parser 绕过 ssrf.py |
| B-08 | 测试覆盖不足 | 核心 parser（docx/pdf/chain）无测试 |
| B-09 | 容器以 root 运行 | 安全风险 |
| B-10 | Makefile 完全过时 | 无法用于构建/运行 |

### 11.3 重构必要性结论

**结论：必须重构。**

理由：
1. 镜像体积 1.5-1.9GB 严重影响部署效率，可瘦身至 500-700MB
2. 多个 CRITICAL 安全/正确性问题（SSRF/内存/命名反转）必须修复
3. 死代码和死依赖拖累维护
4. 单文件过大（1500+ 行）阻碍协作
5. 测试覆盖不足，重构需先补测试

**重构方向**：以"轻量化 + 支持本地模型服务（MinerU/PaddleOCR）"为目标，分阶段实施，每阶段保证不破坏 14 项重构红线。

---

## 附录：评审文件清单

### Python 源码（docreader/）

| 文件 | 行数 | 评审状态 |
|------|------|---------|
| main.py | ~350 | ✅ 已评审 |
| auth.py | ~200 | ✅ 已评审 |
| config.py | ~160 | ✅ 已评审 |
| proto/docreader.proto | ~70 | ✅ 已评审 |
| parser/base_parser.py | ~50 | ✅ 已评审 |
| parser/chain_parser.py | ~180 | ✅ 已评审 |
| parser/concurrency.py | ~50 | ✅ 已评审 |
| parser/registry.py | ~180 | ✅ 已评审 |
| parser/parser.py | ~100 | ✅ 已评审 |
| parser/pdf_parser.py | 1548 | ✅ 已评审 |
| parser/docx_parser.py | 1534 | ✅ 已评审 |
| parser/opendataloader_parser.py | 360 | ✅ 已评审 |
| parser/web_parser.py | 326 | ✅ 已评审 |
| parser/doc_parser.py | 362 | ✅ 已评审 |
| parser/markitdown_parser.py | ~80 | ✅ 已评审 |
| parser/image_parser.py | 27 | ✅ 已评审 |
| parser/markdown_parser.py | 469 | ✅ 已评审 |
| parser/epub_parser.py | - | ✅ 已评审 |
| parser/excel_parser.py | - | ✅ 已评审 |
| parser/mhtml_parser.py | - | ✅ 已评审 |
| parser/docx2_parser.py | - | ✅ 已评审 |
| parser/ppt_convert.py | - | ✅ 已评审 |
| parser/xlsx_merge.py | - | ✅ 已评审 |
| parser/xlsx_repair.py | - | ✅ 已评审 |
| parser/pptx_media.py | - | ✅ 已评审 |
| parser/excel_convert.py | - | ✅ 已评审 |
| utils/ssrf.py | ~250 | ✅ 已评审 |
| utils/endecode.py | ~100 | ✅ 已评审 |
| utils/request.py | - | ✅ 已评审 |
| utils/tempfile.py | - | ✅ 已评审 |
| utils/split.py | - | ✅ 已评审 |
| models/document.py | - | ✅ 已评审 |
| models/read_config.py | - | ✅ 已评审 |
| Makefile | - | ✅ 已评审 |
| pyproject.toml | 30 | ✅ 已评审 |

### Go 源码

| 文件 | 行数 | 评审状态 |
|------|------|---------|
| docreader/client/client.go | 110 | ✅ 已评审 |
| docreader/client/auth.go | 134 | ✅ 已评审 |
| docreader/client/client_test.go | - | ✅ 已评审 |
| docreader/proto/docreader.pb.go | - | 生成文件，未评审 |
| docreader/proto/docreader_grpc.pb.go | - | 生成文件，未评审 |
| internal/infrastructure/docparser/grpc_parser.go | 255 | ✅ 已评审 |
| internal/application/service/knowledge_process.go | - | ✅ 已评审（关键段落） |
| internal/handler/system.go | - | ✅ 已评审（关键段落） |

### 部署配置

| 文件 | 评审状态 |
|------|---------|
| docker/Dockerfile.docreader | ✅ 已评审 |
| docreader/pyproject.toml | ✅ 已评审 |
| docreader/uv.lock | 未评审（自动生成） |

### 测试代码

| 文件 | 评审状态 |
|------|---------|
| docreader/tests/*.py（11 个文件） | ✅ 已评审 |
| docreader/client/client_test.go | ✅ 已评审 |

---

**文档结束。**
