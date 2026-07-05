import assert from 'node:assert/strict'
import test from 'node:test'

import {
  serializeJobs,
  deserializeJobs,
  filterPersistableJobs,
  pruneJobsToCapacity,
  loadJobs,
  saveJobs,
} from './useJobsPersistence.ts'
import type { StudioJob } from '../types/notebook.ts'

/** 构造一个最小可用的 StudioJob */
function makeJob(overrides: Partial<StudioJob> = {}): StudioJob {
  return {
    id: 'job-1',
    type: 'report',
    name: '研究报告',
    status: 'completed',
    sourceCount: 0,
    sourceType: 'conversation',
    createdAt: '2026-07-04T10:00:00.000Z',
    updatedAt: '2026-07-04T10:01:00.000Z',
    content: 'hello',
    progress: 100,
    ...overrides,
  }
}

/** 简易内存 Storage mock，仅实现 getItem/setItem/removeItem */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) as string) : null
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
  }
}

// ===== serializeJobs =====

test('serializeJobs returns a JSON string containing all job fields', () => {
  const jobs = [makeJob({ id: 'job-a', content: 'A' }), makeJob({ id: 'job-b', content: 'B' })]
  const raw = serializeJobs(jobs)
  assert.equal(typeof raw, 'string')
  const parsed = JSON.parse(raw)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].id, 'job-a')
  assert.equal(parsed[1].id, 'job-b')
})

test('serializeJobs writes sessionId field when present', () => {
  const jobs = [makeJob({ id: 'job-sess', sessionId: 'sess-X' })]
  const parsed = JSON.parse(serializeJobs(jobs))
  assert.equal(parsed[0].sessionId, 'sess-X')
})

test('serializeJobs returns empty array string for empty input', () => {
  assert.equal(serializeJobs([]), '[]')
})

// ===== deserializeJobs =====

test('deserializeJobs returns parsed jobs array for valid JSON', () => {
  const raw = JSON.stringify([makeJob({ id: 'job-x' })])
  const jobs = deserializeJobs(raw)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].id, 'job-x')
  assert.equal(jobs[0].type, 'report')
})

test('deserializeJobs returns empty array for empty string', () => {
  assert.deepEqual(deserializeJobs(''), [])
})

test('deserializeJobs returns empty array for malformed JSON', () => {
  assert.deepEqual(deserializeJobs('not-json'), [])
})

test('deserializeJobs returns empty array for non-array JSON', () => {
  assert.deepEqual(deserializeJobs('{"foo":"bar"}'), [])
})

test('deserializeJobs tolerates jobs without sessionId field (backward compat)', () => {
  // 模拟旧数据：sessionId 字段不存在
  const raw = JSON.stringify([
    { id: 'old-1', type: 'report', name: 'n', status: 'completed', sourceCount: 0, sourceType: 'conversation', createdAt: 't', updatedAt: 't' },
  ])
  const jobs = deserializeJobs(raw)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].id, 'old-1')
  // 不应抛错，sessionId 字段缺失视为 undefined
  assert.equal(jobs[0].sessionId, undefined)
})

test('deserializeJobs filters out entries missing required id field', () => {
  const raw = JSON.stringify([
    { type: 'report', name: 'n', status: 'completed', sourceCount: 0, sourceType: 'conversation', createdAt: 't', updatedAt: 't' },
    makeJob({ id: 'valid' }),
  ])
  const jobs = deserializeJobs(raw)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].id, 'valid')
})

// ===== filterPersistableJobs =====

test('filterPersistableJobs keeps completed and failed jobs', () => {
  const jobs = [
    makeJob({ id: 'a', status: 'completed' }),
    makeJob({ id: 'b', status: 'failed' }),
  ]
  const result = filterPersistableJobs(jobs)
  assert.equal(result.length, 2)
})

test('filterPersistableJobs drops generating and pending jobs (transient state)', () => {
  const jobs = [
    makeJob({ id: 'a', status: 'generating' }),
    makeJob({ id: 'b', status: 'pending' }),
    makeJob({ id: 'c', status: 'completed' }),
  ]
  const result = filterPersistableJobs(jobs)
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'c')
})

test('filterPersistableJobs returns empty array for empty input', () => {
  assert.deepEqual(filterPersistableJobs([]), [])
})

// ===== pruneJobsToCapacity =====

