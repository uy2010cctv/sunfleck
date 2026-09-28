/** `workspace.files` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'workspace.files'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger.open': '查看工作区文件',
  'trigger.close': '关闭工作区文件',
  'panel.title': '工作区文件',
  'panel.workspace': '当前工作区',
  'panel.empty': '当前会话没有工作区目录',
  'panel.noSession': '请先新建或打开一个会话',
  'panel.loading': '加载中…',
  'panel.error': '无法加载文件列表',
  'panel.refresh': '刷新',
  'panel.close': '关闭',
  'panel.directory': '目录',
  'panel.file': '文件',
  'panel.expand': '展开',
  'panel.collapse': '折叠',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<WorkspaceFilesKey, string> = {
  'trigger.open': 'View workspace files',
  'trigger.close': 'Close workspace files',
  'panel.title': 'Workspace files',
  'panel.workspace': 'Current workspace',
  'panel.empty': 'The current session has no workspace directory',
  'panel.noSession': 'Create or open a session first',
  'panel.loading': 'Loading…',
  'panel.error': 'Failed to load file list',
  'panel.refresh': 'Refresh',
  'panel.close': 'Close',
  'panel.directory': 'Directory',
  'panel.file': 'File',
  'panel.expand': 'Expand',
  'panel.collapse': 'Collapse',
}

/** Key domain of the `workspace.files` namespace (zh is the source of truth). */
export type WorkspaceFilesKey = keyof typeof zh
