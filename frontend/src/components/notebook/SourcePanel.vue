<template>
  <aside class="source-panel" :class="{ 'is-collapsed': collapsed }">
    <template v-if="!collapsed">
      <!-- 顶部标题 -->
      <div class="panel-header">
        <span class="panel-title">来源</span>
        <div class="panel-header-actions">
          <button
            class="panel-icon-btn"
            :title="loading ? '加载中...' : '刷新来源列表'"
            :disabled="loading"
            @click="loadKnowledgeBases"
          >
            <t-icon :name="loading ? 'loading' : 'refresh'" size="16px" />
          </button>
          <button class="panel-icon-btn" title="收起面板" @click="$emit('toggle')">
            <t-icon name="chevron-left" size="16px" />
          </button>
        </div>
      </div>

      <!-- 搜索框 -->
      <div class="search-row">
        <t-input
          v-model="searchQuery"
          placeholder="搜索来源..."
          clearable
          size="small"
          class="source-search"
        >
          <template #prefix-icon>
            <t-icon name="search" size="14px" />
          </template>
        </t-input>
      </div>

      <!-- 添加来源按钮 -->
      <div class="add-source-row">
        <button class="add-source-btn" @click="handleAddSource">
          <t-icon name="add" size="14px" />
          <span>添加来源</span>
        </button>
      </div>

      <!-- 来源统计 -->
      <div v-if="totalCount > 0" class="source-count-info">
        <span>{{ totalCount }} 个来源 · {{ selectedCount }} 个已选</span>
      </div>

      <!-- 来源列表 -->
      <div class="source-list">
        <!-- 加载骨架 -->
        <div v-if="loading" class="source-loading">
          <div v-for="n in 4" :key="'skel-' + n" class="source-item-skeleton">
            <t-skeleton animation="gradient" :row-col="[{ width: '80%', height: '16px' }, { width: '60%', height: '12px' }]" />
          </div>
        </div>

        <!-- 空态 -->
        <div v-else-if="sourceGroups.length === 0" class="source-empty">
          <t-icon name="folder-open" size="32px" class="empty-icon" />
          <p class="empty-text">暂无知识来源</p>
          <p class="empty-hint">添加知识库或上传文件开始对话</p>
        </div>

        <!-- 知识库分组 -->
        <template v-for="group in sourceGroups" :key="group.id">
          <div class="source-group" v-show="group.visible">
            <div class="group-header" @click="toggleGroup(group.id)">
              <t-icon
                :name="group.expanded ? 'caret-down' : 'caret-right'"
                size="12px"
                class="group-caret"
              />
              <t-icon name="folder" size="14px" class="group-icon" />
              <span class="group-name" :title="group.name">{{ group.name }}</span>
              <span class="group-count">{{ group.items.length }}</span>
              <t-checkbox
                v-if="group.items.length > 0"
                :checked="isGroupAllSelected(group)"
                :indeterminate="isGroupIndeterminate(group)"
                class="group-checkbox"
                @change="(val: boolean) => selectGroup(group, val)"
                @click.stop
              />
              <button
                class="group-delete-btn"
                title="删除该知识库"
                @click.stop="handleDeleteKB(group)"
              >
                <t-icon name="delete" size="14px" />
              </button>
            </div>

            <transition name="group-expand">
              <div v-show="group.expanded" class="group-items">
                <div
                  v-for="item in group.items"
                  :key="item.id"
                  class="source-item"
                  :class="{ 'item-selected': item.selected, 'item-filtered': !itemMatches(item) }"
                >
                  <t-checkbox
                    :checked="item.selected"
                    class="item-checkbox"
                    @change="(val: boolean) => toggleItem(group.id, item.id, val)"
                  />
                  <t-icon :name="getFileIcon(item.name)" size="14px" class="item-icon" />
                  <span class="item-name" :title="item.name">{{ item.name }}</span>
                </div>
              </div>
            </transition>
          </div>
        </template>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { listKnowledgeBases, deleteKnowledgeBase } from '@/api/knowledge-base'
import { useRouter } from 'vue-router'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import { useUIStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'
import { useNotebookStore } from '@/stores/notebook'
import type { KnowledgeBaseInfo } from '@/api/auth'
import type { SourceItem, SourceGroup } from '@/types/notebook'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  (e: 'toggle'): void
}>()

const router = useRouter() // eslint-disable-line @typescript-eslint/no-unused-vars
const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const notebookStore = useNotebookStore()

const loading = ref(true)
const searchQuery = ref('')

// 本地知识库分组（仅 knowledge_bases，web_sources 由 store 管理）
const sourceGroups = ref<SourceGroup[]>([])

