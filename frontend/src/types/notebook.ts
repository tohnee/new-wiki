// Studio（生成能力）相关类型定义

/** 生成工具类型 */
export type StudioToolType =
  | 'audio_overview'      // 音频概览
  | 'presentation'        // 演示文稿
  | 'video_script'        // 视频脚本
  | 'mind_map'            // 思维导图
  | 'report'              // 报告
  | 'flashcards'          // 闪卡
  | 'outline'             // 大纲
  | 'infographic'         // 信息图
  | 'data_table'          // 数据表格
  | 'timeline'            // 时间线
  | 'comparison'          // 对比分析
  | 'faq'                 // FAQ
  | 'study_guide'         // 学习指南
  | 'glossary'            // 术语表
  | 'briefing'            // 简报
  | 'quiz'                // 测验
  | 'action_items'        // 行动项
  | 'summary'             // 摘要
  | 'transcript'          // 文字稿
  | 'key_quotes';         // 关键引语

/** 生成工具卡片配置 */
export interface StudioToolCard {
  type: StudioToolType
  name: string
  description: string
  icon: string
  /** 分类：insight / organize / create / study / share */
  category: 'insight' | 'organize' | 'create' | 'study' | 'share'
  /** 发送给模型的 prompt 模板 */
  prompt: string
  /** 是否需要付费/高级功能 */
  pro?: boolean
  /** 支持的输入源：文档 / 对话 / 知识库 */
  supportedSources: Array<'documents' | 'conversation' | 'knowledge_base'>
}

/** 生成任务状态 */
export type StudioJobStatus = 'pending' | 'generating' | 'completed' | 'failed'

/** 单个生成任务（历史记录项） */
export interface StudioJob {
  id: string
  type: StudioToolType
  name: string
  status: StudioJobStatus
  /** 来源：基于哪些文档/对话生成 */
  sourceCount: number
  sourceType: 'documents' | 'conversation' | 'knowledge_base'
  createdAt: string
  updatedAt: string
  /** 生成的内容（不同类型格式不同） */
  content?: string
  /** 错误信息 */
  errorMessage?: string
  /** 进度百分比 0-100 */
  progress?: number
  /**
   * 触发该 job 时所属的对话 session ID。
   * 用于按 session 过滤历史记录、避免跨会话污染；空字符串表示尚未绑定 session
   * （向后兼容已有数据）。
   */
  sessionId?: string
}

/** Studio 面板状态 */
export interface StudioState {
  /** 当前选中的工具类型 */
  activeTool: StudioToolType | null
  /** 生成任务列表（历史记录） */
  jobs: StudioJob[]
  /** 面板是否展开 */
  panelOpen: boolean
  /** 当前查看的任务详情 */
  viewingJobId: string | null
}

/** 左栏来源类型 */
export type SourceItemType = 'knowledge_base' | 'document' | 'web_search' | 'faq' | 'wiki_page'

/** 来源项（左栏列表项） */
export interface SourceItem {
  id: string
  /** 显示名称 */
  name: string
  /** 来源类型：knowledge_base 表示知识库分组，document 表示知识库内文档 */
  type: SourceItemType
  /** 是否已选中 */
  selected: boolean
  /** 来源/创建时间 */
  updatedAt?: string
  /** 子项数量（如文档数、段落数） */
  itemCount?: number
  /** 知识库 ID（文档类型用） */
  knowledgeBaseId?: string
}

/** 左栏分组 */
export interface SourceGroup {
  id: string
  name: string
  /** 分组类型：knowledge_base / web_sources */
  type: 'knowledge_base' | 'web_sources'
  items: SourceItem[]
  /** 是否展开 */
  expanded: boolean
  /** 搜索过滤后是否可见 */
  visible: boolean
}

/** Notebook 整体布局状态 */
export interface NotebookLayoutState {
  /** 左栏宽度 */
  leftPanelWidth: number
  /** 右栏宽度 */
  rightPanelWidth: number
  /** 左栏是否折叠 */
  leftPanelCollapsed: boolean
  /** 右栏是否折叠 */
  rightPanelCollapsed: boolean
}
