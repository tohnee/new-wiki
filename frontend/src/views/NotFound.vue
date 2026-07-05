<template>
  <div class="not-found">
    <div class="nf-content">
      <div class="nf-code">404</div>
      <h1 class="nf-title">页面未找到</h1>
      <p class="nf-desc">你访问的路径不存在或已被移动。</p>
      <div class="nf-actions">
        <button class="nf-btn nf-btn-primary" @click="goHome">
          <t-icon name="home" size="14px" />
          返回首页
        </button>
        <button class="nf-btn nf-btn-secondary" @click="goBack">
          <t-icon name="arrow-left" size="14px" />
          返回上一页
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

const goHome = () => {
  router.push('/platform/knowledge-bases')
}

const goBack = () => {
  // router.back() 在无历史记录时是 no-op，加 fallback 避免用户卡住
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/platform/knowledge-bases')
  }
}
</script>

<style lang="less" scoped>
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--td-bg-color-page, #f5f5f5);
  padding: 24px;
}

.nf-content {
  text-align: center;
  max-width: 480px;
}

.nf-code {
  font-size: 96px;
  font-weight: 700;
  color: var(--td-brand-color, #0052d9);
  line-height: 1;
  margin-bottom: 12px;
  letter-spacing: -2px;
}

.nf-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--td-text-color-primary, #333);
  margin: 0 0 8px;
}

.nf-desc {
  font-size: 14px;
  color: var(--td-text-color-secondary, #666);
  margin: 0 0 24px;
}

.nf-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.nf-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.nf-btn-primary {
  background: var(--td-brand-color, #0052d9);
  color: #fff;
  border-color: var(--td-brand-color, #0052d9);

  &:hover {
    background: var(--td-brand-color-hover, #003cab);
  }
}

.nf-btn-secondary {
  background: transparent;
  color: var(--td-text-color-primary, #333);
  border-color: var(--td-component-border, #d9d9d9);

  &:hover {
    background: var(--td-bg-color-container-hover, #f0f0f0);
  }
}
</style>
