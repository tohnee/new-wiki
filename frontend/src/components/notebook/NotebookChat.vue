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
          <div class="welcome-suggestions">
            <button
              v-for="q in suggestedPrompts"
              :key="q"
              class="suggestion-chip"
              @click="handleSuggestionClick(q)"
            >
              {{ q }}
            </button>
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
import { createSessions, getSession } from '@/api/chat/index'
import { useSettingsStore } from '@/stores/settings'
import { useChatResourcesStore } from '@/stores/chatResources'
import { useNotebookStore } from '@/stores/notebook'
import { useStickyBottomOnResize } from '@/composables/useStickyBottomOnResize'
import { MessagePlugin } from 'tdesign-vue-next'

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

// 滚动相关
const scrollContainer = ref<HTMLElement>()
const userHasScrolledUp = ref(false)
const inputFieldRef = ref()
const SCROLL_THRESHOLD = 80

const selectedCount = computed(() => notebookStore.selectedSourceCount)

const isNearBottom = () => {
  if (!scrollContainer.value) return true
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value
  return scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD
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
}

useStickyBottomOnResize(scrollContainer, userHasScrolledUp, scrollToBottom)

// 推荐问题
const suggestedPrompts = [
  '总结一下我选择的来源',
  '列出关键要点',
  '生成思维导图大纲',
  '对比不同观点',
]

const handleSuggestionClick = (q: string) => {
  if (inputFieldRef.value?.triggerSend) {
    inputFieldRef.value.triggerSend(q)
  } else {
    sendMsg(q)
  }
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

// 创建会话
const ensureSession = async () => {
  if (sessionId.value) return
  try {
    const res = await createSessions({
      title: notebookStore.notebookTitle,
      agent_id: settingsStore.selectedAgentId || 'builtin-quick-answer',
    })
    if (res?.success && res.data?.id) {
      sessionId.value = String(res.data.id)
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
}

const { onChunk, error: streamError, startStream, stopStream } = useStream()

// 简易流式处理（复用核心逻辑）
const processChunk = (data: any) => {
  if (!data) return
  if (data.response_type === 'session_title') {
    if (data.content) notebookStore.setNotebookTitle(data.content)
    return
  }
  if (data.response_type === 'answer') {
    fullContent.value += data.content || ''
    const last = messagesList.value[messagesList.value.length - 1]
    if (last && last.role === 'assistant' && !last.is_completed) {
      last.content = fullContent.value
    } else {
      const msg: any = {
        id: data.message_id || `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.content || '',
        is_completed: false,
        created_at: new Date().toISOString(),
        channel: 'web',
      }
      currentAssistantMessageId.value = msg.id
      messagesList.value.push(msg)
      fullContent.value = data.content || ''
    }
    scrollToBottom()
    return
  }
  if (data.response_type === 'done' || data.done) {
    const last = messagesList.value[messagesList.value.length - 1]
    if (last && last.role === 'assistant') {
      last.is_completed = true
      last.content = fullContent.value
    }
    isReplying.value = false
    loading.value = false
    currentAssistantMessageId.value = ''
    scrollToBottom(true)
  }
  if (data.response_type === 'error') {
    MessagePlugin.error(data.content || data.message || '生成失败')
    isReplying.value = false
    loading.value = false
  }
}

onChunk(processChunk)

watch(streamError, (err) => {
  if (err) {
    MessagePlugin.error(err)
    isReplying.value = false
    loading.value = false
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

  isReplying.value = true
  loading.value = true
  fullContent.value = ''

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
        else fileIds.push(item.id)
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
  const selectedAgentId = settingsStore.selectedAgentId || (agentEnabled ? '' : 'builtin-quick-answer')
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

// 预加载资源
onMounted(async () => {
  // 如果路由带 chatid，尝试加载该会话
  const routeChatId = route.params.chatid as string
  if (routeChatId) {
    sessionId.value = routeChatId
    // 不加载历史消息（简化版，后续补充）
  }
  await chatResources.prefetchChatInput()
})

onBeforeUnmount(() => {
  stopStream()
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
    transition: background 0.2s ease;
  }

  &:hover::-webkit-scrollbar-thumb {
    background: var(--td-scrollbar-color, rgba(0, 0, 0, 0.15));
  }
}

.msg-list {
  max-width: 800px;
  margin: 0 auto;
  padding: 24px 24px 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.welcome-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px 40px;
  text-align: center;
}

.welcome-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--td-brand-color-1) 0%, var(--td-brand-color-3) 100%);
  color: var(--td-brand-color);
  margin-bottom: 20px;
}

.welcome-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--td-text-color-primary);
  margin: 0 0 8px;
}

.welcome-desc {
  font-size: 14px;
  color: var(--td-text-color-secondary);
  margin: 0 0 24px;
  max-width: 480px;
  line-height: 1.6;
}

.welcome-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  max-width: 560px;
}

.suggestion-chip {
  padding: 8px 16px;
  border: 1px solid var(--td-component-border);
  background: var(--td-bg-color-container);
  color: var(--td-text-color-secondary);
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--td-brand-color);
    color: var(--td-brand-color);
    background: var(--td-brand-color-light);
    transform: translateY(-1px);
  }
}

.msg-item {
  contain: layout style;
}

.msg-skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
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
  gap: 4px;

  span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--td-text-color-placeholder);
    animation: typingBounce 1.4s ease-in-out infinite;

    &:nth-child(1) { animation-delay: 0s; }
    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }
}

@keyframes typingBounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-8px); }
}

.scroll-bottom-btn {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 160px;
  z-index: 10;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-stroke);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--td-text-color-secondary);
  transition: all 0.2s ease;

  &:hover {
    background: var(--td-bg-color-container-hover);
    color: var(--td-text-color-primary);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
}

.fade-btn-enter-active,
.fade-btn-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-btn-enter-from,
.fade-btn-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

.input-area {
  flex-shrink: 0;
  padding: 16px 24px 24px;
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.source-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 4px;
}

.source-chip-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  padding: 4px 10px;
  border-radius: 12px;
  font-weight: 500;
}

.source-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-secondary);
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--td-error-color-1);
    color: var(--td-error-color);
  }
}
</style>
