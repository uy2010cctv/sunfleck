/** Directory loading and the org-tree people picker reused by room member pickers. */
import { useEffect, useState } from 'react'
import css from './CollaborationRoom.module.css'

/** One selectable directory entry: a colleague or a published digital employee. */
export interface DirectoryChoice { readonly id: string; readonly name: string }
/** One org-tree department node. */
export interface DepartmentNode { readonly id: string; readonly name: string; readonly parentId: string | null }
/** One colleague entry carrying the departments they belong to. */
export interface PersonChoice { readonly id: string; readonly name: string; readonly departmentIds: readonly string[] }

/** Load the people directory (with departments) and the employee roster once. */
export function useDirectories(): {
  readonly loaded: boolean
  readonly departments: readonly DepartmentNode[]
  readonly people: readonly PersonChoice[]
  readonly employees: readonly DirectoryChoice[]
} {
  const [state, setState] = useState({
    loaded: false,
    departments: [] as readonly DepartmentNode[],
    people: [] as readonly PersonChoice[],
    employees: [] as readonly DirectoryChoice[],
  })
  useEffect(() => {
    let live = true
    void Promise.all([
      fetch('/auth/departments', { credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then(async response => response.ok ? response.json() as Promise<readonly Record<string, unknown>[]> : [])
        .then(rows => rows.flatMap((row) => {
          if (typeof row.id !== 'string' || row.id === '') return []
          const parent = typeof row.parentId === 'string' && row.parentId !== '' ? row.parentId : null
          const name = typeof row.name === 'string' && row.name !== '' ? row.name : row.id
          return [{ id: row.id, name, parentId: parent }]
        }))
        .catch(() => [] as readonly DepartmentNode[]),
      fetch('/auth/admin/users', { credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then(async response => response.ok ? response.json() as Promise<readonly Record<string, unknown>[]> : [])
        .then(rows => rows.flatMap((row) => {
          if (typeof row.id !== 'string' || row.id === '') return []
          const name = typeof row.displayName === 'string' && row.displayName !== '' ? row.displayName
            : typeof row.name === 'string' && row.name !== '' ? row.name
              : typeof row.username === 'string' && row.username !== '' ? row.username : row.id
          const ids = Array.isArray(row.departmentIds) ? row.departmentIds.filter((id): id is string => typeof id === 'string') : []
          return [{ id: row.id, name, departmentIds: ids }]
        }))
        .catch(() => [] as readonly PersonChoice[]),
      fetch('/enterprise/employees', { credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then(async response => response.ok ? response.json() as Promise<readonly Record<string, unknown>[]> : [])
        .then(rows => rows.flatMap((row) => {
          if (typeof row.id !== 'string' || row.id === '') return []
          const name = typeof row.displayName === 'string' && row.displayName !== '' ? row.displayName : row.id
          return [{ id: row.id, name }]
        }))
        .catch(() => [] as readonly DirectoryChoice[]),
    ]).then(([departments, people, employees]) => {
      if (live) setState({ loaded: true, departments, people, employees })
    })
    return () => { live = false }
  }, [])
  return { loaded: state.loaded, departments: state.departments, people: state.people, employees: state.employees }
}

/** People picker: the org tree with department grouping, or a flat fallback. */
export function OrgPeoplePicker({ people, departments, picked, onToggle, unassignedLabel }: {
  readonly people: readonly PersonChoice[]
  readonly departments: readonly DepartmentNode[]
  readonly picked: readonly string[]
  readonly onToggle: (id: string) => void
  readonly unassignedLabel: string
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const departmentIds = new Set(departments.map(department => department.id))
  const assigned = people.filter(person => person.departmentIds.some(id => departmentIds.has(id)))
  const unassigned = people.filter(person => !assigned.includes(person))
  const renderNode = (node: DepartmentNode, depth: number): React.ReactNode => {
    const members = assigned.filter(person => person.departmentIds.includes(node.id))
    const children = departments.filter(department => department.parentId === node.id)
    const isCollapsed = collapsed.has(node.id)
    return <div key={node.id}>
      <div className={css.pickerDept} style={{ paddingLeft: `${depth * 14}px` }}>
        <button type="button" className={css.pickerToggle} aria-expanded={!isCollapsed}
          onClick={() => { setCollapsed((current) => {
            const next = new Set(current)
            if (next.has(node.id)) next.delete(node.id)
            else next.add(node.id)
            return next
          })}}>{isCollapsed ? '▸' : '▾'}</button>
        <span className={css.pickerDeptName}>{node.name}</span>
      </div>
      {!isCollapsed && <div>
        {children.map(child => renderNode(child, depth + 1))}
        {members.map(person => <label key={person.id} className={css.pickerRow} style={{ paddingLeft: `${(depth + 1) * 14 + 20}px` }}>
          <input type="checkbox" checked={picked.includes(person.id)}
            onChange={() => { onToggle(person.id) }}/> <span>{person.name}</span>
        </label>)}
      </div>}
    </div>
  }
  return <div className={css.pickerTree}>
    {departments.filter(department => department.parentId === null).map(department => renderNode(department, 0))}
    {unassigned.length > 0 && <div className={css.pickerDept}>
      <span className={css.pickerDeptName}>{unassignedLabel}</span>
    </div>}
    {unassigned.map(person => <label key={person.id} className={css.pickerRow} style={{ paddingLeft: '20px' }}>
      <input type="checkbox" checked={picked.includes(person.id)}
        onChange={() => { onToggle(person.id) }}/> <span>{person.name}</span>
    </label>)}
  </div>
}
