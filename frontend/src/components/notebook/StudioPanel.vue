<template>
  <aside class="studio-panel" :class="{ 'is-collapsed': collapsed }">
    <template v-if="!collapsed">
      <!-- 顶部标题 + 折叠 -->
      <div class="panel-header">
        <span class="panel-title">Studio</span>
        <button
          class="panel-icon-btn"
          title="收起 Studio 面板"
          @click="$emit('toggle')"
        >
          <t-icon name="chevron-right" size="16px" />
        </button>
      </div>

      <!-- 正在查看的生成结果 -->
      <div v-if="viewingJob" class="viewing-job-section">
        <div class="viewing-job-header">
          <button class="back-btn" @click="notebookStore.setViewingJob(null)">
            <t-icon name="chevron-left" size="14px" />
            <span>返回</span>
          </button>
          <span class="viewing-job-title">{{ viewingJob.name }}</span>
        </div>
        <div class="viewing-job-content">
          <div v-if="viewingJob.status === 'generating'" class="generating-status">
            <t-loading size="small" />
            <span>正在生成... {{ viewingJob.progress ?? 0 }}%</span>
          </div>
          <div v-else-if="viewingJob.status === 'failed'" class="failed-status">
            <t-icon name="error-circle" size="16px" />
            <span>生成失败：{{ viewingJob.errorMessage }}</span>
          </div>
          <div v-else-if="viewingJob.content" class="job-content-wrapper">
            <div v-if="mediaFallbackHint" class="media-fallback-hint">
              <t-icon name="info-circle" size="14px" />
              <span>{{ mediaFallbackHint }}</span>
            </div>
            <div class="job-content-preview markdown-body" v-html="renderedContent">
            </div>
          </div>
          <div v-else class="empty-content">
            暂无内容
          </div>
        </div>
        <div class="viewing-job-actions">
          <button
            class="action-btn"
            :disabled="viewingJob.status !== 'completed'"
            @click="handleDownload"
          >
            <t-icon name="download" size="14px" />
            <span>下载</span>
          </button>
          <button
            class="action-btn"
            :disabled="viewingJob.status !== 'completed'"
            @click="handleShare"
          >
            <t-icon name="share" size="14px" />
            <span>分享</span>
          </button>
          <button
            class="action-btn"
            :disabled="viewingJob.status === 'generating'"
            @click="handleRegenerate"
          >
            <t-icon name="refresh" size="14px" />
            <span>重新生成</span>
          </button>
        </div>
      </div>

      <!-- Studio 工具网格 + 历史记录 -->
      <div v-else class="studio-scroll">
        <!-- 生成工具分类 -->
        <div
          v-for="category in displayCategories"
          :key="category.id"
          class="tool-category"
        >
          <div class="category-header">
            <span class="category-name">{{ category.name }}</span>
          </div>
          <div class="tool-grid">
            <div
              v-for="tool in toolsByCategory(category.id)"
              :key="tool.type"
              class="tool-card"
              :class="{ pro: tool.pro }"
              @click="handleToolClick(tool.type)"
            >
              <div class="tool-icon">
                <t-icon :name="tool.icon" size="18px" />
              </div>
              <div class="tool-info">
                <div class="tool-name">
                  {{ tool.name }}
                  <t-tag v-if="tool.pro" theme="warning" variant="light" size="small">PRO</t-tag>
                </div>
                <div class="tool-desc">{{ tool.description }}</div>
              </div>
              <div class="tool-arrow">
                <t-icon name="chevron-right" size="14px" />
              </div>
            </div>
          </div>
        </div>

        <!-- 历史生成记录 -->
        <div v-if="notebookStore.jobs.length > 0" class="history-section">
          <div class="category-header">
            <span class="category-name">最近生成</span>
            <button
              v-if="notebookStore.jobs.length > 8"
              class="view-all-btn"
              @click="showAllJobs = !showAllJobs"
            >
              {{ showAllJobs ? '收起' : '查看全部' }}
            </button>
          </div>
          <div class="history-list">
            <div
              v-for="job in displayJobs"
              :key="job.id"
              class="history-item"
              @click="notebookStore.setViewingJob(job.id)"
            >
              <div class="history-icon">
                <t-icon :name="getToolIcon(job.type)" size="14px" />
              </div>
              <div class="history-info">
                <div class="history-title">{{ job.name }}</div>
                <div class="history-meta">
                  <span>{{ job.sourceCount }} 个来源</span>
                  <span class="dot">·</span>
                  <span>{{ formatTime(job.createdAt) }}</span>
                </div>
              </div>
              <div class="history-status">
                <t-loading v-if="job.status === 'generating'" size="small" />
                <t-icon v-else-if="job.status === 'completed'" name="check-circle" size="14px" class="status-success" />
                <t-icon v-else-if="job.status === 'failed'" name="error-circle" size="14px" class="status-error" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 折叠态 -->
    <template v-else>
      <div class="collapsed-bar">
        <button
          class="collapse-expand-btn"
          title="展开 Studio 面板"
          @click="$emit('toggle')"
        >
          <t-icon name="chevron-left" size="16px" />
        </button>
        <div class="collapsed-studio-label">
          <t-icon name="wand" size="18px" />
        </div>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { marked } from 'marked'
