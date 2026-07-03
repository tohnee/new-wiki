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
</template>

<script setup lang="ts">
import NotebookHeader from '@/components/notebook/NotebookHeader.vue'
import SourcePanel from '@/components/notebook/SourcePanel.vue'
import NotebookChat from '@/components/notebook/NotebookChat.vue'
import StudioPanel from '@/components/notebook/StudioPanel.vue'
import { useNotebookStore } from '@/stores/notebook'

const notebookStore = useNotebookStore()

const handleTitleUpdate = (title: string) => {
  notebookStore.setNotebookTitle(title)
}

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
  background: var(--td-bg-color-container);
  overflow: hidden;
}

.notebook-body {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  position: relative;
}

.panel {
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.panel-left,
.panel-right {
  flex-shrink: 0;
  transition: width 0.25s ease;
}

.panel-center {
  flex: 1;
  min-width: 400px;
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
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--td-brand-color-light);
    color: var(--td-brand-color);
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
  transition: background 0.15s ease;
  z-index: 5;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 1px;
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background 0.15s ease;
  }

  &:hover::after,
  &:active::after {
    background: var(--td-brand-color);
  }
}

/* 面板展开/收起动画 */
.panel-slide-left-enter-active,
.panel-slide-left-leave-active,
.panel-slide-right-enter-active,
.panel-slide-right-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
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
