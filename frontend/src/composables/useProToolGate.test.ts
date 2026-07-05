import assert from 'node:assert/strict'
import test from 'node:test'

import { canUseProTool, getProToolDeniedMessage } from './useProToolGate.ts'
import type { StudioToolCard } from '../types/notebook.ts'

// 构造测试用 tool 卡片
function makeTool(overrides: Partial<StudioToolCard> = {}): StudioToolCard {
  return {
    type: 'report',
    name: '测试工具',
    description: '测试',
    icon: 'file',
    category: 'insight',
    prompt: 'test',
    supportedSources: ['documents'],
    ...overrides,
  }
}

test('canUseProTool returns true for non-PRO tools regardless of role', () => {
  const tool = makeTool({ pro: undefined })
  assert.equal(canUseProTool(tool, false), true)
  assert.equal(canUseProTool(tool, true), true)
})

test('canUseProTool returns true for non-PRO tools when pro is false', () => {
  const tool = makeTool({ pro: false })
  assert.equal(canUseProTool(tool, false), true)
  assert.equal(canUseProTool(tool, true), true)
})

test('canUseProTool returns false for PRO tools when user is not admin', () => {
  const tool = makeTool({ pro: true })
  assert.equal(canUseProTool(tool, false), false)
})

test('canUseProTool returns true for PRO tools when user is admin', () => {
  const tool = makeTool({ pro: true })
  assert.equal(canUseProTool(tool, true), true)
})

test('getProToolDeniedMessage returns null for non-PRO tools', () => {
  const tool = makeTool({ pro: false })
  assert.equal(getProToolDeniedMessage(tool), null)
})

test('getProToolDeniedMessage returns a message for PRO tools', () => {
  const tool = makeTool({ pro: true, name: '视频脚本' })
  const msg = getProToolDeniedMessage(tool)
  assert.ok(msg !== null)
  assert.ok(msg.includes('PRO') || msg.includes('会员') || msg.includes('升级'))
})

test('getProToolDeniedMessage includes the tool name', () => {
  const tool = makeTool({ pro: true, name: '演示文稿' })
  const msg = getProToolDeniedMessage(tool)
  assert.ok(msg !== null)
  assert.ok(msg!.includes('演示文稿'))
})
