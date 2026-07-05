// Notebook / Studio 页面状态管理
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type {
  StudioJob,
  StudioToolType,
  SourceItem,
  SourceGroup,
  NotebookLayoutState,
} from '@/types/notebook'
import { STUDIO_TOOL_CARDS } from '@/config/studioTools'
import {
  createPendingJobMap,
  setPendingJob as setPendingJobInMap,
  consumePendingJob as consumePendingJobFromMap,
  consumeAllPendingJobs as consumeAllPendingJobsFromMap,
  peekPendingJob as peekPendingJobInMap,
  rebindPendingJob as rebindPendingJobInMap,
  getPendingJobCount,
} from '@/composables/usePendingJobs'
import {
  loadJobs as loadJobsFromStorage,
  saveJobs as saveJobsToStorage,
  DEFAULT_JOBS_CAPACITY,
} from '@/composables/useJobsPersistence'

const LAYOUT_STORAGE_KEY = 'notebook-layout'
const JOBS_STORAGE_KEY = 'notebook-jobs'

function loadLayout(): NotebookLayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        leftPanelWidth: Math.max(240, Math.min(500, parsed.leftPanelWidth ?? 320)),
        rightPanelWidth: Math.max(280, Math.min(520, parsed.rightPanelWidth ?? 340)),
        leftPanelCollapsed: !!parsed.leftPanelCollapsed,
        rightPanelCollapsed: !!parsed.rightPanelCollapsed,
      }
    }
  } catch (e) {
    console.warn('[notebook] Failed to load layout from localStorage:', e)
  }
  return {
    leftPanelWidth: 320,
    rightPanelWidth: 340,
    leftPanelCollapsed: false,
    rightPanelCollapsed: false,
  }
}

