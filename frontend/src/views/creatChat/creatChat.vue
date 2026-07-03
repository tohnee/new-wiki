<template>
    <div class="creatchat-notebook-layout">
        <!-- 左栏：来源面板 -->
        <transition name="panel-slide-left">
            <div v-show="!notebookStore.layout.leftPanelCollapsed" class="nb-panel nb-panel-left"
                :style="{ width: `${notebookStore.layout.leftPanelWidth}px` }">
                <SourcePanel :collapsed="false" @toggle="notebookStore.toggleLeftPanel" />
            </div>
        </transition>
        <div v-show="notebookStore.layout.leftPanelCollapsed" class="nb-collapsed nb-collapsed-left">
            <button class="nb-expand-btn" title="展开来源面板" @click="notebookStore.toggleLeftPanel">
                <t-icon name="chevron-right" size="16px" />
            </button>
        </div>
        <div v-if="!notebookStore.layout.leftPanelCollapsed" class="nb-resize-handle nb-resize-left"
            @mousedown="startResize('left', $event)" />

        <!-- 中栏：新对话欢迎区 -->
        <div class="nb-panel nb-panel-center">
            <div class="dialogue-wrap">
                <div class="dialogue-answers">
                    <div class="dialogue-title" style="--wails-draggable: drag">
                        <span style="--wails-draggable: drag">{{ $t('createChat.title') }}</span>
                    </div>
                    <!-- 推荐问题 -->
                    <div ref="sqContainerRef" class="suggested-questions-container">
                        <!-- 骨架屏占位 -->
                        <div v-if="sqLoading && suggestedQuestions.length === 0" class="suggested-questions-inner">
                            <div class="suggested-questions-title"><t-skeleton animation="gradient"
                                    :row-col="[{ width: '120px', height: '14px' }]" /></div>
                            <div class="suggested-questions-grid">
                                <div v-for="n in 6" :key="'sq-skel-' + n" class="suggested-question-card sq-card-skeleton">
                                    <t-skeleton animation="gradient"
                                        :row-col="[{ width: '100%', height: '14px', type: 'rect' }]" />
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
                                            <t-icon :name="sqLoading ? 'loading' : 'refresh'"
                                                :class="{ 'sq-refresh-spin': sqLoading }" />
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
                    <InputField ref="inputFieldRef" @send-msg="sendMsg"></InputField>
                </div>
            </div>
        </div>

        <!-- 右栏拖拽 -->
        <div v-if="!notebookStore.layout.rightPanelCollapsed" class="nb-resize-handle nb-resize-right"
            @mousedown="startResize('right', $event)" />

        <!-- 右栏：Studio 面板 -->
        <transition name="panel-slide-right">
            <div v-show="!notebookStore.layout.rightPanelCollapsed" class="nb-panel nb-panel-right"
                :style="{ width: `${notebookStore.layout.rightPanelWidth}px` }">
                <StudioPanel :collapsed="false" @toggle="notebookStore.toggleRightPanel" />
            </div>
        </transition>
        <div v-show="notebookStore.layout.rightPanelCollapsed" class="nb-collapsed nb-collapsed-right">
            <button class="nb-expand-btn nb-studio-expand" title="展开 Studio" @click="notebookStore.toggleRightPanel">
                <t-icon name="wand" size="16px" />
            </button>
        </div>
    </div>

    <ContextualGuide tour="chat" :when="showChatContextualGuide" />

    <!-- 知识库编辑器（创建/编辑统一组件） -->
    <KnowledgeBaseEditorModal :visible="uiStore.showKBEditorModal" :mode="uiStore.kbEditorMode"
        :kb-id="uiStore.currentKBId || undefined" :initial-type="uiStore.kbEditorType"
        @update:visible="(val) => val ? null : uiStore.closeKBEditor()" @success="handleKBEditorSuccess" />
</template>
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue';
import ContextualGuide from '@/components/ContextualGuide.vue';
import InputField from '@/components/Input-field.vue';
import SourcePanel from '@/components/notebook/SourcePanel.vue';
import StudioPanel from '@/components/notebook/StudioPanel.vue';
import { useNotebookStore } from '@/stores/notebook';
import { createSessions } from "@/api/chat/index";
import { getSuggestedQuestions } from "@/api/agent/index";
import type { SuggestedQuestion } from "@/api/agent/index";
import { useMenuStore } from '@/stores/menu';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { useRoute, useRouter } from 'vue-router';
import { MessagePlugin } from 'tdesign-vue-next';
import { useI18n } from 'vue-i18n';
import KnowledgeBaseEditorModal from '@/views/knowledge/KnowledgeBaseEditorModal.vue';
import { useKnowledgeBaseCreationNavigation } from '@/hooks/useKnowledgeBaseCreationNavigation';

const router = useRouter();
const route = useRoute();
const usemenuStore = useMenuStore();
const settingsStore = useSettingsStore();
const uiStore = useUIStore();
const notebookStore = useNotebookStore();
const { t } = useI18n();
const { navigateToKnowledgeBaseList } = useKnowledgeBaseCreationNavigation();

