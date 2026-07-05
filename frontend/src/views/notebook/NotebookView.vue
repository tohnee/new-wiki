<template>
  <div class="notebook-view">
    <NotebookHeader
      :title="notebookStore.notebookTitle"
      :left-collapsed="notebookStore.layout.leftPanelCollapsed"
      :right-collapsed="notebookStore.layout.rightPanelCollapsed"
      @toggle-left="notebookStore.toggleLeftPanel"
      @toggle-right="notebookStore.toggleRightPanel"
      @update:title="handleTitleUpdate"
    />

    <div class="notebook-body">
      <!-- 左栏：来源面板 -->
      <transition name="panel-slide-left">
        <div
          v-show="!notebookStore.layout.leftPanelCollapsed"
          class="panel panel-left"
          :style="{ width: `${notebookStore.layout.leftPanelWidth}px` }"
        >
          <SourcePanel
            :collapsed="false"
            @toggle="notebookStore.toggleLeftPanel"
          />
        </div>
      </transition>

      <!-- 左栏折叠时的展开按钮 -->
      <div v-show="notebookStore.layout.leftPanelCollapsed" class="panel-collapsed-left">
        <button
          class="expand-btn"
          title="展开来源面板"
          @click="notebookStore.toggleLeftPanel"
        >
          <t-icon name="chevron-right" size="16px" />
        </button>
      </div>

      <!-- 左栏拖拽调整宽度 -->
      <div
        v-if="!notebookStore.layout.leftPanelCollapsed"
        class="resize-handle resize-handle-left"
        @mousedown="startResize('left', $event)"
      />

      <!-- 中栏：对话区 -->
      <div class="panel panel-center">
        <NotebookChat />
      </div>

      <!-- 右栏拖拽调整宽度 -->
      <div
        v-if="!notebookStore.layout.rightPanelCollapsed"
        class="resize-handle resize-handle-right"
        @mousedown="startResize('right', $event)"
      />

      <!-- 右栏：Studio 面板 -->
      <transition name="panel-slide-right">
        <div
          v-show="!notebookStore.layout.rightPanelCollapsed"
          class="panel panel-right"
          :style="{ width: `${notebookStore.layout.rightPanelWidth}px` }"
        >
          <StudioPanel
            :collapsed="false"
            @toggle="notebookStore.toggleRightPanel"
          />
        </div>
      </transition>

      <!-- 右栏折叠时的展开按钮 -->
      <div v-show="notebookStore.layout.rightPanelCollapsed" class="panel-collapsed-right">
        <button
          class="expand-btn studio-expand"
          title="展开 Studio"
          @click="notebookStore.toggleRightPanel"
        >
          <t-icon name="wand" size="16px" />
        </button>
      </div>
    </div>
  </div>

  <!-- 新手引导（迁移自 creatChat） -->
  <ContextualGuide tour="chat" :when="true" />
</template>

<script setup lang="ts">
import NotebookHeader from '@/components/notebook/NotebookHeader.vue'
import SourcePanel from '@/components/notebook/SourcePanel.vue'
import NotebookChat from '@/components/notebook/NotebookChat.vue'
import StudioPanel from '@/components/notebook/StudioPanel.vue'
import ContextualGuide from '@/components/ContextualGuide.vue'
import { useNotebookStore } from '@/stores/notebook'
import { useRoute } from 'vue-router'
import { onMounted, watch } from 'vue'

const notebookStore = useNotebookStore()
const route = useRoute()

const handleTitleUpdate = (title: string) => {
  notebookStore.setNotebookTitle(title)
}

// ===== 调试日志：记录页面加载时的路由状态 =====
onMounted(() => {
  console.log('[NotebookView] mounted', {
    path: route.path,
    name: route.name,
    params: route.params,
    query: route.query,
    sessionId: route.params.sessionId ?? null,
  })
})

// 监听路由变化，记录切换行为（便于排查旧 creatChat 重定向是否生效）
watch(
  () => route.fullPath,
  (newPath, oldPath) => {
    console.log('[NotebookView] route changed', { from: oldPath, to: newPath, name: route.name })
  },
)

// 拖拽调整面板宽度
let resizeType: 'left' | 'right' | null = null
let startX = 0
let startWidth = 0

const startResize = (type: 'left' | 'right', e: MouseEvent) => {
  resizeType = type
  startX = e.clientX
  startWidth = type === 'left'
    ? notebookStore.layout.leftPanelWidth
    : notebookStore.layout.rightPanelWidth
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
}

const onResize = (e: MouseEvent) => {
  if (!resizeType) return
  const delta = e.clientX - startX
  if (resizeType === 'left') {
    notebookStore.setLeftPanelWidth(startWidth + delta)
  } else {
    notebookStore.setRightPanelWidth(startWidth - delta)
  }
}

const stopResize = () => {
  resizeType = null
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}
</script>

<style lang="less" scoped>
.notebook-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  /* NotebookLM 风格：浅灰背景，让三栏白色面板浮起 */
  background: var(--td-bg-color-page);
  overflow: hidden;
}

.notebook-body {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  position: relative;
  /* 给三栏之间留出浅灰间隔，强化卡片浮起感 */
  gap: 0;
  padding: 0;
}

.panel {
  min-width: 0;
  height: 100%;
  overflow: hidden;
  /* NotebookLM 卡片化：白色背景 + 微妙阴影 */
  background: var(--td-bg-color-container);
}

.panel-left,
.panel-right {
  flex-shrink: 0;
  transition-property: width;
  transition-duration: var(--duration-base, 220ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));
}

.panel-center {
  flex: 1;
  min-width: 400px;
  /* 中栏对话区使用浅灰背景，与左右白色面板形成对比 */
  background: var(--td-bg-color-page);
  border-left: 1px solid var(--td-component-stroke);
  border-right: 1px solid var(--td-component-stroke);
}

.panel-collapsed-left,
.panel-collapsed-right {
  width: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8px;
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-component-stroke);
}

.panel-collapsed-right {
  border-right: none;
  border-left: 1px solid var(--td-component-stroke);
}

.expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-secondary);
  border-radius: var(--td-radius-default, 6px);
  cursor: pointer;
  transition-property: background-color, color;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.08));
    color: var(--td-brand-color);
  }

  &:active {
    transform: scale(0.96);
  }

  &.studio-expand {
    color: var(--td-brand-color);
  }
}

.resize-handle {
  width: 4px;
  flex-shrink: 0;
  cursor: ew-resize;
  position: relative;
  background: transparent;
  transition-property: background;
  transition-duration: var(--duration-fast, 150ms);
  z-index: 5;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 1px;
    width: 2px;
    height: 100%;
    background: transparent;
    transition-property: background;
    transition-duration: var(--duration-fast, 150ms);
  }

  &:hover::after,
  &:active::after {
    background: var(--td-brand-color);
  }
}

/* 面板展开/收起动画（Apple 风格曲线） */
.panel-slide-left-enter-active,
.panel-slide-left-leave-active,
.panel-slide-right-enter-active,
.panel-slide-right-leave-active {
  transition-property: transform, opacity;
  transition-duration: var(--duration-base, 220ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));
}

.panel-slide-left-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}

.panel-slide-left-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

.panel-slide-right-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.panel-slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>
