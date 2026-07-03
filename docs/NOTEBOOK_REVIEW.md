# 三栏式问答页面深度审查报告

> 审查日期:2026-07-03
> 审查范围:WeKnora 前端三栏布局(SourcePanel / 对话区 / StudioPanel)的完整实现状态
> 审查文件:NotebookView.vue、creatChat.vue、chat/index.vue 及所有 notebook 子组件

---

## 一、整体架构

三栏布局**已在 3 个页面落地**,并非单一页面:

| 页面 | 路由 | 文件 | 状态 |
|---|---|---|---|
| Notebook 独立页 | `/platform/notebook/:sessionId?` | [NotebookView.vue](../frontend/src/views/notebook/NotebookView.vue) | ⚠️ 半成品 |
| 新建对话 | `/platform/creatChat` | [creatChat.vue](../frontend/src/views/creatChat/creatChat.vue) | ✅ 生产可用 |
| 聊天会话 | `/platform/chat/:chatid` | [chat/index.vue](../frontend/src/views/chat/index.vue) | ✅ 生产可用 |

**组件复用**:`SourcePanel` / `StudioPanel` / `notebookStore` 被 3 个页面共享。`NotebookChat` 仅 NotebookView 使用,`chat/index.vue` 和 `creatChat.vue` 内联了自己的对话区。

### 关键文件清单

| 文件 | 路径 | 作用 |
|---|---|---|
| NotebookView | `frontend/src/views/notebook/NotebookView.vue` | 三栏布局容器 + Header |
| NotebookChat | `frontend/src/components/notebook/NotebookChat.vue` | NotebookView 专用对话区 |
| NotebookHeader | `frontend/src/components/notebook/NotebookHeader.vue` | 顶部标题栏 |
| SourcePanel | `frontend/src/components/notebook/SourcePanel.vue` | 左栏来源面板(3 页面共享) |
| StudioPanel | `frontend/src/components/notebook/StudioPanel.vue` | 右栏生成工具面板(3 页面共享) |
| notebook store | `frontend/src/stores/notebook.ts` | 三栏状态管理 |
| studioTools config | `frontend/src/config/studioTools.ts` | 20 种 Studio 工具卡片配置 |
| notebook types | `frontend/src/types/notebook.ts` | 类型定义 |
| menu store | `frontend/src/stores/menu.ts` | 侧栏菜单注册(含 notebook 入口) |

---

## 二、左栏 SourcePanel(来源面板)

### ✅ 已实现功能

| 功能 | 实现位置 | 状态 |
|---|---|---|
| 知识库列表加载 | `SourcePanel.vue:147-172` | ✅ `listKnowledgeBases({ creator: 'all' })` |
| 搜索过滤 | `SourcePanel.vue:175-186` | ✅ 实时 watch |
| 分组展开/折叠 | `SourcePanel.vue:202-205` | ✅ |
| 全选/半选状态 | `SourcePanel.vue:208-218` | ✅ indeterminate 正确 |
| 文件类型图标 | `SourcePanel.vue:246-258` | ✅ 16 种扩展名映射 |
| 骨架屏加载 | `SourcePanel.vue:43-47` | ✅ |
| 空态 | `SourcePanel.vue:50-54` | ✅ |
| 来源统计 | `SourcePanel.vue:36-38` | ✅ `X 个来源 · Y 个已选` |
| 添加来源 | `SourcePanel.vue:261-263` | ✅ `uiStore.openKBEditor('create')` |
| 选择同步 settings | `SourcePanel.vue:226-243` | ✅ kbIds + fileIds |

### ⚠️ 问题与缺陷

#### 1. `web_sources` 分组永远为空

