/**
 * 原地修改 messagesList 数组的纯函数集合。
 *
 * 存在原因：NotebookChat.vue 用 `ref<any[]>([])` 持有消息列表，并把
 * `messagesList.value` 数组引用传给 useChatStreamHandler。如果直接重新赋值
 * `messagesList.value = newData`，handler 内部仍持有旧数组引用，后续流式 push
 * 会推到旧数组，模板不显示。
 *
 * 解决方案：所有需要"替换列表内容"的场景都通过 splice 原地修改，保持数组引用稳定。
 */

/**
 * 用 newItems 原地替换 list 的全部内容（保留 list 引用本身）。
 *
 * @param list      要被替换的数组（会就地修改）
 * @param newItems  新内容（不会被修改）
 */
export function replaceMessagesInPlace<T>(list: T[], newItems: T[]): void {
  list.splice(0, list.length, ...newItems)
}

/**
 * 在 list 头部原地插入若干条消息（保留 list 引用本身）。
 *
 * @param list      要被插入的数组（会就地修改）
 * @param prepend   要插入到头部的消息（不会被修改）
 */
export function prependMessagesInPlace<T>(list: T[], prepend: T[]): void {
  if (prepend.length === 0) return
  list.unshift(...prepend)
}
