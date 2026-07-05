#!/bin/bash
# =============================================================================
# redline_check.sh — docreader 重构红线检查脚本
#
# 基于代码核实（2026-07-04），使用真实 proto 字段名。
# 每个 Phase 完成后必须执行，确保 14 项重构红线未被破坏。
#
# 用法：
#   chmod +x docreader/scripts/redline_check.sh
#   ./docreader/scripts/redline_check.sh
#
# 退出码：0=全部通过，1=任一项失败
# =============================================================================

set -eo pipefail

# 项目根目录（脚本所在目录的上两级）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PASS=0
FAIL=0

check() {
    local name="$1"
    local cmd="$2"
    if eval "$cmd" >/dev/null 2>&1; then
        echo "  [PASS] $name"
        PASS=$((PASS + 1))
    else
        echo "  [FAIL] $name"
        FAIL=$((FAIL + 1))
    fi
}

echo "=========================================="
echo " docreader 重构红线检查"
echo " 项目根目录: $PROJECT_ROOT"
echo "=========================================="
echo ""

# -----------------------------------------------------------------------------
# R-01: gRPC 端口 50051
# 位置: docker-compose.yml + docker/Dockerfile.docreader
# -----------------------------------------------------------------------------
echo "--- R-01: gRPC 端口 50051 ---"
check "docker-compose 含 50051" \
    "grep -q '50051' '$PROJECT_ROOT/docker-compose.yml'"
check "Dockerfile EXPOSE 50051" \
    "grep -q 'EXPOSE 50051' '$PROJECT_ROOT/docker/Dockerfile.docreader'"

# -----------------------------------------------------------------------------
# R-02: proto 服务名 DocReader
# 位置: docreader/proto/docreader.proto L7
# -----------------------------------------------------------------------------
echo ""
echo "--- R-02: proto 服务名 DocReader ---"
check "service DocReader 存在" \
    "grep -q 'service DocReader' '$PROJECT_ROOT/docreader/proto/docreader.proto'"

# -----------------------------------------------------------------------------
# R-03: 3 个 RPC 方法签名
# 位置: docreader/proto/docreader.proto L8-16
#   rpc Read(ReadRequest) returns (ReadResponse)
#   rpc ReadStream(ReadRequest) returns (stream ReadStreamResponse)
#   rpc ListEngines(ListEnginesRequest) returns (ListEnginesResponse)
# -----------------------------------------------------------------------------
echo ""
echo "--- R-03: 3 个 RPC 方法签名 ---"
check "rpc Read 存在" \
    "grep -q 'rpc Read(' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "rpc ReadStream 存在" \
    "grep -q 'rpc ReadStream(' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "rpc ListEngines 存在" \
    "grep -q 'rpc ListEngines(' '$PROJECT_ROOT/docreader/proto/docreader.proto'"

# -----------------------------------------------------------------------------
# R-04: ReadRequest 字段（真实字段名）
# 位置: docreader/proto/docreader.proto L28-36
#   bytes  file_content = 1;
#   string file_name = 2;
#   string file_type = 3;
#   string url = 4;
#   string title = 5;
#   ReadConfig config = 6;
#   string request_id = 7;
# -----------------------------------------------------------------------------
echo ""
echo "--- R-04: ReadRequest 字段（真实字段名） ---"
check "file_content 字段存在" \
    "grep -q 'file_content' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "file_name 字段存在" \
    "grep -q 'file_name' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "file_type 字段存在" \
    "grep -q 'file_type' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "url 字段存在" \
    "grep -q 'url' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "title 字段存在" \
    "grep -q 'title' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "request_id 字段存在" \
    "grep -q 'request_id' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "config (ReadConfig) 嵌套字段存在" \
    "grep -q 'ReadConfig' '$PROJECT_ROOT/docreader/proto/docreader.proto'"

# -----------------------------------------------------------------------------
# R-05: ReadResponse 字段（真实字段名）
# 位置: docreader/proto/docreader.proto L46-52
#   string markdown_content = 1;
#   repeated ImageRef image_refs = 2;
#   string image_dir_path = 3;
#   map<string,string> metadata = 4;
#   string error = 5;
# -----------------------------------------------------------------------------
echo ""
echo "--- R-05: ReadResponse 字段（真实字段名） ---"
check "markdown_content 字段存在" \
    "grep -q 'markdown_content' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "image_refs 字段存在" \
    "grep -q 'image_refs' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "image_dir_path 字段存在" \
    "grep -q 'image_dir_path' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "metadata 字段存在" \
    "grep -q 'metadata' '$PROJECT_ROOT/docreader/proto/docreader.proto'"

# -----------------------------------------------------------------------------
# R-06: ReadStream 降级逻辑
# 位置: internal/infrastructure/docparser/grpc_parser.go L136-146
#   Unimplemented → 降级到 unary Read
# -----------------------------------------------------------------------------
echo ""
echo "--- R-06: ReadStream 降级逻辑 ---"
check "grpc_parser.go 含 Unimplemented 降级" \
    "grep -q 'Unimplemented' '$PROJECT_ROOT/internal/infrastructure/docparser/grpc_parser.go'"
check "grpc_parser.go 含 fallback 到 Read" \
    "grep -q 'falling back to unary Read\|readUnary' '$PROJECT_ROOT/internal/infrastructure/docparser/grpc_parser.go'"

