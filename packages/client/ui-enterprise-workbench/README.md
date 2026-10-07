---
description: "Enterprise digital-employee roster and operations workbench over DSH runtime facts."
kind: "package-reference"
---
# `@deepseek-ai/dsh-client-ui-enterprise-workbench`

English | [中文](README.zh.md)

## Summary

Enterprise digital-employee roster and operations workbench over DSH runtime facts.

## Table of Contents

- [Configuration](#configuration)
- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

The sidebar entry and workbench heading display Lichen Agent using the supplied two-part logo and embedded Tourney lettering. Functional navigation and descriptive copy retain their digital-employee terminology. The font ships under its [SIL Open Font License](LICENSES/tourney-OFL.txt).

The sidebar scheduled-task shortcut shares a row with Cordis Plugin, keeps its clock at full size when space is tight, and opens a centered task dialog over the current conversation. The dialog reuses the workbench's scheduled-task creation, pause, resume, and archive actions, and refreshes its list when the enterprise read model is already loaded. The full workbench retains its Schedules page.

The schedule form fills the dialog width and lists each employee once with an avatar. Selecting an employee uses its latest published release when the task is saved; existing tasks retain their recorded release id.

Group room details list only the titles of active Host reminders created in that group's employee Sessions. Selecting a title opens a scrollable dialog with its employee, timing, identifier, and full instructions; administrators can remove the task there after confirmation. Members can ask an employee in the room to set a time. Signed scheduled replies render as separate room messages rather than details of an earlier Agent answer.

The employee editor lists bound capability names and revisions per category. Already-bound assets remain selectable and are marked explicitly; updating a revision replaces the previous reference, and removing a binding changes only the local draft until Save and Publish. Category counts show bindings; catalog loading, errors, empty categories, and fully bound categories have separate messages.

Provider-owned knowledge bases use the `enterprise.employee-knowledge-bindings` slot inside the Knowledge category. The provider stores base references under the employee Preset id and reports the bound count to the category card; it does not copy documents into the enterprise asset catalog. Conversation controls and retrieval scope remain owned by the knowledge provider.

The employee binding contribution stays mounted while another capability category is visible, so saved counts load on editor entry and after publish reload. Hiding the controls does not suspend their read lifecycle.

Roster cards and the capability overview request provider counts through the existing knowledge slots with `summaryOnly`. Providers read saved bindings or base metadata without mounting editors; `refreshKey` reloads that summary when the page refreshes. A null count is loading or unavailable and appears as a dash, while a confirmed empty result appears as zero.

<a id="configuration"></a>

## Configuration

Room entry requests metadata and the latest event page concurrently. `roomInitialPageSize` sets the number of latest events in that first page; Load earlier and thread pages fetch up to 100 events per request. The history remains available through Load earlier. Each request verifies room access, and authorization loss clears the selected room. Saved messages remain visible while missing execution history synchronizes; the room header shows a synchronization status until a subsequent event poll reports completion.

| Field | Default | Accepted values | Effect |
| --- | --- | --- | --- |
| `roomInitialPageSize` | `20` | Integer from `1` to `100` | Latest room events fetched on entry. |

<a id="package-details"></a>

## Package Details

My devices automatically detects the local helper, asks for explicit account confirmation, and displays connection and permission results. Installation, browser and control details stay in optional help. Pairing completes independently of desktop permissions or a work record. After confirmed pairing, macOS with both verified grants automatically runs a read-only screen-dimensions check; other supported platforms offer a manual check without claiming OS grants. Diagnostics use the currently displayed or an existing permitted Workspace Session, exclude archived Sessions, and create no work record. No available Session leaves pairing complete and the operation check pending. Only a completed action reports screen-dimensions success. Pairing fixes the confirming account before local identity is read and rechecks authentication after asynchronous work; connection replacement and plugin disposal cancel the operation and its retry. Pending diagnostics and failed cleanup remain in the controller for the originating account across page and dialog remounts; another account cannot resume their cleanup. Its observe run stops after completion, failure, or timeout. A failed stop appears separately from the observation result and can be retried with the latest run revision; only that diagnostic run is targeted. The technical preview uses the administrator-provided repository rather than a downloadable installer. Closing setup does not stop active access; the device page provides pause and stop controls.

Groups and channels occupy separate tabs beside Workspace in the left sidebar, including when no Session is selected. Creation uses visible employee releases, explicit people and an accessible Workspace. Selecting a row opens one shared room timeline for human and digital-employee authors. The room composer sends human messages with selected employee or human mentions, or a thread root; an untargeted message remains in the room. It preserves rejected drafts and reuses the request identity after uncertain delivery. Local pending and failed echoes never supply server polling cursors; a signed acceptance receipt clears transient send errors. The timeline opens at recent events, polls an authenticated event cursor, loads earlier events without losing scroll position, renders signed author and source metadata, and supports threads, reactions and search. The room roster carries message and mention attention; each category tab shows a dot until its exact room event page is opened and displayed. Human and Agent posts retain signed author identity. Losing access clears the visible room immediately. Employee Sessions remain execution records linked from Bot posts and are omitted from Workspace browsing and search through their durable room bindings.

The workbench's Collaboration page separates projects, member-visible groups, and channels. Project creation asks for a name and goal; the Host chooses the managed path and creates a native project Workspace for current members. Each group or channel row opens that same native timeline; creation uses the native room form, and creation from an active project preselects the project relationship. Archived project conversations remain readable without new linked-room controls. Project detail reads its durable member roster and shows groups and channels linked to that project. Team governance remains a management page for charters, runs, and Human decisions, with a return link to Collaboration. The directory does not claim an organization-wide room inventory for administrators who are not room members.

The room's right rail shows authorized members, linked project and charter metadata, or the selected thread. Native execution Session details continue to use the existing right Sidebar tab. Employee/project context and approved memory load from the Session-scoped endpoint and clear on navigation or reconnect; scope filters show only authorized returned summaries. This view exposes no memory review or mutation controls.

Channel details read saved versioned YAML workflows. The Host reports whether current policy allows management; other members see definitions without edit controls. A manager names a workflow and explicitly saves its YAML with the last read revision. Failed saves and revision conflicts keep the draft; loading the current revision leaves that draft available for comparison. The editor lists supported trigger and action fields, while execution results remain room events and approval decisions remain with the enterprise approval service.

The same channel pane reads pending approval decisions and displays their real summaries. Only a server-reported decision permission exposes Approve and Reject. Each action carries the last read revision and a stable retry key. Uncertain responses offer retry with the same key; conflicts require fresh readback and another explicit choice. A successful response waits for the pending list to confirm removal before displaying completion. Permission loss hides the actions while retaining the pending card and its recovery message.

Enterprise digital-employee operations surface for the DSH Web client. The enterprise profile reads authenticated PostgreSQL catalog and operations projections through the typed Host API, while an ordinary profile retains the native runtime projection when those enterprise domains explicitly report unavailable:

- New Sessions combine an Agent Preset work mode with one published digital employee release; legacy employee preset declarations remain available for historical Session replay.
- Workspaces are business spaces.
- Sessions are work records.
- Pending interactions, running state, completion hints, Jobs, and Session projections remain owned by their existing packages.

The browser plugin contributes two additive entries: `enterprise-workbench` under `sidebar.footer.action`, and the matching overlay under `shell.overlay`. It replaces neither the Sidebar nor the Conversation. Enterprise governance remains under Settings. The overlay owns local navigation for employees, work records, approvals, schedules, capability assets, and teams; desktop uses a navigation rail, narrow viewports use a contained horizontal strip, and the document never needs horizontal scrolling.

The controller calls `enterpriseEmployees`, `enterpriseAssets`, `enterpriseTeams`, and `enterpriseOperations` without accepting or sending an organization or principal. The Host injects the authenticated principal. Roster search, release status, visibility, and owner filters are server-side and cursor-paginated. Employee edits are explicit-save drafts protected by `expectedRevision`; conflict state preserves unsaved input. Publishing, release history, rollback, work-state updates, approval decisions, schedule lifecycle, versioned assets, and fixed-team saves all use their real typed mutations.

The Workspace extensions page opens on “My extensions” across all Workspaces visible to the caller. It shows one entry per Plugin and scope, with immutable versions in a selector; the active binding, source Workspace, and applicable actions appear once per entry. The Workspace selector narrows the list. If one Workspace read fails, other records remain available and the page names the failed Workspace. The owner can enable a selected version, submit a private department-Workspace version for review, move a private Plugin to the recycle bin, and restore it without automatic activation. A submitted version shows its review state instead of another submit action. The review page groups requests by Plugin and department, showing the latest request with earlier decisions in expandable history. Department and organization controls appear only for authorized managers in valid binding states. Version and access changes apply to new Sessions; the Session Cordis panel separately shows process-local running Plugins.

The employee page opens on the employee directory: search, release-status tabs, and employee cards. Workspace context chooses where a card starts its conversation; default-employee configuration and advanced filters expand separately in page flow. The secondary “Assign by objective” action reveals the work panel and preserves its objective when collapsed. Employee editing hides these directory controls. It sends the objective, optional deadline, and an open native Session only when one exists to `enterpriseWork.prepare`; it never guesses a workspace from list order. A ready result starts work with one browser-generated idempotency key, opens the returned native Session, and closes the overlay. Ambiguous results expose only matching Workspace titles or employee name and release version from loaded browser snapshots; identifiers, model routes, and team settings remain absent. The panel keeps preparation and start failures visible with retry and clear actions.

The employee page also lets the operator choose a Workspace before starting a roster card. The collapsed default settings are available to a department manager or organization administrator for that Workspace; a personal Workspace owner may set its default. Other members see only authorized employees. On a new Session, the work-mode control appears before the employee control. The employee control applies an available Workspace default without sending a prompt, and a member may change the work mode and the employee independently before the first turn. Its selected label shows the release version recorded in that Session even when a newer employee release is published. The old employee direct-message directory is hidden while its complete PostgreSQL runtime is unavailable; its stored data and endpoints remain intact.

Enterprise Host frames are forwarded by the runtime's single stream owner. Each enterprise frame carries a `resourceType`; the workbench deduplicates `eventId` values and refreshes the owning read model even when its page is in the background. Mutations share a contained error/retry state and reuse the originally generated idempotency key on retry. Revision conflicts never retry a stale revision: the recovery action reloads the server version, while employee edits retain the unsaved local copy and show a comparison. The operator then explicitly adopts the server draft or keeps local fields on the new server revision. If reload fails, retry repeats only that reload. Independent page failures remain local: loading, empty, error, forbidden, and partial-success states do not erase read models that loaded successfully.

Employee presentation comes from the published catalog release: name, position, department, capability labels, and immutable release version. These fields describe the employee; capability labels never grant tools or permissions. The employee's preset id remains its stable runtime identity.

Room composers share the workspace capsule, control row and send action, with attachment upload and member mentions and no model or permission selectors. The add button opens the workspace candidate menu with its file action; selecting it opens the picker. Picked, pasted and dropped files enter one room upload path. Drafts use the workspace attachment rail and image lightbox; each visible composer owns its drop area. Pending or failed uploads block sending, and removal releases image preview URLs. Signed permanent attachment failures appear beside their source message instead of inside collapsed execution details; unavailable charter attachment delivery keeps the draft with an explicit notice. Delivered file cards use the existing deliverables factory. Previews address the producing Session and keep the room visible. Signed reply revisions refresh file metadata; native closing coordinates from the full log associate declared files with their reply, including paginated and thread history.

Channels use a left-aligned post list and a separate thread pane. Reply counts include signed text posts, and execution facts fold into their employee reply. A targeted Human post in either the room or a thread shows the same employee avatar and replying indicator until that employee's signed answer arrives in the same conversation scope. Persisted topic destinations place historical unthreaded employee facts in their known thread without changing signed records. Thread pages load the authorized parent even outside the room page; narrow room containers show the thread as a single panel, and closing returns keyboard focus to the invoking control.

Room details share one information and membership layout for groups and channels. Administrator-only edits and eligible-member search use protected room endpoints; other members can leave through a confirmed action. Removal and archive confirmations retain inputs on failure. Channel duty selection uses only current employees, and workflows/approvals stay in a separate expandable section. Archiving keeps history stored.

Team governance starts with the charter list. Creating a charter groups team purpose, members, and acceptance/access rules; missing activation requirements are listed explicitly. Saved drafts show their stored revision, while an unselected or unavailable active charter has no editable launch fields. Fixed-team compatibility rows are collapsed and exclude governed-team projections. Draft and publication retries preserve the original idempotency key, so a committed write with a lost response is not submitted as a new command.

The Tools capability category reads the authorized native Session catalog and `session.capabilities` for the selected source. It shows current scoped registrations when an Agent already exists, or the latest recorded catalog and native/PTC call attempts without activating an Agent. Tool type, exact MCP identity, configured ACP integration, availability and usage are separate facts; registration does not verify connection health, and old logs may lack integration identity. Source changes cancel earlier reads and suppress their late results; failed reads clear stale metadata and expose retry. Runtime entries remain separate from managed tool assets and never create duplicate asset records.

## Ordinary-profile fallback

Fallback activates only when `enterpriseEmployee.list` returns the explicit enterprise-unavailable response. Other transport, authorization, cursor, and server failures stay visible as failures. The fallback roster includes only declarations marked as employees; generic work modes stay in the mode picker. Starting a fallback employee requires an explicit Workspace choice.

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
