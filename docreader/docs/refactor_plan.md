# docreader 模块重构计划

> 文档目的：基于 [code_review_analysis.md](./code_review_analysis.md) 的评审结果，制定可执行的分阶段重构计划，明确修改逻辑和验收标准。
>
> 重构目标：**轻量化 + 支持本地模型服务（MinerU/PaddleOCR）为主**，保证不影响其他模块、不影响产品使用、不影响其他交互。
>
> 生成日期：2026-07-04

---

## 目录

1. [重构总原则](#1-重构总原则)
2. [重构红线（绝对不可破坏）](#2-重构红线绝对不可破坏)
3. [分阶段实施计划概览](#3-分阶段实施计划概览)
4. [Phase 0：测试基线建立](#phase-0测试基线建立)
5. [Phase 1：P0 紧急安全/正确性修复](#phase-1p0-紧急安全正确性修复)
6. [Phase 2：死代码和死依赖清理](#phase-2死代码和死依赖清理)
7. [Phase 3：镜像瘦身（sidecar 拆分）](#phase-3镜像瘦身sidecar-拆分)
8. [Phase 4：本地模型服务接入与 Go 端路由优化](#phase-4本地模型服务接入与-go-端路由优化)
9. [Phase 5：大文件拆分和代码质量提升](#phase-5大文件拆分和代码质量提升)
10. [Phase 6：测试覆盖率提升](#phase-6测试覆盖率提升)
11. [风险与回滚策略](#7-风险与回滚策略)
12. [验收检查表（汇总）](#8-验收检查表汇总)

---

## 1. 重构总原则

| 编号 | 原则 | 说明 |
|------|------|------|
| P-01 | **不破坏重构红线** | 14 项契约（见第 2 节）必须保持向后兼容 |
| P-02 | **小步快走，每步可回滚** | 每个 Phase 独立可交付、可回滚，禁止多个 Phase 混合提交 |
| P-03 | **测试先行** | 重构前先补测试（Phase 0），重构中持续运行测试 |
| P-04 | **不引入新依赖** | 全部 Phase 不新增 Python 依赖（MinerU/PaddleOCR 由 Go 端 HTTP 调用，不需要 Python SDK） |
| P-05 | **保持 gRPC 契约稳定** | proto 文件除删除死字段外，不修改任何字段名/类型/方法签名 |
| P-06 | **Go 端零改动** | Phase 1-6 不修改 Go 端调用方代码（除 P0-5/P0-6/P0-7 三项明确修复） |
| P-07 | **容器化兼容** | 重构后容器仍可通过 docker-compose 编排，端口/环境变量/健康检查不变 |
| P-08 | **可观测性不降级** | 日志/健康检查/错误信息不得弱化 |
| P-09 | **优先删除而非新增** | 能通过删除死代码/死依赖解决的问题，不新增抽象 |
| P-10 | **文档同步** | 每个 Phase 完成后更新 [code_review_analysis.md](./code_review_analysis.md) 状态 |

---

## 2. 重构红线（绝对不可破坏）

> 详见 [code_review_analysis.md 第 4.3 节](./code_review_analysis.md#43-14-项重构红线清单绝对不可破坏)

| 编号 | 红线 | 验证方式 |
|------|------|---------|
| R-01 | gRPC 端口 50051 | docker-compose.yml + 容器 EXPOSE |
| R-02 | proto 服务名 `DocReader` | proto 文件 diff |
| R-03 | 3 个 RPC 方法签名 | proto 文件 diff + Go 客户端编译 |
| R-04 | ReadRequest 字段 | proto 文件 diff |
| R-05 | ReadResponse.document 字段 | proto 文件 diff |
| R-06 | ReadStream 降级逻辑 | grpc_parser.go L131-146 行不变 + 集成测试 |
| R-07 | resolveDocReader 7 种引擎分支 | knowledge_process.go L3261-3295 行不变 + 单元测试 |
| R-08 | ListEngines 返回格式 | proto 文件 diff + 集成测试 |
| R-09 | Bearer Token 认证机制 | auth.py + auth.go metadata 格式 |
| R-10 | RequireTransportSecurity 守卫 | auth.go L132-134 行不变 + 单元测试 |
| R-11 | GRPC_AUTH_TOKEN 环境变量 | config.py 环境变量名 |
| R-12 | GRPC_TLS_* 环境变量 | config.py 环境变量名 |
| R-13 | 健康检查 grpc_health_probe | Dockerfile + 容器内 /bin/grpc_health_probe |
| R-14 | ImageRef 数据结构 | proto 文件 diff（storage_key 可删除） |

**红线验证：每个 Phase 完成后必须执行 [第 8 节验收检查表](#8-验收检查表汇总) 的红线检查项。**

---

## 3. 分阶段实施计划概览

```
Phase 0：测试基线建立（不改业务代码）
   ↓
Phase 1：P0 紧急安全/正确性修复（15 项 CRITICAL）
   ↓
Phase 2：死代码和死依赖清理（19 项死代码 + 3 项死依赖）
   ↓
Phase 3：镜像瘦身（sidecar 拆分，目标 1.5GB → 700MB）
   ↓
Phase 4：本地模型服务接入与 Go 端路由优化（Python 零改动）
   ↓
Phase 5：大文件拆分和代码质量提升（pdf_parser.py 1548→6 模块）
   ↓
Phase 6：测试覆盖率提升（30% → 70%）
```

| Phase | 目标 | 风险 | 可回滚性 |
|-------|------|------|---------|
| Phase 0 | 建立测试基线，覆盖率 30% → 45% | 低（仅新增测试） | 高（删除测试文件即可） |
| Phase 1 | 修复 15 项 P0 安全/正确性问题 | 中（修改核心逻辑） | 中（每项独立提交） |
| Phase 2 | 清理 19 项死代码 + 3 项死依赖 | 低（删除无引用代码） | 高（git revert） |
| Phase 3 | 镜像从 1.5GB 瘦身到 700MB | 高（拆分容器） | 中（保留旧镜像） |
| Phase 4 | Go 端路由优化 + 配置文档 | 低（仅 Go 端小改） | 高（Python 零改动） |
| Phase 5 | 拆分大文件 | 中（结构调整） | 中（保留旧文件路径） |
| Phase 6 | 测试覆盖率 45% → 70% | 低（仅新增测试） | 高 |

---

## Phase 0：测试基线建立

### 0.1 目标

在重构前建立测试基线，确保后续重构有测试护栏。**本阶段不修改任何业务代码。**

### 0.2 修改逻辑

#### 0.2.1 新增测试文件

| 测试文件 | 覆盖目标 | 测试要点 |
|---------|---------|---------|
| `tests/test_endecode.py` | utils/endecode.py | 验证 encode/decode 正确性（**先记录当前命名反转行为**） |
| `tests/test_chain_parser.py` | parser/chain_parser.py | 验证 FirstParser 尝试链 + PipelineParser 流水链（**先记录当前 bug 行为**） |
| `tests/test_registry.py` | parser/registry.py | 验证引擎注册/查询/列表 |
| `tests/test_auth.py` | auth.py | 验证 TLS 开关 + Token 校验 + metadata 大小写 |
| `tests/test_main_servicer.py` | main.py DocReaderServicer | 验证 3 个 RPC 方法（mock parser） |
| `tests/test_docx_parser.py` | parser/docx_parser.py | 验证 DOCX 解析 + 表格 + 图片 |
| `tests/test_doc_parser.py` | parser/doc_parser.py | 验证 DOC 解析（**先记录 textract 死代码行为**） |
| `tests/test_markitdown_parser.py` | parser/markitdown_parser.py | 验证 markitdown 引擎 |
| `tests/test_markdown_parser_full.py` | parser/markdown_parser.py | 验证非表格部分（**先记录 _self_test 死代码**） |

#### 0.2.2 测试策略

- **characterization tests（特征测试）**：对当前行为（包括 bug）写测试，锁定现状。后续修复 bug 时再修改测试预期。
- **不修改被测代码**：本阶段只写测试，不改业务代码。
- **mock 外部依赖**：playwright/urllib/grpc 等外部依赖全部 mock。

### 0.3 验收标准

| 编号 | 验收项 | 验证方式 |
|------|--------|---------|
| A0-01 | 新增 9 个测试文件 | `ls docreader/tests/test_*.py` |
| A0-02 | 测试覆盖率 ≥ 45% | `pytest --cov=docreader --cov-report=term` |
| A0-03 | 所有测试通过 | `cd docreader && pytest` 退出码 0 |
| A0-04 | 业务代码零改动 | `git diff --stat docreader/main.py docreader/auth.py docreader/parser/*.py docreader/utils/*.py` 仅新增测试文件 |
| A0-05 | 红线 R-01 ~ R-14 全部通过 | 执行第 8 节红线检查 |

### 0.4 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 测试发现新 bug | 高 | 低（记录即可） | 在测试注释中标记 `# TODO: bug P0-XX, fix in Phase 1` |
| mock 困难 | 中 | 中 | 优先 mock 边界，不 mock 内部 |

---

## Phase 1：P0 紧急安全/正确性修复

### 1.1 目标

修复 15 项 CRITICAL（P0）安全/正确性问题。**每项独立提交，便于回滚。**

### 1.2 修改逻辑（按提交顺序）

#### 提交 1.1：认证 fail-fast（P0-1, P0-2, P1-4）

**文件**：`docreader/auth.py` + `docreader/main.py`

```python
# auth.py 修改逻辑
def validate_auth_config(config):
    """启动时校验认证配置，fail-fast"""
    # P0-1: TLS 关闭且 token 空 → 强制要求显式配置 DOCREADER_ALLOW_INSECURE=true
    if not config.tls_enabled and not config.auth_token:
        env = os.environ.get("DOCREADER_ALLOW_INSECURE", "").lower()
        if env not in ("true", "1", "yes"):
            raise SystemExit(
                "FATAL: docreader 启动时未启用 TLS 且未配置 GRPC_AUTH_TOKEN。"
                "生产环境必须配置其中至少一项。"
                "如需在可信网络内明文运行，请显式设置 DOCREADER_ALLOW_INSECURE=true。"
            )
    # P0-2: token 非空但 < 16 字节 → fail-fast
    if config.auth_token and len(config.auth_token) < 16:
        raise SystemExit(
            "FATAL: GRPC_AUTH_TOKEN 长度 < 16 字节，存在暴力破解风险。"
            "请使用至少 16 字节的随机 token。"
        )
    # P1-4: TLS 配置错误 → exit
    if config.tls_enabled:
        if not config.tls_cert_file or not config.tls_key_file:
            raise SystemExit("FATAL: TLS 开启但未配置证书/私钥路径")
        if not os.path.exists(config.tls_cert_file):
            raise SystemExit(f"FATAL: TLS 证书文件不存在: {config.tls_cert_file}")
        if not os.path.exists(config.tls_key_file):
            raise SystemExit(f"FATAL: TLS 私钥文件不存在: {config.tls_key_file}")
```

```python
# main.py 修改逻辑（L319-323 附近）
def serve():
    config = load_config()
    validate_auth_config(config)  # 新增 fail-fast 校验
    # ... 原有启动逻辑
```

**metadata 大小写修复（P1-2）**：
```python
# auth.py L187 附近
# 修改前：metadata 键大小写敏感
# 修改后：使用 lowercase，并兼容旧客户端
def _extract_token(metadata):
    for key, value in metadata:
        if key.lower() == "authorization":
            return value.replace("Bearer ", "", 1)
    return None
```

#### 提交 1.2：endecode 命名反转修复（P0-15）

**文件**：`docreader/utils/endecode.py` + 3 个调用方文件

**不保留 deprecated alias**：函数名反转的根因是名称与行为相反，保留旧名会让调用方继续混淆。Phase 0 特征测试已锁定所有调用点，Phase 1 一次性重命名并修正所有调用方。

**受影响的调用点清单（经代码核实，共 6 处调用 + 4 处导入）**：

| 编号 | 文件 | 行号 | 当前调用 | 期望语义 | 修改后调用 |
|------|------|------|---------|---------|----------|
| C-01 | docx_parser.py | L47 | `from docreader.utils import endecode` | 导入 | 不变 |
| C-02 | docx_parser.py | L175 | `endecode.decode_image(image_data.object)` | bytes→base64（encode） | `endecode.encode_image_to_base64(image_data.object)` |
| C-03 | markdown_parser.py | L24 | `from docreader.utils import endecode` | 导入 | 不变 |
| C-04 | markdown_parser.py | L221 | `endecode.decode_bytes(content)` | bytes→str（正确） | 不变 |
| C-05 | markdown_parser.py | L340 | `endecode.encode_image(img_b64, errors="ignore")` | base64→bytes（decode） | `endecode.decode_image_from_base64(img_b64, errors="ignore")` |
| C-06 | markdown_parser.py | L429 | `endecode.decode_bytes(content)` | bytes→str（正确） | 不变 |
| C-07 | web_parser.py | L16 | `from docreader.utils import endecode` | 导入 | 不变 |
| C-08 | web_parser.py | L237 | `endecode.decode_bytes(content)` | bytes→str（正确） | 不变 |
| C-09 | chain_parser.py | L14 | `from docreader.utils import endecode` | 导入 | 不变 |
| C-10 | chain_parser.py | L144 | `endecode.encode_bytes(document.content)` | str→bytes（正确） | 不变 |

> `encode_bytes`/`decode_bytes` 命名与行为一致，无需修改。仅 `decode_image`/`encode_image` 两个函数需要重命名。

```python
# endecode.py 修改逻辑（一次性重命名，不保留 alias）

# 修改前（L23）：
#   def decode_image(image) -> str:   # 实际是 encode: bytes/PIL → base64
# 修改后：
def encode_image_to_base64(image: Union[str, bytes, Image.Image, np.ndarray]) -> str:
    """Convert image to base64 encoded string.

    原函数名 decode_image 与实际行为相反，已修正为 encode_image_to_base64。
    行为不变：bytes/PIL/ndarray/路径 → base64 字符串。
    """
    # 原 decode_image 函数体（L23-75），不改逻辑只改函数名
    ...

# 修改前（L78）：
#   def encode_image(image: str, errors="strict") -> bytes:  # 实际是 decode: base64 → bytes
# 修改后：
def decode_image_from_base64(image: str, errors="strict") -> bytes:
    """Decode a base64 encoded image string back to bytes.

    原函数名 encode_image 与实际行为相反，已修正为 decode_image_from_base64。
    行为不变：base64 字符串 → bytes。
    """
    # 原 encode_image 函数体（L78-112），不改逻辑只改函数名
    ...
```

```python
# 调用方修改 1：docx_parser.py L175
# 修改前：
#   image_parts[image_data.url] = endecode.decode_image(image_data.object)
# 修改后：
image_parts[image_data.url] = endecode.encode_image_to_base64(image_data.object)

# 调用方修改 2：markdown_parser.py L340
# 修改前：
#   image_byte = endecode.encode_image(img_b64, errors="ignore")
# 修改后：
image_byte = endecode.decode_image_from_base64(img_b64, errors="ignore")
```

**验证**：
```bash
# 确认无残留旧名调用
grep -rn "endecode\.decode_image\b\|endecode\.encode_image\b" docreader/ | grep -v "encode_image_to_base64\|decode_image_from_base64"
# 预期输出：空（无残留）
```

#### 提交 1.3：删除 textract 死代码（P0-12）

**文件**：`docreader/parser/doc_parser.py` + `docreader/pyproject.toml`

```python
# doc_parser.py 修改
# 删除 L9: import textract
# 删除 L167-171: _parse_with_textract 方法
# 删除 L95 重复 logger（如果存在）
```

```toml
# pyproject.toml 修改
# 删除 L28: "textract==1.5.0",
```

#### 提交 1.4：SSRF 防护补全（P0-9, P0-10, P0-11, P0-14）

**文件**：`docreader/parser/opendataloader_parser.py` + `docreader/parser/web_parser.py` + `docreader/utils/ssrf.py`

```python
# opendataloader_parser.py 修改
# P0-9: L82 urllib.request.urlopen → 使用 ssrf 校验
from docreader.utils.ssrf import safe_urlopen

def _download(self, url: str) -> bytes:
    return safe_urlopen(url, timeout=30)  # 新增 SSRF 校验

# P0-10: L288 hybrid_url → 使用 ssrf 校验
def _fetch_hybrid(self, url: str) -> dict:
    safe_url = validate_url(url)  # 新增 SSRF 校验
    # ...
```

```python
# web_parser.py 修改
# P0-11: L174 DNS rebinding → 在 page.route 中重新校验 IP
async def _handle_route(self, route, request):
    url = request.url
    # 重新解析 DNS 并校验 IP
    ip = socket.gethostbyname(urlparse(url).hostname)
    if is_private_ip(ip):
        route.abort()
        return
    route.continue_()
```

```python
# utils/ssrf.py 修改
# P0-14: TOCTOU 修复 → 校验后 pin IP
def safe_urlopen(url: str, timeout: int = 30) -> bytes:
    """校验 URL 后立即 pin IP，防止 DNS rebinding"""
    parsed = urlparse(url)
    # 1. 解析 DNS
    ip = socket.gethostbyname(parsed.hostname)
    # 2. 校验 IP
    if is_private_ip(ip) or is_metadata_ip(ip):
        raise SSRFError(f"Blocked SSRF: {url} -> {ip}")
    # 3. pin IP，使用 IP 而非 hostname 请求（Host 头保留 hostname）
    safe_url = url.replace(parsed.hostname, ip)
    headers = {"Host": parsed.hostname}
    # 4. 禁止重定向（重定向需重新校验）
    opener = urllib.request.build_opener(NoRedirectHandler)
    return opener.open(safe_url, timeout=timeout, headers=headers).read()
```

#### 提交 1.5：PDF 内存安全（P0-4）

**文件**：`docreader/parser/pdf_parser.py`

```python
# pdf_parser.py L1211 附近修改
# 当前：MD5 hash + pil.tobytes() 内存爆炸
# 修复：sha256 + 流式处理 + 内存上限

import hashlib
from docreader.config import CONFIG

def _image_hash(self, image_data: bytes) -> str:
    """计算图片哈希，使用 sha256 替代 MD5"""
    return hashlib.sha256(image_data).hexdigest()

def _process_image_safe(self, image) -> bytes:
    """流式处理图片，限制单图最大 50MB"""
    MAX_IMAGE_SIZE = CONFIG.max_image_size_mb * 1024 * 1024  # 默认 50MB
    # 使用文件暂存而非 tobytes()
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        image.save(f.name, format="PNG")
        if os.path.getsize(f.name) > MAX_IMAGE_SIZE:
            # 降级：缩放图片
            image.thumbnail((1920, 1080))
            image.save(f.name, format="PNG")
        return f.read()
```

#### 提交 1.6：docx_parser Manager 异常修复（P0-8）

**文件**：`docreader/parser/docx_parser.py` L776

```python
# 修改前：Manager 跨进程 pickle PIL Image（会抛异常）
# 修改后：使用共享文件路径而非 pickle

class ImageWorker:
    def __init__(self, shared_dir: str):
        self.shared_dir = shared_dir  # 共享临时目录

    def process_image(self, image_ref) -> str:
        """返回文件路径而非 Image 对象"""
        path = os.path.join(self.shared_dir, f"{image_ref.name}.png")
        image_ref.image.save(path)  # 在子进程保存到共享目录
        return path  # 返回路径（可序列化）
```

#### 提交 1.7：ChainParser PipelineParser 修复（P0-3）

**文件**：`docreader/parser/chain_parser.py` L138-150

```python
# 修改前：将 markdown 编码为 bytes 传给下游 parser（错误）
# 修改后：传递原始 bytes，下游 parser 解析后合并 markdown

class PipelineParser(BaseParser):
    def parse(self, content: bytes, **kwargs) -> Document:
        original_content = content
        accumulated_md = []
        all_images = []
        for parser in self.parsers:
            document = parser.parse(original_content, **kwargs)  # 始终传原始 bytes
            accumulated_md.append(document.content)
            all_images.extend(document.images)
        return Document(
            content="\n\n".join(accumulated_md),
            images=all_images
        )
```

#### 提交 1.8：Go 端全局副作用修复（P0-5, P0-6, P0-7）

**文件**：`docreader/client/client.go` + `internal/infrastructure/docparser/grpc_parser.go` + `internal/application/service/knowledge_process.go`

```go
// client.go L61 修改
// 修改前：resolver.SetDefaultScheme("dns")  // 全局副作用
// 修改后：使用 WithResolvers
import "google.golang.org/grpc/resolver"

func newClient(target string) *grpc.ClientConn {
    // 不再调用 SetDefaultScheme
    conn, err := grpc.Dial(target,
        grpc.WithDefaultServiceConfig(...),
        grpc.WithResolvers(dns.NewResolver()),  // 显式指定 resolver
        // P1-6: 不使用 WithBlock（已弃用），改用 DialContext + 超时
        // ...
    )
    // ...
}
```

```go
// grpc_parser.go L65 修改
// 同样移除 resolver.SetDefaultScheme("dns")

// grpc_parser.go L80-91 Reconnect 回滚修复（P1-7）
func (g *GRPCDocumentReader) Reconnect() error {
    g.mu.Lock()
    defer g.mu.Unlock()
    oldConn := g.conn
    // 1. 先建立新连接
    newConn, err := g.dial()
    if err != nil {
        return err  // 旧连接保持不变
    }
    // 2. 新连接就绪后再关闭旧连接
    g.conn = newConn
    if oldConn != nil {
        oldConn.Close()
    }
    return nil
}
```

```go
// knowledge_process.go L3217 修改
// 修改前：30 * time.Minute
// 修改后：可配置，默认 5 分钟
timeout := g.config.DocReaderTimeout
if timeout == 0 {
    timeout = 5 * time.Minute
}
ctx, cancel := context.WithTimeout(ctx, timeout)
defer cancel()
```

#### 提交 1.9：Dockerfile 安全（P0-13）

**文件**：`docker/Dockerfile.docreader`

```dockerfile
# 在 CMD 之前添加
RUN groupadd -r docreader && useradd -r -g docreader -u 65532 docreader
USER 65532:65532
```

### 1.3 验收标准

| 编号 | 验收项 | 验证方式 |
|------|--------|---------|
| A1-01 | auth.py 启动时 fail-fast：TLS 关闭 + token 空 → exit | `DOCREADER_ALLOW_INSECURE= docker-compose up` 退出码非 0 |
| A1-02 | auth.py 启动时 fail-fast：token < 16B → exit | `GRPC_AUTH_TOKEN=short docker-compose up` 退出码非 0 |
| A1-03 | endecode.py 函数命名正确：encode_image=编码, decode_image=解码 | `pytest tests/test_endecode.py` 通过 |
| A1-04 | doc_parser.py 无 `import textract` | `grep textract docreader/parser/doc_parser.py` 无输出 |
| A1-05 | pyproject.toml 无 textract 依赖 | `grep textract docreader/pyproject.toml` 无输出 |
| A1-06 | opendataloader_parser.py 所有 URL 经 SSRF 校验 | `pytest tests/test_opendataloader_parser.py` + 新增 SSRF 测试通过 |
| A1-07 | web_parser.py 无 DNS rebinding | `pytest tests/test_web_parser.py` + 新增 DNS rebinding 测试通过 |
| A1-08 | pdf_parser.py 无 MD5 + 无 `pil.tobytes()` 直接调用 | `grep -n "md5\|tobytes" docreader/parser/pdf_parser.py` 仅在受控位置 |
| A1-09 | docx_parser.py Manager 不 pickle PIL Image | `pytest tests/test_docx_parser.py` 大文件测试通过 |
| A1-10 | chain_parser.py PipelineParser 传递原始 bytes | `pytest tests/test_chain_parser.py` PipelineParser 测试通过 |
| A1-11 | client.go 无 `SetDefaultScheme` | `grep SetDefaultScheme docreader/client/client.go` 无输出 |
| A1-12 | grpc_parser.go 无 `SetDefaultScheme` | `grep SetDefaultScheme internal/infrastructure/docparser/grpc_parser.go` 无输出 |
| A1-13 | knowledge_process.go 默认超时 ≤ 5 分钟 | `grep -A2 "DocReaderTimeout\|time.Minute" internal/application/service/knowledge_process.go` |
| A1-14 | Dockerfile 含 `USER 65532:65532` | `grep "^USER" docker/Dockerfile.docreader` 输出 `USER 65532:65532` |
| A1-15 | 所有测试通过 | `cd docreader && pytest` 退出码 0 |
| A1-16 | Go 端编译通过 | `go build ./...` 退出码 0 |
| A1-17 | 红线 R-01 ~ R-14 全部通过 | 执行第 8 节红线检查 |
| A1-18 | 集成测试：4 个调用场景功能正常 | 知识库导入 + 聊天附件 + 系统管理 + 启动检测 |

### 1.4 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| fail-fast 导致现有部署启动失败 | 中 | 高 | 提供 `DOCREADER_ALLOW_INSECURE=true` 逃生阀 |
| endecode 重命名导致调用方误用 | 中 | 中 | Phase 0 特征测试锁定行为；保留 deprecated alias |
| SSRF 校验误杀合法 URL | 中 | 中 | 提供 allowlist 配置项 |
| Go 端改动引入编译错误 | 低 | 高 | 每项独立提交 + CI 编译检查 |
| Dockerfile USER 导致文件权限问题 | 中 | 中 | 提前 `chown` 共享目录 |

**回滚策略**：每项 P0 修复独立提交，回滚时 `git revert <commit>` 即可。

---

## Phase 2：死代码和死依赖清理

### 2.1 目标

清理 19 项死代码 + 3 项死依赖，减少维护负担，为 Phase 3 镜像瘦身铺路。

### 2.2 修改逻辑

#### 2.2.1 死代码删除清单

| 编号 | 文件 | 删除内容 | 验证方式 |
|------|------|---------|---------|
| D-01 | doc_parser.py L9 | `import textract` | grep 无输出（Phase 1 已删除） |
| D-02 | doc_parser.py L167-171 | `_parse_with_textract` 方法 | grep 无输出 |
| D-03 | docx_parser.py L298 | `picture_cache` | grep 无输出 |
| D-04 | docx_parser.py L302-342 | `get_picture` 方法 | grep 无输出 |
| D-05 | docx_parser.py L1085-1132 | `_safe_concat_images` 方法 | grep 无输出 |
| D-06 | opendataloader_parser.py L298 | `mineru_endpoint`/`mineru_api_key` 过滤 | grep 无输出 |
| D-07 | web_parser.py L295-326 | `__main__` 块 | grep 无输出 |
| D-08 | chain_parser.py L173-179 | `__main__` 块 | grep 无输出 |
| D-09 | markdown_parser.py L171-188 | `_self_test` | grep 无输出 |
| D-10 | markdown_parser.py L404-413 | `_self_test` | grep 无输出 |
| D-11 | config.py L40-45 | `_mask_secret` 函数 | grep 无输出 |
| D-12 | config.py | `mask_secrets` 参数 | grep 无输出 |
| D-13 | main.py L57-106 | `_resolve_images` 的 `storage_map` 参数 | 函数签名无 storage_map |
| D-14 | main.py L76-83, L111-118 | 重复 `mime_map` 字典 | 抽取为模块级常量 `MIME_MAP` |
| D-15 | proto/docreader.proto L42 | `storage_key` 字段 | proto 文件无此字段 |
| D-16 | registry.py L2 | `Any` 导入 | grep 无输出 |
| D-17 | image_parser.py L22 | `ext` 变量 | grep 无输出 |
| D-18 | pyproject.toml L28 | `textract==1.5.0` | grep 无输出（Phase 1 已删除） |
| D-19 | pyproject.toml | - | `pypdf` 依赖（已确认无引用，实际使用 pypdfium2） | grep 无输出（代码中仅使用 pypdfium2，无 pypdf 导入） |

#### 2.2.2 pypdf 引用确认

```bash
# 已确认：代码中无 pypdf 导入，实际使用 pypdfium2
# grep -rn "import pypdf\|from pypdf" docreader/ → 零匹配
# 可直接删除 pyproject.toml 中的 pypdf 依赖（若存在）
```

#### 2.2.3 proto storage_key 删除（D-15）

**注意**：proto 字段删除需谨慎，确保 Go 端不引用。

```bash
# 确认 Go 端不引用 storage_key
grep -rn "storage_key\|StorageKey" internal/ docreader/client/
# 若无引用，删除 proto 字段 + 重新生成 pb.go / pb2.py
```

### 2.3 验收标准

| 编号 | 验收项 | 验证方式 |
|------|--------|---------|
| A2-01 | 19 项死代码全部删除 | 第 8 节死代码检查脚本输出 0 |
| A2-02 | pyproject.toml 无 textract、无 pypdf（若确认无引用） | grep 无输出 |
| A2-03 | 所有测试通过 | `cd docreader && pytest` 退出码 0 |
| A2-04 | Go 端编译通过 | `go build ./...` 退出码 0 |
| A2-05 | proto 重新生成无 diff | `make proto` 后 `git diff` 无变化（除 storage_key 删除） |
| A2-06 | 红线 R-01 ~ R-14 全部通过 | 执行第 8 节红线检查 |
| A2-07 | 集成测试：4 个调用场景功能正常 | 知识库导入 + 聊天附件 + 系统管理 + 启动检测 |

### 2.4 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 删除 pypdf 导致隐式依赖断裂 | 低 | 中 | grep 全局确认 + 测试 |
| 删除 storage_key 导致 Go 端编译失败 | 低 | 高 | 先 grep Go 端引用，确认无引用再删除 |
| 删除 _self_test 导致测试依赖断裂 | 低 | 低 | grep 测试文件 |

**回滚策略**：`git revert <commit>`。

---

## Phase 3：镜像瘦身（sidecar 拆分）

### 3.1 目标

将主镜像从 1.5-1.9 GB 瘦身到 ≤ 700 MB（目标 500 MB），通过拆分重型依赖为独立 sidecar 容器。

### 3.2 修改逻辑

#### 3.2.1 主镜像瘦身（低风险项）

**文件**：`docker/Dockerfile.docreader` + `docreader/pyproject.toml`

```dockerfile
# Dockerfile.docreader 修改
# 1. base image 换 slim
FROM python:3.10.18-slim-bookworm AS builder  # 原 bookworm → slim
# ...

# 2. runner 阶段移除 libreoffice / openjdk-17 / playwright
# 原 apt install libreoffice openjdk-17-jre-headless → 删除
# 原 python -m playwright install webkit → 删除（迁移到 sidecar）

# 3. 添加非 root 用户（Phase 1 已添加）
USER 65532:65532
```

```toml
# pyproject.toml 修改
# 删除 textract（Phase 1 已删）
# 删除 pypdf（Phase 2 已删）
# 注：pandas 被 excel_parser.py/excel_convert.py 实际使用，不能删除
# 删除 playwright（迁移到 sidecar）
# 评估删除 markitdown（若使用率低）
dependencies = [
    "beautifulsoup4>=4.14.2",
    "ebooklib>=0.18",
    "grpcio>=1.78.0",
    "grpcio-health-checking>=1.78.0",
    "grpcio-tools>=1.78.0",
    "lxml>=6.1.0",
    "markdownify>=0.13.1",
    "openpyxl>=3.1.0",       # 已有
    "pandas>=2.0.0",         # 保留：excel_parser/excel_convert 实际使用
    "xlrd>=2.0.0",
    "pillow>=12.0.0",
    "protobuf>=6.33.0",
    "pydantic>=2.13.4",
    "pypdfium2>=5.8.0",      # PDF 文本提取
    "python-docx>=1.2.0",
    "requests>=2.32.5",
    "trafilatura>=2.0.0",    # HTML 提取（替代 playwright 轻量场景）
    # markitdown 评估后决定
    # opendataloader-pdf 评估后决定（若保留则 JRE 不拆）
]
```

#### 3.2.2 LibreOffice sidecar（可选，低优先级）

**新增**：`docker/Dockerfile.docreader-libreoffice`

```dockerfile
# 独立的 LibreOffice sidecar，仅处理 .doc 格式
FROM linuxserver/libreoffice:latest
# 通过 HTTP API 暴露 doc→pdf 转换
# docreader 主服务通过 HTTP 调用此 sidecar
```

**修改**：`docreader/parser/doc_parser.py`

```python
# 修改前：依赖本地 libreoffice
# 修改后：通过 HTTP 调用 sidecar
import requests

class DocParser(BaseParser):
    LIBREOFFICE_SIDECAR_URL = os.environ.get("LIBREOFFICE_SIDECAR_URL", "http://localhost:8300")

    def parse(self, content: bytes, **kwargs) -> Document:
        # 1. 上传 .doc 到 sidecar
        # 2. sidecar 返回 .pdf
        # 3. 用 PDFParser 解析 .pdf
        # ...
```

#### 3.2.3 Playwright sidecar（中等优先级）

**新增**：`docker/Dockerfile.docreader-playwright`

```dockerfile
# 独立的 Playwright sidecar，仅处理网页解析
FROM mcr.microsoft.com/playwright:v1.55.0-jammy
# 通过 HTTP API 暴露 page.render
COPY docreader/scripts/playwright_sidecar.py /app/
CMD ["python", "/app/playwright_sidecar.py"]
```

**新增**：`docreader/scripts/playwright_sidecar.py`（轻量 HTTP 服务）

**修改**：`docreader/parser/web_parser.py`

```python
# 修改前：本地启动 playwright
# 修改后：通过 HTTP 调用 sidecar
class WebParser(BaseParser):
    PLAYWRIGHT_SIDECAR_URL = os.environ.get("PLAYWRIGHT_SIDECAR_URL", "http://localhost:8301")

    def parse(self, url: str, **kwargs) -> Document:
        # 1. POST url 到 sidecar
        # 2. sidecar 返回渲染后的 HTML
        # 3. 用 trafilatura 提取正文
        # ...
```

#### 3.2.4 OpenDataLoader/JRE sidecar（高优先级，opendataloader 重型）

**评估**：若 opendataloader 引擎使用率低，直接降级为"按需启用"，默认不打包 JRE。

```dockerfile
# 评估方案 A：删除 opendataloader 引擎（若使用率 < 5%）
# 评估方案 B：保留但拆 sidecar
```

### 3.3 验收标准

| 编号 | 验收项 | 验证方式 |
|------|--------|---------|
| A3-01 | 主镜像 ≤ 700 MB | `docker images weknora-docreader` SIZE 列 |
| A3-02 | 主镜像无 libreoffice | `docker run --rm weknora-docreader dpkg -l \| grep libreoffice` 无输出 |
| A3-03 | 主镜像无 openjdk | `docker run --rm weknora-docreader java -version` 失败 |
| A3-04 | 主镜像无 playwright webkit | `docker run --rm weknora-docreader python -c "import playwright"` 失败（或 sidecar 化） |
| A3-05 | 主镜像以非 root 运行 | `docker run --rm weknora-docreader id` 输出 uid=65532 |
| A3-06 | PDF/DOCX/XLSX/HTML/EPUB/Markdown/Image 解析功能正常 | 集成测试 7 种文件类型 |
| A3-07 | .doc 解析（若 sidecar 化）正常 | 集成测试 .doc 文件 |
| A3-08 | 网页解析（若 sidecar 化）正常 | 集成测试 URL 解析 |
| A3-09 | 所有单元测试通过 | `cd docreader && pytest` 退出码 0 |
| A3-10 | 红线 R-01 ~ R-14 全部通过 | 执行第 8 节红线检查 |
| A3-11 | docker-compose up 正常启动 | 所有容器 healthy |
| A3-12 | 集成测试：4 个调用场景功能正常 | 知识库导入 + 聊天附件 + 系统管理 + 启动检测 |

### 3.4 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 删除 libreoffice 导致 .doc 解析失败 | 高 | 高 | 提供 libreoffice sidecar |
| 删除 playwright 导致网页解析失败 | 高 | 高 | 提供 playwright sidecar 或用 trafilatura 替代 |
| sidecar 网络延迟 | 中 | 中 | localhost 通信，延迟 < 5ms |
| sidecar 增加运维复杂度 | 高 | 中 | docker-compose 编排，对用户透明 |
| opendataloader 引擎删除影响部分用户 | 中 | 高 | 保留为可选 sidecar |

**回滚策略**：保留旧 Dockerfile（`Dockerfile.docreader.legacy`），必要时回滚。

---

## Phase 4：本地模型服务接入与 Go 端路由优化

### 4.1 背景：当前引擎路由架构（代码核实）

**Go 端 `resolveDocReader`**（`internal/application/service/knowledge_process.go` L3261-3295）已有 7 种引擎分支：

| 引擎名 | Go 实现位置 | 处理方式 | 是否经过 Python docreader |
|--------|------------|---------|--------------------------|
| `simple` | `docparser.SimpleFormatReader{}` | Go 原生解析（txt/csv 等） | 否 |
| `weknoracloud` | `docparser.NewWeKnoraCloudSignedDocumentReader()` | HTTP 调用腾讯云签名服务 | 否 |
| `mineru` | `docparser.NewMinerUReader(overrides)` | HTTP 调用本地 MinerU 服务 | 否 |
| `mineru_cloud` | `docparser.NewMinerUCloudReader(overrides)` | HTTP 调用云端 MinerU 服务 | 否 |
| `paddleocr_vl` | `docparser.NewPaddleOCRVLReader(overrides)` | HTTP 调用本地 PaddleOCR 服务 | 否 |
| `paddleocr_vl_cloud` | `docparser.NewPaddleOCRVLCloudReader(overrides)` | HTTP 调用云端 PaddleOCR 服务 | 否 |
| `builtin` | `s.documentReader`（gRPC 客户端） | gRPC 调用 Python docreader | 是 |
| default（非 simple 格式） | `s.documentReader` | gRPC 调用 Python docreader | 是 |

**Python 端**（`docreader/parser/registry.py`）仅注册 3 个引擎：`builtin`/`markitdown`/`opendataloader`。registry.py L168-171 注释明确说明：

```python
# NOTE: Engine listing is managed by Go-side engine registry
# (docparser.ListAllEngines). The Python list_engines method is kept for
# backward compatibility with the gRPC ListEngines RPC but the Go app
# no longer calls it. MinerU engines are handled natively by Go.
```

**结论**：MinerU/PaddleOCR 的本地模型服务接入已由 Go 端实现（`NewMinerUReader`/`NewPaddleOCRVLReader`），**不需要在 Python 端重复适配**。本阶段聚焦于 Go 端路由健壮性、配置规范化和可观测性。

### 4.2 目标

1. 确认 Go 端 `NewMinerUReader`/`NewPaddleOCRVLReader` 已支持本地模型服务 HTTP endpoint 配置
2. 补充环境变量和配置文档，让运维人员能正确部署本地 MinerU/PaddleOCR 服务
3. 优化 Go 端路由健壮性：本地服务不可用时 fail-fast + 错误提示 + 可选降级到 builtin
4. **Python 端零改动**：不新增 Python parser，不修改 registry.py

### 4.3 修改逻辑

#### 4.3.1 确认 Go 端 MinerU/PaddleOCR Reader 实现

**文件**：`internal/infrastructure/docparser/` 目录

需核实以下文件是否存在及实现细节：
- `mineru_reader.go`（或类似文件）：`NewMinerUReader(overrides)` 实现
- `paddleocr_reader.go`（或类似文件）：`NewPaddleOCRVLReader(overrides)` 实现

**核实项**：
- 是否从 `overrides` map 中读取 `mineru_endpoint`/`mineru_api_key` 参数
- 是否支持本地 HTTP endpoint（如 `http://localhost:8302`）
- 是否有超时控制（默认应 ≤ 5 分钟）
- 是否有服务不可用时的错误处理
- 是否有重试机制

#### 4.3.2 配置规范化

**新增**：环境变量配置文档

```bash
# MinerU 本地模型服务配置（部署文档，非代码修改）
MINERU_ENDPOINT=http://localhost:8302    # 本地 MinerU 服务地址
MINERU_API_KEY=                           # 可选 API Key（本地服务通常不需要）
MINERU_TIMEOUT=5m                          # 解析超时（默认 5 分钟）

# PaddleOCR VL 本地模型服务配置
PADDLEOCR_ENDPOINT=http://localhost:8303  # 本地 PaddleOCR 服务地址
PADDLEOCR_API_KEY=                         # 可选 API Key
PADDLEOCR_TIMEOUT=3m                      # 解析超时（默认 3 分钟）
```

#### 4.3.3 Go 端路由健壮性优化

**文件**：`internal/application/service/knowledge_process.go` L3277-3284

```go
// 修改前（L3277-3284）：
case "mineru":
    return docparser.NewMinerUReader(overrides)
case "paddleocr_vl":
    return docparser.NewPaddleOCRVLReader(overrides)

// 修改后：增加 endpoint 空值校验 + 可选降级
case "mineru":
    reader := docparser.NewMinerUReader(overrides)
    if reader == nil {
        logger.Warnf(ctx, "[resolveDocReader] mineru: no endpoint configured, falling back to builtin")
        return s.documentReader  // 降级到 builtin
    }
    return reader
case "paddleocr_vl":
    reader := docparser.NewPaddleOCRVLReader(overrides)
    if reader == nil {
        logger.Warnf(ctx, "[resolveDocReader] paddleocr_vl: no endpoint configured, falling back to builtin")
        return s.documentReader
    }
    return reader
```

#### 4.3.4 Python 端不做任何改动

**重要**：Python docreader 不新增 mineru_parser.py 或 paddleocr_parser.py。MinerU/PaddleOCR 引擎的请求处理完全由 Go 端完成。

### 4.4 验收标准

| 编号 | 验收项 | 验证方式 |
|------|--------|---------|
| A4-01 | Go 端 NewMinerUReader 支持本地 endpoint 配置 | `grep -rn "endpoint" internal/infrastructure/docparser/mineru_reader.go` |
| A4-02 | Go 端 NewPaddleOCRVLReader 支持本地 endpoint 配置 | `grep -rn "endpoint" internal/infrastructure/docparser/paddleocr_reader.go` |
| A4-03 | resolveDocReader 在 endpoint 未配置时降级到 builtin | 单元测试：overrides 不含 endpoint → 返回 s.documentReader |
| A4-04 | MinerU 本地服务解析 PDF 功能正常 | 启动 MinerU + 上传 PDF + 验证 Markdown |
| A4-05 | PaddleOCR 本地服务解析图片功能正常 | 启动 PaddleOCR + 上传图片 + 验证 OCR 结果 |
| A4-06 | Python docreader 零改动 | `git diff docreader/` Phase 4 无改动 |
| A4-07 | Python registry 引擎列表不变 | `python -c "from docreader.parser.registry import registry; print(registry.get_engine_names())"` 输出 `['builtin', 'markitdown', 'opendataloader']` |
| A4-08 | 红线 R-01 ~ R-14 全部通过 | 执行第 8 节红线检查 |
| A4-09 | Go 端编译通过 | `go build ./...` 退出码 0 |
| A4-10 | 部署文档含 MinerU/PaddleOCR 环境变量说明 | 文档存在 |

### 4.5 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| MinerU/PaddleOCR 本地服务未部署 | 高 | 中 | endpoint 未配置时自动降级到 builtin |
| Go 端 Reader 实现已有 bug | 低 | 高 | Phase 0 补充 Go 端单元测试 |
| 环境变量命名不一致 | 中 | 低 | 确认 Go 端实际使用的 override key 名 |

**回滚策略**：`git revert` Go 端 knowledge_process.go 修改。Python 端无改动，无需回滚。

---

## Phase 5：大文件拆分和代码质量提升

### 5.1 目标

将 pdf_parser.py（1548 行）和 docx_parser.py（1534 行）拆分为多个模块，提升可维护性。

### 5.2 修改逻辑

#### 5.2.1 pdf_parser.py 拆分

**新增目录**：`docreader/parser/pdf/`

```
docreader/parser/pdf/
  ├── __init__.py          # 导出 PDFParser（保持原导入路径兼容）
  ├── classify.py          # _page_classify 页面分类
  ├── text_layout.py       # _text_page 文本布局
  ├── sanitize.py          # 文本清洗
  ├── render.py            # _scanned_page 渲染
  ├── figures.py           # _extract_embedded_images 图片提取
  └── parser.py            # PDFParser 主类，编排上述模块
```

**兼容性**：`docreader/parser/pdf_parser.py` 改为薄包装，re-export PDFParser：

```python
# docreader/parser/pdf_parser.py（保留，作为兼容入口）
from docreader.parser.pdf import PDFParser  # noqa: F401
```

#### 5.2.2 docx_parser.py 拆分

**新增目录**：`docreader/parser/docx/`

```
docreader/parser/docx/
  ├── __init__.py          # 导出 DOCXParser
  ├── parser.py            # DOCXParser 主类
  ├── table.py             # 表格处理
  ├── image.py             # 图片处理
  └── style.py             # 样式处理
```

#### 5.2.3 endecode deprecated alias 删除

**文件**：`docreader/utils/endecode.py`

```python
# 删除 Phase 1 保留的 deprecated alias
# del decode_image_alias
# 所有调用方已修正为正确命名
```

#### 5.2.4 跨文件 DRY 违规修复

- 抽取 `mime_map` 为 `docreader/utils/mime.py` 常量
- 抽取 logger 配置为 `docreader/utils/logging.py`

### 5.3 验收标准

| 编号 | 验收项 | 验证方式 |
|------|--------|---------|
| A5-01 | pdf_parser.py 拆分为 6 个模块 | `ls docreader/parser/pdf/` 显示 7 个文件 |
| A5-02 | docx_parser.py 拆分为 4 个模块 | `ls docreader/parser/docx/` 显示 5 个文件 |
| A5-03 | 原导入路径兼容 | `python -c "from docreader.parser.pdf_parser import PDFParser"` 成功 |
| A5-04 | 每个模块 ≤ 400 行 | `wc -l docreader/parser/pdf/*.py docreader/parser/docx/*.py` |
| A5-05 | endecode deprecated alias 已删除 | `grep "alias" docreader/utils/endecode.py` 无输出 |
| A5-06 | mime_map 抽取为常量 | `grep "mime_map" docreader/main.py` 仅引用 `from docreader.utils.mime import MIME_MAP` |
| A5-07 | 所有单元测试通过 | `cd docreader && pytest` 退出码 0 |
| A5-08 | Go 端零改动 | `git diff internal/` 无 Phase 5 改动 |
| A5-09 | 红线 R-01 ~ R-14 全部通过 | 执行第 8 节红线检查 |
| A5-10 | 集成测试：PDF/DOCX 解析功能正常 | 集成测试 |

### 5.4 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 拆分后导入路径断裂 | 中 | 高 | 保留 pdf_parser.py 作为兼容入口 |
| 拆分后循环依赖 | 中 | 中 | 模块间单向依赖，parser.py 依赖其他模块 |
| 行为变化 | 低 | 高 | 特征测试锁定行为 |

**回滚策略**：保留旧文件（pdf_parser.py 仍可独立运行），逐步迁移调用方。

---

## Phase 6：测试覆盖率提升

### 6.1 目标

将测试覆盖率从 45%（Phase 0 后）提升到 70%。

### 6.2 修改逻辑

#### 6.2.1 补充测试文件

| 测试文件 | 覆盖目标 | 目标覆盖率 |
|---------|---------|----------|
| `tests/test_pdf_classify.py` | pdf/classify.py | 80% |
| `tests/test_pdf_text_layout.py` | pdf/text_layout.py | 80% |
| `tests/test_pdf_render.py` | pdf/render.py | 70% |
| `tests/test_pdf_figures.py` | pdf/figures.py | 80% |
| `tests/test_docx_table.py` | docx/table.py | 80% |
| `tests/test_docx_image.py` | docx/image.py | 80% |
| `tests/test_docx_style.py` | docx/style.py | 70% |
| `tests/test_mineru_parser.py` | mineru_parser.py | 80% |
| `tests/test_paddleocr_parser.py` | paddleocr_parser.py | 80% |
| `tests/test_grpc_integration.py` | main.py + auth.py + registry.py | 70% |

#### 6.2.2 集成测试

**新增**：`tests/integration/test_grpc_e2e.py`

- 启动 docreader gRPC 服务
- 通过 Go 客户端调用 3 个 RPC 方法
- 验证 4 个调用场景端到端

### 6.3 验收标准

| 编号 | 验收项 | 验证方式 |
|------|--------|---------|
| A6-01 | 测试覆盖率 ≥ 70% | `pytest --cov=docreader --cov-report=term` |
| A6-02 | 新增 10 个测试文件 | `ls docreader/tests/test_*.py` |
| A6-03 | 集成测试通过 | `pytest tests/integration/` 退出码 0 |
| A6-04 | 所有测试通过 | `cd docreader && pytest` 退出码 0 |
| A6-05 | 红线 R-01 ~ R-14 全部通过 | 执行第 8 节红线检查 |

### 6.4 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 集成测试环境复杂 | 中 | 中 | 使用 docker-compose 启动依赖 |
| 覆盖率提升困难 | 中 | 低 | 优先覆盖核心路径 |

---

## 7. 风险与回滚策略

### 7.1 总体风险矩阵

| Phase | 主要风险 | 影响 | 缓解 |
|-------|---------|------|------|
| Phase 0 | 测试发现新 bug | 低 | 记录待 Phase 1 修复 |
| Phase 1 | fail-fast 破坏现有部署 | 高 | 逃生阀 DOCREADER_ALLOW_INSECURE |
| Phase 1 | endecode 重命名误用 | 中 | deprecated alias + 特征测试 |
| Phase 1 | SSRF 误杀合法 URL | 中 | allowlist 配置 |
| Phase 1 | Go 端改动编译失败 | 高 | CI 编译检查 |
| Phase 2 | 删除字段导致 Go 端失败 | 高 | 先 grep 确认 |
| Phase 3 | 删除 libreoffice/playwright 导致功能缺失 | 高 | sidecar 替代 |
| Phase 3 | 镜像构建失败 | 中 | 保留 legacy Dockerfile |
| Phase 4 | MinerU/PaddleOCR 本地服务未部署 | 高 | endpoint 未配置时降级到 builtin |
| Phase 5 | 拆分后导入路径断裂 | 高 | 兼容入口 |
| Phase 6 | 集成测试环境复杂 | 中 | docker-compose |

### 7.2 回滚策略

| Phase | 回滚方式 | 回滚时间 |
|-------|---------|---------|
| Phase 0 | `git revert` + 删除测试文件 | < 5 分钟 |
| Phase 1 | `git revert` 每个提交（9 个提交独立回滚） | < 10 分钟 |
| Phase 2 | `git revert` | < 5 分钟 |
| Phase 3 | 回滚到 legacy Dockerfile | < 15 分钟（需重建镜像） |
| Phase 4 | `git revert` Go 端 knowledge_process.go | < 5 分钟 |
| Phase 5 | 回滚到单文件版本 | < 10 分钟 |
| Phase 6 | `git revert` + 删除测试文件 | < 5 分钟 |

### 7.3 灰度策略

- **Phase 1-2**：在测试环境验证 24 小时后发布到生产
- **Phase 3**：先发布 sidecar 版本到测试环境，验证 48 小时，保留 legacy 镜像 1 周后删除
- **Phase 4**：MinerU/PaddleOCR 由 Go 端路由，endpoint 未配置时自动降级到 builtin
- **Phase 5-6**：在测试环境验证 24 小时后发布

---

## 8. 验收检查表（汇总）

### 8.1 红线检查（每个 Phase 完成后必须执行）

```bash
#!/bin/bash
# redline_check.sh - 红线检查脚本

echo "=== R-01: gRPC 端口 50051 ==="
grep "50051" docker-compose.yml docker/Dockerfile.docreader

echo "=== R-02: proto 服务名 DocReader ==="
grep "service DocReader" docreader/proto/docreader.proto

echo "=== R-03: 3 个 RPC 方法 ==="
grep -E "rpc (Read|ReadStream|ListEngines)" docreader/proto/docreader.proto

echo "=== R-04: ReadRequest 字段 ==="
grep -E "(file_content|file_name|file_type|url|title|request_id|parser_engine|parser_engine_overrides)" docreader/proto/docreader.proto

echo "=== R-05: ReadResponse 字段 ==="
grep -E "(markdown_content|image_refs|image_dir_path|metadata|error)" docreader/proto/docreader.proto

echo "=== R-06: ReadStream 降级逻辑 ==="
grep -A5 "Unimplemented" internal/infrastructure/docparser/grpc_parser.go

echo "=== R-07: resolveDocReader 7 种引擎分支 ==="
grep -c "case.*simple\|case.*weknoracloud\|case.*mineru\|case.*paddleocr_vl\|case.*builtin" internal/application/service/knowledge_process.go

echo "=== R-08: ListEngines 返回格式 ==="
grep "ListEnginesResponse" docreader/proto/docreader.proto

echo "=== R-09: Bearer Token 认证 ==="
grep -i "bearer" docreader/auth.py docreader/client/auth.go

echo "=== R-10: RequireTransportSecurity 守卫 ==="
grep -A2 "RequireTransportSecurity" docreader/client/auth.go

echo "=== R-11: GRPC_AUTH_TOKEN 环境变量 ==="
grep "GRPC_AUTH_TOKEN" docreader/config.py

echo "=== R-12: GRPC_TLS_* 环境变量 ==="
grep "GRPC_TLS" docreader/config.py

echo "=== R-13: grpc_health_probe ==="
grep "grpc_health_probe" docker/Dockerfile.docreader

echo "=== R-14: ImageRef 数据结构 ==="
grep -E "(filename|original_ref|mime_type|storage_key|image_data)" docreader/proto/docreader.proto | head -5
```

### 8.2 死代码检查脚本

```bash
#!/bin/bash
# deadcode_check.sh - 死代码检查脚本

echo "=== D-01: import textract ==="
grep -n "import textract" docreader/parser/doc_parser.py || echo "OK: 已删除"

echo "=== D-02: _parse_with_textract ==="
grep -n "_parse_with_textract" docreader/parser/doc_parser.py || echo "OK: 已删除"

echo "=== D-03 ~ D-05: docx 死代码 ==="
grep -n "picture_cache\|get_picture\|_safe_concat_images" docreader/parser/docx_parser.py || echo "OK: 已删除"

echo "=== D-06: opendataloader 死代码 ==="
grep -n "mineru_endpoint\|mineru_api_key" docreader/parser/opendataloader_parser.py || echo "OK: 已删除"

echo "=== D-07: web_parser __main__ ==="
grep -n '__name__.*__main__' docreader/parser/web_parser.py || echo "OK: 已删除"

echo "=== D-08: chain_parser __main__ ==="
grep -n '__name__.*__main__' docreader/parser/chain_parser.py || echo "OK: 已删除"

echo "=== D-09 ~ D-10: markdown _self_test ==="
grep -n "_self_test" docreader/parser/markdown_parser.py || echo "OK: 已删除"

echo "=== D-11 ~ D-12: config 死代码 ==="
grep -n "_mask_secret\|mask_secrets" docreader/config.py || echo "OK: 已删除"

echo "=== D-13: storage_map 参数 ==="
grep -n "storage_map" docreader/main.py || echo "OK: 已删除"

echo "=== D-15: proto storage_key ==="
grep -n "storage_key" docreader/proto/docreader.proto || echo "OK: 已删除"

echo "=== D-16: registry Any 导入 ==="
grep -n "from typing import Any\|import Any" docreader/parser/registry.py || echo "OK: 已删除"

echo "=== D-17: image_parser ext 变量 ==="
grep -n "ext" docreader/parser/image_parser.py || echo "OK: 已删除"

echo "=== D-18: pyproject textract ==="
grep -n "textract" docreader/pyproject.toml || echo "OK: 已删除"

echo "=== D-19: pyproject pypdf（注意：实际使用 pypdfium2，不是 pypdf） ==="
grep -n "^\"pypdf" docreader/pyproject.toml || echo "OK: 已删除（或从未存在）"
```

### 8.3 镜像体积检查

```bash
#!/bin/bash
# image_size_check.sh - 镜像体积检查

IMAGE_NAME="weknora-docreader"
SIZE=$(docker images --format "{{.Size}}" "$IMAGE_NAME" 2>/dev/null | head -1)
echo "镜像: $IMAGE_NAME"
echo "体积: $SIZE"

# 解析为 MB
SIZE_MB=$(echo "$SIZE" | sed 's/MB//;s/GB/*1024/' | bc)
if [ "$SIZE_MB" -le 700 ]; then
    echo "✅ 通过：体积 ≤ 700 MB"
else
    echo "❌ 失败：体积 > 700 MB"
    exit 1
fi
```

### 8.4 测试覆盖率检查

```bash
#!/bin/bash
# coverage_check.sh - 测试覆盖率检查

cd docreader
pytest --cov=docreader --cov-report=term --cov-fail-under=70
```

### 8.5 集成测试检查

```bash
#!/bin/bash
# integration_check.sh - 集成测试

echo "=== 场景 1: 知识库文档导入 ==="
# 上传 PDF/DOCX/XLSX/HTML 到知识库，验证解析成功

echo "=== 场景 2: 聊天附件处理 ==="
# 聊天中上传附件，验证解析成功

echo "=== 场景 3: 系统管理 ==="
# 调用 /api/v1/system/docreader/engines，验证返回引擎列表

echo "=== 场景 4: 启动检测 ==="
# docker-compose up，验证 docreader 容器 healthy
```

### 8.6 Phase 验收汇总表

| Phase | 验收项数量 | 关键验收项 | 状态 |
|-------|----------|----------|------|
| Phase 0 | 5 | 覆盖率 ≥ 45% | ⬜ 待执行 |
| Phase 1 | 18 | 15 项 P0 修复 + 红线通过 | ⬜ 待执行 |
| Phase 2 | 7 | 19 项死代码删除 + 红线通过 | ⬜ 待执行 |
| Phase 3 | 12 | 镜像 ≤ 700MB + 功能正常 | ⬜ 待执行 |
| Phase 4 | 10 | Go 端路由优化 + Python 零改动 | ⬜ 待执行 |
| Phase 5 | 10 | 大文件拆分 + 兼容性 | ⬜ 待执行 |
| Phase 6 | 5 | 覆盖率 ≥ 70% | ⬜ 待执行 |

---

## 附录：重构后预期架构

```
┌─────────────────────────────────────────────────────┐
│  WeKnora-app 容器（Go 主应用）                        │
│  ┌──────────────┐   ┌─────────────────┐            │
│  │  HTTP/REST   │   │  GRPCDocument   │            │
│  │  Handler     │──→│  Reader (client)│────────────┼──→ localhost:50051
│  └──────────────┘   └─────────────────┘            │
│         │                                           │
│         │ resolveDocReader 7 种引擎路由              │
│         │ (simple/builtin/markitdown/opendataloader/ │
│         │  mineru/mineru_cloud/paddleocr_vl/        │
│         │  paddleocr_vl_cloud/weknoracloud)         │
└─────────────────────────────────────────────────────┘
                                                      ↓
┌─────────────────────────────────────────────────────┐
│  WeKnora-docreader 容器（Python sidecar，~500MB）    │
│  ┌─────────────────────────────────────────────┐    │
│  │  DocReaderServicer (gRPC :50051)            │    │
│  │  ├─ Read / ReadStream / ListEngines         │    │
│  │  └─ Auth: TLS + Bearer Token (fail-fast)    │    │
│  └─────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │  ParserEngineRegistry                       │    │
│  │  ├─ builtin (PDF/DOCX/XLSX/HTML/...)        │    │
│  │  │   ├─ PDFParser (拆分为 6 模块)            │    │
│  │  │   ├─ DOCXParser (拆分为 4 模块)           │    │
│  │  │   └─ ...                                  │    │
│  │  ├─ markitdown                              │    │
│  │  └─ opendataloader (可选)                   │    │
│  └─────────────────────────────────────────────┘    │
│  USER 65532 (非 root)                               │
└─────────────────────────────────────────────────────┘
       │                    │                  │
       ↓ HTTP               ↓ HTTP             ↓ HTTP
┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ LibreOffice  │  │ Playwright       │  │ MinerU 服务      │
│ Sidecar      │  │ Sidecar          │  │ (本地模型)       │
│ (.doc 解析)  │  │ (网页渲染)       │  │ HTTP :8302       │
│ HTTP :8300   │  │ HTTP :8301       │  │                  │
└──────────────┘  └──────────────────┘  └──────────────────┘
                                                │
                                                ↓ HTTP
                                        ┌──────────────────┐
                                        │ PaddleOCR 服务   │
                                        │ (本地模型)       │
                                        │ HTTP :8303       │
                                        └──────────────────┘
```

**重构前后对比**：

| 指标 | 重构前 | 重构后 | 改善 |
|------|--------|--------|------|
| 主镜像体积 | 1.5-1.9 GB | ≤ 700 MB | -60% |
| 容器运行用户 | root | 65532 (非 root) | 安全提升 |
| P0 问题 | 15 项 | 0 项 | 全部修复 |
| 死代码 | 19 项 | 0 项 | 全部清理 |
| 死依赖 | 2 项 (textract/pypdf) | 0 项 | 全部清理（pandas 实际在用，不删） |
| 测试覆盖率 | 30-35% | ≥ 70% | +35% |
| 单文件最大行数 | 1548 行 | ≤ 400 行 | -74% |
| 支持本地模型服务 | ❌ | ✅ (MinerU/PaddleOCR) | 新增能力 |
| gRPC 契约兼容 | - | 100% 兼容 | 红线全通过 |
| Go 端改动 | - | 仅 P0 修复（3 项） | 最小化 |

---

**文档结束。**

> 配套文档：[code_review_analysis.md](./code_review_analysis.md) —— 代码实现与方案梳理
