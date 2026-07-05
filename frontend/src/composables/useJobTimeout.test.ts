import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isJobStale,
  findStaleJobs,
  markStaleJobsAsFailed,
  scheduleJobTimeout,
} from './useJobTimeout.ts'
import type { StudioJob } from '../types/notebook.ts'

/** 构造一个最小可用的 StudioJob */
function makeJob(overrides: Partial<StudioJob> = {}): StudioJob {
  return {
    id: 'job-1',
    type: 'report',
    name: '研究报告',
    status: 'generating',
    sourceCount: 0,
    sourceType: 'conversation',
    createdAt: '2026-07-04T10:00:00.000Z',
    updatedAt: '2026-07-04T10:00:00.000Z',
    progress: 0,
    ...overrides,
  }
}

const NOW_ISO = '2026-07-04T10:01:00.000Z' // 比 createdAt 晚 60 秒
const NOW_MS = Date.parse(NOW_ISO)

// ===== isJobStale =====

test('isJobStale returns true for a generating job older than timeoutMs', () => {
  // createdAt 是 60 秒前，timeout 30 秒 → 已超时
  const job = makeJob({ status: 'generating', createdAt: '2026-07-04T10:00:00.000Z' })
  assert.equal(isJobStale(job, NOW_MS, 30_000), true)
})

test('isJobStale returns false for a generating job younger than timeoutMs', () => {
  // createdAt 是 60 秒前，timeout 120 秒 → 未超时
  const job = makeJob({ status: 'generating', createdAt: '2026-07-04T10:00:00.000Z' })
  assert.equal(isJobStale(job, NOW_MS, 120_000), false)
})

test('isJobStale returns false for a completed job regardless of age', () => {
  const job = makeJob({ status: 'completed', createdAt: '2026-07-04T10:00:00.000Z' })
  assert.equal(isJobStale(job, NOW_MS, 1_000), false)
})

test('isJobStale returns false for a failed job regardless of age', () => {
  const job = makeJob({ status: 'failed', createdAt: '2026-07-04T10:00:00.000Z' })
  assert.equal(isJobStale(job, NOW_MS, 1_000), false)
})

test('isJobStale returns false for a pending job (only generating is timeout-tracked)', () => {
  const job = makeJob({ status: 'pending', createdAt: '2026-07-04T10:00:00.000Z' })
  assert.equal(isJobStale(job, NOW_MS, 1_000), false)
})

test('isJobStale treats invalid createdAt as not stale (defensive)', () => {
  const job = makeJob({ status: 'generating', createdAt: 'not-a-date' })
  assert.equal(isJobStale(job, NOW_MS, 1_000), false)
})

// ===== findStaleJobs =====

test('findStaleJobs returns only stale generating jobs', () => {
  const jobs = [
    makeJob({ id: 'stale-1', status: 'generating', createdAt: '2026-07-04T10:00:00.000Z' }),
    makeJob({ id: 'fresh-1', status: 'generating', createdAt: '2026-07-04T10:00:55.000Z' }),
    makeJob({ id: 'done-1', status: 'completed', createdAt: '2026-07-04T10:00:00.000Z' }),
  ]
  const result = findStaleJobs(jobs, NOW_MS, 30_000)
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'stale-1')
})

test('findStaleJobs returns empty array when no jobs are stale', () => {
  const jobs = [
    makeJob({ id: 'fresh', status: 'generating', createdAt: '2026-07-04T10:00:55.000Z' }),
  ]
  assert.deepEqual(findStaleJobs(jobs, NOW_MS, 30_000), [])
})

test('findStaleJobs returns empty array for empty input', () => {
  assert.deepEqual(findStaleJobs([], NOW_MS, 30_000), [])
})

// ===== markStaleJobsAsFailed =====

test('markStaleJobsAsFailed marks stale generating jobs as failed in place', () => {
  const jobs = [
    makeJob({ id: 'stale-1', status: 'generating', createdAt: '2026-07-04T10:00:00.000Z' }),
    makeJob({ id: 'fresh-1', status: 'generating', createdAt: '2026-07-04T10:00:55.000Z' }),
  ]
  const result = markStaleJobsAsFailed(jobs, NOW_MS, 30_000, '生成超时')
  // 返回被标记为 failed 的 job id 列表
  assert.deepEqual(result, ['stale-1'])
  // 原数组被原地修改
  assert.equal(jobs[0].status, 'failed')
  assert.equal(jobs[0].errorMessage, '生成超时')
  assert.equal(jobs[0].updatedAt, NOW_ISO)
  // fresh-1 不变
  assert.equal(jobs[1].status, 'generating')
})

test('markStaleJobsAsFailed updates progress to 0 on timed-out jobs', () => {
  const jobs = [
    makeJob({ id: 'stale', status: 'generating', createdAt: '2026-07-04T10:00:00.000Z', progress: 50 }),
  ]
  markStaleJobsAsFailed(jobs, NOW_MS, 30_000, '超时')
  assert.equal(jobs[0].progress, 0)
})

test('markStaleJobsAsFailed returns empty array when nothing is stale', () => {
  const jobs = [makeJob({ id: 'fresh', status: 'generating', createdAt: '2026-07-04T10:00:55.000Z' })]
  assert.deepEqual(markStaleJobsAsFailed(jobs, NOW_MS, 30_000, '超时'), [])
  assert.equal(jobs[0].status, 'generating') // 未修改
})

test('markStaleJobsAsFailed does not mutate completed jobs', () => {
  const jobs = [
    makeJob({ id: 'done', status: 'completed', createdAt: '2026-07-04T10:00:00.000Z' }),
  ]
  markStaleJobsAsFailed(jobs, NOW_MS, 30_000, '超时')
  assert.equal(jobs[0].status, 'completed')
})

// ===== scheduleJobTimeout =====

test('scheduleJobTimeout invokes onTimeout after the specified delay', async () => {
  const calls: string[] = []
  const cancel = scheduleJobTimeout({
    jobId: 'job-x',
    timeoutMs: 50,
    onTimeout: (id) => calls.push(id),
    // 注入 setTimeout 返回值；测试用真实 timer
  })
  // 等待 80ms 让定时器触发
  await new Promise((r) => setTimeout(r, 80))
  assert.deepEqual(calls, ['job-x'])
  assert.equal(typeof cancel, 'function')
})

test('scheduleJobTimeout cancel prevents onTimeout from firing', async () => {
  const calls: string[] = []
  const cancel = scheduleJobTimeout({
    jobId: 'job-y',
    timeoutMs: 50,
    onTimeout: (id) => calls.push(id),
  })
  cancel()
  await new Promise((r) => setTimeout(r, 100))
  assert.deepEqual(calls, [])
})

test('scheduleJobTimeout uses custom timer when provided (injection for testing)', async () => {
  const calls: string[] = []
  let capturedTimeoutMs = 0
  const fakeSetTimeout = (fn: () => void, ms: number) => {
    capturedTimeoutMs = ms
    // 立即触发以便快速断言
    fn()
    return 0 as any
  }
  const fakeClearTimeout = () => {}
  scheduleJobTimeout({
    jobId: 'job-z',
    timeoutMs: 999,
    onTimeout: (id) => calls.push(id),
    customSetTimeout: fakeSetTimeout as any,
    customClearTimeout: fakeClearTimeout as any,
  })
  assert.equal(capturedTimeoutMs, 999)
  assert.deepEqual(calls, ['job-z'])
})
