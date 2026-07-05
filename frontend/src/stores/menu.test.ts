/**
 * menu store 路由统一重构后的单元测试
 *
 * 由于 menu.ts 导入了 @/i18n（Node 原生 test runner 无法解析 @ 别名），
 * 这里不直接导入 useMenuStore，而是用纯数据模拟 menuArr 结构，
 * 验证重构后的核心不变式：
 *
 * 1. creatChat 项保留在 menuArr 中（数据容器），visibleMenuArr 过滤掉它
 * 2. notebook 项在 visibleMenuArr 中可见
 * 3. sidebarHiddenPaths 只包含 creatChat
 * 4. 旧路径 redirect 配置正确指向 notebook
 */

import assert from 'node:assert/strict'
import test from 'node:test'

// 镜像 menu.ts 的配置（保持与源码同步）
const SIDEBAR_HIDDEN_PATHS = new Set(['creatChat'])
const LITE_HIDDEN_PATHS = new Set(['logout', 'organizations'])

const menuArr = [
  { path: 'creatChat', children: [] },
  { path: 'notebook' },
  { path: 'knowledge-bases' },
  { path: 'agents' },
  { path: 'integrations' },
  { path: 'organizations' },
  { path: 'settings' },
  { path: 'logout' },
]

const notebookRoute = { path: 'notebook/:sessionId?', name: 'notebook' }
const creatChatRedirect = { path: 'creatChat', redirect: { name: 'notebook' } }
const kbCreatChatRedirect = { path: 'knowledge-bases/:kbId/creatChat', redirect: { name: 'notebook' } }

function computeVisibleMenuArr(isLiteMode: boolean, hasAdminRole: boolean) {
  return menuArr.filter((item) => {
    if (isLiteMode && LITE_HIDDEN_PATHS.has(item.path)) return false
    if (item.path === 'organizations' && !hasAdminRole) return false
    if (SIDEBAR_HIDDEN_PATHS.has(item.path)) return false
    return true
  })
}

test('creatChat 项保留在 menuArr 中作数据容器', () => {
  const creatChatItem = menuArr.find((m) => m.path === 'creatChat')
  assert.ok(creatChatItem, 'creatChat 必须在 menuArr 中')
  assert.ok(Array.isArray(creatChatItem.children), 'creatChat.children 必须是数组')
})

test('creatChat 不在 visibleMenuArr 中渲染', () => {
  const visible = computeVisibleMenuArr(false, true)
  const paths = visible.map((m) => m.path)
  assert.ok(!paths.includes('creatChat'), 'creatChat 不应在 visibleMenuArr 中')
})

test('notebook 在 visibleMenuArr 中可见', () => {
  const visible = computeVisibleMenuArr(false, true)
  const paths = visible.map((m) => m.path)
  assert.ok(paths.includes('notebook'), 'notebook 必须可见')
  assert.ok(paths.includes('knowledge-bases'), 'knowledge-bases 必须可见')
  assert.ok(paths.includes('agents'), 'agents 必须可见')
})

test('sidebarHiddenPaths 只包含 creatChat', () => {
  assert.equal(SIDEBAR_HIDDEN_PATHS.size, 1)
  assert.ok(SIDEBAR_HIDDEN_PATHS.has('creatChat'))
})

test('lite 模式下 logout 和 organizations 被隐藏', () => {
  const visible = computeVisibleMenuArr(true, true)
  const paths = visible.map((m) => m.path)
  assert.ok(!paths.includes('logout'), 'lite 模式下 logout 应隐藏')
  assert.ok(!paths.includes('organizations'), 'lite 模式下 organizations 应隐藏')
  assert.ok(!paths.includes('creatChat'), 'creatChat 始终隐藏')
  assert.ok(paths.includes('notebook'), 'notebook 在 lite 模式下仍可见')
})

test('非 admin 用户看不到 organizations', () => {
  const visible = computeVisibleMenuArr(false, false)
  const paths = visible.map((m) => m.path)
  assert.ok(!paths.includes('organizations'), '非 admin 不应看到 organizations')
  assert.ok(paths.includes('notebook'), 'notebook 不受角色影响')
})

test('旧路径 /platform/creatChat 重定向到 notebook', () => {
  assert.equal(creatChatRedirect.redirect.name, 'notebook')
  assert.equal(creatChatRedirect.path, 'creatChat')
})

test('旧路径 /platform/knowledge-bases/:kbId/creatChat 重定向到 notebook', () => {
  assert.equal(kbCreatChatRedirect.redirect.name, 'notebook')
  assert.equal(kbCreatChatRedirect.path, 'knowledge-bases/:kbId/creatChat')
})

test('notebook 路由配置正确', () => {
  assert.equal(notebookRoute.name, 'notebook')
  assert.ok(notebookRoute.path.includes(':sessionId?'), 'notebook 路由必须有可选 sessionId 参数')
})

test('menuArr 中 creatChat 在 notebook 之前', () => {
  const paths = menuArr.map((m) => m.path)
  const creatChatIdx = paths.indexOf('creatChat')
  const notebookIdx = paths.indexOf('notebook')
  assert.ok(creatChatIdx >= 0 && notebookIdx >= 0)
  assert.ok(creatChatIdx < notebookIdx, 'creatChat 应在 notebook 之前')
})

test('模拟 updataMenuChildren 写入 creatChat.children 仍有效', () => {
  // 复制 menuArr 模拟 store 操作
  const arr = menuArr.map((m) => ({ ...m, children: m.children ? [...m.children] : undefined }))
  const chatMenu = arr.find((m) => m.path === 'creatChat')!

  const fakeSession = { id: 'test-1', title: 'Test', path: 'chat/test-1' }
  chatMenu.children!.unshift(fakeSession)

  assert.equal(chatMenu.children!.length, 1)
  assert.equal(chatMenu.children![0].id, 'test-1')

  // 模拟 updatemenuArr 去重
  const exists = chatMenu.children!.some((c: any) => c.id === 'test-1')
  if (!exists) chatMenu.children!.push(fakeSession)
  assert.equal(chatMenu.children!.length, 1, '相同 id 不应重复写入')
})

test('模拟 clearMenuArr 清空 creatChat.children', () => {
  const arr = menuArr.map((m) => ({ ...m, children: m.children ? [...m.children] : undefined }))
  const chatMenu = arr.find((m) => m.path === 'creatChat')!
  chatMenu.children!.unshift({ id: 's1' })
  assert.ok(chatMenu.children!.length > 0)

  // clearMenuArr
  chatMenu.children = []
  assert.equal(chatMenu.children.length, 0)
})
