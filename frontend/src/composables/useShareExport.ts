/**
 * 分享 / 导出能力的纯函数集合。
 *
 * 抽取自 NotebookHeader 和 StudioPanel 中重复的"下载/分享/复制"逻辑，
 * 让 UI 层只负责触发，业务逻辑可单测。
 *
 * 兼容性：
 * - 优先使用 navigator.clipboard.writeText（现代浏览器）
 * - 降级到 document.execCommand('copy') + textarea（旧浏览器 / 非安全上下文）
 * - 下载使用 Blob + URL.createObjectURL + <a download>
 * - PDF 导出使用 window.print()，让用户用浏览器原生"打印为 PDF"
 */

/** 将文本复制到剪贴板，返回是否成功 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  // 优先现代 API
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (err) {
    console.warn('[useShareExport] clipboard.writeText failed, falling back to execCommand:', err)
  }

  // 降级方案：textarea + execCommand
  try {
    if (typeof document === 'undefined') return false
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch (err) {
    console.error('[useShareExport] copy fallback failed:', err)
    return false
  }
}

/** 将文本作为文件下载 */
export function downloadTextAsFile(
  content: string,
  filename: string,
  mimeType: string = 'text/plain;charset=utf-8',
): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // 释放 URL 对象
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 把相对路径转换为绝对 URL（基于当前 location.origin） */
function resolveAbsoluteUrl(path: string): string {
  if (typeof location === 'undefined') return path
  if (/^https?:\/\//i.test(path)) return path
  const origin = location.origin || `${location.protocol}//${location.host}`
  return path.startsWith('/') ? `${origin}${path}` : `${origin}/${path}`
}

/** 复制分享链接到剪贴板，返回是否成功 */
export async function copyShareLink(path: string): Promise<boolean> {
  const url = resolveAbsoluteUrl(path)
  return copyTextToClipboard(url)
}

/** 导出为 Markdown 文件，返回是否成功（空内容返回 false） */
export function exportToMarkdown(title: string, content: string): boolean {
  if (!content || !content.trim()) return false
  const safeTitle = title?.trim() || 'notebook-output'
  downloadTextAsFile(content, `${safeTitle}.md`, 'text/markdown;charset=utf-8')
  return true
}

/**
 * 导出为 PDF。
 *
 * 浏览器没有原生"保存为 PDF"API，标准做法是触发 window.print()，
 * 让用户用浏览器原生打印对话框选择"另存为 PDF"。
 *
 * 为了让打印的内容是 notebook 内容而不是整个页面，调用方应该在调用前
 * 给页面加一个 `.printing-mode` class 隐藏掉无关元素，并在 CSS 中加
 * `@media print` 规则。这里只负责触发打印。
 */
export function exportToPDF(title: string, content: string): boolean {
  if (!content || !content.trim()) return false
  if (typeof window === 'undefined' || typeof window.print !== 'function') return false
  // 设置 document.title 让打印的 PDF 默认文件名是 notebook 标题
  if (typeof document !== 'undefined') {
    const origTitle = document.title
    document.title = title?.trim() || 'notebook-output'
    window.print()
    // 异步恢复，避免影响 UI
    setTimeout(() => {
      document.title = origTitle
    }, 0)
  } else {
    window.print()
  }
  return true
}