test('pruneJobsToCapacity keeps all jobs when under capacity', () => {
  const jobs = [makeJob({ id: 'a' }), makeJob({ id: 'b' })]
  const result = pruneJobsToCapacity(jobs, 10)
  assert.equal(result.length, 2)
})

test('pruneJobsToCapacity keeps newest N when exceeding capacity', () => {
  // jobs[0] 是最新的（按数组顺序：原 store 中 unshift，所以前 N 条是最新）
  const jobs = [
    makeJob({ id: 'newest' }),
    makeJob({ id: 'middle' }),
    makeJob({ id: 'oldest' }),
  ]
  const result = pruneJobsToCapacity(jobs, 2)
  assert.equal(result.length, 2)
  assert.equal(result[0].id, 'newest')
  assert.equal(result[1].id, 'middle')
})

test('pruneJobsToCapacity with maxCount 0 returns empty array', () => {
  const jobs = [makeJob({ id: 'a' })]
  assert.deepEqual(pruneJobsToCapacity(jobs, 0), [])
})

test('pruneJobsToCapacity does not mutate input array', () => {
  const jobs = [makeJob({ id: 'a' }), makeJob({ id: 'b' }), makeJob({ id: 'c' })]
  const snapshot = jobs.map((j) => j.id)
  pruneJobsToCapacity(jobs, 1)
  assert.deepEqual(jobs.map((j) => j.id), snapshot)
})

// ===== loadJobs =====

test('loadJobs returns deserialized jobs from storage', () => {
  const storage = createMemoryStorage()
  storage.setItem(
    'notebook-jobs',
    JSON.stringify([makeJob({ id: 'from-storage' })]),
  )
  const jobs = loadJobs(storage, 'notebook-jobs')
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].id, 'from-storage')
})

test('loadJobs returns empty array when key does not exist', () => {
  const storage = createMemoryStorage()
  const jobs = loadJobs(storage, 'notebook-jobs')
  assert.deepEqual(jobs, [])
})

test('loadJobs returns empty array when stored value is malformed', () => {
  const storage = createMemoryStorage()
  storage.setItem('notebook-jobs', 'garbage{')
  const jobs = loadJobs(storage, 'notebook-jobs')
  assert.deepEqual(jobs, [])
})

// ===== saveJobs =====

test('saveJobs writes filtered + pruned jobs to storage', () => {
  const storage = createMemoryStorage()
  const jobs = [
    makeJob({ id: 'done-1', status: 'completed' }),
    makeJob({ id: 'gen-1', status: 'generating' }), // 应被过滤掉
    makeJob({ id: 'done-2', status: 'completed' }),
  ]
  saveJobs(storage, 'notebook-jobs', jobs, 10)
  const stored = JSON.parse(storage.getItem('notebook-jobs') as string)
  assert.equal(stored.length, 2)
  assert.equal(stored[0].id, 'done-1')
  assert.equal(stored[1].id, 'done-2')
})

test('saveJobs prunes to capacity when jobs exceed limit', () => {
  const storage = createMemoryStorage()
  const jobs = [
    makeJob({ id: 'a', status: 'completed' }),
    makeJob({ id: 'b', status: 'completed' }),
    makeJob({ id: 'c', status: 'completed' }),
  ]
  saveJobs(storage, 'notebook-jobs', jobs, 2)
  const stored = JSON.parse(storage.getItem('notebook-jobs') as string)
  assert.equal(stored.length, 2)
  assert.equal(stored[0].id, 'a')
  assert.equal(stored[1].id, 'b')
})

test('saveJobs writes empty array when all jobs are transient', () => {
  const storage = createMemoryStorage()
  const jobs = [makeJob({ id: 'gen', status: 'generating' })]
  saveJobs(storage, 'notebook-jobs', jobs, 10)
  assert.equal(storage.getItem('notebook-jobs'), '[]')
})

test('saveJobs does not throw when storage.setItem raises (quota exceeded)', () => {
  const storage = createMemoryStorage()
  const originalSetItem = storage.setItem.bind(storage)
  storage.setItem = () => {
    throw new Error('QuotaExceededError')
  }
  // 不应抛出
  saveJobs(storage, 'notebook-jobs', [makeJob()], 10)
  // 恢复以免影响后续测试
  storage.setItem = originalSetItem
})
