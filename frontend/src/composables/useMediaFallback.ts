/**
 * Studio 工具富媒体降级提示。
 *
 * 部分工具的理想输出是富媒体（音频/视频/图片/幻灯片），但当前后端只返回
 * Markdown 文本。本模块为这些工具提供"降级提示"，告诉用户当前展示的是
 * 文字稿/结构化描述，如需真正的富媒体需额外加工。
 *
 * 纯文本类工具（report / summary / outline / faq 等）不需要降级提示，返回 null。
 */

import type { StudioToolType } from '../types/notebook'

/** 富媒体工具的降级提示文案映射 */
export const MEDIA_FALLBACK_HINTS: Partial<Record<StudioToolType, string>> = {
  audio_overview:
    '以上为音频概览的文字稿。如需实际音频，请复制内容到 TTS 工具（如豆包语音合成）生成。',
  video_script:
    '以上为视频脚本文稿。如需实际视频，请配合视频制作工具（如剪映 / Premiere）按脚本制作。',
  infographic:
    '以上为信息图的结构化描述（含 Mermaid / ASCII 图）。如需图片格式，请导出后用设计工具加工。',
  presentation:
    '以上为演示文稿大纲。如需 PPT 文件，请导出 Markdown 后用 Marp / PowerPoint 转换。',
}

/**
 * 根据工具类型返回富媒体降级提示，纯文本工具返回 null。
 */
export function getMediaFallbackHint(toolType: StudioToolType): string | null {
  return MEDIA_FALLBACK_HINTS[toolType] ?? null
}
