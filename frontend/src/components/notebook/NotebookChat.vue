<template>
  <div class="notebook-chat">
    <!-- 消息滚动区 -->
    <div ref="scrollContainer" class="chat-scroll" @scroll="handleScroll">
      <div class="msg-list">
        <!-- 空态欢迎区 -->
        <div v-if="messagesList.length === 0 && !loading" class="welcome-area">
          <div class="welcome-icon">
            <t-icon name="chat" size="32px" />
          </div>
          <h2 class="welcome-title">Hi，开始对话</h2>
          <p class="welcome-desc">选择左侧来源，或直接提问。基于你的知识库和对话内容，Studio 将自动生成各种内容。</p>

          <!-- 推荐问题：迁移自 creatChat，含骨架屏 / 交错动画 / FAQ 标签 / 刷新按钮 -->
          <div ref="sqContainerRef" class="suggested-questions-container">
            <!-- 骨架屏占位 -->
            <div v-if="sqLoading && suggestedQuestions.length === 0" class="suggested-questions-inner">
              <div class="suggested-questions-title">
                <t-skeleton animation="gradient" :row-col="[{ width: '120px', height: '14px' }]" />
              </div>
              <div class="suggested-questions-grid">
                <div v-for="n in 6" :key="'sq-skel-' + n" class="suggested-question-card sq-card-skeleton">
                  <t-skeleton animation="gradient" :row-col="[{ width: '100%', height: '14px', type: 'rect' }]" />
                </div>
              </div>
            </div>
            <transition v-else appear name="sq-slide-fade" mode="out-in" @before-leave="onBeforeLeave"
              @after-leave="onAfterLeave" @enter="onEnter" @after-enter="onQuestionsEntered">
              <div v-if="suggestedQuestions.length > 0" :key="sqRenderKey" class="suggested-questions-inner">
                <div class="suggested-questions-title-row">
                  <p class="suggested-questions-caption">
                    <span class="suggested-questions-title">{{ $t('chat.suggestedQuestions') }}</span>
                    <button type="button" class="suggested-questions-refresh" :disabled="sqLoading"
                      :title="$t('chat.refreshSuggestedQuestions')"
                      :aria-label="$t('chat.refreshSuggestedQuestions')" @click="fetchSuggestedQuestions">
                      <t-icon :name="sqLoading ? 'loading' : 'refresh'" :class="{ 'sq-refresh-spin': sqLoading }" />
                    </button>
                  </p>
                </div>
                <div class="suggested-questions-grid">
                  <div v-for="(item, index) in suggestedQuestions" :key="item.question"
                    class="suggested-question-card" :class="{ 'sq-card-visible': sqCardsRevealed }"
                    :style="{ transitionDelay: sqCardsRevealed ? `${index * 50}ms` : '0ms' }"
                    @click="handleSuggestedQuestionClick(item.question)">
                    <span class="suggested-question-text">{{ item.question }}</span>
                    <span v-if="item.source === 'faq'" class="suggested-question-badge faq">FAQ</span>
                  </div>
                </div>
              </div>
            </transition>
          </div>
        </div>

        <!-- 骨架屏 -->
        <div v-if="historyLoading && messagesList.length === 0" class="msg-skeleton-list">
          <div v-for="n in 2" :key="'skel-' + n" class="msg-skeleton msg-skeleton-bot">
            <t-skeleton animation="gradient" :row-col="[{ width: '85%', height: '16px' }, { width: '100%', height: '16px' }, { width: '60%', height: '16px' }]" />
          </div>
        </div>

        <!-- 消息列表 -->
        <div
          v-for="(msg, index) in messagesList"
          :key="msg.id || `${msg.role}-${index}`"
          class="msg-item"
          :class="{ 'msg-user': msg.role === 'user', 'msg-assistant': msg.role === 'assistant' }"
        >
          <div v-if="msg.role === 'user'" class="user-msg">
            <usermsg
              :content="msg.content"
              :mentioned_items="msg.mentioned_items"
              :images="msg.images"
              :attachments="msg.attachments"
              :embedded-mode="false"
            />
          </div>
          <div v-else-if="msg.role === 'assistant'" class="bot-msg">
            <botmsg
              :content="msg.content"
              :session="msg"
              :session-id="sessionId"
              :user-query="getUserQuery(index)"
              @scroll-bottom="scrollToBottom"
              :is-first-enter="false"
              :embedded-mode="false"
            />
          </div>
        </div>

        <!-- 正在输入指示器 -->
        <div v-if="isReplying && !currentAssistantMessageId" class="typing-indicator">
          <div class="typing-dots">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    </div>

    <!-- 滚动到底部按钮 -->
    <transition name="fade-btn">
      <div v-show="userHasScrolledUp" class="scroll-bottom-btn" @click="scrollToBottom(true)">
        <t-icon name="chevron-down" size="18px" />
      </div>
    </transition>

    <!-- 输入框 -->
    <div class="input-area">
      <div class="source-chips" v-if="selectedCount > 0">
        <span class="source-chip-label">
          <t-icon name="file-copy" size="12px" />
          {{ selectedCount }} 个来源已选
        </span>
        <button class="source-clear-btn" @click="clearSources">
          <t-icon name="close" size="12px" />
        </button>
      </div>
      <InputField
        ref="inputFieldRef"
        @send-msg="sendMsg"
        @stop-generation="handleStopGeneration"
        :is-replying="isReplying"
        :session-id="sessionId"
        :assistant-message-id="currentAssistantMessageId"
        :embedded-mode="false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import InputField from '@/components/Input-field.vue'
