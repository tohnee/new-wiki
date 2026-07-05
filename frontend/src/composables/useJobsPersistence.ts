/**
 * Studio jobs 的 localStorage 持久化（纯函数 + 依赖注入）。
 *
 * 设计要点：
 * - pendingJobs Map 不持久化（属于临时通信状态，组件卸载时已被 consume 掉）。
 * - generating / pending 状态的 job 不持久化：它们是临时状态，刷新页面后应当重置。
 *   只持久化 completed / failed，让用户能看到历史生成记录。
 * - 容量限制：避免 localStorage 无限增长，默认保留最新的 N 条（调用方决定 N）。
 * - 向后兼容：旧数据可能没有 sessionId 字段，反序列化时不报错（字段保持 undefined）。
 */
import type { StudioJob } from '../types/notebook'

/** 持久化时保留的最大 job 条数（store 层可覆盖） */
export const DEFAULT_JOBS_CAPACITY = 50

/** 序列化 jobs 数组为 JSON 字符串。 */
export function serializeJobs(jobs: StudioJob[]): string {
  return JSON.stringify(jobs)
}

/**
 * 反序列化 JSON 字符串为 jobs 数组。
 * - 空字符串 / 非 JSON / 非数组 → 返回空数组
 * - 缺失 id 的条目被丢弃（防止脏数据导致渲染崩溃）
 * - sessionId 字段缺失时保持 undefined（向后兼容）
 */
export function deserializeJobs(raw: string): StudioJob[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((item): item is StudioJob => {
    if (!item || typeof item !== 'object') return false
    const j = item as Record<string, unknown>
    return typeof j.id === 'string' && typeof j.type === 'string'
  })
}

/**
 * 过滤出可持久化的 jobs：
 * - completed / failed 状态保留
 * - generating / pending 状态丢弃（临时状态，刷新后无法恢复流式）
 */
export function filterPersistableJobs(jobs: StudioJob[]): StudioJob[] {
  return jobs.filter((j) => j.status === 'completed' || j.status === 'failed')
}

/**
 * 按容量裁剪 jobs 数组，保留最新的 N 条。
 * 约定：数组前部为最新（store 用 unshift 追加），所以取前 N 项。
 * 不修改原数组，返回新数组（或原数组的 slice）。
 */
export function pruneJobsToCapacity(jobs: StudioJob[], maxCount: number): StudioJob[] {
  if (maxCount <= 0) return []
  if (jobs.length <= maxCount) return jobs.slice()
  return jobs.slice(0, maxCount)
}

/**
 * 从 localStorage 加载 jobs。
 * - key 不存在 / 反序列化失败 → 返回空数组
 */
export function loadJobs(storage: Storage, key: string): StudioJob[] {
  const raw = storage.getItem(key)
  if (!raw) return []
  return deserializeJobs(raw)
}

/**
 * 保存 jobs 到 localStorage：
 *  1. 过滤掉 generating / pending（不持久化临时状态）
 *  2. 按容量裁剪
 *  3. 序列化后写入 storage
 *
 * 当 storage.setItem 抛出（如 QuotaExceededError）时静默吞掉，避免阻塞 UI。
 */
export function saveJobs(
  storage: Storage,
  key: string,
  jobs: StudioJob[],
  maxCount: number = DEFAULT_JOBS_CAPACITY,
): void {
  const persistable = filterPersistableJobs(jobs)
  const pruned = pruneJobsToCapacity(persistable, maxCount)
  const raw = serializeJobs(pruned)
  try {
    storage.setItem(key, raw)
  } catch (e) {
    // 忽略 quota 错误，避免阻塞 UI
    if (import.meta.env?.DEV) {
      console.warn('[useJobsPersistence] Failed to persist jobs:', e)
    }
  }
}
