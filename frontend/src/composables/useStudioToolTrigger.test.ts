import assert from 'node:assert/strict'
import test from 'node:test'

// 用相对路径 + .ts 扩展名导入，让 Node 原生 ESM 能解析
import { STUDIO_TOOL_CARDS } from '../config/studioTools.ts'
import {
  triggerStudioTool,
  buildStudioPrompt,
  buildStudioJob,
  getAnalysisTools,
  type StudioToolStore,
} from './useStudioToolTrigger.ts'
import type { StudioJob, StudioToolCard } from '../types/notebook.ts'

/** 构造一个记录所有调用的 mock store */
function createMockStore(sourceCount = 0, sessionId = 'sess-A'): StudioToolStore & {
  jobs: StudioJob[]
  pendingJobs: Map<string, string>
  viewingJobId: string | null
  sentPrompts: string[]
} {
  return {
    jobs: [],
    pendingJobs: new Map<string, string>(),
    viewingJobId: null,
    sentPrompts: [],
    selectedSourceCount: sourceCount,
    chatSessionId: sessionId,
    addJob(job: StudioJob) {
      this.jobs.push(job)
    },
    setPendingJob(sid: string, jid: string) {
      this.pendingJobs.set(sid, jid)
    },
    triggerSendPrompt(prompt: string) {
      this.sentPrompts.push(prompt)
    },
    setViewingJob(id: string | null) {
      this.viewingJobId = id
    },
  } as any
}

// ===== buildStudioPrompt =====

test('buildStudioPrompt returns tool.prompt as-is when no sources selected', () => {
  const tool = STUDIO_TOOL_CARDS.find((t) => t.type === 'report')!
  const prompt = buildStudioPrompt(tool, 0)
  assert.equal(prompt, tool.prompt)
  assert.equal(/基于已选的/.test(prompt), false)
})

test('buildStudioPrompt appends source hint when sources are selected', () => {
  const tool = STUDIO_TOOL_CARDS.find((t) => t.type === 'report')!
  const prompt = buildStudioPrompt(tool, 3)
  assert.match(prompt, /基于已选的 3 个来源/)
  assert.ok(prompt.startsWith(tool.prompt))
})

// ===== buildStudioJob =====

test('buildStudioJob creates a generating job with conversation sourceType when no sources', () => {
  const tool = STUDIO_TOOL_CARDS.find((t) => t.type === 'briefing')!
  const now = '2026-07-04T10:00:00.000Z'
  const job = buildStudioJob(tool, 0, now, 'job_1')
  assert.equal(job.id, 'job_1')
  assert.equal(job.type, 'briefing')
  assert.equal(job.name, '简报')
  assert.equal(job.status, 'generating')
  assert.equal(job.sourceCount, 0)
  assert.equal(job.sourceType, 'conversation')
  assert.equal(job.createdAt, now)
  assert.equal(job.updatedAt, now)
  assert.equal(job.progress, 0)
})

test('buildStudioJob uses documents sourceType when sources are selected', () => {
  const tool = STUDIO_TOOL_CARDS.find((t) => t.type === 'report')!
  const job = buildStudioJob(tool, 5, '2026-07-04T10:00:00.000Z', 'job_2')
  assert.equal(job.sourceCount, 5)
  assert.equal(job.sourceType, 'documents')
})

test('buildStudioJob writes sessionId onto the job when provided', () => {
  const tool = STUDIO_TOOL_CARDS.find((t) => t.type === 'report')!
  const job = buildStudioJob(tool, 0, '2026-07-04T10:00:00.000Z', 'job_3', 'sess-XYZ')
  assert.equal(job.sessionId, 'sess-XYZ')
})

test('buildStudioJob writes empty string when sessionId is omitted', () => {
  const tool = STUDIO_TOOL_CARDS.find((t) => t.type === 'report')!
  const job = buildStudioJob(tool, 0, '2026-07-04T10:00:00.000Z', 'job_4')
  assert.equal(job.sessionId, '')
})

test('triggerStudioTool stamps the current chatSessionId onto the job', () => {
  const store = createMockStore(0, 'sess-attach-test')
  const jobId = triggerStudioTool('report', store, STUDIO_TOOL_CARDS)
  assert.ok(jobId)
  assert.equal(store.jobs[0].sessionId, 'sess-attach-test')
})

// ===== getAnalysisTools =====