import botmsg from '@/views/chat/components/botmsg.vue'
import usermsg from '@/views/chat/components/usermsg.vue'
import { useStream } from '@/api/chat/streame'
import { createSessions, getMessageList, getSession } from '@/api/chat/index'
import { useSettingsStore } from '@/stores/settings'
import { useChatResourcesStore } from '@/stores/chatResources'
import { useNotebookStore } from '@/stores/notebook'
import { useStickyBottomOnResize } from '@/composables/useStickyBottomOnResize'
import { useChatStreamHandler } from '@/composables/useChatStreamHandler'
import {
  extractSessionIdFromRoute,
  shouldHydrateSession,
} from '@/composables/useSessionHydration'
import {
  buildSuggestedQuestions,
} from '@/composables/useSuggestedQuestions'
import {
  replaceMessagesInPlace,
  prependMessagesInPlace,
} from '@/composables/useMessagesListMutation'
import {
  scheduleJobTimeout,
  DEFAULT_JOB_TIMEOUT_MS,
} from '@/composables/useJobTimeout'
import { getSuggestedQuestions } from '@/api/agent/index'
import type { SuggestedQuestion } from '@/api/agent/index'
import { MessagePlugin } from 'tdesign-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const route = useRoute()
const settingsStore = useSettingsStore()
const chatResources = useChatResourcesStore()
const notebookStore = useNotebookStore()

// 会话 ID
const sessionId = ref<string>('')

// 消息列表
const messagesList = ref<any[]>([])
const isReplying = ref(false)
const loading = ref(false)
const historyLoading = ref(false)
const currentAssistantMessageId = ref('')
const fullContent = ref('')

// 历史分页
const hasMoreHistory = ref(true)
const historyLoadingMore = ref(false)
const limit = ref(20)

// 滚动相关
const scrollContainer = ref<HTMLElement | null>(null)
const userHasScrolledUp = ref(false)
const inputFieldRef = ref()
const SCROLL_THRESHOLD = 80

const selectedCount = computed(() => notebookStore.selectedSourceCount)

const isAgentStreamSession = () => settingsStore.isAgentStreamMode

// ===== Studio job 超时定时器管理 =====
// 每个 generating 状态的 job 都有一个超时定时器；到期时把 job 标记为 failed
// 并提示用户。在以下情况下应取消定时器：
//   - onReplyComplete（对话正常完成，job 已 consume）
//   - handleStopGeneration（用户主动停止）
//   - 流式错误（onChunk error / streamError watcher）
//   - onBeforeUnmount（组件卸载）
const activeJobTimers = new Map<string, () => void>()

