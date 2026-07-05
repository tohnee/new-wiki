import assert from 'node:assert/strict'
import test from 'node:test'

import {
  setPendingJob,
  consumePendingJob,
  peekPendingJob,
  rebindPendingJob,
  consumeAllPendingJobs,
  getPendingJobCount,
  createPendingJobMap,
} from './usePendingJobs.ts'

// ===== createPendingJobMap =====

test('createPendingJobMap returns an empty Map', () => {
  const m = createPendingJobMap()
  assert.equal(m.size, 0)
})

// ===== setPendingJob =====

test('setPendingJob adds a new entry to empty map', () => {
  const m = createPendingJobMap()
  setPendingJob(m, 'session-A', 'job-1')
  assert.equal(m.size, 1)
  assert.equal(m.get('session-A'), 'job-1')
})

test('setPendingJob overwrites previous job for same session', () => {
  const m = createPendingJobMap()
  setPendingJob(m, 'session-A', 'job-1')
  setPendingJob(m, 'session-A', 'job-2')
  assert.equal(m.size, 1)
  assert.equal(m.get('session-A'), 'job-2')
})

test('setPendingJob keeps jobs for different sessions independent', () => {
  const m = createPendingJobMap()
  setPendingJob(m, 'session-A', 'job-1')
  setPendingJob(m, 'session-B', 'job-2')
  assert.equal(m.size, 2)
  assert.equal(m.get('session-A'), 'job-1')
  assert.equal(m.get('session-B'), 'job-2')
})

// ===== peekPendingJob =====

test('peekPendingJob returns job id without removing it', () => {
  const m = createPendingJobMap()
  setPendingJob(m, 'session-A', 'job-1')
  assert.equal(peekPendingJob(m, 'session-A'), 'job-1')
  assert.equal(m.size, 1, 'peek must not remove the entry')
})

test('peekPendingJob returns null when session has no pending job', () => {
  const m = createPendingJobMap()
  assert.equal(peekPendingJob(m, 'session-A'), null)
})

// ===== consumePendingJob =====

test('consumePendingJob returns job id and removes it from map', () => {
  const m = createPendingJobMap()
  setPendingJob(m, 'session-A', 'job-1')
  const consumed = consumePendingJob(m, 'session-A')
  assert.equal(consumed, 'job-1')
  assert.equal(m.size, 0, 'consume must remove the entry')
})

test('consumePendingJob returns null when session has no pending job', () => {
  const m = createPendingJobMap()
  assert.equal(consumePendingJob(m, 'session-A'), null)
})

test('consumePendingJob only removes the targeted session', () => {
  const m = createPendingJobMap()
  setPendingJob(m, 'session-A', 'job-1')
  setPendingJob(m, 'session-B', 'job-2')
  consumePendingJob(m, 'session-A')
  assert.equal(m.size, 1)
  assert.equal(m.get('session-B'), 'job-2')
})

// ===== rebindPendingJob =====

test('rebindPendingJob returns false and is a no-op when oldSessionId has no pending job', () => {
  const m = createPendingJobMap()
  assert.equal(rebindPendingJob(m, '', 'sess-A'), false)
  assert.equal(m.size, 0)
})

test('rebindPendingJob migrates pending job from empty key to real sessionId', () => {
  // 模拟 P0-6 修复场景：triggerStudioTool 用 '' 作 key 写入，
  // ensureSession 后 NotebookChat 拿到真实 sessionId，需要 rebind
  const m = createPendingJobMap()
  setPendingJob(m, '', 'job-empty')
  assert.equal(rebindPendingJob(m, '', 'sess-real'), true)
  assert.equal(m.size, 1, '迁移后总数不变')
  assert.equal(m.get(''), undefined, '旧 key 必须删除')
  assert.equal(m.get('sess-real'), 'job-empty', '新 key 必须指向同一 jobId')
})

test('rebindPendingJob migrates between two non-empty session ids', () => {
  const m = createPendingJobMap()
  setPendingJob(m, 'old', 'job-1')
  assert.equal(rebindPendingJob(m, 'old', 'new'), true)
  assert.equal(m.get('old'), undefined)
  assert.equal(m.get('new'), 'job-1')
})

test('rebindPendingJob returns true without modifying map when old equals new', () => {
  const m = createPendingJobMap()
  setPendingJob(m, 'sess-X', 'job-X')
  assert.equal(rebindPendingJob(m, 'sess-X', 'sess-X'), true)
  assert.equal(m.size, 1)
  assert.equal(m.get('sess-X'), 'job-X')
})

test('rebindPendingJob overwrites existing pending job on target session', () => {
  // 业务上同一 session 不应同时有两个 pending job；若发生则覆盖是合理行为
  const m = createPendingJobMap()
  setPendingJob(m, '', 'job-empty')
  setPendingJob(m, 'sess-A', 'job-existing')
  assert.equal(rebindPendingJob(m, '', 'sess-A'), true)
  assert.equal(m.size, 1)
  assert.equal(m.get(''), undefined)
  assert.equal(m.get('sess-A'), 'job-empty', 'target session 上的旧 job 被覆盖')
})

// ===== consumeAllPendingJobs =====

test('consumeAllPendingJobs returns all entries and clears the map', () => {
  const m = createPendingJobMap()
  setPendingJob(m, 'session-A', 'job-1')
  setPendingJob(m, 'session-B', 'job-2')
  setPendingJob(m, 'session-C', 'job-3')
  const all = consumeAllPendingJobs(m)
  assert.equal(all.length, 3)
  assert.deepEqual(
    all.sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    [
      { sessionId: 'session-A', jobId: 'job-1' },
      { sessionId: 'session-B', jobId: 'job-2' },
      { sessionId: 'session-C', jobId: 'job-3' },
    ],
  )
  assert.equal(m.size, 0, 'consumeAll must clear the map')
})

test('consumeAllPendingJobs returns empty array for empty map', () => {
  const m = createPendingJobMap()
  const all = consumeAllPendingJobs(m)
  assert.equal(all.length, 0)
})

// ===== getPendingJobCount =====

test('getPendingJobCount returns 0 for empty map', () => {
  assert.equal(getPendingJobCount(createPendingJobMap()), 0)
})

test('getPendingJobCount returns the number of entries', () => {
  const m = createPendingJobMap()
  setPendingJob(m, 'session-A', 'job-1')
  setPendingJob(m, 'session-B', 'job-2')
  assert.equal(getPendingJobCount(m), 2)
})