[notebook.ts:46-52](../frontend/src/stores/notebook.ts#L46-52) 定义了 `web_sources` 分组:

```typescript
{
  id: 'web_sources',
  name: '网络搜索来源',
  expanded: true,
  items: [],
}
```

但 `SourcePanel.vue:147-172` 的 `loadKnowledgeBases` 只填充知识库分组,网络搜索来源从未被填充 — 用户在左栏永远看不到"网络搜索来源"分组,即使对话中使用了网络搜索。

#### 2. 类型定义不一致

[notebook.ts:77](../frontend/src/types/notebook.ts#L77) 定义:

```typescript
export type SourceItemType = 'knowledge_base' | 'document' | 'web_search' | 'faq' | 'wiki_page'
```

但 [SourcePanel.vue:131](../frontend/src/components/notebook/SourcePanel.vue#L131) 内部定义:

```typescript
interface SourceItem {
  type: 'file' | 'note'
}
```

类型系统未对齐,组件内部使用的 `'file'` / `'note'` 不在官方类型定义中。

#### 3. store 与组件 SourceGroup 结构不一致

[notebook.ts:99-105](../frontend/src/types/notebook.ts#L99-105) 的 `SourceGroup` 没有 `type` 和 `visible` 字段,但组件使用了它们 — 类型定义滞后于实现。

#### 4. `toggleItem` 未实际切换选中状态

[SourcePanel.vue:221-223](../frontend/src/components/notebook/SourcePanel.vue#L221-223):

```typescript
const toggleItem = (_groupId: string, _itemId: string, _val: boolean) => {
  syncToSettings()
}
```

参数全部以下划线前缀忽略,依赖 `t-checkbox` 的双向绑定自动更新 `item.selected`。虽然能工作但语义不清,且无法在切换时执行额外逻辑(如权限检查、来源限制等)。

---

## 三、中栏对话区

### 3.1 NotebookChat(NotebookView 专用)

#### ✅ 已实现

| 功能 | 位置 | 状态 |
|---|---|---|
| 消息列表渲染 | `NotebookChat.vue:33-59` | ✅ user/assistant |
| 流式响应 | `NotebookChat.vue:232-275` | ✅ `useStream` |
| 滚动控制 | `NotebookChat.vue:139-162` | ✅ 智能底部固定 |
| 推荐问题 | `NotebookChat.vue:167-180` | ✅ 4 个内置 |
| 图片/附件上传 | `NotebookChat.vue:303-328` | ✅ base64 |
| 停止生成 | `NotebookChat.vue:223-227` | ✅ |
| 来源 chips | `NotebookChat.vue:79-87` | ✅ |
| typing 指示器 | `NotebookChat.vue:62-66` | ✅ |

#### ⚠️ 严重缺陷

##### 1. 历史消息加载未实现

[NotebookChat.vue:395-398](../frontend/src/components/notebook/NotebookChat.vue#L395-398):

```typescript
onMounted(async () => {
  const routeChatId = route.params.chatid as string
  if (routeChatId) {
    sessionId.value = routeChatId
    // 不加载历史消息（简化版，后续补充）
  }
  await chatResources.prefetchChatInput()
})
```

注释明确写着"不加载历史消息(简化版,后续补充)" — 刷新页面后历史对话丢失。对比 `chat/index.vue` 实现了完整的 `getmsgList` 分页加载。

##### 2. Agent 流式事件未处理

[NotebookChat.vue:232-275](../frontend/src/components/notebook/NotebookChat.vue#L232-275) 的 `processChunk` 只处理 4 种 response_type:

- `answer` — 文本响应
- `session_title` — 会话标题
- `done` — 完成
- `error` — 错误

**未处理**:
- `tool_call` — 工具调用
- `thinking` — 思考过程
- `web_search` — 网络搜索
- `rag_pipeline` — RAG 管道进度
- `citation` — 引用信息

NotebookView 中看不到 Agent 的工具调用过程、思考链、RAG 进度,体验远不如 `chat/index.vue`。

##### 3. Studio 集成断裂

[NotebookChat.vue](../frontend/src/components/notebook/NotebookChat.vue) **没有**注册 `registerSendPrompt` 回调。

对比:
- `creatChat.vue:224` ✅ 注册了
- `chat/index.vue:876` ✅ 注册了
- `NotebookChat.vue` ❌ 未注册

在 NotebookView 中点击 Studio 工具卡片,`StudioPanel` 调用 `notebookStore.triggerSendPrompt(prompt)`,但 `sendPromptCallback` 为 `null`,**prompt 丢失** — Studio 在 NotebookView 中完全不可用。

##### 4. 会话创建与 Agent 模式不联动

[NotebookChat.vue:199-210](../frontend/src/components/notebook/NotebookChat.vue#L199-210):

```typescript
const res = await createSessions({
  title: notebookStore.notebookTitle,
  agent_id: settingsStore.selectedAgentId || 'builtin-quick-answer',
})
```

创建会话时硬编码 `builtin-quick-answer`,但 `sendMsg` 中又根据 `settingsStore.isAgentStreamMode` 选择 endpoint:

```typescript
const endpoint = agentEnabled ? '/api/v1/agent-chat' : '/api/v1/knowledge-chat'
```

会话类型与请求 endpoint 可能不匹配 — 创建的是 quick-answer 会话,却向 agent-chat 发请求。

### 3.2 chat/index.vue(生产使用)

✅ 功能最完整:历史消息加载、Agent 事件处理、IM 恢复轮询、会话切换、Studio 集成、推荐问题、引用渲染。

### 3.3 creatChat.vue(生产使用)

✅ 新建对话入口,推荐问题展示,Studio 集成,会话创建后跳转 `chat/:sessionId`。

---

## 四、右栏 StudioPanel

### ✅ 已实现

| 功能 | 位置 | 状态 |
|---|---|---|
| 20 种生成工具 | `studioTools.ts:4-197` | ✅ 5 大分类 |
| 分类展示 | `StudioPanel.vue:60-91` | ✅ 洞察/整理/创作/学习/分享 |
| PRO 标记 | `StudioPanel.vue:82` | ✅ |
| 工具点击 → 发送 prompt | `StudioPanel.vue:193-224` | ✅ |
| 历史记录列表 | `StudioPanel.vue:94-124` | ✅ 最近 8 条 |
| 任务状态图标 | `StudioPanel.vue:117-121` | ✅ |
| 任务详情查看 | `StudioPanel.vue:17-55` | ✅ |
| 折叠态 | `StudioPanel.vue:129-142` | ✅ |

### 20 种工具清单

| 分类 | 工具 |
|---|---|
| 洞察 (insight) | 音频概览、研究报告、视频脚本(PRO)、简报 |
| 整理 (organize) | 大纲、思维导图、时间线、数据表格、术语表 |
| 创作 (create) | 演示文稿(PRO)、信息图(PRO)、摘要、文字稿 |
| 学习 (study) | 闪卡、测验题、学习指南、常见问题、关键引语 |
| 分享 (share) | 对比分析、行动项 |

### ⚠️ 严重缺陷

#### 1. job 状态永远停在 `generating`

[StudioPanel.vue:206-216](../frontend/src/components/notebook/StudioPanel.vue#L206-216):

```typescript
notebookStore.addJob({
  id: jobId,
  type: toolType,
  name: tool.name,
  status: 'generating',
  sourceCount,
  sourceType: sourceCount > 0 ? 'selected' : 'conversation',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  progress: 0,
})
```

添加 job 时设为 `generating`,但**没有任何代码**调用 `notebookStore.updateJob()` 将状态更新为 `completed`/`failed`。

对话流完成后,Studio 历史记录中的 job 依然显示 loading 图标,永远无法变成成功状态。

#### 2. 下载/分享/重新生成 3 个按钮无功能

[StudioPanel.vue:42-53](../frontend/src/components/notebook/StudioPanel.vue#L42-53):

```html
<button class="action-btn">
  <t-icon name="download" size="14px" />
  <span>下载</span>
</button>
<button class="action-btn">
  <t-icon name="share" size="14px" />
  <span>分享</span>
</button>
<button class="action-btn">
  <t-icon name="refresh" size="14px" />
  <span>重新生成</span>
</button>
```

三个 `action-btn` **没有 `@click` 绑定** — 纯 UI 装饰,点击无任何效果。

#### 3. "查看全部"按钮无功能

[StudioPanel.vue:97](../frontend/src/components/notebook/StudioPanel.vue#L97):

```html
<button class="view-all-btn">查看全部</button>
```

无事件绑定,点击无效果。

#### 4. 内容渲染原始

[StudioPanel.vue:34-36](../frontend/src/components/notebook/StudioPanel.vue#L34-36):

```html
<div v-else-if="viewingJob.content" class="job-content-preview">
  <pre>{{ viewingJob.content }}</pre>
</div>
```

用 `<pre>` 直接渲染 `viewingJob.content`,没有 markdown 渲染、没有代码高亮、没有 Mermaid 图表支持。对比对话区 `botmsg.vue` 有完整的 markdown 渲染管线。

#### 5. job.content 永远为空

`handleToolClick` 添加 job 时没有设置 `content`,后续也没有任何代码将对话回复内容回填到 job — `viewingJob.content` 永远是 `undefined`,详情页永远显示"暂无内容"。

#### 6. progress 无更新

`handleToolClick` 设置 `progress: 0`,后续无更新。用户看到"正在生成... 0%"永远不会变化。

---

## 五、NotebookHeader

### ⚠️ 大量未实现功能

| 按钮 | 位置 | 状态 |
|---|---|---|
| 创建笔记本 → 空白笔记本 | `NotebookHeader.vue:37-39` | ⚠️ `MessagePlugin.info('功能开发中')` |
| 创建笔记本 → 从知识库创建 | `NotebookHeader.vue:40-42` | ⚠️ `MessagePlugin.info('功能开发中')` |
| 分析 | `NotebookHeader.vue:48-51` | ❌ 无 `@click` |
| 分享 → 复制链接 | `NotebookHeader.vue:59-61` | ❌ 无 `@click` |
| 分享 → 导出 PDF | `NotebookHeader.vue:62-64` | ❌ 无 `@click` |
| 分享 → 导出 Markdown | `NotebookHeader.vue:65-67` | ❌ 无 `@click` |
| 标题编辑持久化 | `NotebookHeader.vue:124-132` | ⚠️ 仅更新 store,无 API 调用 |

### 具体代码

```typescript
const createNotebook = () => {
  MessagePlugin.info('创建新笔记本（功能开发中）')
}

const createFromKB = () => {
  MessagePlugin.info('从知识库创建（功能开发中）')
}
```

标题编辑只在内存中:

```typescript
const commitTitle = () => {
  if (!localTitle.value.trim()) {
    localTitle.value = props.title
    editingTitle.value = false
    return
  }
  emit('update:title', localTitle.value.trim())  // 仅 emit 到父组件
  editingTitle.value = false
}
```

父组件 `NotebookView.vue:94-96`:

```typescript
const handleTitleUpdate = (title: string) => {
  notebookStore.setNotebookTitle(title)  // 仅更新 store,无 API 调用
}
```

刷新后标题丢失。

---

## 六、菜单入口问题

### ⚠️ NotebookView 菜单入口被隐藏

[menu.ts:29-35](../frontend/src/stores/menu.ts#L29-35) 注册了 notebook 菜单项:

```typescript
{
  title: 'Notebook',
  titleKey: '',
  icon: 'notebook',
  path: 'notebook',
  childrenPath: 'notebook'
},
```

但 [menu.vue:447-451](../frontend/src/components/menu.vue#L447-451) 的 `topMenuItems` 过滤条件**只包含 5 个 path**:

```typescript
const topMenuItems = computed<MenuItem[]>(() => {
  return (visibleMenuArr.value as unknown as MenuItem[]).filter((item: MenuItem) =>
    item.path === 'knowledge-bases' || item.path === 'agents'
    || item.path === 'integrations' || item.path === 'organizations'
    || item.path === 'creatChat'
  );
});
```

**notebook 不在其中** — 菜单项注册了但永远不会显示,用户无法通过侧栏导航到 NotebookView。

虽然 [menu.vue:1095-1097](../frontend/src/components/menu.vue#L1095-1097) 有跳转逻辑:

```typescript
} else if (path === 'notebook') {
  router.push('/platform/notebook')
}
```

但由于菜单项被过滤,这个分支永远不会触发。

---

## 七、布局系统

### ✅ 已实现

- 三栏 flex 布局,中栏 `flex: 1` 自适应
- 左右栏可折叠(transition 动画)
- 拖拽调整宽度(左栏 240-500px,右栏 280-520px)
- 折叠态展开按钮

### ⚠️ 缺陷

#### 1. 宽度未持久化

[notebook.ts:15-20](../frontend/src/stores/notebook.ts#L15-20):

```typescript
const layout = ref<NotebookLayoutState>({
  leftPanelWidth: 320,
  rightPanelWidth: 340,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
})
```

纯内存 ref,刷新后恢复默认值(320px/340px)。未使用 `localStorage` 或 `pinia-plugin-persistedstate`。

#### 2. 拖拽事件无 cleanup

[NotebookView.vue:103-131](../frontend/src/views/notebook/NotebookView.vue#L103-131):

```typescript
const startResize = (type: 'left' | 'right', e: MouseEvent) => {
  resizeType = type
  startX = e.clientX
  startWidth = type === 'left'
    ? notebookStore.layout.leftPanelWidth
    : notebookStore.layout.rightPanelWidth
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
}
```

`stopResize` 只在 mouseup 时移除监听 — 若组件在拖拽中卸载(如路由切换),事件监听器泄漏。

对比 `chat/index.vue` 和 `creatChat.vue` 也有相同问题(代码复制粘贴)。

---

## 八、综合评估

| 模块 | 完成度 | 评级 |
|---|---|---|
| **左栏 SourcePanel** | 85% | 🟡 基本可用,有类型不一致和空分组问题 |
| **中栏 NotebookChat** | 40% | 🔴 半成品,无历史加载、无 Agent 事件、Studio 集成断裂 |
| **中栏 chat/index.vue** | 95% | 🟢 生产可用 |
| **中栏 creatChat.vue** | 90% | 🟢 生产可用 |
| **右栏 StudioPanel** | 30% | 🔴 UI 壳完整,但 job 状态管理、内容回填、操作按钮全部未实现 |
| **NotebookHeader** | 20% | 🔴 大量按钮无功能或"开发中" |
| **布局系统** | 90% | 🟢 缺持久化 |
| **菜单入口** | 0% | 🔴 NotebookView 入口被隐藏 |

---

## 九、核心结论

### 9.1 当前可用状态

1. **三栏布局在 `creatChat.vue` 和 `chat/index.vue` 中已完整实现并生产可用** — 这两个是用户实际访问的页面。

2. **`NotebookView.vue` 是半成品** — 路由配置了但菜单入口被隐藏,自身功能不完整(无历史加载、无 Agent 事件处理、Studio 集成断裂),看起来是**未完成的功能预览**。

3. **StudioPanel 是"UI 壳"** — 20 种工具卡片看起来很完整,但点击后的 job 状态管理完全缺失:job 永远停在 generating、content 永远为空、下载/分享/重新生成按钮无功能。Studio 实际上只是一个"快捷发送预设 prompt"的入口,不是独立的生成任务系统。

### 9.2 NotebookView 修复优先级

如果要启用 NotebookView,需按以下优先级修复:

#### P0(阻断性)

1. **menu.vue 的 topMenuItems 过滤加入 `notebook`** — 否则用户无法进入
2. **NotebookChat 注册 `registerSendPrompt` 回调** — 否则 Studio 不可用
3. **NotebookChat 实现历史消息加载** — 否则刷新丢失对话

#### P1(核心体验)

4. **NotebookChat 处理 Agent 流式事件** — 复用 `chat/index.vue` 的 `useChatStreamHandler`
5. **StudioPanel 实现 job 状态更新** — 监听对话完成事件,更新 job 为 completed + 回填 content
6. **NotebookChat 修复会话创建与 Agent 模式联动** — 根据 `isAgentStreamMode` 创建会话

#### P2(完善性)

7. **StudioPanel 实现下载/分享/重新生成按钮**
8. **StudioPanel 实现 markdown 渲染**(复用 botmsg 的渲染管线)
9. **NotebookHeader 实现标题编辑 API 持久化**
10. **布局宽度持久化到 localStorage**
11. **SourcePanel 修复 web_sources 分组或移除定义**
12. **类型定义对齐**(SourceItemType、SourceGroup)

### 9.3 架构建议

#### 建议一:统一对话区组件

当前有 3 个对话区实现(`NotebookChat`、`chat/index.vue` 内联、`creatChat.vue` 内联),代码重复严重。建议:

- 将 `chat/index.vue` 的对话区提取为独立的 `ChatPanel.vue` 组件
- `NotebookChat`、`creatChat.vue` 都复用 `ChatPanel.vue`
- 通过 props 控制是否显示推荐问题、是否加载历史等差异

#### 建议二:StudioPanel 任务系统化

当前 Studio 是"伪任务系统" — 只有 UI 没有后端。建议:

- 后端新增 `/api/v1/studio/jobs` 接口,支持 job CRUD
- 前端 StudioPanel 改为真正的任务管理:创建 job → 轮询状态 → 完成后回填内容
- 支持 job 持久化(刷新后历史记录不丢失)

#### 建议三:布局状态持久化

```typescript
// notebook.ts
const layout = ref<NotebookLayoutState>(
  JSON.parse(localStorage.getItem('notebook-layout') || 'null') || {
    leftPanelWidth: 320,
    rightPanelWidth: 340,
    leftPanelCollapsed: false,
    rightPanelCollapsed: false,
  }
)

watch(layout, (val) => {
  localStorage.setItem('notebook-layout', JSON.stringify(val))
}, { deep: true })
```

---

## 十、文件路径索引

### 三栏布局核心文件

| 文件 | 绝对路径 |
|---|---|
| NotebookView | `/Users/tohnee/Trae/github/WeKnora/frontend/src/views/notebook/NotebookView.vue` |
| NotebookChat | `/Users/tohnee/Trae/github/WeKnora/frontend/src/components/notebook/NotebookChat.vue` |
| NotebookHeader | `/Users/tohnee/Trae/github/WeKnora/frontend/src/components/notebook/NotebookHeader.vue` |
| SourcePanel | `/Users/tohnee/Trae/github/WeKnora/frontend/src/components/notebook/SourcePanel.vue` |
| StudioPanel | `/Users/tohnee/Trae/github/WeKnora/frontend/src/components/notebook/StudioPanel.vue` |
| notebook store | `/Users/tohnee/Trae/github/WeKnora/frontend/src/stores/notebook.ts` |
| studioTools config | `/Users/tohnee/Trae/github/WeKnora/frontend/src/config/studioTools.ts` |
| notebook types | `/Users/tohnee/Trae/github/WeKnora/frontend/src/types/notebook.ts` |
| chat/index | `/Users/tohnee/Trae/github/WeKnora/frontend/src/views/chat/index.vue` |
| creatChat | `/Users/tohnee/Trae/github/WeKnora/frontend/src/views/creatChat/creatChat.vue` |
| menu store | `/Users/tohnee/Trae/github/WeKnora/frontend/src/stores/menu.ts` |
| menu component | `/Users/tohnee/Trae/github/WeKnora/frontend/src/components/menu.vue` |
| router | `/Users/tohnee/Trae/github/WeKnora/frontend/src/router/index.ts` |

### 复用组件

| 文件 | 绝对路径 |
|---|---|
| InputField | `/Users/tohnee/Trae/github/WeKnora/frontend/src/components/Input-field.vue` |
| botmsg | `/Users/tohnee/Trae/github/WeKnora/frontend/src/views/chat/components/botmsg.vue` |
| usermsg | `/Users/tohnee/Trae/github/WeKnora/frontend/src/views/chat/components/usermsg.vue` |
| useStream | `/Users/tohnee/Trae/github/WeKnora/frontend/src/api/chat/streame.ts` |
| useChatStreamHandler | `/Users/tohnee/Trae/github/WeKnora/frontend/src/composables/useChatStreamHandler.ts` |
| useStickyBottomOnResize | `/Users/tohnee/Trae/github/WeKnora/frontend/src/composables/useStickyBottomOnResize.ts` |

---

*报告结束*