/** 启动指定 job 的超时定时器。若该 job 已有定时器，先取消旧的再注册新的。 */
const startJobTimeout = (jobId: string): void => {
  const existing = activeJobTimers.get(jobId)
  if (existing) existing()
  const cancel = scheduleJobTimeout({
    jobId,
    timeoutMs: DEFAULT_JOB_TIMEOUT_MS,
    onTimeout: (id) => {
      activeJobTimers.delete(id)
      notebookStore.updateJob(id, {
        status: 'failed',
        errorMessage: '生成超时，请重试',
        progress: 0,
      })
      MessagePlugin.warning('生成超时已自动停止')
    },
  })
  activeJobTimers.set(jobId, cancel)
}

/** 取消指定 job 的超时定时器（不影响 job 自身状态）。 */
const cancelJobTimeout = (jobId: string): void => {
  const cancel = activeJobTimers.get(jobId)
  if (cancel) {
    cancel()
    activeJobTimers.delete(jobId)
  }
}

/** 取消所有未完成的 job 定时器（用于组件卸载）。 */
const cancelAllJobTimeouts = (): void => {
  for (const cancel of activeJobTimers.values()) {
    cancel()
  }
  activeJobTimers.clear()
}

const scrollToBottom = (force = false) => {
  if (!force && userHasScrolledUp.value) return
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
    }
  })
}

const handleScroll = () => {
  if (!scrollContainer.value) return
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value
  if (scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD) {
    userHasScrolledUp.value = false
  } else {
    userHasScrolledUp.value = true
  }
  // 滚动到顶部时触发历史消息分页加载
  if (scrollTop < 50 && hasMoreHistory.value && !historyLoadingMore.value && sessionId.value) {
    loadHistory()
  }
}

useStickyBottomOnResize(scrollContainer, userHasScrolledUp, scrollToBottom)

// ===== 使用 useChatStreamHandler 处理所有流式事件（thinking/tool_call/answer/rag_pipeline 等） =====
const { processStreamChunk, prepareForNewOutgoingMessage } = useChatStreamHandler({
  messagesList: messagesList.value,
  loading,
  isReplying,
  currentAssistantMessageId,
  fullContent,
  isAgentStreamSession,
  scrollToBottom,
  onError: (msg) => MessagePlugin.error(msg),
  onReplyComplete: (content) => {
    // 对话完成时更新 Studio job 状态和内容。
    // 按当前 sessionId 消费 pending job，避免跨会话误消费其它 session 的 job
    const jobId = notebookStore.consumePendingJob(sessionId.value)
    if (jobId) {
      cancelJobTimeout(jobId)
      notebookStore.updateJob(jobId, {
        status: 'completed',
        content,
        progress: 100,
      })
    }
  },
  debug: import.meta.env.DEV,
})

// ===== 推荐问题（迁移自 creatChat：骨架屏 / 交错动画 / FAQ 标签 / 刷新按钮） =====
const FALLBACK_PROMPTS = [
  '总结一下我选择的来源',
  '列出关键要点',
  '生成思维导图大纲',
  '对比不同观点',
]
const suggestedQuestions = ref<SuggestedQuestion[]>([])
// 兜底列表：仅用于非 agent 模式或远程为空时渲染为 fallback SuggestedQuestion[]
const fallbackQuestions = (): SuggestedQuestion[] =>
  FALLBACK_PROMPTS.map((q) => ({ question: q, source: 'fallback' as any }))
const sqLoading = ref(true)
const sqCardsRevealed = ref(false)
const sqRenderKey = ref(0)
const sqContainerRef = ref<HTMLElement | null>(null)
let suggestedQuestionsFetchId = 0
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// --- 高度平滑过渡钩子 ---
const onBeforeLeave = () => {
  const c = sqContainerRef.value
  if (!c) return
  c.style.height = c.offsetHeight + 'px'
  c.style.overflow = 'hidden'
}

const onAfterLeave = () => {
  const c = sqContainerRef.value
  if (!c) return
  if (suggestedQuestions.value.length === 0) {
    requestAnimationFrame(() => { c.style.height = '0px' })
    c.addEventListener('transitionend', () => {
      c.style.height = ''
      c.style.overflow = ''
    }, { once: true })
  }
}

const onEnter = (el: Element) => {
  const c = sqContainerRef.value
  if (!c) return
  const startHeight = c.offsetHeight
  c.style.height = 'auto'
  c.style.overflow = 'hidden'
  const targetHeight = c.offsetHeight
  c.style.height = startHeight + 'px'
  requestAnimationFrame(() => {
    c.style.height = targetHeight + 'px'
  })
}

