import assert from 'node:assert/strict'
import test from 'node:test'

import {
  replaceMessagesInPlace,
  prependMessagesInPlace,
} from './useMessagesListMutation.ts'

type Msg = { id: string; content: string }

// ===== replaceMessagesInPlace =====

test('replaceMessagesInPlace swaps contents but keeps array reference', () => {
  const original: Msg[] = [{ id: '1', content: 'old' }]
  const ref = original
  const newItems: Msg[] = [
    { id: '2', content: 'new1' },
    { id: '3', content: 'new2' },
  ]
  replaceMessagesInPlace(original, newItems)
  assert.equal(original, ref, 'array reference must be preserved')
  assert.equal(original.length, 2)
  assert.deepEqual(original, newItems)
})

test('replaceMessagesInPlace clears array when newItems is empty', () => {
  const original: Msg[] = [{ id: '1', content: 'old' }]
  replaceMessagesInPlace(original, [])
  assert.equal(original.length, 0)
})

test('replaceMessagesInPlace with empty original and non-empty newItems', () => {
  const original: Msg[] = []
  const newItems: Msg[] = [{ id: '1', content: 'a' }]
  replaceMessagesInPlace(original, newItems)
  assert.equal(original.length, 1)
  assert.equal(original[0].id, '1')
})

test('replaceMessagesInPlace does not mutate newItems', () => {
  const original: Msg[] = [{ id: '0', content: 'old' }]
  const newItems: Msg[] = [{ id: '1', content: 'new' }]
  const snapshot = [...newItems]
  replaceMessagesInPlace(original, newItems)
  assert.deepEqual(newItems, snapshot)
})

// ===== prependMessagesInPlace =====

test('prependMessagesInPlace inserts items at the head', () => {
  const original: Msg[] = [
    { id: '2', content: 'b' },
    { id: '3', content: 'c' },
  ]
  const prepend: Msg[] = [{ id: '1', content: 'a' }]
  prependMessagesInPlace(original, prepend)
  assert.equal(original.length, 3)
  assert.equal(original[0].id, '1')
  assert.equal(original[1].id, '2')
  assert.equal(original[2].id, '3')
})

test('prependMessagesInPlace preserves array reference', () => {
  const original: Msg[] = [{ id: '2', content: 'b' }]
  const ref = original
  prependMessagesInPlace(original, [{ id: '1', content: 'a' }])
  assert.equal(original, ref)
})

test('prependMessagesInPlace with empty prepend is a no-op', () => {
  const original: Msg[] = [{ id: '1', content: 'a' }]
  prependMessagesInPlace(original, [])
  assert.equal(original.length, 1)
  assert.equal(original[0].id, '1')
})

test('prependMessagesInPlace to empty original', () => {
  const original: Msg[] = []
  prependMessagesInPlace(original, [{ id: '1', content: 'a' }])
  assert.equal(original.length, 1)
  assert.equal(original[0].id, '1')
})

test('prependMessagesInPlace does not mutate prepend array', () => {
  const original: Msg[] = [{ id: '2', content: 'b' }]
  const prepend: Msg[] = [{ id: '1', content: 'a' }]
  const snapshot = [...prepend]
  prependMessagesInPlace(original, prepend)
  assert.deepEqual(prepend, snapshot)
})
