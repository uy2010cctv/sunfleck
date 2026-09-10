/** Value exported as `NS`. */
export const NS = 'enterprise.governance' as const

/** Value exported as `zh`. */
export const zh: Record<string, string> = {
  'settings.label': '企业管理',
  'account.logoutLabel': '退出登录：{name}',
  'account.current': '当前用户',
  'account.loggingOut': '正在退出…',
  'account.logout': '退出登录',
  'account.error': '退出失败，请重试',
  'role.administrator': '管理员', 'role.creator': '创建者', 'role.operator': '运营者',
  'role.auditor': '审计员', 'role.member': '成员',
  'nav.organizations': '组织架构', 'nav.users': '用户管理', 'nav.workspaces': '工作区',
  'nav.memory': '企业记忆', 'nav.policies': '资源权限', 'nav.audit': '审计日志',
  'common.disabledSuffix': ' · 已停用', 'department.internalId': '内部编号 {id}',
  'user.editAria': '编辑用户：{name}', 'workspace.sandboxAria': '{name} 沙盒策略',
  'workspace.nameAria': '{name} 名称', 'workspace.saveAria': '保存{name}',
  'workspace.saving': '正在保存…', 'workspace.save': '保存', 'workspace.error': '保存工作区失败，请刷新后重试',
  'department.primaryLabel': '{name} · 主部门',
  'memory.reviewAria': '{summary} 审核说明', 'memory.reviewReason': '审核说明：{reason}',
  'visibility.restrictedCount': '指定 {count} 位成员', 'policy.editAria': '编辑权限：{name}',
}

/** Value exported as `en`. */
export const en: Record<string, string> = {
  'settings.label': 'Enterprise management',
  'account.logoutLabel': 'Log out: {name}',
  'account.current': 'Current user',
  'account.loggingOut': 'Logging out…',
  'account.logout': 'Log out',
  'account.error': 'Log out failed. Try again.',
  'role.administrator': 'Administrator', 'role.creator': 'Creator', 'role.operator': 'Operator',
  'role.auditor': 'Auditor', 'role.member': 'Member',
  'nav.organizations': 'Organization', 'nav.users': 'Users', 'nav.workspaces': 'Workspaces',
  'nav.memory': 'Enterprise memory', 'nav.policies': 'Resource access', 'nav.audit': 'Audit log',
  'common.disabledSuffix': ' · Disabled', 'department.internalId': 'Internal ID {id}',
  'user.editAria': 'Edit user: {name}', 'workspace.sandboxAria': 'Sandbox policy for {name}',
  'workspace.nameAria': 'Name for {name}', 'workspace.saveAria': 'Save {name}',
  'workspace.saving': 'Saving…', 'workspace.save': 'Save', 'workspace.error': 'Workspace save failed. Refresh and try again.',
  'department.primaryLabel': '{name} · Primary department',
  'memory.reviewAria': 'Review note for {summary}', 'memory.reviewReason': 'Review note: {reason}',
  'visibility.restrictedCount': '{count} selected members', 'policy.editAria': 'Edit access: {name}',
}

/** Allowed values for `GovernanceTranslate`. */
export type GovernanceTranslate = (key: string, params?: Record<string, string | number>) => string

/** Value exported as `defaultGovernanceTranslate`.
 * @param key - Input value used by this API.
 * @param params - Input value used by this API.
 */
export const defaultGovernanceTranslate: GovernanceTranslate = (key, params) => {
  let text = zh[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}