const onQuestionsEntered = () => {
  const c = sqContainerRef.value
  if (c) {
    c.style.height = ''
    c.style.overflow = ''
  }
  nextTick(() => { sqCardsRevealed.value = true })
}

const fetchSuggestedQuestions = async () => {
  const fetchId = ++suggestedQuestionsFetchId
  sqLoading.value = true
  try {
    const agentId = settingsStore.selectedAgentId
    if (!agentId) {
      if (fetchId === suggestedQuestionsFetchId) {
        sqCardsRevealed.value = false
        sqRenderKey.value++
        suggestedQuestions.value = fallbackQuestions()
      }
      return
    }
    const res = await getSuggestedQuestions(agentId, settingsStore.getSuggestedQuestionsParams(6))
    if (fetchId === suggestedQuestionsFetchId) {
      sqCardsRevealed.value = false
      sqRenderKey.value++
      const remote = res?.data?.questions || []
      suggestedQuestions.value = buildSuggestedQuestions(
        remote,
        FALLBACK_PROMPTS,
        settingsStore.isAgentStreamMode,
        6,
      ).map((q) => ({ question: q, source: 'remote' as any }))
    }
  } catch (err) {
    console.warn('[NotebookChat] Failed to load suggested questions:', err)
    if (fetchId === suggestedQuestionsFetchId) {
      suggestedQuestions.value = fallbackQuestions()
    }
  } finally {
    if (fetchId === suggestedQuestionsFetchId) {
      sqLoading.value = false
    }
  }
}

// 防抖包装，切换知识库/文件/agent 时 300ms 内不重复请求
const debouncedFetch = () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { fetchSuggestedQuestions() }, 300)
}

// 监听 Agent / 知识库 / 文件 / 标签 / MCP / Skill @mention 变化
watch(
  () => ({
    agentId: settingsStore.selectedAgentId,
    kbs: settingsStore.settings.selectedKnowledgeBases,
    files: settingsStore.settings.selectedFiles,
    tags: settingsStore.settings.selectedTags,
    mcps: settingsStore.settings.selectedMCPServices,
    skills: settingsStore.settings.selectedSkills,
  }),
  debouncedFetch,
  { deep: true },
)

const handleSuggestionClick = (q: string) => {
  if (inputFieldRef.value?.triggerSend) {
    inputFieldRef.value.triggerSend(q)
  } else {
    sendMsg(q)
  }
}

const handleSuggestedQuestionClick = (question: string) => {
  inputFieldRef.value?.triggerSend(question)
}

const getUserQuery = (index: number) => {
  if (index <= 0) return ''
  const prev = messagesList.value[index - 1]
  if (prev?.role === 'user') return prev.content || ''
  return ''
}

const clearSources = () => {
  notebookStore.sourceGroups.forEach((group) => {
    group.items.forEach((item) => (item.selected = false))
  })
}

// 创建会话 — 根据 agent 模式选择正确的 agent_id
const ensureSession = async () => {
  if (sessionId.value) return
  try {
    const agentEnabled = settingsStore.isAgentStreamMode
    const agentId = agentEnabled
      ? (settingsStore.selectedAgentId || '')
      : 'builtin-quick-answer'
    const res = await createSessions({
      title: notebookStore.notebookTitle,
      agent_id: agentId,
    })
    if (res?.success && res.data?.id) {
      sessionId.value = String(res.data.id)
      notebookStore.setChatSessionId(sessionId.value)
    }
  } catch (err) {
    console.error('Failed to create session:', err)
    MessagePlugin.error('创建会话失败')
  }
}

// 文件转 base64
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 停止生成
const handleStopGeneration = () => {
  stopStream()
  isReplying.value = false
  loading.value = false
  // 标记 Studio job 为失败（按当前 sessionId 消费）
  const jobId = notebookStore.consumePendingJob(sessionId.value)
  if (jobId) {
    cancelJobTimeout(jobId)
    notebookStore.updateJob(jobId, {
      status: 'failed',
      errorMessage: '用户已停止生成',
    })
  }
}

const { onChunk, error: streamError, startStream, stopStream } = useStream()