import { MessagePlugin } from 'tdesign-vue-next'
import { useNotebookStore } from '@/stores/notebook'
import { useAuthStore } from '@/stores/auth'
import { STUDIO_TOOL_CARDS, STUDIO_CATEGORIES } from '@/config/studioTools'
import { sanitizeMarkdownHTML } from '@/utils/security'
import { triggerStudioTool } from '@/composables/useStudioToolTrigger'
import { getMediaFallbackHint } from '@/composables/useMediaFallback'
import { canUseProTool, getProToolDeniedMessage } from '@/composables/useProToolGate'
import type { StudioToolType } from '@/types/notebook'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  (e: 'toggle'): void
}>()

const notebookStore = useNotebookStore()
const authStore = useAuthStore()

// 临时隐藏的分类与工具
const HIDDEN_CATEGORIES = new Set(['study'])
const HIDDEN_TOOL_TYPES = new Set(['video_script'])

const displayCategories = computed(() =>
  STUDIO_CATEGORIES.filter((cat) =>
    !HIDDEN_CATEGORIES.has(cat.id) &&
    STUDIO_TOOL_CARDS.some((t) => t.category === cat.id && !HIDDEN_TOOL_TYPES.has(t.type)),
  ),
)

const toolsByCategory = (categoryId: string) =>
  STUDIO_TOOL_CARDS.filter((t) => t.category === categoryId && !HIDDEN_TOOL_TYPES.has(t.type))

const viewingJob = computed(() => notebookStore.viewingJob)

// 历史记录展开/收起：默认只显示前 8 条，点击"查看全部"展开
const showAllJobs = ref(false)
// 按当前 session 过滤历史记录；空 sessionId 时显示全部（向后兼容）
const sessionFilteredJobs = computed(() => {
  const sid = notebookStore.chatSessionId
  if (!sid) return notebookStore.jobs
  // 兼容旧数据（sessionId 字段未写入）：sessionId 为空字符串的 job 也显示
  return notebookStore.jobs.filter((j) => !j.sessionId || j.sessionId === sid)
})
const displayJobs = computed(() =>
  showAllJobs.value ? sessionFilteredJobs.value : sessionFilteredJobs.value.slice(0, 8),
)

// 将 job.content 渲染为安全的 HTML（marked + DOMPurify）
const renderedContent = computed(() => {
  const content = viewingJob.value?.content
  if (!content) return ''
  try {
    const html = marked.parse(content, { async: false }) as string
    return sanitizeMarkdownHTML(html)
  } catch (err) {
    console.error('[StudioPanel] markdown render failed:', err)
    return sanitizeMarkdownHTML(content)
  }
})

