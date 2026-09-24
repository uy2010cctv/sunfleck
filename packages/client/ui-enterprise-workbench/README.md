---
description: "Enterprise digital-employee roster and operations workbench over DSH runtime facts."
kind: "package-reference"
---
# `@deepseek-ai/dsh-client-ui-enterprise-workbench`

English | [中文](README.zh.md)

## Summary

Enterprise digital-employee roster and operations workbench over DSH runtime facts.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

The sidebar entry and workbench heading display Lichen Agent using the supplied two-part logo and embedded Tourney lettering. Functional navigation and descriptive copy retain their digital-employee terminology. The font ships under its [SIL Open Font License](LICENSES/tourney-OFL.txt).

The employee editor lists bound capability names and revisions per category. Already-bound assets remain selectable and are marked explicitly; updating a revision replaces the previous reference, and removing a binding changes only the local draft until Save and Publish. Category counts show bindings; catalog loading, errors, empty categories, and fully bound categories have separate messages.

Provider-owned knowledge bases use the `enterprise.employee-knowledge-bindings` slot inside the Knowledge category. The provider stores base references under the employee Preset id and reports the bound count to the category card; it does not copy documents into the enterprise asset catalog. Conversation controls and retrieval scope remain owned by the knowledge provider.

The employee binding contribution stays mounted while another capability category is visible, so saved counts load on editor entry and after publish reload. Hiding the controls does not suspend their read lifecycle.

Roster cards and the capability overview request provider counts through the existing knowledge slots with `summaryOnly`. Providers read saved bindings or base metadata without mounting editors; `refreshKey` reloads that summary when the page refreshes. A null count is loading or unavailable and appears as a dash, while a confirmed empty result appears as zero.

<a id="package-details"></a>
## Package Details

Enterprise digital-employee operations surface for the DSH Web client. The enterprise profile reads authenticated PostgreSQL catalog and operations projections through the typed Host API, while an ordinary profile retains the native runtime projection when those enterprise domains explicitly report unavailable:

- Agent Presets are digital employees.
- Workspaces are business spaces.
- Sessions are work records.
- Pending interactions, running state, completion hints, Jobs, and Session projections remain owned by their existing packages.

The browser plugin contributes two additive entries: `enterprise-workbench` under `sidebar.footer.action`, and the matching overlay under `shell.overlay`. It replaces neither the Sidebar nor the Conversation. Enterprise governance remains under Settings. The overlay owns local navigation for employees, work records, approvals, schedules, capability assets, and teams; desktop uses a navigation rail, narrow viewports use a contained horizontal strip, and the document never needs horizontal scrolling.

The controller calls `enterpriseEmployees`, `enterpriseAssets`, `enterpriseTeams`, and `enterpriseOperations` without accepting or sending an organization or principal. The Host injects the authenticated principal. Roster search, release status, visibility, and owner filters are server-side and cursor-paginated. Employee edits are explicit-save drafts protected by `expectedRevision`; conflict state preserves unsaved input. Publishing, release history, rollback, work-state updates, approval decisions, schedule lifecycle, versioned assets, and fixed-team saves all use their real typed mutations.

The Workspace extensions page opens on “My extensions” across all Workspaces visible to the caller. Each private version names its source Workspace; the Workspace selector narrows the unified list when needed. If one Workspace read fails, other records remain available and the page names the failed Workspace. The owner can activate a saved or stopped version, submit a private version from a department Workspace for manager review, delete a private Plugin into the recycle bin, and restore it without automatic activation. The department tab also shows pending versions authorized for the caller and marks their review state; only approved bindings activate in new Sessions. Only authorized managers see department management actions. The Session Cordis panel separately shows Plugins running in the current Session.

The employee page starts with a goal-first work panel. It sends the objective, optional deadline, and an open native Session only when one exists to `enterpriseWork.prepare`; it never guesses a workspace from list order. A ready result starts work with one browser-generated idempotency key, opens the returned native Session, and closes the overlay. Ambiguous results expose only matching Workspace titles or employee name and release version from loaded browser snapshots; identifiers, model routes, and team settings remain absent. The panel keeps preparation and start failures visible with retry and clear actions.

Enterprise Host frames are forwarded by the runtime's single stream owner. Each enterprise frame carries a `resourceType`; the workbench deduplicates `eventId` values and refreshes the owning read model even when its page is in the background. Mutations share a contained error/retry state and reuse the originally generated idempotency key on retry. Revision conflicts never retry a stale revision: the recovery action reloads the server version, while employee edits retain the unsaved local copy and show a comparison. The operator then explicitly adopts the server draft or keeps local fields on the new server revision. If reload fails, retry repeats only that reload. Independent page failures remain local: loading, empty, error, forbidden, and partial-success states do not erase read models that loaded successfully.

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

## Ordinary-profile fallback

Fallback activates only when `enterpriseEmployee.list` returns the explicit enterprise-unavailable response. Other transport, authorization, cursor, and server failures stay visible as failures; they do not silently downgrade to the broader native projection. In fallback mode, selecting a work record opens its source Session and starting an employee creates a native Session with the corresponding Agent Preset.

## Security boundary

This surface does not authenticate users or authorize enterprise records. It consumes the Host's authenticated, permission-filtered read models and never sends `orgId` or `principal` in mutation payloads. A deployment exposed to multiple intranet users still requires the enterprise Host identity and authorization composition. Loopback/trusted-host checks are transport fences, not authentication.

## Model Experience

### Browser operations projection

#### What the model sees

Nothing. The workbench projects browser state and invokes `SessionRuntime.create`; it adds no prompt section, model tool, message, Session Event, or model call.

#### Token effect

None. Starting an employee creates a native Session, whose later conversation requests own their ordinary token cost.

#### KV Cache effect

None. Opening the workbench does not assemble or mutate a provider request.

## Known Limitations and Deferred Work

- The enterprise UI displays only fields present in catalog and operations read models; it does not infer productivity, SLA, completion percentage, or business outcomes.
- Draft profile fields are a typed UI projection over an open JSON profile. Unknown profile keys are retained by the server contract only when a caller includes them; this editor writes its supported profile fields.
- Capability bindings and team membership use loaded asset and release selectors; raw IDs and JSON remain available only under advanced editing for unsupported policy detail.
- Authentication, role assignment, credentials, model administration, and organization governance remain Settings concerns.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
