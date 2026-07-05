import assert from 'node:assert/strict'
import test from 'node:test'

// ===== mock 测试环境 =====
// 浏览器 API 在 Node 环境缺失，需要 mock：document / Blob / URL.createObjectURL / navigator.clipboard / window.print
function installBrowserMocks() {
  // 在 jsdom-like 环境中，document 可能已经存在；这里直接定义最小集合
  const createdLinks: Array<{ href: string; download: string }> = []
  const createdBlobs: Array<{ content: string; type: string }> = []

  const fakeDocument: Partial<Document> = {
    createElement: (tagName: string) => {
      if (tagName === 'a') {
        const link: any = {
          href: '',
          download: '',
          click() {},
        }
        // 记录 link.click 前的属性
        const origClick = link.click
        link.click = function () {
          createdLinks.push({ href: link.href, download: link.download })
          origClick.call(this)
        }
        return link
      }
      if (tagName === 'textarea') {
        return {
          value: '',
          style: {} as CSSStyleDeclaration,
          select() {},
        } as any
      }
      return {} as any
    },
    body: {
      appendChild: () => {},
      removeChild: () => {},
    } as any,
  }

  Object.defineProperty(globalThis, 'document', {
    value: fakeDocument,
    configurable: true,
    writable: true,
  })

  // Blob mock
  class BlobMock implements Blob {
    static _created = createdBlobs
    readonly parts: BlobPart[]
    readonly options?: BlobPropertyBag
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      this.parts = parts
      this.options = options
      const text = parts.map((p) => String(p)).join('')
      createdBlobs.push({ content: text, type: options?.type || '' })
    }
    get size() {
      return 0
    }
    get type() {
      return this.options?.type || ''
    }
    arrayBuffer() {
      return Promise.resolve(new ArrayBuffer(0))
    }
    slice(): Blob {
      return new BlobMock([], {})
    }
    stream() {
      return new ReadableStream()
    }
    bytes() {
      return Promise.resolve(new Uint8Array(0))
    }
    text() {
      return Promise.resolve(this.parts.map((p) => String(p)).join(''))
    }
  }
  Object.defineProperty(globalThis, 'Blob', {
    value: BlobMock,
    configurable: true,
    writable: true,
  })

  // URL.createObjectURL / revokeObjectURL
  Object.defineProperty(globalThis, 'URL', {
    value: {
      ...globalThis.URL,
      createObjectURL: () => 'blob:mock://test',
      revokeObjectURL: () => {},
    },
    configurable: true,
    writable: true,
  })

  // navigator.clipboard
  let lastClipboardText = ''
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      ...((globalThis as any).navigator || {}),
      clipboard: {
        writeText: async (text: string) => {
          lastClipboardText = text
        },
        readText: async () => lastClipboardText,
      },
    },
    configurable: true,
    writable: true,
  })

  // window.print
  let printCalled = false
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...((globalThis as any).window || {}),
      print: () => {
        printCalled = true
      },
      _wasPrintCalled: () => printCalled,
      _resetPrintFlag: () => {
        printCalled = false
      },
      _getCreatedLinks: () => createdLinks,
      _getCreatedBlobs: () => createdBlobs,
      _getLastClipboardText: () => lastClipboardText,
    },
    configurable: true,
    writable: true,
  })

  return {
    getCreatedLinks: () => createdLinks,
    getCreatedBlobs: () => createdBlobs,
    getLastClipboardText: () => lastClipboardText,
    wasPrintCalled: () => printCalled,
    reset: () => {
      createdLinks.length = 0
      createdBlobs.length = 0
      lastClipboardText = ''
      printCalled = false
    },
  }
}

const mocks = installBrowserMocks()

import {
  copyTextToClipboard,
  downloadTextAsFile,
  copyShareLink,
  exportToMarkdown,
  exportToPDF,
} from './useShareExport.ts'

test('copyTextToClipboard uses navigator.clipboard.writeText and returns true', async () => {
  mocks.reset()
  const ok = await copyTextToClipboard('hello world')
  assert.equal(ok, true)
  assert.equal(mocks.getLastClipboardText(), 'hello world')
})

test('copyTextToClipboard returns false when clipboard API throws', async () => {
  mocks.reset()
  // 临时破坏 clipboard API
  const origClipboard = (globalThis as any).navigator.clipboard
  ;(globalThis as any).navigator.clipboard = {
    writeText: async () => {
      throw new Error('permission denied')
    },
  }
  const ok = await copyTextToClipboard('hello')
  assert.equal(ok, false)
  // 恢复
  ;(globalThis as any).navigator.clipboard = origClipboard
})

test('downloadTextAsFile creates a Blob with the correct type and triggers an <a> download', () => {
  mocks.reset()
  downloadTextAsFile('hello markdown', 'note.md', 'text/markdown')
  const blobs = mocks.getCreatedBlobs()
  assert.equal(blobs.length, 1)
  assert.equal(blobs[0].content, 'hello markdown')
  assert.equal(blobs[0].type, 'text/markdown')
  const links = mocks.getCreatedLinks()
  assert.equal(links.length, 1)
  assert.equal(links[0].download, 'note.md')
})

test('copyShareLink builds an absolute URL from a relative path and copies it', async () => {
  mocks.reset()
  // mock location
  Object.defineProperty(globalThis, 'location', {
    value: { origin: 'https://example.com', href: 'https://example.com/notebook/abc' },
    configurable: true,
    writable: true,
  })
  const ok = await copyShareLink('/notebook/abc')
  assert.equal(ok, true)
  assert.equal(mocks.getLastClipboardText(), 'https://example.com/notebook/abc')
})

test('exportToMarkdown downloads a .md file with the content and returns true', () => {
  mocks.reset()
  const ok = exportToMarkdown('我的笔记', '# 标题\n正文内容')
  assert.equal(ok, true)
  const links = mocks.getCreatedLinks()
  assert.equal(links.length, 1)
  assert.equal(links[0].download, '我的笔记.md')
  const blobs = mocks.getCreatedBlobs()
  assert.equal(blobs.length, 1)
  assert.equal(blobs[0].type, 'text/markdown;charset=utf-8')
  assert.equal(blobs[0].content, '# 标题\n正文内容')
})

test('exportToMarkdown returns false when content is empty', () => {
  mocks.reset()
  const ok = exportToMarkdown('我的笔记', '')
  assert.equal(ok, false)
  assert.equal(mocks.getCreatedLinks().length, 0)
})

test('exportToPDF triggers window.print for non-empty content', () => {
  mocks.reset()
  ;(globalThis as any).window._resetPrintFlag()
  const ok = exportToPDF('我的笔记', '# 标题\n正文')
  assert.equal(ok, true)
  assert.equal((globalThis as any).window._wasPrintCalled(), true)
})

test('exportToPDF returns false when content is empty', () => {
  mocks.reset()
  ;(globalThis as any).window._resetPrintFlag()
  const ok = exportToPDF('我的笔记', '')
  assert.equal(ok, false)
  assert.equal((globalThis as any).window._wasPrintCalled(), false)
})