// 富媒体工具降级提示（audio_overview / video_script / infographic / presentation）
const mediaFallbackHint = computed(() => {
  const toolType = viewingJob.value?.type
  if (!toolType) return null
  return getMediaFallbackHint(toolType)
})

const getToolIcon = (type: StudioToolType) => {
  const tool = STUDIO_TOOL_CARDS.find((t) => t.type === type)
  return tool?.icon || 'file-copy'
}

const formatTime = (iso: string) => {
  const date = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return date.toLocaleDateString()
}

const handleToolClick = (toolType: StudioToolType) => {
  const tool = STUDIO_TOOL_CARDS.find((t) => t.type === toolType)
  if (!tool) return

  // PRO 工具权限校验：需要 admin 及以上角色
  if (!canUseProTool(tool, authStore.hasRole('admin'))) {
    const msg = getProToolDeniedMessage(tool)
    if (msg) MessagePlugin.warning(msg)
    return
  }

  // 使用共享的 triggerStudioTool（修复 sourceType 枚举 bug，与 NotebookHeader 分析下拉一致）
  const jobId = triggerStudioTool(toolType, notebookStore, STUDIO_TOOL_CARDS)
  if (!jobId) return

  MessagePlugin.success(`正在生成${tool.name}...`)
}

// 下载生成结果为 Markdown 文件
const handleDownload = () => {
  const job = viewingJob.value
  if (!job?.content) {
    MessagePlugin.warning('暂无可下载的内容')
    return
  }
  try {
    const blob = new Blob([job.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${job.name || 'studio-output'}.md`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    MessagePlugin.success('已开始下载')
  } catch (err) {
    console.error('[StudioPanel] download failed:', err)
    MessagePlugin.error('下载失败')
  }
}

// 分享：复制 Markdown 内容到剪贴板
const handleShare = async () => {
  const job = viewingJob.value
  if (!job?.content) {
    MessagePlugin.warning('暂无可分享的内容')
    return
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(job.content)
      MessagePlugin.success('内容已复制到剪贴板')
    } else {
      // 回退方案：使用 textarea
      const textarea = document.createElement('textarea')
      textarea.value = job.content
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      MessagePlugin.success('内容已复制到剪贴板')
    }
  } catch (err) {
    console.error('[StudioPanel] share failed:', err)
    MessagePlugin.error('复制失败')
  }
}

// 重新生成：基于当前 job 重新触发一次工具调用
const handleRegenerate = () => {
  const job = viewingJob.value
  if (!job) return
  handleToolClick(job.type)
}
</script>

<style lang="less" scoped>
.studio-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--td-bg-color-container);
  border-left: 1px solid var(--td-component-stroke);
  min-width: 0;
  overflow: hidden;

  &.is-collapsed {
    width: 52px;
    min-width: 52px;
  }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--td-component-stroke);
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  letter-spacing: -0.01em;
}

.panel-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--td-text-color-secondary);
  border-radius: var(--td-radius-default, 6px);
  cursor: pointer;
  transition-property: background-color, color, transform;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.08));
    color: var(--td-brand-color);
  }

  &:active {
    transform: scale(0.92);
  }
}

.studio-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-bottom: 16px;

  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  transition-property: scrollbar-color;
  transition-duration: var(--duration-base, 220ms);

  &:hover {
    scrollbar-color: var(--td-scrollbar-color, rgba(0, 0, 0, 0.18)) transparent;
  }

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background-color: transparent;
    border-radius: 6px;
    transition-property: background-color;
    transition-duration: var(--duration-base, 220ms);
  }

  &:hover::-webkit-scrollbar-thumb {
    background-color: var(--td-scrollbar-color, rgba(0, 0, 0, 0.18));
  }
}

.tool-category {
  padding: 14px 12px 4px;
}

.category-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  margin-bottom: 8px;
  padding: 0 4px;
}

.category-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--td-text-color-placeholder);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.view-all-btn {
  border: none;
  background: transparent;
  color: var(--td-brand-color);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  padding: 3px 8px;
  border-radius: var(--td-radius-small, 4px);
  transition-property: background-color;
  transition-duration: var(--duration-fast, 150ms);

  &:hover {
    background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.08));
  }
}

/* NotebookLM 风格工具网格：卡片化，更宽松间距 */
.tool-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

/* 工具卡片：NotebookLM 风格浮起卡片，类别区分色 */
.tool-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-large, 12px);
  background: var(--td-bg-color-container);
  cursor: pointer;
  transition-property: border-color, background-color, transform, box-shadow;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));
  position: relative;

  &:hover {
    border-color: var(--brand-color-border, rgba(0, 113, 227, 0.32));
    background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.04));
    transform: translateY(-1px);
    box-shadow: var(--td-shadow-card, 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.05));
  }

  &:active {
    transform: translateY(0) scale(0.98);
  }

  &.pro {
    border-color: var(--td-warning-color-2);
    background: linear-gradient(135deg, var(--td-warning-color-1) 0%, var(--td-bg-color-container) 60%);

    &:hover {
      border-color: var(--td-warning-color);
      background: linear-gradient(135deg, var(--td-warning-color-1) 0%, var(--td-brand-color-light, var(--td-bg-color-container)) 100%);
    }
  }
}

/* 工具图标：NotebookLM 风格彩色图标 */
.tool-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--td-radius-medium, 8px);
  background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.08));
  color: var(--td-brand-color);
  flex-shrink: 0;
  transition-property: background-color, transform;
  transition-duration: var(--duration-fast, 150ms);

  .tool-card:hover & {
    background: var(--td-brand-color);
    color: #fff;
    transform: scale(1.05);
  }

  .tool-card.pro & {
    background: var(--td-warning-color-1);
    color: var(--td-warning-color);

    .tool-card.pro:hover & {
      background: var(--td-warning-color);
      color: #fff;
    }
  }
}

.tool-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tool-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  display: flex;
  align-items: center;
  gap: 4px;
  line-height: 1.3;
  letter-spacing: -0.005em;
}

.tool-desc {
  font-size: 11px;
  color: var(--td-text-color-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-wrap: pretty;
}

.tool-arrow {
  position: absolute;
  top: 10px;
  right: 10px;
  color: var(--td-text-color-placeholder);
  opacity: 0;
  transition-property: opacity, transform;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));
}

.tool-card:hover .tool-arrow {
  opacity: 1;
  transform: translateX(2px);
}

.history-section {
  padding: 14px 12px 8px;
  border-top: 1px solid var(--td-component-stroke);
  margin-top: 8px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--td-radius-default, 6px);
  cursor: pointer;
  transition-property: background-color, transform;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: var(--td-bg-color-container-hover);
  }

  &:active {
    transform: scale(0.99);
  }
}

.history-icon {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--td-radius-small, 4px);
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-secondary);
  flex-shrink: 0;
}

.history-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--td-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-meta {
  font-size: 10.5px;
  color: var(--td-text-color-placeholder);
  display: flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;

  .dot {
    opacity: 0.5;
  }
}

.history-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;

  .status-success {
    color: var(--td-success-color);
  }

  .status-error {
    color: var(--td-error-color);
  }
}

/* 查看生成结果 */
.viewing-job-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.viewing-job-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid var(--td-component-stroke);
  flex-shrink: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 2px;
  border: none;
  background: transparent;
  color: var(--td-brand-color);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  padding: 5px 8px;
  border-radius: var(--td-radius-small, 4px);
  transition-property: background-color, transform;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.08));
  }

  &:active {
    transform: scale(0.97);
  }
}

.viewing-job-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.005em;
}

.viewing-job-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  min-height: 0;
}

.job-content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.media-fallback-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--td-radius-medium, 8px);
  background: var(--td-warning-color-1);
  border: 1px solid var(--td-warning-color-2);
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-secondary);

  .t-icon {
    color: var(--td-warning-color);
    flex-shrink: 0;
    margin-top: 1px;
  }
}

.job-content-preview {
  font-size: 13px;
  line-height: 1.7;
  color: var(--td-text-color-primary);
  word-break: break-word;

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: 14px 0 8px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--td-text-color-primary);
    letter-spacing: -0.01em;
    text-wrap: balance;
  }

  :deep(h1) { font-size: 19px; }
  :deep(h2) { font-size: 17px; }
  :deep(h3) { font-size: 15px; }
  :deep(h4),
  :deep(h5),
  :deep(h6) { font-size: 14px; }

  :deep(p) {
    margin: 8px 0;
  }

  :deep(ul),
  :deep(ol) {
    margin: 8px 0;
    padding-left: 22px;
  }

  :deep(li) {
    margin: 3px 0;
  }

  :deep(blockquote) {
    margin: 10px 0;
    padding: 6px 14px;
    border-left: 3px solid var(--td-brand-color);
    background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.06));
    color: var(--td-text-color-secondary);
    border-radius: 0 var(--td-radius-small, 4px) var(--td-radius-small, 4px) 0;
  }

  :deep(pre) {
    margin: 10px 0;
    padding: 12px 14px;
    background: var(--td-bg-color-secondarycontainer);
    border-radius: var(--td-radius-medium, 8px);
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.55;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  }

  :deep(code) {
    padding: 2px 5px;
    background: var(--td-bg-color-secondarycontainer);
    border-radius: var(--td-radius-small, 4px);
    font-size: 12px;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  }

  :deep(pre code) {
    padding: 0;
    background: transparent;
  }

  :deep(table) {
    width: 100%;
    margin: 10px 0;
    border-collapse: collapse;
    font-size: 12px;
    border-radius: var(--td-radius-medium, 8px);
    overflow: hidden;
  }

  :deep(th),
  :deep(td) {
    padding: 8px 12px;
    border: 1px solid var(--td-component-stroke);
    text-align: left;
  }

  :deep(th) {
    background: var(--td-bg-color-secondarycontainer);
    font-weight: 600;
  }

  :deep(a) {
    color: var(--td-brand-color);
    text-decoration: none;
    transition-property: color;
    transition-duration: var(--duration-fast, 150ms);

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(img) {
    max-width: 100%;
    border-radius: var(--td-radius-medium, 8px);
    outline: 1px solid rgba(0, 0, 0, 0.06);
    outline-offset: -1px;
  }

  :deep(hr) {
    margin: 14px 0;
    border: none;
    border-top: 1px solid var(--td-component-stroke);
  }
}

.generating-status,
.failed-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  font-size: 12px;
  color: var(--td-text-color-secondary);
}

.failed-status {
  color: var(--td-error-color);
}

.empty-content {
  text-align: center;
  padding: 24px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.viewing-job-actions {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--td-component-stroke);
  flex-shrink: 0;
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 32px;
  border: 1px solid var(--td-component-border);
  background: var(--td-bg-color-container);
  color: var(--td-text-color-secondary);
  border-radius: var(--td-radius-default, 6px);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition-property: border-color, color, background-color, transform;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover:not(:disabled) {
    border-color: var(--brand-color-border, rgba(0, 113, 227, 0.32));
    color: var(--td-brand-color);
    background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.08));
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

/* 折叠态 */
.collapsed-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 10px;
  height: 100%;
}

.collapse-expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: var(--td-text-color-secondary);
  border-radius: var(--td-radius-default, 6px);
  cursor: pointer;
  margin-bottom: 8px;
  transition-property: background-color, color, transform;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.08));
    color: var(--td-brand-color);
  }

  &:active {
    transform: scale(0.92);
  }
}

.collapsed-studio-label {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--td-brand-color);
  padding: 10px 0;
}
</style>
