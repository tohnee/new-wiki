/**
 * Studio 工具触发逻辑（纯函数 + 依赖注入）。
 *
 * 抽取自 StudioPanel.handleToolClick，让 NotebookHeader 的"分析"下拉
 * 也能复用同一套：addJob → setPendingJob → triggerSendPrompt → setViewingJob。
 *
 * 设计说明：
 * - 这里不直接 import useNotebookStore 或 STUDIO_TOOL_CARDS，而是让调用方传入，
 *   这样 composable 可以在 Node 原生 test runner 下被单测（store 和 tools 用 mock）。
 * - 同时修正了原 StudioPanel 中的 sourceType 类型 bug（原来传 'selected'，
 *   不在 StudioJob.sourceType 的合法枚举里）。
 */
import type { StudioToolType, StudioToolCard, StudioJob } from '../types/notebook'

/** 触发工具所依赖的 store 形状（useNotebookStore 的子集） */
export interface StudioToolStore {
  selectedSourceCount: number
  /** 当前对话会话 ID；用于把 pending job 绑定到具体 session */
  chatSessionId: string
  addJob(job: StudioJob): void
  setPendingJob(sessionId: string, jobId: string): void
  triggerSendPrompt(prompt: string): void
  setViewingJob(id: string | null): void
}

/** 分析下拉用的精简工具项 */
export interface AnalysisToolOption {
  type: StudioToolType
  name: string
  icon: string
  description: string
  pro?: boolean
}

/** 从一组工具卡里筛选分析类工具（insight 分类），用于 Header 的"分析"下拉 */
export function getAnalysisTools(tools: StudioToolCard[]): AnalysisToolOption[] {
  return tools
    .filter((t) => t.category === 'insight')
    .map((t) => ({
      type: t.type,
      name: t.name,
      icon: t.icon,
      description: t.description,
      pro: t.pro,
    }))
}

/** 构建 Studio 工具的发送 prompt（含来源提示） */
export function buildStudioPrompt(tool: StudioToolCard, sourceCount: number): string {
  const sourceHint = sourceCount > 0 ? `（基于已选的 ${sourceCount} 个来源）` : ''
  return tool.prompt + sourceHint
}

/** 构建一个 generating 状态的 StudioJob（纯函数，便于单测） */
export function buildStudioJob(
  tool: StudioToolCard,
  sourceCount: number,
  now: string,
  id: string,
  sessionId?: string,
): StudioJob {
  return {
    id,
    type: tool.type,
    name: tool.name,
    status: 'generating',
    sourceCount,
    // 修正：原 StudioPanel 传 'selected' 不在合法枚举里
    sourceType: sourceCount > 0 ? 'documents' : 'conversation',
    createdAt: now,
    updatedAt: now,
    progress: 0,
    // 把 job 绑定到触发时的 session；为空字符串时仍写入以便兼容
    sessionId: sessionId ?? '',
  }
}

/**
 * 触发一个 Studio 工具：
 *  1. 在 store.jobs 中追加一条 generating 状态的 job
 *  2. 设置 pendingJob（按 sessionId 索引；NotebookChat 在对话完成后会消费它并回填 job）
 *  3. 通过 store 的 sendPrompt 通道触发对话输入框发送
 *  4. 切换 StudioPanel 到该 job 的查看视图
 *
 * @param toolType 工具类型
 * @param store    notebook store（生产代码传 useNotebookStore()，测试传 mock）
 * @param tools    工具卡列表（生产代码传 STUDIO_TOOL_CARDS，测试可传 mock）
 * @returns 新建的 jobId；如果 toolType 不存在则返回 null 且不做任何副作用
 */
export function triggerStudioTool(
  toolType: StudioToolType,
  store: StudioToolStore,
  tools: StudioToolCard[],
): string | null {
  const tool = tools.find((t) => t.type === toolType)
  if (!tool) return null

  const sourceCount = store.selectedSourceCount
  const prompt = buildStudioPrompt(tool, sourceCount)
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  const sessionId = store.chatSessionId || ''
  const job = buildStudioJob(tool, sourceCount, now, jobId, sessionId)

  store.addJob(job)
  // 把 pending job 绑定到当前 session；如果尚未创建 session（空字符串），
  // 用空字符串作 key，NotebookChat 在 onReplyComplete 中会用当前 sessionId 消费
  store.setPendingJob(sessionId, jobId)
  store.triggerSendPrompt(prompt)
  store.setViewingJob(jobId)

  return jobId
}