# -----------------------------------------------------------------------------
# R-07: resolveDocReader 7 种引擎分支
# 位置: internal/application/service/knowledge_process.go L3262-3294
#   case simple / weknoracloud / mineru / mineru_cloud /
#        paddleocr_vl / paddleocr_vl_cloud / builtin
# -----------------------------------------------------------------------------
echo ""
echo "--- R-07: resolveDocReader 7 种引擎分支 ---"
# Go 端 case 使用常量名（SimpleEngineName/WeKnoraCloudEngineName）和字符串字面量混合
ENGINE_COUNT=$(grep -cE 'case (docparser\.(Simple|WeKnoraCloud)EngineName|"(mineru|mineru_cloud|paddleocr_vl|paddleocr_vl_cloud|builtin)")' \
    "$PROJECT_ROOT/internal/application/service/knowledge_process.go" 2>/dev/null || true)
if [ "${ENGINE_COUNT:-0}" -ge 7 ]; then
    echo "  [PASS] 7 种引擎分支（实际 $ENGINE_COUNT 个 case）"
    PASS=$((PASS + 1))
else
    echo "  [FAIL] 引擎分支不足：$ENGINE_COUNT（期望 ≥ 7）"
    FAIL=$((FAIL + 1))
fi

# -----------------------------------------------------------------------------
# R-08: ListEngines 返回格式
# 位置: docreader/proto/docreader.proto L72-86
#   ListEnginesRequest / ParserEngineInfo / ListEnginesResponse
# -----------------------------------------------------------------------------
echo ""
echo "--- R-08: ListEngines 返回格式 ---"
check "ListEnginesResponse 存在" \
    "grep -q 'ListEnginesResponse' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "ParserEngineInfo 含 available 字段" \
    "grep -q 'available' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "ParserEngineInfo 含 unavailable_reason 字段" \
    "grep -q 'unavailable_reason' '$PROJECT_ROOT/docreader/proto/docreader.proto'"

# -----------------------------------------------------------------------------
# R-09: Bearer Token 认证机制
# 位置: docreader/auth.py L188-190 + docreader/client/auth.go
# -----------------------------------------------------------------------------
echo ""
echo "--- R-09: Bearer Token 认证机制 ---"
check "auth.py 含 Bearer token 校验" \
    "grep -q 'Bearer' '$PROJECT_ROOT/docreader/auth.py'"
check "auth.go 含 Bearer token 发送" \
    "grep -q 'Bearer\|authorization' '$PROJECT_ROOT/docreader/client/auth.go'"

# -----------------------------------------------------------------------------
# R-10: RequireTransportSecurity 守卫
# 位置: docreader/client/auth.go L132-134
#   token 非空时强制 TLS
# -----------------------------------------------------------------------------
echo ""
echo "--- R-10: RequireTransportSecurity 守卫 ---"
check "auth.go 含 RequireTransportSecurity" \
    "grep -q 'RequireTransportSecurity' '$PROJECT_ROOT/docreader/client/auth.go'"

# -----------------------------------------------------------------------------
# R-11: GRPC_AUTH_TOKEN 环境变量
# 位置: docreader/auth.py L168 + docreader/config.py
# -----------------------------------------------------------------------------
echo ""
echo "--- R-11: GRPC_AUTH_TOKEN 环境变量 ---"
check "auth.py 读取 GRPC_AUTH_TOKEN" \
    "grep -q 'GRPC_AUTH_TOKEN' '$PROJECT_ROOT/docreader/auth.py'"

# -----------------------------------------------------------------------------
# R-12: GRPC_TLS_* 环境变量
# 位置: docreader/auth.py L5-11
# -----------------------------------------------------------------------------
echo ""
echo "--- R-12: GRPC_TLS_* 环境变量 ---"
check "auth.py 读取 GRPC_TLS_ENABLED" \
    "grep -q 'GRPC_TLS_ENABLED' '$PROJECT_ROOT/docreader/auth.py'"
check "auth.py 读取 GRPC_TLS_CERT" \
    "grep -q 'GRPC_TLS_CERT' '$PROJECT_ROOT/docreader/auth.py'"
check "auth.py 读取 GRPC_TLS_KEY" \
    "grep -q 'GRPC_TLS_KEY' '$PROJECT_ROOT/docreader/auth.py'"

# -----------------------------------------------------------------------------
# R-13: 健康检查 grpc_health_probe
# 位置: docker/Dockerfile.docreader L128-136
# -----------------------------------------------------------------------------
echo ""
echo "--- R-13: grpc_health_probe ---"
check "Dockerfile 下载 grpc_health_probe" \
    "grep -q 'grpc_health_probe' '$PROJECT_ROOT/docker/Dockerfile.docreader'"

# -----------------------------------------------------------------------------
# R-14: ImageRef 数据结构（真实字段名）
# 位置: docreader/proto/docreader.proto L38-44
#   string filename = 1;
#   string original_ref = 2;
#   string mime_type = 3;
#   string storage_key = 4;
#   bytes  image_data = 5;
# -----------------------------------------------------------------------------
echo ""
echo "--- R-14: ImageRef 数据结构（真实字段名） ---"
check "filename 字段存在" \
    "grep -q 'filename' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "original_ref 字段存在" \
    "grep -q 'original_ref' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "mime_type 字段存在" \
    "grep -q 'mime_type' '$PROJECT_ROOT/docreader/proto/docreader.proto'"
check "image_data 字段存在" \
    "grep -q 'image_data' '$PROJECT_ROOT/docreader/proto/docreader.proto'"

# -----------------------------------------------------------------------------
# 汇总
# -----------------------------------------------------------------------------
echo ""
echo "=========================================="
echo " 红线检查结果"
echo "=========================================="
echo "  通过: $PASS"
echo "  失败: $FAIL"
echo "=========================================="

if [ "$FAIL" -gt 0 ]; then
    echo "❌ 红线检查未通过，请修复失败项后再继续重构。"
    exit 1
else
    echo "✅ 全部红线检查通过。"
    exit 0
fi
