import assert from 'node:assert/strict'
import test from 'node:test'

import { setupPinia } from '../test/setupPinia.ts'
import { useUIStore } from './ui.ts'

test('useUIStore exposes openCreateKB (not openKBEditor)', () => {
  setupPinia()
  const ui = useUIStore()
  assert.equal(typeof ui.openCreateKB, 'function', 'openCreateKB must exist')
  assert.equal(
    // @ts-expect-error — openKBEditor should not exist on the store
    typeof ui.openKBEditor,
    'undefined',
    'openKBEditor must NOT exist; use openCreateKB instead',
  )
})

test('openCreateKB opens the KB editor in create mode', () => {
  setupPinia()
  const ui = useUIStore()
  ui.openCreateKB('document')
  assert.equal(ui.showKBEditorModal, true)
  assert.equal(ui.kbEditorMode, 'create')
  assert.equal(ui.kbEditorType, 'document')
  assert.equal(ui.currentKBId, null)
})