// 流式处理：session_title 单独处理，其余交给 useChatStreamHandler
onChunk((data: any) => {
  if (!data) return
  if (data.response_type === 'session_title') {
    if (data.content) notebookStore.setNotebookTitle(data.content)
    return
  }
  if (data.response_type === 'error') {
    MessagePlugin.error(data.content || data.message || '生成失败')
    isReplying.value = false
    loading.value = false
    const jobId = notebookStore.consumePendingJob(sessionId.value)
    if (jobId) {
      cancelJobTimeout(jobId)
      notebookStore.updateJob(jobId, {
        status: 'failed',
        errorMessage: data.content || data.message || '生成失败',
      })
    }
    return
  }
  processStreamChunk(data)
})

watch(streamError, (err) => {
  if (err) {
    MessagePlugin.error(err)
    isReplying.value = false
    loading.value = false
    const jobId = notebookStore.consumePendingJob(sessionId.value)
    if (jobId) {
      cancelJobTimeout(jobId)
      notebookStore.updateJob(jobId, {
        status: 'failed',
        errorMessage: err,
      })
    }
  }
})

// 发送消息
const sendMsg = async (
  value: string,
  modelId = '',
  mentionedItems: any[] = [],
  imageFiles: File[] = [],
  attachmentFiles: any[] = [],
) => {
  stopStream()
  await ensureSession()
  if (!sessionId.value) return

  // 若本次发送是 Studio 工具触发（store.peekPendingJob 命中），启动超时定时器。
  // peek 而非 consume：定时器在对话完成 / 出错 / 用户停止时才需要取消，
  // pendingJob 本身仍由 onReplyComplete 等回调消费。
  //
  // P0-6 修复：triggerStudioTool 在 chatSessionId 为空时会用 '' 作 key 写入
  // pendingJobs。ensureSession 后才拿到真实 sessionId，此时 peek 真实 sessionId
  // 会 miss。检测到这种场景时把空 key 上的 pending job 重新绑定到真实 sessionId。
  let pendingJobId = notebookStore.peekPendingJob(sessionId.value)
  if (!pendingJobId) {
    // 兼容首次触发场景：尝试从空 key 迁移到当前 sessionId
    if (notebookStore.rebindPendingJob('', sessionId.value)) {
      pendingJobId = notebookStore.peekPendingJob(sessionId.value)
    }
  }
  if (pendingJobId) {
    startJobTimeout(pendingJobId)
  }

  isReplying.value = true
  loading.value = true
  fullContent.value = ''
  prepareForNewOutgoingMessage()

  // 图片处理
  let imageAttachments: any[] = []
  let userImages: any[] = []
  if (imageFiles?.length > 0) {
    for (const file of imageFiles) {
      const dataURI = await fileToBase64(file)
      imageAttachments.push({ data: dataURI })
      userImages.push({ url: dataURI })
    }
  }

  // 附件处理
  let attachmentUploads: any[] = []
  if (attachmentFiles?.length > 0) {
    for (const att of attachmentFiles) {
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = () => resolve('')
        reader.readAsDataURL(att.file)
      })
      if (base64) {
        attachmentUploads.push({ data: base64, file_name: att.name, file_size: att.size })
      }
    }
  }

  // 来源：选中的知识库
  const kbIds: string[] = []
  const fileIds: string[] = []
  notebookStore.sourceGroups.forEach((group) => {
    group.items.forEach((item) => {
      if (item.selected) {
        if (item.type === 'knowledge_base') kbIds.push(item.id)
        else if (item.type === 'document') fileIds.push(item.id)
      }
    })
  })
  // 合并 @提及的
  for (const item of mentionedItems || []) {
    if (item?.type === 'kb' && !kbIds.includes(item.id)) kbIds.push(item.id)
    if (item?.type === 'file' && !fileIds.includes(item.id)) fileIds.push(item.id)
  }

  messagesList.value.push({
    content: value,
    role: 'user',
    mentioned_items: mentionedItems,
    images: userImages,
    attachments: attachmentFiles?.map((a: any) => ({
      file_name: a.name,
      file_size: a.size,
      file_type: '.' + a.name?.split('.').pop()?.toLowerCase(),
    })),
    channel: 'web',
  })
  userHasScrolledUp.value = false
  scrollToBottom(true)

  const agentEnabled = settingsStore.isAgentStreamMode
  const webSearchEnabled = settingsStore.isWebSearchEnabled
  const selectedAgentId = agentEnabled
    ? (settingsStore.selectedAgentId || '')
    : 'builtin-quick-answer'
  const endpoint = agentEnabled ? '/api/v1/agent-chat' : '/api/v1/knowledge-chat'

  const tagIds = (mentionedItems || []).filter((i: any) => i.type === 'tag' && i.id).map((i: any) => i.id)
  const mcpServiceIds = agentEnabled ? (mentionedItems || []).filter((i: any) => i.type === 'mcp' && i.id).map((i: any) => i.id) : []
  const skillNames = agentEnabled ? (mentionedItems || []).filter((i: any) => i.type === 'skill' && i.id).map((i: any) => i.skill_name || i.id) : []

  await startStream({
    session_id: sessionId.value,
    knowledge_base_ids: kbIds.length > 0 ? kbIds : settingsStore.settings.selectedKnowledgeBases,
    knowledge_ids: fileIds.length > 0 ? fileIds : settingsStore.settings.selectedFiles,
    agent_enabled: agentEnabled,
    agent_id: selectedAgentId,
    web_search_enabled: webSearchEnabled,
    summary_model_id: modelId,
    mcp_service_ids: mcpServiceIds,
    skill_names: skillNames,
    tag_ids: tagIds,
    mentioned_items: mentionedItems,
    images: imageAttachments.length > 0 ? imageAttachments : undefined,
    attachment_uploads: attachmentUploads.length > 0 ? attachmentUploads : undefined,
    query: value,
    method: 'POST',
    url: endpoint,
  })
}

