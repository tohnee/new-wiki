/**
 * PRO 工具权限校验。
 *
 * 部分 Studio 工具标记为 PRO（tool.pro === true），需要更高的租户角色才能使用。
 * 本模块提供纯函数判断，由 UI 层调用并展示相应提示。
 *
 * 权限模型：
 * - 非 PRO 工具：所有用户可用
 * - PRO 工具：需要 admin 及以上角色（admin / owner）
 *
 * 注意：客户端权限仅用于 UI 展示，最终由后端 RBAC 强制执行。
 */

import type { StudioToolCard } from '../types/notebook'

/**
 * 判断用户是否可以使用某个工具。
 *
 * @param tool 工具卡片
 * @param hasAdminRole 用户是否拥有 admin 及以上角色（由 auth store 的 hasRole('admin') 提供）
 */
export function canUseProTool(tool: StudioToolCard, hasAdminRole: boolean): boolean {
  if (!tool.pro) return true
  return hasAdminRole
}

/**
 * 返回 PRO 工具被拒绝时的提示消息。非 PRO 工具返回 null。
 */
export function getProToolDeniedMessage(tool: StudioToolCard): string | null {
  if (!tool.pro) return null
  return `「${tool.name}」是 PRO 工具，需要管理员权限。请联系租户管理员升级角色后再使用。`
}