// 加载知识库列表
const loadKnowledgeBases = async () => {
  loading.value = true
  try {
    const res = await listKnowledgeBases({ creator: 'all' })
    // API 返回的 KB 带有 knowledge 文件数组（KnowledgeBaseInfo 类型未覆盖此字段）
    const kbs = (res?.data || []) as Array<KnowledgeBaseInfo & { knowledge?: Array<{ id: string; name?: string; title?: string }> }>

    sourceGroups.value = kbs.map((kb) => ({
      id: kb.id,
      name: kb.name,
      type: 'knowledge_base' as const,
      expanded: true,
      visible: true,
      items: (kb.knowledge || []).map((file) => ({
        id: file.id,
        name: file.name || file.title || '未命名',
        type: 'document' as const,
        selected: false,
      })),
    }))
  } catch (err) {
    console.error('[SourcePanel] Failed to load knowledge bases:', err)
    sourceGroups.value = []
  } finally {
    loading.value = false
  }
}

// 搜索过滤
const itemMatches = (item: SourceItem): boolean => {
  if (!searchQuery.value) return true
  return item.name.toLowerCase().includes(searchQuery.value.toLowerCase())
}

// 监听搜索
watch(searchQuery, () => {
  sourceGroups.value.forEach((group) => {
    const hasMatching = group.items.some(itemMatches) || group.name.toLowerCase().includes(searchQuery.value.toLowerCase())
    group.visible = hasMatching
  })
})

// 统计
const totalCount = computed(() => {
  return sourceGroups.value.reduce((sum, g) => sum + g.items.length, 0)
})

const selectedCount = computed(() => {
  let count = 0
  sourceGroups.value.forEach((group) => {
    group.items.forEach((item) => { if (item.selected) count++ })
  })
  return count
})

// 切换分组展开
const toggleGroup = (groupId: string) => {
  const group = sourceGroups.value.find((g) => g.id === groupId)
  if (group) group.expanded = !group.expanded
}

// 全选分组
const isGroupAllSelected = (group: SourceGroup): boolean => {
  return group.items.length > 0 && group.items.every((i) => i.selected)
}
const isGroupIndeterminate = (group: SourceGroup): boolean => {
  const selected = group.items.filter((i) => i.selected).length
  return selected > 0 && selected < group.items.length
}
const selectGroup = (group: SourceGroup, val: boolean) => {
  group.items.forEach((item) => { item.selected = val })
  syncToSettings()
}

// 切换单个选择
// 修复 P0-7：原实现完全忽略 groupId/itemId/val 三个参数，只调用 syncToSettings，
// 导致 checkbox 的 @change 事件传过来的新选中状态从未写回到 item.selected，
// 用户点击 checkbox 后视觉无变化、settings store 也读不到任何已选文件。
const toggleItem = (groupId: string, itemId: string, val: boolean) => {
  const group = sourceGroups.value.find((g) => g.id === groupId)
  if (!group) return
  const item = group.items.find((i) => i.id === itemId)
  if (!item) return
  item.selected = val
  syncToSettings()
}

// 同步选择到 settings store（供对话使用）
const syncToSettings = () => {
  const kbIds: string[] = []
  const fileIds: string[] = []
  sourceGroups.value.forEach((group) => {
    const allSelected = group.items.length > 0 && group.items.every((i) => i.selected)
    if (allSelected) {
      kbIds.push(group.id)
    } else {
      group.items.forEach((item) => {
        if (item.selected) fileIds.push(item.id)
      })
    }
  })
  // 更新到 settings store
  settingsStore.selectKnowledgeBases(kbIds)
  // 文件选择通过 settings 的 API
  settingsStore.settings.selectedFiles = fileIds
}

// 文件图标
const getFileIcon = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const iconMap: Record<string, string> = {
    pdf: 'file-pdf',
    doc: 'file-word', docx: 'file-word',
    xls: 'file-excel', xlsx: 'file-excel', csv: 'file-excel',
    ppt: 'file-powerpoint', pptx: 'file-powerpoint',
    md: 'file', txt: 'file',
    html: 'file-code', xml: 'file-code', json: 'file-code',
    mp3: 'sound', wav: 'sound', m4a: 'sound', flac: 'sound', ogg: 'sound', aac: 'sound',
  }
  return iconMap[ext] || 'file'
}

// 添加来源（打开知识库编辑器）
const handleAddSource = () => {
  uiStore.openCreateKB('document')
}

// 删除知识库（带确认对话框）
const handleDeleteKB = (group: SourceGroup) => {
  const dialog = DialogPlugin.confirm({
    header: '删除知识库',
    body: `确定要删除知识库「${group.name}」吗？该操作不可恢复，知识库内的所有文件都将被删除。`,
    confirmBtn: { content: '删除', theme: 'danger' },
    cancelBtn: '取消',
    theme: 'warning',
    onConfirm: async () => {
      try {
        await deleteKnowledgeBase(group.id)
        // 从本地列表中移除
        sourceGroups.value = sourceGroups.value.filter((g) => g.id !== group.id)
        // 同步选择状态
        syncToSettings()
        MessagePlugin.success(`已删除知识库「${group.name}」`)
      } catch (err) {
        console.error('[SourcePanel] Failed to delete knowledge base:', err)
        MessagePlugin.error('删除知识库失败，请重试')
      } finally {
        dialog.hide()
      }
    },
  })
}

