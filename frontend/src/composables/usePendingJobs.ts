/**
 * pendingJob 多 session 化的纯函数集合。
 *
 * 背景：原 notebook store 用单个 `pendingJobId: ref<string | null>(null)` 跟踪
 * Studio 工具触发的"等待对话完成"任务。当用户在 session A 触发 Studio 后切换到
 * session B，B 的对话完成时会错误地把 A 的 job 标记为完成。
 *
 * 改为 Map<sessionId, jobId> 后可同时挂多个 pending，且按 session 索引。
 *
 * 这里只暴露操作 Map 的纯函数；store 内部包装为 ref<Map> 即可。
 */

export interface PendingJobEntry {
  sessionId: string
  jobId: string
}

/** 创建一个空的 pending jobs Map。 */
export function createPendingJobMap(): Map<string, string> {
  return new Map()
}

/** 设置指定 session 的 pending job ID（覆盖该 session 上已有的）。 */
export function setPendingJob(
  map: Map<string, string>,
  sessionId: string,
  jobId: string,
): void {
  map.set(sessionId, jobId)
}

/** 仅查看指定 session 的 pending job ID，不删除。 */
export function peekPendingJob(
  map: Map<string, string>,
  sessionId: string,
): string | null {
  return map.get(sessionId) ?? null
}

/** 取出并删除指定 session 的 pending job ID；不存在时返回 null。 */
export function consumePendingJob(
  map: Map<string, string>,
  sessionId: string,
): string | null {
  const jobId = map.get(sessionId) ?? null
  if (jobId !== null) {
    map.delete(sessionId)
  }
  return jobId
}

/**
 * 把 pending job 从 oldSessionId 迁移到 newSessionId。
 *
 * 用于 P0-6 修复场景：Studio 工具在 chatSessionId 为空字符串时被触发，
 * triggerStudioTool 会用 '' 作为 key 写入 pendingJobs。NotebookChat 在
 * ensureSession 之后才拿到真实 sessionId，此时需要把空 key 上的 pending job
 * 重新绑定到真实 sessionId 上，否则 onReplyComplete 用真实 sessionId 取不到
 * pending job，Studio job 永远卡在 generating 状态。
 *
 * - 若 oldSessionId 上无 pending job，返回 false 且不做任何修改
 * - 若 newSessionId 上已有 pending job，会被覆盖（业务上同一 session 不会
 *   同时存在两个 pending job，覆盖是合理行为）
 * - 迁移成功返回 true
 */
export function rebindPendingJob(
  map: Map<string, string>,
  oldSessionId: string,
  newSessionId: string,
): boolean {
  const jobId = map.get(oldSessionId)
  if (jobId === undefined) return false
  if (oldSessionId === newSessionId) return true
  map.delete(oldSessionId)
  map.set(newSessionId, jobId)
  return true
}

/**
 * 取出所有 pending job 并清空 Map。用于组件卸载时一次性消费所有未完成的 pending，
 * 防止 Studio job 永远卡在 generating 状态。
 */
export function consumeAllPendingJobs(
  map: Map<string, string>,
): PendingJobEntry[] {
  const entries: PendingJobEntry[] = []
  for (const [sessionId, jobId] of map.entries()) {
    entries.push({ sessionId, jobId })
  }
  map.clear()
  return entries
}

/** 返回当前 pending job 的数量。 */
export function getPendingJobCount(map: Map<string, string>): number {
  return map.size
}
