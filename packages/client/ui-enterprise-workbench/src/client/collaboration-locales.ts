/** Copy for native-shell collaboration navigation. */
export const COLLABORATION_NS = 'enterprise.collaboration'
/** English collaboration strings. */
export const en = {
  groups: 'Group chats', channels: 'Channels', addGroup: 'Create group', addChannel: 'Create channel',
  refresh: 'Refresh conversations', emptyGroup: 'No group chats', emptyChannel: 'No channels',
  loadError: 'Could not load conversations', retry: 'Retry', create: 'Create', cancel: 'Cancel',
  name: 'Name', workspace: 'Workspace', chooseWorkspace: 'Select an accessible workspace',
  employees: 'Digital employees', people: 'People', team: 'Team charter', noTeam: 'No charter · respond to mentions',
  project: 'Project', noProject: 'No linked project', duty: 'On-duty employee', chooseDuty: 'Select an on-duty employee',
  topicPolicy: 'Topics', thread: 'Create a topic for each new request', command: 'Create topics with /topic', lane: 'One continuous topic',
  respondPolicy: 'Response', mention_duty: 'Mentions or on-duty employee', ingest_only: 'Announcements · collect only',
  createHelp: 'Choose the workspace and members. Only invited people who can access the workspace can open this conversation.',
  peopleUnavailable: 'The people directory is unavailable. You will be the only human member.',
  chooseEmployee: 'Choose an employee conversation', chooseTopic: 'Select a topic or start a new one',
  startTeam: 'Send a goal to start the chartered team', announcement: 'Submit an announcement for knowledge review',
  message: 'Message', placeholder: 'Write a message; @ an employee in a group, or /topic to create a topic', send: 'Send',
  noSelection: 'Select a group or channel from the sidebar', details: 'Conversation details',
  settled: 'Resolved', open: 'Open', emptyTopics: 'No topics yet', emptyEmployees: 'Publish an employee before creating a conversation',
  requestFailed: 'The operation failed. Try again', forbidden: 'You no longer have access to this conversation',
  unavailable: 'Collaboration is unavailable on this host', noTarget: 'Mention an employee to receive this message',
  noTopic: 'Select a topic or create one with /topic', alreadySettled: 'This topic is resolved. Create a new topic',
  submitted: 'Announcement submitted for review', choicesError: 'Could not load available workspaces and employees',
  nativeHint: 'Messages continue in the existing Session after you choose a destination.',
  senderPolicy: 'Group members respond only when mentioned.',
} as const
/** Translation keys consumed by the collaboration components. */
export type CollaborationKey = keyof typeof en
/** Chinese collaboration strings. */
export const zh: Record<CollaborationKey, string> = {
  groups: '群聊', channels: '频道', addGroup: '创建群聊', addChannel: '创建频道',
  refresh: '刷新会话', emptyGroup: '暂无群聊', emptyChannel: '暂无频道',
  loadError: '会话加载失败', retry: '重试', create: '创建', cancel: '取消',
  name: '名称', workspace: '工作区', chooseWorkspace: '选择可访问的工作区',
  employees: '数字员工', people: '成员', team: '团队章程', noTeam: '无章程 · @ 谁谁回应',
  project: '项目', noProject: '不关联项目', duty: '当值员工', chooseDuty: '选择当值员工',
  topicPolicy: '话题方式', thread: '每个新请求开启一个话题', command: '通过 /topic 创建话题', lane: '持续使用同一话题',
  respondPolicy: '响应方式', mention_duty: '提及员工或交给当值', ingest_only: '公告 · 只收不答',
  createHelp: '选择工作区和成员。受邀成员还需拥有工作区访问权限，才能打开会话。',
  peopleUnavailable: '暂时无法读取成员目录，创建后仅你自己可访问',
  chooseEmployee: '选择员工会话', chooseTopic: '选择话题，或发送消息开始新话题',
  startTeam: '发送目标，启动章程团队', announcement: '提交公告，进入知识审核',
  message: '消息', placeholder: '输入消息，群聊用 @ 提及员工，/topic 创建话题', send: '发送',
  noSelection: '从左侧选择群聊或频道', details: '会话详情',
  settled: '已解决', open: '进行中', emptyTopics: '暂无话题', emptyEmployees: '请先发布数字员工，再创建会话',
  requestFailed: '操作未完成，请重试', forbidden: '你已无权访问此会话',
  unavailable: '当前服务暂不支持协作会话', noTarget: '请 @ 一位员工接收这条消息',
  noTopic: '请选择话题，或用 /topic 创建新话题', alreadySettled: '此话题已解决，请创建新话题',
  submitted: '公告已提交审核', choicesError: '可用工作区和员工加载失败',
  nativeHint: '选择后将在现有会话中继续对话', senderPolicy: '群成员仅在被 @ 时回应',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Native-shell collaboration directory and first-message copy. */
    'enterprise.collaboration': CollaborationKey
  }
}