// ===== 历史消息加载 =====
const loadHistory = async () => {
  if (!sessionId.value || !hasMoreHistory.value || historyLoadingMore.value) return
  historyLoadingMore.value = true
  // 保存加载前的滚动位置，用于加载后恢复（避免视觉跳跃）
  const container = scrollContainer.value
  const prevScrollHeight = container?.scrollHeight || 0
  const prevScrollTop = container?.scrollTop || 0
  try {
    const lastMsg = messagesList.value[0]
    const beforeTime = lastMsg?.created_at || ''
    const res = await getMessageList({
      session_id: sessionId.value,
      limit: limit.value,
      created_at: beforeTime,
    })
    const data = res?.data || []
    if (data.length === 0) {
      hasMoreHistory.value = false
    } else {
      if (data.length < limit.value) hasMoreHistory.value = false
      // 插入到列表头部（原地修改，保留 useChatStreamHandler 持有的数组引用）
      prependMessagesInPlace(messagesList.value, data.reverse())
      // 恢复滚动位置：加上新增内容的高度差
      nextTick(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight
          container.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight)
        }
      })
    }
  } catch (err) {
    console.error('[NotebookChat] Failed to load history:', err)
  } finally {
    historyLoadingMore.value = false
  }
}

// 首次加载历史消息
const loadInitialHistory = async () => {
  if (!sessionId.value) return
  historyLoading.value = true
  try {
    const res = await getMessageList({
      session_id: sessionId.value,
      limit: limit.value,
      created_at: '',
    })
    const data = res?.data || []
    if (data.length < limit.value) hasMoreHistory.value = false
    // 原地替换列表内容，保留 useChatStreamHandler 持有的数组引用；
    // 否则流式响应到达时 push 到的是旧数组，模板不显示
    replaceMessagesInPlace(messagesList.value, data.reverse())
  } catch (err) {
    console.error('[NotebookChat] Failed to load initial history:', err)
  } finally {
    historyLoading.value = false
  }
}

/**
 * 从路由携带的 sessionId 恢复对话状态：
 * 1. 调 getSession 拉取 session 元信息（标题等），同步到 notebookStore
 * 2. 加载该 session 的消息历史
 *
 * 仅当 shouldHydrateSession 返回 true 时执行；首次进入和路由切换都会调用此函数。
 */
