import assert from 'node:assert/strict'
import test from 'node:test'

import { getMediaFallbackHint, MEDIA_FALLBACK_HINTS } from './useMediaFallback.ts'

test('getMediaFallbackHint returns null for text-only tools (report, summary, etc.)', () => {
  assert.equal(getMediaFallbackHint('report'), null)
  assert.equal(getMediaFallbackHint('summary'), null)
  assert.equal(getMediaFallbackHint('briefing'), null)
  assert.equal(getMediaFallbackHint('outline'), null)
  assert.equal(getMediaFallbackHint('faq'), null)
})

test('getMediaFallbackHint returns audio hint for audio_overview', () => {
  const hint = getMediaFallbackHint('audio_overview')
  assert.ok(hint !== null)
  assert.ok(hint.includes('音频') || hint.includes('audio') || hint.includes('文字稿'))
})

test('getMediaFallbackHint returns video hint for video_script', () => {
  const hint = getMediaFallbackHint('video_script')
  assert.ok(hint !== null)
  assert.ok(hint.includes('视频') || hint.includes('video') || hint.includes('脚本'))
})

test('getMediaFallbackHint returns visual hint for infographic', () => {
  const hint = getMediaFallbackHint('infographic')
  assert.ok(hint !== null)
  assert.ok(hint.includes('信息图') || hint.includes('可视化') || hint.includes('Mermaid'))
})

test('getMediaFallbackHint returns slides hint for presentation', () => {
  const hint = getMediaFallbackHint('presentation')
  assert.ok(hint !== null)
  assert.ok(hint.includes('演示') || hint.includes('幻灯片') || hint.includes('PPT'))
})

test('MEDIA_FALLBACK_HINTS contains entries for all rich-media tools', () => {
  const richMediaTools = ['audio_overview', 'video_script', 'infographic', 'presentation']
  for (const tool of richMediaTools) {
    assert.ok(tool in MEDIA_FALLBACK_HINTS, `${tool} should have a fallback hint`)
  }
})

test('MEDIA_FALLBACK_HINTS does not contain entries for text-only tools', () => {
  const textTools = ['report', 'summary', 'briefing', 'outline', 'faq', 'quiz']
  for (const tool of textTools) {
    assert.ok(!(tool in MEDIA_FALLBACK_HINTS), `${tool} should NOT have a fallback hint`)
  }
})
