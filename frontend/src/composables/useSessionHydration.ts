/**
 * 路由 → session 恢复决策的纯函数集合。
 *
 * 拆出为独立模块的原因：
 * 1. NotebookChat.vue 原本读取 `route.params.chatid`，但 notebook 路由实际使用
 *    `:sessionId?` 参数；导致 /notebook/:id 进入时永远拿不到 ID，历史无法加载。
 * 2. 路由切换到另一个 session 时，需要纯函数判定是否要重新加载历史，避免重复加载。
 * 3. 单独抽离便于单测（Node test runner + node:assert/strict）。
 */

/**
 * 从 vue-router 的 route.params 中提取 session ID，兼容新旧两种参数名。
 * params 类型保持宽松以匹配真实 route.params 形态（可能含其他路由参数）。
 */
export function extractSessionIdFromRoute(params: {
  sessionId?: unknown
  chatid?: unknown
  [key: string]: unknown
}): string {
  const fromSessionId = pickString(params.sessionId)
  if (fromSessionId) return fromSessionId
  return pickString(params.chatid)
}

/** 仅接受非空字符串值；数组（vue-router 重复参数）或其它类型返回空。 */
function pickString(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed
}

/**
 * 判定是否需要根据路由携带的 sessionId 触发历史恢复。
 *
 * @param routeSessionId  从路由提取的 sessionId
 * @param currentSessionId 当前组件已持有的 sessionId（已加载过历史）
 * @param isEmbeddedMode   嵌入式场景由宿主注入状态，跳过路由恢复
 */
export function shouldHydrateSession(
  routeSessionId: string,
  currentSessionId: string,
  isEmbeddedMode: boolean,
): boolean {
  if (!routeSessionId) return false
  if (isEmbeddedMode) return false
  if (routeSessionId === currentSessionId) return false
  return true
}
