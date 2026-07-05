/**
 * 推荐问题构建的纯函数集合。
 *
 * 拆出为独立模块的原因：
 * 1. NotebookChat.vue 原本只用硬编码列表，没有 agent 模式下的远程推荐问题接入；
 * 2. 后端 `/agents/:id/suggested-questions` 返回的是对象数组 {question, source, ...}，
 *    需要扁平化为字符串数组供模板 v-for 渲染；
 * 3. 远程失败 / 返回空 / 非 agent 模式都需回退到本地兜底，逻辑需独立可测。
 */
import type { SuggestedQuestion } from '../api/agent/index'

/** 从单条 SuggestedQuestion 中提取问题文本（去前后空格；非法类型返回空字符串）。 */
export function extractQuestionText(q: SuggestedQuestion): string {
  if (typeof q?.question !== 'string') return ''
  return q.question.trim()
}

/**
 * 根据当前模式与后端返回构建最终展示的推荐问题字符串数组。
 *
 * @param remote       后端返回的 SuggestedQuestion 列表（可能为空）
 * @param fallback     本地兜底问题列表
 * @param isAgentMode  当前是否为 agent 模式（非 agent 模式直接返回 fallback）
 * @param limit        返回条数上限；<=0 表示不限制
 */
export function buildSuggestedQuestions(
  remote: SuggestedQuestion[],
  fallback: string[],
  isAgentMode: boolean,
  limit = 0,
): string[] {
  if (!isAgentMode) return fallback

  const filtered = remote
    .map(extractQuestionText)
    .filter((q): q is string => q.length > 0)

  if (filtered.length === 0) return fallback

  return limit > 0 ? filtered.slice(0, limit) : filtered
}
