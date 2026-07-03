// Notebook / Studio 页面状态管理
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  StudioJob,
  StudioToolType,
  SourceItem,
  SourceGroup,
  NotebookLayoutState,
} from '@/types/notebook'
import { STUDIO_TOOL_CARDS } from '@/config/studioTools'

export const useNotebookStore = defineStore('notebook', () => {
  // ===== 布局状态 =====
  const layout = ref<NotebookLayoutState>({
    leftPanelWidth: 320,
    rightPanelWidth: 340,
    leftPanelCollapsed: false,
    rightPanelCollapsed: false,
  })

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
  const sourceGroups = ref<SourceGroup[]>([
    {
      id: 'knowledge_bases',
      name: '知识库',
      expanded: true,
      items: [],
    },
    {
      id: 'web_sources',
      name: '网络搜索来源',
      expanded: true,
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

  // ===== Studio / 生成能力状态 =====
  const jobs = ref<StudioJob[]>([])
  const activeTool = ref<StudioToolType | null>(null)
  const viewingJobId = ref<string | null>(null)
  const studioPanelOpen = ref(true)

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

  const setNotebookTitle = (title: string) => {
    notebookTitle.value = title
  }

  const setNotebookId = (id: string) => {
    notebookId.value = id
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
    sourceSearchQuery,
    setSourceSearchQuery,
    // studio
    jobs,
    activeTool,
    viewingJobId,
    studioPanelOpen,
    addJob,
    updateJob,
    setActiveTool,
    setViewingJob,
    viewingJob,
    activeToolCard,
    jobsByType,
    // notebook
    notebookTitle,
    notebookId,
    setNotebookTitle,
    setNotebookId,
    // send prompt
    registerSendPrompt,
    unregisterSendPrompt,
    triggerSendPrompt,
  }
})