// 同步本地知识库分组到 notebookStore，保留 store 中的 web_sources 分组
watch(sourceGroups, (groups) => {
  const webSourcesGroup = notebookStore.sourceGroups.find((g) => g.id === 'web_sources')
  notebookStore.sourceGroups = [
    ...groups.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      expanded: g.expanded,
      visible: g.visible,
      items: g.items.map((i) => ({ ...i })),
    })),
    ...(webSourcesGroup ? [webSourcesGroup] : []),
  ]
}, { deep: true, immediate: true })

onMounted(() => {
  loadKnowledgeBases()
})
</script>

<style lang="less" scoped>
.source-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--td-bg-color-container);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  flex-shrink: 0;
}

.panel-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  letter-spacing: -0.01em;
  /* NotebookLM 风格：标题优化换行 */
  text-wrap: balance;
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

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    transform: none;
  }
}

.search-row {
  padding: 0 16px 10px;
  flex-shrink: 0;
}

.source-search :deep(.t-input__wrap) {
  border-radius: var(--td-radius-medium, 8px);
}

.add-source-row {
  padding: 0 16px 12px;
  flex-shrink: 0;
}

/* NotebookLM 风格：添加来源按钮做成虚线胶囊 */
.add-source-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 9px 12px;
  border: 1px dashed var(--brand-color-border, rgba(0, 113, 227, 0.32));
  background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.08));
  color: var(--td-brand-color);
  border-radius: var(--td-radius-medium, 8px);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition-property: background-color, border-color, transform, box-shadow;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: rgba(0, 113, 227, 0.14);
    border-color: var(--td-brand-color);
    border-style: solid;
  }

  &:active {
    transform: scale(0.98);
  }
}

.source-count-info {
  padding: 0 20px 8px;
  font-size: 11px;
  color: var(--td-text-color-placeholder);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}

.source-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 16px;
  min-height: 0;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 3px;
    transition-property: background;
    transition-duration: var(--duration-base, 220ms);
  }
  &:hover::-webkit-scrollbar-thumb {
    background: var(--td-scrollbar-color, rgba(0,0,0,0.15));
  }
}

.source-loading {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.source-item-skeleton {
  padding: 10px 12px;
}

.source-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 56px 24px 40px;
  text-align: center;
}

.empty-icon {
  color: var(--td-text-color-placeholder);
  margin-bottom: 14px;
  opacity: 0.6;
}

.empty-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--td-text-color-secondary);
  margin: 0 0 6px;
  text-wrap: balance;
}

.empty-hint {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  margin: 0;
  text-wrap: pretty;
  max-width: 220px;
  line-height: 1.5;
}

.source-group {
  margin-bottom: 4px;
}

/* NotebookLM 风格：分组头做成可点击的胶囊 */
.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--td-radius-default, 6px);
  cursor: pointer;
  transition-property: background-color;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: var(--td-bg-color-container-hover);
  }
}

.group-caret {
  color: var(--td-text-color-placeholder);
  flex-shrink: 0;
  transition-property: transform;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));
}

.group-icon {
  color: var(--td-brand-color);
  flex-shrink: 0;
}

.group-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.005em;
}

.group-count {
  font-size: 11px;
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-secondarycontainer);
  padding: 2px 8px;
  border-radius: 10px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.group-checkbox {
  flex-shrink: 0;
  :deep(.t-checkbox__input) {
    transform: scale(0.85);
  }
}

.group-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--td-text-color-placeholder);
  border-radius: var(--td-radius-small, 4px);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition-property: background-color, color, opacity, transform;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: var(--td-error-color-light);
    color: var(--td-error-color);
  }

  &:active {
    transform: scale(0.92);
  }
}

.group-header:hover .group-delete-btn {
  opacity: 1;
}

.group-expand-enter-active,
.group-expand-leave-active {
  transition-property: opacity, max-height, transform;
  transition-duration: var(--duration-base, 220ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));
  overflow: hidden;
}

.group-expand-enter-from,
.group-expand-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-4px);
}

.group-expand-enter-to,
.group-expand-leave-from {
  opacity: 1;
  max-height: 500px;
  transform: translateY(0);
}

.group-items {
  padding-left: 18px;
  padding-top: 2px;
  padding-bottom: 4px;
}

/* NotebookLM 风格：来源项做成柔和卡片感 */
.source-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
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

  &.item-selected {
    background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.08));
    /* 选中态左侧加品牌色细条，强化视觉反馈 */
    box-shadow: inset 2px 0 0 var(--td-brand-color);
  }

  &.item-filtered {
    display: none;
  }
}

.item-checkbox {
  flex-shrink: 0;
  :deep(.t-checkbox__input) {
    transform: scale(0.8);
  }
}

.item-icon {
  color: var(--td-text-color-secondary);
  flex-shrink: 0;
  transition-property: color;
  transition-duration: var(--duration-fast, 150ms);

  .item-selected & {
    color: var(--td-brand-color);
  }
}

.item-name {
  flex: 1;
  font-size: 12.5px;
  color: var(--td-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition-property: color;
  transition-duration: var(--duration-fast, 150ms);

  .item-selected & {
    color: var(--td-text-color-primary);
    font-weight: 500;
  }
}
</style>
