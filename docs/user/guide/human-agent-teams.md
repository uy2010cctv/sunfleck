# Run a Human–Agent team

English | [中文](human-agent-teams.zh.md)

This guide defines the operating method for enterprise Human–Agent teams. The complete Team Definition, Team Room, and cross-Run attention surfaces are proposed product behavior, not a claim about the current experimental Agent Teams UI. Until those surfaces ship, use one DSH root Session as the Run record, keep decisions and evidence in that Session, and use existing approvals, subagents, and work records for the same steps.

## 1. Write the Team charter

The Human owns the North Star: the outcome worth achieving, how success will be judged, what is explicitly out of scope, which constraints apply, and which conditions stop the Run. Write these before assigning Agents so decomposition does not silently redefine the goal.

Build one roster containing both Humans and Agents. Name the Human decision owner, one Agent Lead, the Doers, and independent Verifiers for risky task classes. Give each Agent a separate credential identity; never ask an Agent to act through a Human's browser or channel credential.

Set autonomy as a matrix of Agent × task type × capability. Begin at the lowest useful trust level: `observe` can inspect, `propose` can recommend, `execute-reviewed` can execute inside scope but needs review before its result advances the workflow, and `execute-delegated` can complete pre-authorized reversible work inside the stated scope. Irreversible decisions remain Human-owned at every level.

## 2. Launch one Run

Review the exact Team Definition version, Workspace, source context, Run-specific North Star, deadline or stop condition, active roster, grants, verification policy, and decision policy. Narrow any grant that the Run does not need, and resolve missing credentials or Verifiers before starting work.

One root DSH Session is the Run record. The Agent Lead decomposes the North Star into a dependency-aware task DAG, states the expected evidence for every task, and marks which tasks require a separate Verifier. A task is not ready merely because it has an owner; its dependencies, capability grant, and input evidence must also be ready.

## 3. Collaborate in the open

Keep Run-relevant context visible inside the authorized Team boundary: decisions, assumptions, task changes, evidence, artifacts, and blockers belong in the Run record. Keep unrelated conversations, personal memory, raw credentials, and data outside the Workspace authorization boundary out of the shared context.

The Agent Lead coordinates rather than absorbing every task. It assigns Doers, orders dependencies, requests verification, and reports deviations. Team members use the shared task and mailbox behavior instead of parallel private task lists; the existing experimental [Agent Teams subsystem](../../subsystems/agent-team.md) is the runtime foundation for Agent roster, task DAG, and mailbox state.

## 4. Verify before accepting

A Doer reports the claim, method, artifact or digest, observed result, and remaining uncertainty. A Verifier reproduces or inspects the result independently enough for the task's risk and records acceptance, rejection, or a bounded concern. Completion and verification remain separate states.

For code or operational work, match evidence to the claimed outcome: source diff, focused test, build or package, authenticated behavior, persisted business state, deployment, and notification delivery are different facts. Do not promote one as proof of another.

## 5. Make Human decisions efficiently

Agents escalate when values conflict, authority is missing, evidence is insufficient, or an action is irreversible. Each request contains the recommended option, alternatives, consequence, deadline, affected downstream tasks, and the smallest sufficient evidence packet.

Review compatible items in batches only when they have the same action semantics and authorization requirements. Preserve risk, expiry, and dependency order; do not let batching hide an urgent decision or convert several distinct approvals into one ambiguous consent.

The first delivery phase is the DSH core collaboration loop, without an enterprise channel command surface. A later phase starts with Enterprise WeChat and then reuses its DSH adapter protocol for Feishu and DingTalk. Across those channels, DSH remains the only business-state and audit system; channel notifications are invitations to review DSH state. Personal WeChat can notify and invite takeover only, so make the decision inside DSH.

## 6. Close and review the Run

Close only after the North Star evidence, verification outcomes, unresolved concerns, accepted artifacts, and Human decisions are visible in the Run record. Record why stopped work was stopped; an interrupted or paused task is not a failed task unless the evidence says so.

In the retrospective, compare the charter with the outcome, inspect where Humans were interrupted, identify repeated decisions that can become policy, and review every autonomy grant. Increase a grant only for the same Agent, task type, and capability scope when repeated evidence supports it; reduce or revoke it when verification finds drift.

Promote reusable knowledge through the governed organization or department memory workflow. Keep raw conversation content, personal preferences, credentials, and one-off speculation out of shared memory.

## Continue

- [Use the Web UI](./index.md)
- [Understand Agent Teams runtime state](../../subsystems/agent-team.md)
- [Configure model providers](./providers.md)
