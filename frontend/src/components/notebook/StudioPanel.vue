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
          <div v-else-if="viewingJob.content" class="job-content-preview">
            <pre>{{ viewingJob.content }}</pre>
          </div>
          <div v-else class="empty-content">
            暂无内容
          </div>
        </div>
        <div class="viewing-job-actions">
          <button class="action-btn">
            <t-icon name="download" size="14px" />
            <span>下载</span>
          </button>
          <button class="action-btn">
            <t-icon name="share" size="14px" />
            <span>分享</span>
          </button>
          <button class="action-btn">
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
            <button class="view-all-btn">查看全部</button>
          </div>
          <div class="history-list">
            <div
              v-for="job in recentJobs"
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
import { computed } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useNotebookStore } from '@/stores/notebook'
import { STUDIO_TOOL_CARDS, STUDIO_CATEGORIES } from '@/config/studioTools'
import type { StudioToolType } from '@/types/notebook'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  (e: 'toggle'): void
}>()

const notebookStore = useNotebookStore()

const displayCategories = computed(() =>
  STUDIO_CATEGORIES.filter((cat) =>
    STUDIO_TOOL_CARDS.some((t) => t.category === cat.id),
  ),
)

const toolsByCategory = (categoryId: string) =>
  STUDIO_TOOL_CARDS.filter((t) => t.category === categoryId)

const viewingJob = computed(() => notebookStore.viewingJob)

const recentJobs = computed(() => notebookStore.jobs.slice(0, 8))

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

const handleToolClick = async (toolType: StudioToolType) => {
  const tool = STUDIO_TOOL_CARDS.find((t) => t.type === toolType)
  if (!tool) return

  // 构建 prompt 并发送到对话
  const sourceCount = notebookStore.selectedSourceCount
  const sourceHint = sourceCount > 0
    ? `（基于已选的 ${sourceCount} 个来源）`
    : ''
  const prompt = tool.prompt + sourceHint

  // 添加到 Studio 历史记录
  const jobId = `job_${Date.now()}`
  notebookStore.addJob({
    id: jobId,
    type: toolType,
    name: tool.name,
    status: 'generating',
    sourceCount,
    sourceType: sourceCount > 0 ? 'selected' : 'conversation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progress: 0,
  })

  // 通过 store 触发对话输入框发送
  notebookStore.triggerSendPrompt(prompt)

  // 折叠右栏让用户看到对话
  notebookStore.setViewingJob(jobId)
  MessagePlugin.success(`正在生成${tool.name}...`)
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
  height: 44px;
  padding: 0 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--td-component-stroke);
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.panel-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--td-text-color-secondary);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--td-bg-color-container-hover);
    color: var(--td-text-color-primary);
  }
}

.studio-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-bottom: 12px;

  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  transition: scrollbar-color 0.2s ease;

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
    transition: background-color 0.2s ease;
  }

  &:hover::-webkit-scrollbar-thumb {
    background-color: var(--td-scrollbar-color, rgba(0, 0, 0, 0.18));
  }
}

.tool-category {
  padding: 12px 10px 4px;
}

.category-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  margin-bottom: 6px;
  padding: 0 2px;
}

.category-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--td-text-color-placeholder);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.view-all-btn {
  border: none;
  background: transparent;
  color: var(--td-brand-color);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;

  &:hover {
    background: var(--td-brand-color-light);
  }
}

.tool-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.tool-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--td-component-border);
  border-radius: 8px;
  background: var(--td-bg-color-container);
  cursor: pointer;
  transition: all 0.15s ease;
  position: relative;

  &:hover {
    border-color: var(--td-brand-color);
    background: var(--td-brand-color-light);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  &.pro {
    border-color: var(--td-warning-color-2);
    background: linear-gradient(135deg, var(--td-warning-color-1) 0%, var(--td-bg-color-container) 100%);
  }
}

.tool-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-brand-color);
  flex-shrink: 0;
}

.tool-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tool-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  display: flex;
  align-items: center;
  gap: 4px;
  line-height: 1.3;
}

.tool-desc {
  font-size: 11px;
  color: var(--td-text-color-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tool-arrow {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--td-text-color-placeholder);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.tool-card:hover .tool-arrow {
  opacity: 1;
}

.history-section {
  padding: 12px 10px 0;
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
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--td-bg-color-container-hover);
  }
}

.history-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
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
  color: var(--td-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-meta {
  font-size: 10px;
  color: var(--td-text-color-placeholder);
  display: flex;
  align-items: center;
  gap: 4px;

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
  height: 40px;
  padding: 0 10px;
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
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;

  &:hover {
    background: var(--td-brand-color-light);
  }
}

.viewing-job-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewing-job-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  min-height: 0;
}

.job-content-preview {
  pre {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--td-text-color-primary);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
  }
}

.generating-status,
.failed-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  font-size: 12px;
  color: var(--td-text-color-secondary);
}

.failed-status {
  color: var(--td-error-color);
}

.empty-content {
  text-align: center;
  padding: 20px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.viewing-job-actions {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--td-component-stroke);
  flex-shrink: 0;
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 30px;
  border: 1px solid var(--td-component-border);
  background: var(--td-bg-color-container);
  color: var(--td-text-color-secondary);
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--td-brand-color);
    color: var(--td-brand-color);
    background: var(--td-brand-color-light);
  }
}

/* 折叠态 */
.collapsed-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
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
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 8px;
  transition: all 0.15s ease;

  &:hover {
    background: var(--td-bg-color-container-hover);
    color: var(--td-text-color-primary);
  }
}

.collapsed-studio-label {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--td-brand-color);
  padding: 8px 0;
}
</style>