const loadSessionAndHydrate = async (routeSessionId: string) => {
  if (!shouldHydrateSession(routeSessionId, sessionId.value, false)) return

  // 重置分页状态，准备加载新会话的历史
  sessionId.value = routeSessionId
  notebookStore.setChatSessionId(routeSessionId)
  // 原地清空，保留 useChatStreamHandler 持有的数组引用
  replaceMessagesInPlace(messagesList.value, [])
  hasMoreHistory.value = true
  historyLoadingMore.value = false

  // 先拉取 session 元信息（标题等），再加载消息历史
  // session 元信息失败不阻塞历史加载；只记录日志
  try {
    const sessionRes = await getSession(routeSessionId)
    const title = sessionRes?.data?.title
    if (title) {
      notebookStore.setNotebookTitle(title)
    }
  } catch (err) {
    console.error('[NotebookChat] Failed to load session metadata:', err)
  }

  await loadInitialHistory()
}

// 预加载资源
onMounted(async () => {
  // 注册 Studio 面板的 prompt 发送回调
  notebookStore.registerSendPrompt((prompt: string) => {
    if (inputFieldRef.value?.triggerSend) {
      inputFieldRef.value.triggerSend(prompt)
    } else {
      sendMsg(prompt)
    }
  })

  // 如果路由携带 sessionId（notebook 路由参数名），加载该会话历史
  // 修复：原代码读 route.params.chatid，但 notebook 路由用 :sessionId? 参数，
  // 导致 /notebook/:id 进入时永远拿不到 ID，历史无法加载。
  const routeSessionId = extractSessionIdFromRoute(route.params)
  if (routeSessionId) {
    await loadSessionAndHydrate(routeSessionId)
  }
  await chatResources.prefetchChatInput()
  // 拉取后端推荐问题（agent 模式生效；非 agent 模式回退到本地兜底）
  fetchSuggestedQuestions()
})

// 路由切换响应：从 /notebook/A 跳到 /notebook/B 时，重新加载新会话历史
watch(
  () => extractSessionIdFromRoute(route.params),
  (newSessionId, oldSessionId) => {
    if (newSessionId && newSessionId !== oldSessionId && newSessionId !== sessionId.value) {
      // 停掉可能正在进行的流式响应
      stopStream()
      isReplying.value = false
      loading.value = false
      loadSessionAndHydrate(newSessionId)
    }
  },
)

onBeforeUnmount(() => {
  stopStream()
  notebookStore.unregisterSendPrompt()
  // 取消所有未触发的 job 超时定时器，避免卸载后回调仍在跑导致 store 状态错乱
  cancelAllJobTimeouts()
  // 组件卸载时一次性消费所有 pending jobs，把它们标记为 failed。
  // 否则用户切换路由 / 关闭 Notebook 后，Studio job 会永远卡在 generating 状态。
  // 这里不依赖 sessionId，因为不论挂在哪个 session 上，组件卸载意味着没人会再消费它。
  const leftovers = notebookStore.consumeAllPendingJobs()
  for (const { jobId } of leftovers) {
    notebookStore.updateJob(jobId, {
      status: 'failed',
      errorMessage: '会话已关闭，生成被中断',
    })
  }
})
</script>

<style lang="less" scoped>
.notebook-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--td-bg-color-page, var(--td-bg-color-container));
  position: relative;
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: auto;
  padding: 0;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 8px;
    transition-property: background;
    transition-duration: var(--duration-base, 220ms);
  }

  &:hover::-webkit-scrollbar-thumb {
    background: var(--td-scrollbar-color, rgba(0, 0, 0, 0.15));
  }
}

/* NotebookLM 风格：宽松留白，更窄最大宽度保持阅读舒适 */
.msg-list {
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 28px 8px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 空态欢迎区：NotebookLM 风格的居中布局 + 大留白 */
.welcome-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 96px 24px 48px;
  text-align: center;
}

/* Apple 风格渐变图标 */
.welcome-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--td-radius-extra-large, 16px);
  background: linear-gradient(135deg, var(--td-brand-color-1) 0%, var(--td-brand-color-3) 100%);
  color: var(--td-brand-color);
  margin-bottom: 24px;
  box-shadow: 0 4px 16px var(--brand-color-glow, rgba(0, 113, 227, 0.16));
}

.welcome-title {
  font-size: 26px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  margin: 0 0 10px;
  letter-spacing: -0.02em;
  text-wrap: balance;
}

.welcome-desc {
  font-size: 14px;
  color: var(--td-text-color-secondary);
  margin: 0 0 28px;
  max-width: 460px;
  line-height: 1.6;
  text-wrap: pretty;
}

