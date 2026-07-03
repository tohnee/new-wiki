<template>
  <aside class="source-panel" :class="{ 'is-collapsed': collapsed }">
    <template v-if="!collapsed">
      <!-- 顶部标题 -->
      <div class="panel-header">
        <span class="panel-title">来源</span>
        <button class="panel-icon-btn" title="收起面板" @click="$emit('toggle')">
          <t-icon name="chevron-left" size="16px" />
        </button>
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
import { listKnowledgeBases } from '@/api/knowledge-base'
import { useRouter } from 'vue-router'
import { useUIStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'
import { useNotebookStore } from '@/stores/notebook'
import type { KnowledgeBaseInfo } from '@/types/knowledgeProcess'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  (e: 'toggle'): void
}>()

const router = useRouter()
const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const notebookStore = useNotebookStore()

const loading = ref(true)
const searchQuery = ref('')

interface SourceItem {
  id: string
  name: string
  type: 'file' | 'note'
  selected: boolean
}

interface SourceGroup {
  id: string
  name: string
  type: 'knowledge_base'
  expanded: boolean
  visible: boolean
  items: SourceItem[]
}

const sourceGroups = ref<SourceGroup[]>([])

// 加载知识库列表
const loadKnowledgeBases = async () => {
  loading.value = true
  try {
    const res = await listKnowledgeBases({ creator: 'all' })
    const kbs: KnowledgeBaseInfo[] = res?.data || []

    sourceGroups.value = kbs.map((kb) => ({
      id: kb.id,
      name: kb.name,
      type: 'knowledge_base' as const,
      expanded: true,
      visible: true,
      items: (kb.knowledge || []).map((file: any) => ({
        id: file.id,
        name: file.name || file.title || '未命名',
        type: 'file' as const,
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
const toggleItem = (_groupId: string, _itemId: string, _val: boolean) => {
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
  uiStore.openKBEditor('create')
}

// 同步到 notebookStore 的 sourceGroups
watch(sourceGroups, (groups) => {
  notebookStore.sourceGroups = groups.map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    items: g.items.map((i) => ({ ...i })),
  }))
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
  padding: 12px 16px 8px;
  flex-shrink: 0;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.panel-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--td-text-color-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--td-bg-color-container-hover);
    color: var(--td-text-color-primary);
  }
}

.search-row {
  padding: 0 12px 8px;
  flex-shrink: 0;
}

.source-search :deep(.t-input__wrap) {
  border-radius: 8px;
}

.add-source-row {
  padding: 0 12px 8px;
  flex-shrink: 0;
}

.add-source-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 12px;
  border: 1px dashed var(--td-component-border);
  background: transparent;
  color: var(--td-brand-color);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--td-brand-color-light);
    border-color: var(--td-brand-color);
  }
}

.source-count-info {
  padding: 0 16px 8px;
  font-size: 11px;
  color: var(--td-text-color-placeholder);
  flex-shrink: 0;
}

.source-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 16px;
  min-height: 0;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 3px;
    transition: background 0.2s;
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
  padding: 8px 12px;
}

.source-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.empty-icon {
  color: var(--td-text-color-placeholder);
  margin-bottom: 12px;
}

.empty-text {
  font-size: 14px;
  color: var(--td-text-color-secondary);
  margin: 0 0 4px;
}

.empty-hint {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  margin: 0;
}

.source-group {
  margin-bottom: 2px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--td-bg-color-container-hover);
  }
}

.group-caret {
  color: var(--td-text-color-placeholder);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.group-icon {
  color: var(--td-brand-color);
  flex-shrink: 0;
}

.group-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--td-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  font-size: 11px;
  color: var(--td-text-color-placeholder);
  background: var(--td-bg-color-secondarycontainer);
  padding: 1px 6px;
  border-radius: 10px;
  flex-shrink: 0;
}

.group-checkbox {
  flex-shrink: 0;
  :deep(.t-checkbox__input) {
    transform: scale(0.85);
  }
}

.group-expand-enter-active,
.group-expand-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.group-expand-enter-from,
.group-expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.group-expand-enter-to,
.group-expand-leave-from {
  opacity: 1;
  max-height: 500px;
}

.group-items {
  padding-left: 20px;
}

.source-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease;

  &:hover {
    background: var(--td-bg-color-container-hover);
  }

  &.item-selected {
    background: var(--td-brand-color-light);
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
}

.item-name {
  flex: 1;
  font-size: 12px;
  color: var(--td-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  .item-selected & {
    color: var(--td-text-color-primary);
  }
}
</style>