test('getAnalysisTools filters only insight-category tools from a mixed list', () => {
  const tools: StudioToolCard[] = [
    {
      type: 'report',
      name: '研究报告',
      description: 'd1',
      icon: 'i1',
      category: 'insight',
      prompt: 'p1',
      supportedSources: ['documents'],
    },
    {
      type: 'outline',
      name: '大纲',
      description: 'd2',
      icon: 'i2',
      category: 'organize',
      prompt: 'p2',
      supportedSources: ['documents'],
    },
  ]
  const result = getAnalysisTools(tools)
  assert.equal(result.length, 1)
  assert.equal(result[0].type, 'report')
  assert.equal(result[0].name, '研究报告')
  assert.equal(result[0].icon, 'i1')
})

test('getAnalysisTools on real STUDIO_TOOL_CARDS includes report and briefing', () => {
  const result = getAnalysisTools(STUDIO_TOOL_CARDS)
  assert.ok(result.length > 0)
  assert.ok(result.some((t) => t.type === 'report'))
  assert.ok(result.some((t) => t.type === 'briefing'))
  for (const t of result) {
    assert.equal(typeof t.type, 'string')
    assert.equal(typeof t.name, 'string')
    assert.equal(typeof t.icon, 'string')
  }
})

// ===== triggerStudioTool =====

test('triggerStudioTool adds a job with the right type and generating status', () => {
  const store = createMockStore(0)

  const jobId = triggerStudioTool('report', store, STUDIO_TOOL_CARDS)

  assert.ok(jobId, 'should return a job id')
  assert.equal(store.jobs.length, 1)
  const job = store.jobs[0]
  assert.equal(job.type, 'report')
  assert.equal(job.status, 'generating')
  assert.equal(job.name, '研究报告')
  assert.equal(job.sourceCount, 0)
  assert.equal(job.sourceType, 'conversation')
})

test('triggerStudioTool sets pendingJob for current session so NotebookChat can consume it', () => {
  const store = createMockStore(0, 'sess-A')

  const jobId = triggerStudioTool('briefing', store, STUDIO_TOOL_CARDS)

  assert.equal(store.pendingJobs.get('sess-A'), jobId)
})

test('triggerStudioTool binds pendingJob to the given session id', () => {
  // 关键：避免跨会话污染——session B 触发的 job 必须挂在 session B 的 key 下，
  // 而不是单值 pendingJobId（会导致 session A 的对话完成时错误消费）
  const storeA = createMockStore(0, 'sess-A')
  const storeB = createMockStore(0, 'sess-B')

  const jobIdA = triggerStudioTool('briefing', storeA, STUDIO_TOOL_CARDS)
  const jobIdB = triggerStudioTool('summary', storeB, STUDIO_TOOL_CARDS)

  assert.equal(storeA.pendingJobs.get('sess-A'), jobIdA)
  assert.equal(storeB.pendingJobs.get('sess-B'), jobIdB)
  assert.notEqual(jobIdA, jobIdB)
})

test('triggerStudioTool sets viewingJobId so StudioPanel switches to the new job', () => {
  const store = createMockStore(0)

  const jobId = triggerStudioTool('summary', store, STUDIO_TOOL_CARDS)

  assert.equal(store.viewingJobId, jobId)
})

test('triggerStudioTool triggers the registered sendPrompt callback with tool prompt', () => {
  const store = createMockStore(0)

  triggerStudioTool('report', store, STUDIO_TOOL_CARDS)

  assert.equal(store.sentPrompts.length, 1)
  assert.match(store.sentPrompts[0], /结构化的深度研究报告/)
  assert.equal(/基于已选的/.test(store.sentPrompts[0]), false)
})

test('triggerStudioTool appends source hint when sources are selected', () => {
  const store = createMockStore(2)

  triggerStudioTool('report', store, STUDIO_TOOL_CARDS)

  assert.match(store.sentPrompts[0], /基于已选的 2 个来源/)
  assert.equal(store.jobs[0].sourceType, 'documents')
  assert.equal(store.jobs[0].sourceCount, 2)
})

test('triggerStudioTool returns null and does nothing for unknown tool type', () => {
  const store = createMockStore(0)

  const jobId = triggerStudioTool('not_a_real_tool' as any, store, STUDIO_TOOL_CARDS)

  assert.equal(jobId, null)
  assert.equal(store.jobs.length, 0)
  assert.equal(store.pendingJobs.size, 0)
  assert.equal(store.viewingJobId, null)
  assert.equal(store.sentPrompts.length, 0)
})
