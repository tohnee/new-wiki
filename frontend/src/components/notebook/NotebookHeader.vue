<template>
  <header class="notebook-header">
    <div class="header-left">
      <button
        class="header-icon-btn"
        :title="leftCollapsed ? '展开来源面板' : '收起来源面板'"
        @click="$emit('toggle-left')"
      >
        <t-icon :name="leftCollapsed ? 'chevron-right' : 'chevron-left'" size="18px" />
      </button>
      <div class="logo-mark" @click="goHome">
        <t-icon name="notebook" size="20px" />
      </div>
      <div class="notebook-title-wrap">
        <input
          v-if="editingTitle"
          ref="titleInputRef"
          v-model="localTitle"
          class="notebook-title-input"
          @blur="commitTitle"
          @keydown.enter="commitTitle"
          @keydown.esc="cancelEdit"
        />
        <h1 v-else class="notebook-title" @dblclick="startEdit" :title="title">
          {{ title }}
        </h1>
      </div>
    </div>

    <div class="header-right">
      <t-dropdown placement="bottom-right" trigger="click" :min-column-width="200">
        <button class="header-btn primary">
          <t-icon name="add" size="16px" />
          <span>创建笔记本</span>
        </button>
        <t-dropdown-menu>
          <t-dropdown-item @click="createNotebook">
            <t-icon name="file-add" slot="prefix" />
            空白笔记本
          </t-dropdown-item>
          <t-dropdown-item @click="createFromKB">
            <t-icon name="file-copy" slot="prefix" />
            从知识库创建
          </t-dropdown-item>
        </t-dropdown-menu>
      </t-dropdown>

      <button class="header-btn" title="分析">
        <t-icon name="chart-line" size="16px" />
        <span>分析</span>
      </button>

      <t-dropdown placement="bottom-right" trigger="click" :min-column-width="200">
        <button class="header-btn" title="分享">
          <t-icon name="share" size="16px" />
          <span>分享</span>
        </button>
        <t-dropdown-menu>
          <t-dropdown-item>
            <t-icon name="link" slot="prefix" />
            复制链接
          </t-dropdown-item>
          <t-dropdown-item>
            <t-icon name="upload" slot="prefix" />
            导出为 PDF
          </t-dropdown-item>
          <t-dropdown-item>
            <t-icon name="download" slot="prefix" />
            导出 Markdown
          </t-dropdown-item>
        </t-dropdown-menu>
      </t-dropdown>

      <button
        class="header-icon-btn"
        title="设置"
        @click="openSettings"
      >
        <t-icon name="settings" size="18px" />
      </button>

      <div class="header-divider"></div>

      <UserMenu />
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import UserMenu from '@/components/UserMenu.vue'
import { useUIStore } from '@/stores/ui'

const props = defineProps<{
  title: string
  leftCollapsed: boolean
  rightCollapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-left'): void
  (e: 'toggle-right'): void
  (e: 'update:title', val: string): void
}>()

const router = useRouter()
const uiStore = useUIStore()

const editingTitle = ref(false)
const localTitle = ref(props.title)
const titleInputRef = ref<HTMLInputElement>()

const startEdit = () => {
  localTitle.value = props.title
  editingTitle.value = true
  nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

const commitTitle = () => {
  if (!localTitle.value.trim()) {
    localTitle.value = props.title
    editingTitle.value = false
    return
  }
  emit('update:title', localTitle.value.trim())
  editingTitle.value = false
}

const cancelEdit = () => {
  localTitle.value = props.title
  editingTitle.value = false
}

const openSettings = () => {
  uiStore.openSettings()
}

const goHome = () => {
  router.push('/platform/knowledge-bases')
}

const createNotebook = () => {
  MessagePlugin.info('创建新笔记本（功能开发中）')
}

const createFromKB = () => {
  MessagePlugin.info('从知识库创建（功能开发中）')
}
</script>

<style lang="less" scoped>
.notebook-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 12px;
  background: var(--td-bg-color-container);
  border-bottom: 1px solid var(--td-component-stroke);
  flex-shrink: 0;
  z-index: 10;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.logo-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--td-brand-color);
  cursor: pointer;
  margin: 0 4px;
}

.notebook-title-wrap {
  min-width: 0;
  margin-left: 4px;
}

.notebook-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  margin: 0;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
  user-select: none;
}

.notebook-title-input {
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--td-brand-color);
  border-radius: 4px;
  padding: 4px 8px;
  outline: none;
  width: 320px;
  font-family: inherit;
}

.header-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
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

  &:active {
    transform: scale(0.92);
  }
}

.header-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--td-component-border);
  background: var(--td-bg-color-container);
  color: var(--td-text-color-primary);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--td-bg-color-container-hover);
    border-color: var(--td-component-stroke);
  }

  &.primary {
    background: var(--td-brand-color);
    border-color: var(--td-brand-color);
    color: #fff;

    &:hover {
      background: var(--td-brand-color-hover);
      border-color: var(--td-brand-color-hover);
    }
  }

  span {
    line-height: 1;
  }
}

.header-divider {
  width: 1px;
  height: 20px;
  background: var(--td-component-stroke);
  margin: 0 4px;
}
</style>
