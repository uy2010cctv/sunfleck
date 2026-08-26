# `@deepseek-ai/dsh-client-ui-enterprise-workbench`

English | [中文](README.zh.md)

Enterprise digital-employee operations surface for the DSH Web client. It projects the existing runtime instead of creating another business data plane:

- Agent Presets are digital employees.
- Workspaces are business spaces.
- Sessions are work records.
- Pending interactions, running state, completion hints, Jobs, and Session projections remain owned by their existing packages.

The browser plugin contributes two additive entries: `enterprise-workbench` under `sidebar.footer.action`, and the matching overlay under `shell.overlay`. It replaces neither the Sidebar nor the Conversation. Selecting a work record closes the overlay and opens the source Session; starting with an employee calls the existing Session creation path with that Agent Preset and opens the resulting Conversation.

Optional employee presentation comes from the Preset's `preset.yml`:

```yaml
employee:
  position: 通用执行员工
  department: 数字化运营
  capabilities:
    - 文件与命令执行
    - 信息检索
```

These fields are display metadata only. The Preset id remains the stable runtime and employee identity; capability labels never grant tools or permissions.

## Security boundary

This surface does not authenticate users or authorize enterprise records. A deployment exposed to multiple intranet users still requires an authenticated Host identity and authorization policy before it can claim multi-user isolation. Loopback/trusted-host checks are transport fences, not authentication.

## Model Experience

### Browser operations projection

#### What the model sees

Nothing. The workbench projects browser state and invokes `SessionRuntime.create`; it adds no prompt section, model tool, message, Session Event, or model call.

#### Token effect

None. Starting an employee creates a native Session, whose later conversation requests own their ordinary token cost.

#### KV Cache effect

None. Opening the workbench does not assemble or mutate a provider request.

## Known Limitations and Deferred Work

- Employee state is derived from the current browser Session mirror; it is not an HR presence system.
- Work-record counts are Session counts, not business outcome or productivity metrics.
- The first release has no enterprise user/role provider, cross-user visibility filter, approval inbox aggregation, or persistent team definition.