export const useNotebookStore = defineStore('notebook', () => {
  // ===== 布局状态（持久化到 localStorage） =====
  const layout = ref<NotebookLayoutState>(loadLayout())

  watch(layout, (val) => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(val))
    } catch (e) {
      // 忽略 quota 错误
    }
  }, { deep: true })

  const toggleLeftPanel = () => {
    layout.value.leftPanelCollapsed = !layout.value.leftPanelCollapsed
  }

  const toggleRightPanel = () => {
    layout.value.rightPanelCollapsed = !layout.value.rightPanelCollapsed
  }

  const setLeftPanelWidth = (w: number) => {
    layout.value.leftPanelWidth = Math.max(240, Math.min(500, w))
  }

  const setRightPanelWidth = (w: number) => {
    layout.value.rightPanelWidth = Math.max(280, Math.min(520, w))
  }

  // ===== 左栏来源状态 =====
  // web_sources 分组默认隐藏（visible=false），仅当对话中实际使用网络搜索时才显示
  const sourceGroups = ref<SourceGroup[]>([
    {
      id: 'knowledge_bases',
      name: '知识库',
      type: 'knowledge_base',
      expanded: true,
      visible: true,
      items: [],
    },
    {
      id: 'web_sources',
      name: '网络搜索来源',
      type: 'web_sources',
      expanded: true,
      visible: false,
      items: [],
    },
  ])

  const selectedSourceIds = computed(() => {
    const ids: string[] = []
    sourceGroups.value.forEach((group) => {
      group.items.forEach((item) => {
        if (item.selected) ids.push(item.id)
      })
    })
    return ids
  })

  const selectedSourceCount = computed(() => selectedSourceIds.value.length)

  const setSourceItems = (groupId: string, items: SourceItem[]) => {
    const group = sourceGroups.value.find((g) => g.id === groupId)
    if (group) {
      group.items = items
    }
  }

  const toggleSourceItem = (itemId: string) => {
    for (const group of sourceGroups.value) {
      const item = group.items.find((i) => i.id === itemId)
      if (item) {
        item.selected = !item.selected
        break
      }
    }
  }

  const toggleGroupSelectAll = (groupId: string, selected: boolean) => {
    const group = sourceGroups.value.find((g) => g.id === groupId)
    if (group) {
      group.items.forEach((item) => {
        item.selected = selected
      })
    }
  }

  const toggleGroupExpanded = (groupId: string) => {
    const group = sourceGroups.value.find((g) => g.id === groupId)
    if (group) {
      group.expanded = !group.expanded
    }
  }

  /** 添加网络搜索来源（对话中使用 web search 时回填到左栏） */
  const addWebSource = (item: SourceItem) => {
    const group = sourceGroups.value.find((g) => g.id === 'web_sources')
    if (!group) return
    if (!group.visible) group.visible = true
    if (!group.items.some((i) => i.id === item.id)) {
      group.items.unshift(item)
    }
  }

  /** 清空网络搜索来源 */
  const clearWebSources = () => {
    const group = sourceGroups.value.find((g) => g.id === 'web_sources')
    if (group) {
      group.items = []
      group.visible = false
    }
  }

  // ===== Studio / 生成能力状态 =====
  // jobs 初始值从 localStorage 加载（仅含 completed/failed，generating 状态不持久化）
  const jobs = ref<StudioJob[]>(loadJobsFromStorage(localStorage, JOBS_STORAGE_KEY))

  // jobs 变化时自动持久化到 localStorage（debounce 通过 watch flush:'post' 简化处理）
  watch(
    jobs,
    (val) => {
      saveJobsToStorage(localStorage, JOBS_STORAGE_KEY, val, DEFAULT_JOBS_CAPACITY)
    },
    { deep: true },
  )

  const activeTool = ref<StudioToolType | null>(null)
  const viewingJobId = ref<string | null>(null)
  const studioPanelOpen = ref(true)
  /**
   * 等待对话完成的 Studio job 映射：sessionId → jobId。
   *
   * 改造原因：原 pendingJobId 是单值 ref，当用户在 session A 触发 Studio 后切换到
   * session B，B 的对话完成时会错误地把 A 的 job 标记为完成。改为 Map 后按 session
   * 索引，避免跨会话污染。
   */
  const pendingJobs = ref<Map<string, string>>(createPendingJobMap())

  const addJob = (job: StudioJob) => {
    jobs.value.unshift(job)
  }

  const updateJob = (jobId: string, patch: Partial<StudioJob>) => {
    const job = jobs.value.find((j) => j.id === jobId)
    if (job) {
      Object.assign(job, patch)
      job.updatedAt = new Date().toISOString()
    }
  }

  const setActiveTool = (tool: StudioToolType | null) => {
    activeTool.value = tool
  }

  const setViewingJob = (jobId: string | null) => {
    viewingJobId.value = jobId
  }

  /** 设置指定 session 的 pending job ID（覆盖该 session 上已有的）。 */
  const setPendingJob = (sessionId: string, jobId: string) => {
    setPendingJobInMap(pendingJobs.value, sessionId, jobId)
  }

  /** 取出并删除指定 session 的 pending job ID；不存在时返回 null。 */
  const consumePendingJob = (sessionId: string): string | null => {
    return consumePendingJobFromMap(pendingJobs.value, sessionId)
  }

  /** 取出所有 pending job 并清空 Map（用于组件卸载时一次性消费）。 */
  const consumeAllPendingJobs = () => {
    return consumeAllPendingJobsFromMap(pendingJobs.value)
  }

  /** 仅查看指定 session 的 pending job ID，不删除。 */
  const peekPendingJob = (sessionId: string): string | null => {
    return peekPendingJobInMap(pendingJobs.value, sessionId)
  }

  /**
   * 把 pending job 从 oldSessionId 迁移到 newSessionId。
   *
   * P0-6 修复场景：triggerStudioTool 触发时若 chatSessionId 为空，会用 '' 作 key
   * 写入 pendingJobs。NotebookChat.ensureSession 后拿到真实 sessionId，需要把
   * 空 key 上的 pending job 迁移到真实 sessionId 上，否则后续 consume/peek 都用
   * 真实 sessionId 取不到，Studio job 永远卡在 generating。
   */
  const rebindPendingJob = (
    oldSessionId: string,
    newSessionId: string,
  ): boolean => {
    return rebindPendingJobInMap(pendingJobs.value, oldSessionId, newSessionId)
  }

  /** 当前 pending job 的数量（响应式：基于 ref<Map> 派生）。 */
  const pendingJobCount = computed(() => getPendingJobCount(pendingJobs.value))

  const viewingJob = computed(() =>
    jobs.value.find((j) => j.id === viewingJobId.value) || null,
  )

  const activeToolCard = computed(() =>
    activeTool.value ? STUDIO_TOOL_CARDS.find((c) => c.type === activeTool.value) : null,
  )

  const jobsByType = computed(() => {
    const map: Record<string, StudioJob[]> = {}
    jobs.value.forEach((job) => {
      if (!map[job.type]) map[job.type] = []
      map[job.type].push(job)
    })
    return map
  })

  // ===== Notebook 元信息 =====
  const notebookTitle = ref('未命名笔记')
  const notebookId = ref<string | null>(null)
  // 当前对话会话 ID（由 NotebookChat 创建/恢复后写入，供 NotebookHeader 持久化标题使用）
  const chatSessionId = ref<string>('')

  const setNotebookTitle = (title: string) => {
    notebookTitle.value = title
  }

  const setNotebookId = (id: string) => {
    notebookId.value = id
  }

  const setChatSessionId = (id: string) => {
    chatSessionId.value = id
  }

  // ===== 左栏搜索 =====
  const sourceSearchQuery = ref('')
  const setSourceSearchQuery = (q: string) => {
    sourceSearchQuery.value = q
  }

  // ===== 发送 prompt 到对话输入框 =====
  let sendPromptCallback: ((prompt: string) => void) | null = null

  const registerSendPrompt = (fn: (prompt: string) => void) => {
    sendPromptCallback = fn
  }

  const unregisterSendPrompt = () => {
    sendPromptCallback = null
  }

  const triggerSendPrompt = (prompt: string) => {
    if (sendPromptCallback) {
      sendPromptCallback(prompt)
    }
  }

  return {
    // layout
    layout,
    toggleLeftPanel,
    toggleRightPanel,
    setLeftPanelWidth,
    setRightPanelWidth,
    // sources
    sourceGroups,
    selectedSourceIds,
    selectedSourceCount,
    setSourceItems,
    toggleSourceItem,
    toggleGroupSelectAll,
    toggleGroupExpanded,
    addWebSource,
    clearWebSources,
    sourceSearchQuery,
    setSourceSearchQuery,
    // studio
    jobs,
    activeTool,
    viewingJobId,
    studioPanelOpen,
    pendingJobs,
    pendingJobCount,
    addJob,
    updateJob,
    setActiveTool,
    setViewingJob,
    setPendingJob,
    consumePendingJob,
    consumeAllPendingJobs,
    peekPendingJob,
    rebindPendingJob,
    viewingJob,
    activeToolCard,
    jobsByType,
    // notebook
    notebookTitle,
    notebookId,
    chatSessionId,
    setNotebookTitle,
    setNotebookId,
    setChatSessionId,
    // send prompt
    registerSendPrompt,
    unregisterSendPrompt,
    triggerSendPrompt,
  }
})
