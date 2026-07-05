// 共用测试辅助：mock localStorage + setActivePinia
import { createPinia, setActivePinia } from 'pinia'

let installed = false

function installLocalStorageMock() {
  if (installed && typeof globalThis.localStorage !== 'undefined') return
  const store = new Map<string, string>()
  const localStorageMock: Storage = {
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true,
  })
  installed = true
}

export function setupPinia() {
  installLocalStorageMock()
  setActivePinia(createPinia())
}

/** 重置 localStorage 内容（在 setupPinia 之后调用） */
export function resetLocalStorage() {
  globalThis.localStorage.clear()
}