@import '../css/suggested-questions.less';

@keyframes skeletonFadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.suggested-questions-container {
  max-width: 800px;
  width: 100%;
  margin: 28px 0 0;
  padding: 0 16px;
  transition: height 0.35s @suggested-ease;
}

.suggested-questions-inner {
  animation: skeletonFadeIn 0.3s ease-out;
}

.sq-slide-fade-enter-active {
  transition: opacity 0.35s @suggested-ease, transform 0.35s @suggested-ease;
}

.sq-slide-fade-leave-active {
  transition: opacity 0.15s cubic-bezier(0.4, 0, 1, 1),
    transform 0.15s cubic-bezier(0.4, 0, 1, 1);
}

.sq-slide-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.sq-slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.suggested-question-card {
  opacity: 0;
  transform: translateY(8px) scale(0.97);
  transition:
    opacity 0.35s @suggested-ease,
    transform 0.35s @suggested-ease,
    background 0.2s @suggested-ease,
    border-color 0.25s @suggested-ease,
    box-shadow 0.25s @suggested-ease;

  &.sq-card-skeleton {
    opacity: 1;
    transform: none;
  }

  &.sq-card-visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  &:not(.sq-card-skeleton):active {
    transform: scale(0.98);
  }

  &.sq-card-visible:active {
    transform: scale(0.98);
  }
}

.msg-item {
  contain: layout style;
}

.msg-skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 16px 0;
}

.msg-skeleton-bot {
  padding-left: 4px;
}

.typing-indicator {
  height: 40px;
  display: flex;
  align-items: center;
  padding-left: 4px;
}

.typing-dots {
  display: flex;
  gap: 5px;

  span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--td-brand-color);
    opacity: 0.6;
    animation: typingBounce 1.4s var(--ease-in-out-apple, cubic-bezier(0.65, 0, 0.35, 1)) infinite;

    &:nth-child(1) { animation-delay: 0s; }
    &:nth-child(2) { animation-delay: 0.18s; }
    &:nth-child(3) { animation-delay: 0.36s; }
  }
}

@keyframes typingBounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-6px); opacity: 1; }
}

/* 滚动到底部按钮：NotebookLM 风格圆形浮起按钮 */
.scroll-bottom-btn {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 168px;
  z-index: 10;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-stroke);
  box-shadow: var(--td-shadow-card, 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.05));
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--td-text-color-secondary);
  transition-property: background-color, color, box-shadow, transform;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: var(--td-bg-color-container-hover);
    color: var(--td-brand-color);
    box-shadow: var(--td-shadow-card-hover, 0 2px 6px rgba(0, 0, 0, 0.06), 0 8px 20px rgba(0, 0, 0, 0.08));
  }

  &:active {
    transform: translateX(-50%) scale(0.92);
  }
}

.fade-btn-enter-active,
.fade-btn-leave-active {
  transition-property: opacity, transform;
  transition-duration: var(--duration-base, 220ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));
}

.fade-btn-enter-from,
.fade-btn-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* 输入区：NotebookLM 风格底部宽松留白 */
.input-area {
  flex-shrink: 0;
  padding: 16px 28px 24px;
  max-width: 760px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
  /* 顶部渐隐遮罩：让消息滚动到输入区时自然过渡 */
  position: relative;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    var(--td-bg-color-page, #F8F9FA) 40%,
    var(--td-bg-color-page, #F8F9FA) 100%
  );
}

.source-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 4px;
}

/* 来源胶囊：NotebookLM 风格 */
.source-chip-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--td-brand-color);
  background: var(--brand-color-with-opacity, rgba(0, 113, 227, 0.08));
  padding: 4px 10px;
  border-radius: 999px;
  font-weight: 500;
  border: 1px solid var(--brand-color-border, rgba(0, 113, 227, 0.32));
}

.source-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-secondary);
  border-radius: 50%;
  cursor: pointer;
  transition-property: background-color, color, transform;
  transition-duration: var(--duration-fast, 150ms);
  transition-timing-function: var(--ease-out-apple, cubic-bezier(0.16, 1, 0.3, 1));

  &:hover {
    background: var(--td-error-color-1);
    color: var(--td-error-color);
  }

  &:active {
    transform: scale(0.92);
  }
}
</style>
