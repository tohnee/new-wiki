import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractSessionIdFromRoute,
  shouldHydrateSession,
} from './useSessionHydration.ts'

// ===== extractSessionIdFromRoute =====

test('extractSessionIdFromRoute returns sessionId when present', () => {
  const id = extractSessionIdFromRoute({ sessionId: 'abc-123' })
  assert.equal(id, 'abc-123')
})

test('extractSessionIdFromRoute falls back to chatid for backward compat', () => {
  // 路由历史上曾用 chatid 参数；保留兼容避免回归。
  const id = extractSessionIdFromRoute({ chatid: 'legacy-456' })
  assert.equal(id, 'legacy-456')
})

test('extractSessionIdFromRoute prefers sessionId over chatid when both exist', () => {
  const id = extractSessionIdFromRoute({ sessionId: 'new', chatid: 'old' })
  assert.equal(id, 'new')
})

test('extractSessionIdFromRoute returns empty string when neither param exists', () => {
  assert.equal(extractSessionIdFromRoute({}), '')
  assert.equal(extractSessionIdFromRoute({ foo: 'bar' }), '')
})

test('extractSessionIdFromRoute returns empty string when value is array', () => {
  // vue-router 在重复参数场景下可能返回数组；非 notebook 路由不应尝试加载历史。
  assert.equal(extractSessionIdFromRoute({ sessionId: ['a', 'b'] }), '')
  assert.equal(extractSessionIdFromRoute({ chatid: ['x'] }), '')
})

test('extractSessionIdFromRoute trims whitespace', () => {
  assert.equal(extractSessionIdFromRoute({ sessionId: '  spaced  ' }), 'spaced')
})

// ===== shouldHydrateSession =====

test('shouldHydrateSession returns false when routeSessionId is empty', () => {
  assert.equal(shouldHydrateSession('', '', false), false)
  assert.equal(shouldHydrateSession('', 'existing', false), false)
})

test('shouldHydrateSession returns false in embedded mode', () => {
  // 嵌入式场景由宿主注入状态，不应当从路由恢复历史
  assert.equal(shouldHydrateSession('abc', '', true), false)
  assert.equal(shouldHydrateSession('abc', 'different', true), false)
})

test('shouldHydrateSession returns false when routeSessionId equals currentSessionId', () => {
  // 已经加载过该 session 的历史，不应当重复加载
  assert.equal(shouldHydrateSession('abc', 'abc', false), false)
})

test('shouldHydrateSession returns true when routeSessionId differs from current', () => {
  assert.equal(shouldHydrateSession('abc', '', false), true)
  assert.equal(shouldHydrateSession('abc', 'different', false), true)
})

test('shouldHydrateSession is case-sensitive', () => {
  // UUID 是大小写敏感的；不要把大小写不同的 ID 当作相同
  assert.equal(shouldHydrateSession('Abc', 'abc', false), true)
})
