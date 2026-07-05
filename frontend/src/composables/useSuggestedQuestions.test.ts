import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSuggestedQuestions,
  extractQuestionText,
} from './useSuggestedQuestions.ts'
import type { SuggestedQuestion } from '../api/agent/index.ts'

const FALLBACK = [
  '总结一下我选择的来源',
  '列出关键要点',
  '生成思维导图大纲',
  '对比不同观点',
]

// ===== extractQuestionText =====

test('extractQuestionText returns question string as-is', () => {
  assert.equal(extractQuestionText({ question: '你好', source: 'agent_config' }), '你好')
})

test('extractQuestionText returns empty string when question is missing', () => {
  assert.equal(extractQuestionText({ source: 'agent_config' } as any), '')
})

test('extractQuestionText returns empty string when question is not a string', () => {
  assert.equal(extractQuestionText({ question: 123, source: 'agent_config' } as any), '')
})

test('extractQuestionText trims whitespace', () => {
  assert.equal(
    extractQuestionText({ question: '  带空格  ', source: 'agent_config' }),
    '带空格',
  )
})

// ===== buildSuggestedQuestions =====

test('buildSuggestedQuestions returns fallback when not in agent mode', () => {
  const result = buildSuggestedQuestions([], FALLBACK, false)
  assert.deepEqual(result, FALLBACK)
})

test('buildSuggestedQuestions returns fallback when remote is empty in agent mode', () => {
  const result = buildSuggestedQuestions([], FALLBACK, true)
  assert.deepEqual(result, FALLBACK)
})

test('buildSuggestedQuestions returns remote questions when available in agent mode', () => {
  const remote: SuggestedQuestion[] = [
    { question: '如何使用 A？', source: 'faq' },
    { question: '如何使用 B？', source: 'document' },
  ]
  const result = buildSuggestedQuestions(remote, FALLBACK, true)
  assert.deepEqual(result, ['如何使用 A？', '如何使用 B？'])
})

test('buildSuggestedQuestions filters out empty questions from remote', () => {
  const remote: SuggestedQuestion[] = [
    { question: '有效问题', source: 'faq' },
    { question: '', source: 'faq' },
    { question: '   ', source: 'faq' },
    { source: 'faq' } as any,
  ]
  const result = buildSuggestedQuestions(remote, FALLBACK, true)
  assert.deepEqual(result, ['有效问题'])
})

test('buildSuggestedQuestions falls back when all remote questions are empty', () => {
  const remote: SuggestedQuestion[] = [
    { question: '', source: 'faq' },
    { question: '   ', source: 'faq' },
  ]
  const result = buildSuggestedQuestions(remote, FALLBACK, true)
  assert.deepEqual(result, FALLBACK)
})

test('buildSuggestedQuestions respects limit parameter', () => {
  const remote: SuggestedQuestion[] = [
    { question: 'Q1', source: 'faq' },
    { question: 'Q2', source: 'faq' },
    { question: 'Q3', source: 'faq' },
    { question: 'Q4', source: 'faq' },
  ]
  const result = buildSuggestedQuestions(remote, FALLBACK, true, 2)
  assert.deepEqual(result, ['Q1', 'Q2'])
})

test('buildSuggestedQuestions limit larger than array returns all remote', () => {
  const remote: SuggestedQuestion[] = [
    { question: 'Q1', source: 'faq' },
    { question: 'Q2', source: 'faq' },
  ]
  const result = buildSuggestedQuestions(remote, FALLBACK, true, 10)
  assert.deepEqual(result, ['Q1', 'Q2'])
})

test('buildSuggestedQuestions limit 0 or negative is ignored', () => {
  const remote: SuggestedQuestion[] = [
    { question: 'Q1', source: 'faq' },
    { question: 'Q2', source: 'faq' },
  ]
  // limit<=0 视为不限
  assert.deepEqual(buildSuggestedQuestions(remote, FALLBACK, true, 0), ['Q1', 'Q2'])
  assert.deepEqual(buildSuggestedQuestions(remote, FALLBACK, true, -1), ['Q1', 'Q2'])
})
