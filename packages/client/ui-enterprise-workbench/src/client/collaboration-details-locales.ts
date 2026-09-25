/** Copy for Session-scoped collaboration details. */
export const NS = 'enterprise.collaborationDetails'
/** Chinese collaboration detail labels. */
export const zh = {
  employee: '数字员工', version: '发布版本', capabilities: '能力', 'project.state': '项目状态', 'project.active': '进行中', 'project.archived': '已归档', 'project.unknown': '状态未知',
  memory: '记忆', 'memory.scope': '记忆范围', 'memory.all': '全部', 'memory.empty': '此范围暂无可见记忆', 'memory.unavailable': '当前无法查看记忆',
  'scope.organization': '组织', 'scope.department': '部门', 'scope.project': '项目', 'scope.agent': '员工', 'scope.pair': '我与员工',
  title: '会话详情', group: '群组', channel: '频道', unavailable: '当前会话没有协作详情',
  members: '参与成员', 'members.empty': '暂无数字员工', 'members.people': '人类成员',
  duty: '值班员工', 'duty.empty': '未设置值班员工', project: '关联项目', team: '协作团队',
  topics: '话题', 'topics.empty': '暂无话题', open: '进行中', settled: '已结束',
  policy: '协作方式', thread: '按话题协作', command: '指令触发', lane: '持续同一话题',
  mention_duty: '@ 指定员工；未 @ 时交给值班员工', ingest_only: '仅接收内容',
  error: '暂时无法打开，请重试', retry: '重试', loading: '正在加载',
} as const
/** Typed keys used by the detail tab and its header action. */
export type CollaborationDetailsKey = keyof typeof zh
/** English collaboration detail labels. */
export const en: Record<CollaborationDetailsKey, string> = {
  employee: 'Digital employee', version: 'Release version', capabilities: 'Capabilities', 'project.state': 'Project status', 'project.active': 'Active', 'project.archived': 'Archived', 'project.unknown': 'Unknown status',
  memory: 'Memory', 'memory.scope': 'Memory scope', 'memory.all': 'All', 'memory.empty': 'No visible memory in this scope', 'memory.unavailable': 'Memory is unavailable',
  'scope.organization': 'Organization', 'scope.department': 'Department', 'scope.project': 'Project', 'scope.agent': 'Employee', 'scope.pair': 'Me and employee',
  title: 'Conversation details', group: 'Group', channel: 'Channel', unavailable: 'No collaboration details for this conversation',
  members: 'Members', 'members.empty': 'No digital employees', 'members.people': 'Human members',
  duty: 'On duty', 'duty.empty': 'No employees on duty', project: 'Project', team: 'Team',
  topics: 'Topics', 'topics.empty': 'No topics yet', open: 'Open', settled: 'Settled',
  policy: 'Collaboration policy', thread: 'Topic conversations', command: 'Command triggered', lane: 'One continuous topic',
  mention_duty: 'Mention a specific employee; otherwise route to the employee on duty', ingest_only: 'Receive content only',
  error: 'Unable to open right now. Try again.', retry: 'Retry', loading: 'Loading',
}