const showChatContextualGuide = computed(() => {
    return route.name === 'globalCreatChat' || route.name === 'kbCreatChat';
});

// ===== 推荐问题 =====
const suggestedQuestions = ref<SuggestedQuestion[]>([]);
const sqLoading = ref(true);
const sqCardsRevealed = ref(false);
const sqRenderKey = ref(0);
const sqContainerRef = ref<HTMLElement | null>(null);
let suggestedQuestionsFetchId = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// --- 高度平滑过渡钩子 ---
const onBeforeLeave = () => {
    const c = sqContainerRef.value;
    if (!c) return;
    c.style.height = c.offsetHeight + 'px';
    c.style.overflow = 'hidden';
};

const onAfterLeave = () => {
    const c = sqContainerRef.value;
    if (!c) return;
    if (suggestedQuestions.value.length === 0) {
        requestAnimationFrame(() => { c.style.height = '0px'; });
        c.addEventListener('transitionend', () => {
            c.style.height = '';
            c.style.overflow = '';
        }, { once: true });
    }
};

const onEnter = (el: Element) => {
    const c = sqContainerRef.value;
    if (!c) return;
    const startHeight = c.offsetHeight;
    c.style.height = 'auto';
    c.style.overflow = 'hidden';
    const targetHeight = c.offsetHeight;
    c.style.height = startHeight + 'px';
    requestAnimationFrame(() => {
        c.style.height = targetHeight + 'px';
    });
};

const onQuestionsEntered = () => {
    const c = sqContainerRef.value;
    if (c) {
        c.style.height = '';
        c.style.overflow = '';
    }
    nextTick(() => { sqCardsRevealed.value = true; });
};

const fetchSuggestedQuestions = async () => {
    const fetchId = ++suggestedQuestionsFetchId;
    sqLoading.value = true;
    try {
        const agentId = settingsStore.selectedAgentId;
        if (!agentId) return;
        const res = await getSuggestedQuestions(agentId, settingsStore.getSuggestedQuestionsParams(6));
        if (fetchId === suggestedQuestionsFetchId) {
            sqCardsRevealed.value = false;
            sqRenderKey.value++;
            suggestedQuestions.value = res?.data?.questions || [];
        }
    } catch (err) {
        console.warn('[SuggestedQuestions] Failed to fetch:', err);
        if (fetchId === suggestedQuestionsFetchId) {
            suggestedQuestions.value = [];
        }
    } finally {
        if (fetchId === suggestedQuestionsFetchId) {
            sqLoading.value = false;
        }
    }
};

// 防抖包装，切换知识库/文件时300ms内不重复请求
const debouncedFetch = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { fetchSuggestedQuestions(); }, 300);
};

// 监听 Agent / 知识库 / 文件 / 标签 / MCP / Skill @mention
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
);

onMounted(() => {
    fetchSuggestedQuestions();
    // 注册 Studio 面板的 prompt 发送回调
    notebookStore.registerSendPrompt((prompt: string) => {
        if (inputFieldRef.value?.triggerSend) {
            inputFieldRef.value.triggerSend(prompt);
        }
    });
});

const inputFieldRef = ref();

const handleSuggestedQuestionClick = (question: string) => {
    inputFieldRef.value?.triggerSend(question);
};

const sendMsg = (value: string, modelId: string, mentionedItems: any[], imageFiles: any[] = [], attachmentFiles: any[] = []) => {
    createNewSession(value, modelId, mentionedItems, imageFiles, attachmentFiles);
}

async function createNewSession(value: string, modelId: string, mentionedItems: any[] = [], imageFiles: any[] = [], attachmentFiles: any[] = []) {
    const selectedKbs = settingsStore.settings.selectedKnowledgeBases || [];
    const selectedFiles = settingsStore.settings.selectedFiles || [];

    const sessionData: any = {};

    sessionData.agent_config = {
        enabled: true,
        max_iterations: settingsStore.agentConfig.maxIterations,
        temperature: settingsStore.agentConfig.temperature,
        knowledge_bases: selectedKbs,
        knowledge_ids: selectedFiles,
        allowed_tools: settingsStore.agentConfig.allowedTools
    };

    try {
        const res = await createSessions(sessionData);
        if (res.data && res.data.id) {
            await navigateToSession(res.data.id, value, modelId, mentionedItems, imageFiles, attachmentFiles);
        } else {
            console.error('[createChat] Failed to create session');
            MessagePlugin.error(t('createChat.messages.createFailed'));
        }
    } catch (error) {
        console.error('[createChat] Create session error:', error);
        MessagePlugin.error(t('createChat.messages.createError'));
    }
}

const navigateToSession = async (sessionId: string, value: string, modelId: string, mentionedItems: any[], imageFiles: any[] = [], attachmentFiles: any[] = []) => {
    const now = new Date().toISOString();
    let obj = {
        title: t('createChat.newSessionTitle'),
        path: `chat/${sessionId}`,
        id: sessionId,
        isMore: false,
        isNoTitle: true,
        created_at: now,
        updated_at: now
    };
    usemenuStore.updataMenuChildren(obj);
    usemenuStore.changeIsFirstSession(true);
    usemenuStore.changeFirstQuery(value, mentionedItems, modelId, imageFiles, attachmentFiles);
    router.push(`/platform/chat/${sessionId}`);
}

