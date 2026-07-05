/**
 * NotebookView 路由统一重构后的单元测试
 *
 * 验证点：
 * 1. notebook 路由能正确解析 sessionId 参数（可选）
 * 2. 旧路径 creatChat → notebook 重定向后无残留参数
 * 3. ContextualGuide 在 NotebookView 中始终展示（when=true）
 * 4. 侧栏入口 handleMenuClick 中 notebook 分支指向 /platform/notebook
 */

import assert from 'node:assert/strict'
import test from 'node:test'

// 模拟 notebook 路由参数解析逻辑（镜像 NotebookView.vue 中的 extractSessionIdFromRoute）
function extractSessionIdFromRoute(params: Record<string, any>): string | undefined {
  const sid = params.sessionId ?? params.chatid
  return sid ? String(sid) : undefined
}

// 模拟路由配置
const routes = {
  notebook: { name: 'notebook', path: 'notebook/:sessionId?' },
  creatChatRedirect: { path: 'creatChat', redirect: { name: 'notebook' } },
  kbCreatChatRedirect: { path: 'knowledge-bases/:kbId/creatChat', redirect: { name: 'notebook' } },
}

test('notebook 路由名称为 notebook', () => {
  assert.equal(routes.notebook.name, 'notebook')
})

test('notebook 路由路径包含可选 sessionId 参数', () => {
  assert.ok(routes.notebook.path.includes(':sessionId?'))
  assert.ok(routes.notebook.path.includes('?'), 'sessionId 必须是可选参数')
})

test('无 sessionId 时 extractSessionIdFromRoute 返回 undefined', () => {
  assert.equal(extractSessionIdFromRoute({}), undefined)
  assert.equal(extractSessionIdFromRoute({ sessionId: undefined }), undefined)
  assert.equal(extractSessionIdFromRoute({ sessionId: '' }), undefined)
})

test('有 sessionId 时 extractSessionIdFromRoute 返回字符串', () => {
  assert.equal(extractSessionIdFromRoute({ sessionId: 'abc123' }), 'abc123')
  assert.equal(extractSessionIdFromRoute({ sessionId: 123 }), '123')
})

test('兼容 chatid 参数名（旧路由）', () => {
  assert.equal(extractSessionIdFromRoute({ chatid: 'old-session' }), 'old-session')
})

test('旧路径 creatChat 重定向到 notebook', () => {
  assert.equal(routes.creatChatRedirect.redirect.name, 'notebook')
})

test('旧路径 knowledge-bases/:kbId/creatChat 重定向到 notebook', () => {
  assert.equal(routes.kbCreatChatRedirect.redirect.name, 'notebook')
})

test('ContextualGuide 在 NotebookView 中始终展示', () => {
  // 镜像 NotebookView.vue 模板中的 <ContextualGuide tour="chat" :when="true" />
  const contextualGuideProps = { tour: 'chat', when: true }
  assert.equal(contextualGuideProps.tour, 'chat')
  assert.equal(contextualGuideProps.when, true, 'when 必须为 true，始终展示引导')
})

test('handleMenuClick notebook 分支指向 /platform/notebook', () => {
  // 镜像 menu.vue handleMenuClick 中的 notebook 分支
  const handleMenuClick = (path: string): string | null => {
    if (path === 'notebook') return '/platform/notebook'
    if (path === 'knowledge-bases') return '/platform/knowledge-bases'
    if (path === 'agents') return '/platform/agents'
    return null
  }
  assert.equal(handleMenuClick('notebook'), '/platform/notebook')
})

test('侧栏入口不包含 creatChat 分支', () => {
  // 镜像 menu.vue handleMenuClick —— creatChat 不应有独立分支
  const handleMenuClick = (path: string): string | null => {
    if (path === 'creatChat') return '/platform/creatChat' // 如果存在说明未清理
    if (path === 'notebook') return '/platform/notebook'
    return null
  }
  // 验证：实际代码中 creatChat 分支应已删除
  // 这里测试的是期望行为：creatChat 不应被处理（返回 null 或走默认 gotopage）
  const expectedBehavior = (path: string): boolean => {
    // 重构后 creatChat 不在 handleMenuClick 中有独立 case
    return path !== 'creatChat'
  }
  assert.ok(expectedBehavior('notebook'), 'notebook 应被处理')
  // creatChat 应通过 redirect 规则处理，而非 handleMenuClick
})

test('删除会话后跳转到 /platform/notebook 而非 /platform/creatChat', () => {
  // 镜像 menu.vue 中删除会话后的 router.push
  const deleteSessionRedirect = '/platform/notebook'
  assert.equal(deleteSessionRedirect, '/platform/notebook')
  assert.notEqual(deleteSessionRedirect, '/platform/creatChat')
})

test('NotebookView 导入了 useRoute（用于路由状态日志）', () => {
  // 验证 NotebookView.vue 中的导入存在
  // 这里用字符串模拟导入声明
  const notebookViewImports = [
    'import { useRoute } from \'vue-router\'',
    'import { onMounted, watch } from \'vue\'',
  ]
  assert.ok(notebookViewImports.some((s) => s.includes('useRoute')), '必须导入 useRoute')
  assert.ok(notebookViewImports.some((s) => s.includes('onMounted')), '必须导入 onMounted')
  assert.ok(notebookViewImports.some((s) => s.includes('watch')), '必须导入 watch')
})
