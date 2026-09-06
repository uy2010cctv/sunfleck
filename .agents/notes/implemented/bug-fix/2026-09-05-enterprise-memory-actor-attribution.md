# Agent Note: Enterprise memory actor attribution and policy-gated activation

Status: implemented

English | [中文](2026-09-05-enterprise-memory-actor-attribution.zh.md)

## Problem

Enterprise automatic business-memory capture used the profile's static bootstrap administrator as proposal author, reviewer, and audit actor. The same profile also enabled organization-wide automatic activation. That misattributed interactive work and made an absent organization decision look like human approval.

## Decision

The memory context resolves the actor from the authenticated request principal first, then from the durable enterprise Session owner binding. An unbound background call fails unless its profile explicitly supplies an enabled `service:`-prefixed enterprise identity. Automatic capture proposes memory by default. It activates only when a matching organization-visible `enterprise-memory-autonomy` resource policy lists the resolved actor and was created by an enabled administrator. The globally unique policy key is organization-namespaced: `<orgId>:organization` or `<orgId>:department:<departmentId>`.

Personal Workspace preferences stay outside this shared-memory flow. Audit rows identify both the resolved actor and whether a policy activated the entry, so a proposal cannot be mistaken for approval.

## Consequences

The shipped Enterprise profile no longer names `bootstrap-admin` as the automatic-memory actor and no longer enables organization activation by config. Operators must intentionally create the governing policy through the authenticated enterprise control plane. Existing unbound automations need an explicit service identity before they can capture memory.

## Alternatives considered

**Continue attributing automatic capture to `bootstrap-admin`.** Rejected because the bootstrap account is configuration, not the authenticated person or service that performed the work, so both memory provenance and audit attribution would be false.

**Enable automatic activation with a profile-wide boolean.** Rejected because activation is an organization governance decision that must identify its administrator, allowed actors, and scope; a static profile value cannot supply those facts or prevent one organization's policy from colliding with another's.