const handleKBEditorSuccess = (kbId: string) => {
    navigateToKnowledgeBaseList(kbId)
}

onUnmounted(() => {
    notebookStore.unregisterSendPrompt();
});

// ==== 面板拖拽调整宽度 ====
let resizeType: 'left' | 'right' | null = null;
let resizeStartX = 0;
let resizeStartWidth = 0;
const startResize = (type: 'left' | 'right', e: MouseEvent) => {
    resizeType = type;
    resizeStartX = e.clientX;
    resizeStartWidth = type === 'left'
        ? notebookStore.layout.leftPanelWidth
        : notebookStore.layout.rightPanelWidth;
    document.addEventListener('mousemove', onPanelResize);
    document.addEventListener('mouseup', stopPanelResize);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
};
const onPanelResize = (e: MouseEvent) => {
    if (!resizeType) return;
    const delta = e.clientX - resizeStartX;
    if (resizeType === 'left') {
        notebookStore.setLeftPanelWidth(resizeStartWidth + delta);
    } else {
        notebookStore.setRightPanelWidth(resizeStartWidth - delta);
    }
};
const stopPanelResize = () => {
    resizeType = null;
    document.removeEventListener('mousemove', onPanelResize);
    document.removeEventListener('mouseup', stopPanelResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
};
</script>
<style lang="less" scoped>
// ==== 三栏 Notebook 布局 ====
.creatchat-notebook-layout {
    display: flex;
    flex: 1;
    width: 100%;
    min-height: 0;
    min-width: 0;
    position: relative;
    overflow: hidden;
}
.nb-panel {
    height: 100%;
    min-height: 0;
    overflow: hidden;
}
.nb-panel-left {
    flex-shrink: 0;
    border-right: 1px solid var(--td-component-stroke);
    transition: width 0.2s ease;
    background: var(--td-bg-color-container);
    position: relative;
    z-index: 2;
}
.nb-panel-center {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative;
}
.nb-panel-right {
    flex-shrink: 0;
    border-left: 1px solid var(--td-component-stroke);
    transition: width 0.2s ease;
    background: var(--td-bg-color-container);
    position: relative;
    z-index: 2;
}
.nb-collapsed {
    width: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12px;
    background: var(--td-bg-color-container);
}
.nb-collapsed-left {
    border-right: 1px solid var(--td-component-stroke);
}
.nb-collapsed-right {
    border-left: 1px solid var(--td-component-stroke);
}
.nb-expand-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: var(--td-bg-color-secondarycontainer);
    color: var(--td-text-color-secondary);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover {
        background: var(--td-brand-color-light);
        color: var(--td-brand-color);
    }
    &.nb-studio-expand {
        color: var(--td-brand-color);
    }
}
.nb-resize-handle {
    width: 4px;
    flex-shrink: 0;
    cursor: ew-resize;
    position: relative;
    background: transparent;
    z-index: 5;
    transition: background 0.15s ease;
    &::after {
        content: '';
        position: absolute;
        top: 0;
        left: 1px;
        width: 2px;
        height: 100%;
        background: transparent;
        transition: background 0.15s ease;
    }
    &:hover::after, &:active::after {
        background: var(--td-brand-color);
    }
}
.panel-slide-left-enter-active,
.panel-slide-left-leave-active,
.panel-slide-right-enter-active,
.panel-slide-right-leave-active {
    transition: transform 0.25s ease, opacity 0.2s ease;
}
.panel-slide-left-enter-from, .panel-slide-left-leave-to {
    transform: translateX(-100%);
    opacity: 0;
}
.panel-slide-right-enter-from, .panel-slide-right-leave-to {
    transform: translateX(100%);
    opacity: 0;
}

.dialogue-wrap {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
}

.dialogue-answers {
    display: flex;
    flex-flow: column;
    align-items: center;
    width: 100%;
    max-width: 800px;
    gap: 24px;
    padding: 0 24px;

    :deep(.answers-input) {
        position: static;
        transform: translateX(0);
        width: 100%;
    }
}

.dialogue-title {
    display: flex;
    color: var(--td-text-color-primary);
    font-family: var(--app-font-family);
    font-size: 28px;
    font-weight: 600;
    align-items: center;
    margin-bottom: 0;

    .icon {
        display: flex;
        width: 32px;
        height: 32px;
        justify-content: center;
        align-items: center;
        border-radius: 6px;
        background: var(--td-bg-color-container);
        box-shadow: var(--td-shadow-1);
        margin-right: 12px;

        .logo_img {
            height: 24px;
            width: 24px;
        }
    }
}

@import '../../components/css/suggested-questions.less';

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
    margin: 0;
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
</style>
<style lang="less">
.del-menu-popup {
    z-index: 99 !important;

    .t-popup__content {
        width: 100px;
        height: 40px;
        line-height: 30px;
        padding-left: 14px;
        cursor: pointer;
        margin-top: 4px !important;
    }
}
</style>
