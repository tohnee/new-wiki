/**
 * Studio job 超时机制（纯函数 + 依赖注入）。
 *
 * 用途：当对话流式响应中断（网络抖动、SSE 连接断开、用户切后台），Studio job
 * 可能永久停留在 generating 状态。本模块提供：
 * - 同步 API：批量扫描 jobs 数组，把超时的 job 标记为 failed（用于页面加载时的恢复扫描）
 * - 异步 API：给单个新 job 安排一个定时器，到期触发回调（用于实时监控）
 *
 * 只追踪 generating 状态的 job，completed / failed / pending 不处理。
 */
import type { StudioJob } from '../types/notebook'

/** 默认超时时间：5 分钟（足够长的对话生成周期） */
export const DEFAULT_JOB_TIMEOUT_MS = 5 * 60 * 1000

/**
 * 判断某个 job 是否已超时（仅 generating 状态）。
 * 防御性：createdAt 无法解析为时间戳时返回 false。
 */
export function isJobStale(
  job: StudioJob,
  nowMs: number,
  timeoutMs: number,
): boolean {
  if (job.status !== 'generating') return false
  const createdMs = Date.parse(job.createdAt)
  if (Number.isNaN(createdMs)) return false
  return nowMs - createdMs >= timeoutMs
}

/** 找出 jobs 数组中所有已超时的 generating job（不修改原数组）。 */
export function findStaleJobs(
  jobs: StudioJob[],
  nowMs: number,
  timeoutMs: number,
): StudioJob[] {
  return jobs.filter((j) => isJobStale(j, nowMs, timeoutMs))
}

/**
 * 原地把所有超时的 generating job 标记为 failed。
 * - 不修改 completed / failed / pending 的 job
 * - 更新 updatedAt / errorMessage / progress=0
 *
 * @returns 被标记为 failed 的 job id 列表（用于日志/通知）
 */
export function markStaleJobsAsFailed(
  jobs: StudioJob[],
  nowMs: number,
  timeoutMs: number,
  errorMessage: string,
): string[] {
  const failedIds: string[] = []
  const nowIso = new Date(nowMs).toISOString()
  for (const job of jobs) {
    if (!isJobStale(job, nowMs, timeoutMs)) continue
    job.status = 'failed'
    job.errorMessage = errorMessage
    job.updatedAt = nowIso
    job.progress = 0
    failedIds.push(job.id)
  }
  return failedIds
}

/** scheduleJobTimeout 依赖的 timer 函数（用于依赖注入测试） */
export interface JobTimeoutTimer {
  customSetTimeout?: (fn: () => void, ms: number) => any
  customClearTimeout?: (id: any) => void
}

export interface ScheduleJobTimeoutOptions extends JobTimeoutTimer {
  jobId: string
  timeoutMs: number
  onTimeout: (jobId: string) => void
}

/**
 * 给单个 job 安排一个超时定时器。
 * - 到期调用 onTimeout(jobId)，由调用方决定如何处理（一般是标记 failed + 提示用户）
 * - 返回 cancel 函数：在对话正常完成、用户主动停止、组件卸载时调用，取消定时器
 *
 * 通过 customSetTimeout / customClearTimeout 可注入测试用 timer，避免真实等待。
 */
export function scheduleJobTimeout(opts: ScheduleJobTimeoutOptions): () => void {
  const setTimeoutFn = opts.customSetTimeout ?? setTimeout
  const clearTimeoutFn = opts.customClearTimeout ?? clearTimeout
  let timerId: any
  let cancelled = false
  timerId = setTimeoutFn(() => {
    if (cancelled) return
    opts.onTimeout(opts.jobId)
  }, opts.timeoutMs)
  return () => {
    if (cancelled) return
    cancelled = true
    try {
      clearTimeoutFn(timerId)
    } catch {
      // 忽略已清除的 timer
    }
  }
}
