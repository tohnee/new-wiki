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
      <button
        class="header-icon-btn"
        title="设置"
        @click="openSettings"
      >
        <t-icon name="settings" size="18px" />
      </button>

      <div class="header-divider"></div>

      <UserMenu />

      <button
        class="header-icon-btn"
        :title="rightCollapsed ? '展开 Studio 面板' : '收起 Studio 面板'"
        @click="$emit('toggle-right')"
      >
        <t-icon :name="rightCollapsed ? 'chevron-left' : 'chevron-right'" size="18px" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import UserMenu from '@/components/UserMenu.vue'
import { useUIStore } from '@/stores/ui'
import { useNotebookStore } from '@/stores/notebook'
import { updateSession } from '@/api/chat/index'

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
const notebookStore = useNotebookStore()

const editingTitle = ref(false)
const localTitle = ref(props.title)
const titleInputRef = ref<HTMLInputElement>()
const savingTitle = ref(false)

const startEdit = () => {
  localTitle.value = props.title
  editingTitle.value = true
  nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

const commitTitle = async () => {
  const newTitle = localTitle.value.trim()
  if (!newTitle) {
    localTitle.value = props.title
    editingTitle.value = false
    return
  }
  // 标题未变化直接退出编辑
  if (newTitle === props.title) {
    editingTitle.value = false
    return
  }
  // 立即更新本地视图，避免等待网络
  emit('update:title', newTitle)
  editingTitle.value = false

  // 如果有 session ID，持久化到后端
  const sessionId = notebookStore.chatSessionId
  if (!sessionId) return
  savingTitle.value = true
  try {
    await updateSession(sessionId, { title: newTitle })
  } catch (err) {
    console.error('[NotebookHeader] Failed to persist session title:', err)
    MessagePlugin.warning('标题保存失败，仅本地生效')
  } finally {
    savingTitle.value = false
  }
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
</script>

<style lang="less" scoped>
.notebook-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 16px;
  /* 玻璃态顶栏：Apple/Claude 风格半透明白 + 模糊背景 */
  background: var(--glass-bg, rgba(255, 255, 255, 0.72));
  backdrop-filter: blur(var(--glass-blur, 20px)) saturate(var(--glass-saturate, 180%));
  -webkit-backdrop-filter: blur(var(--glass-blur, 20px)) saturate(var(--glass-saturate, 180%));
  border-bottom: 1px solid var(--td-component-stroke);
  flex-shrink: 0;
  z-index: 10;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.logo-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--td-brand-color);
  cursor: pointer;
  margin: 0 4px;
  border-radius: var(--td-radius-default, 6px);
  transition-property: background-color, color, transform;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.08));
  }

  &:active {
    transform: scale(0.94);
  }
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
  /* 长标题优化换行 */
  text-wrap: balance;
  letter-spacing: -0.01em;
}

.notebook-title-input {
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--td-brand-color);
  border-radius: var(--td-radius-default, 6px);
  padding: 4px 8px;
  outline: none;
  width: 320px;
  font-family: inherit;
  box-shadow: 0 0 0 3px var(--brand-color-glow, rgba(0, 113, 227, 0.16));
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

.header-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--td-component-border);
  background: var(--td-bg-color-container);
  color: var(--td-text-color-primary);
  border-radius: var(--td-radius-default, 6px);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition-property: background-color, border-color, color, transform, box-shadow;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: var(--td-bg-color-container-hover);
    border-color: var(--td-component-stroke);
  }

  &:active {
    transform: scale(0.97);
  }

  &.primary {
    background: var(--td-brand-color);
    border-color: var(--td-brand-color);
    color: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 2px 8px var(--brand-color-glow, rgba(0, 113, 227, 0.16));

    &:hover {
      background: var(--td-brand-color-hover);
      border-color: var(--td-brand-color-hover);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.06), 0 4px 12px var(--brand-color-glow, rgba(0, 113, 227, 0.24));
    }

    &:active {
      transform: scale(0.97);
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
  margin: 0 6px;
}
</style>
