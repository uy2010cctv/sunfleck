# Agent Note: Enterprise multi-organization tenancy

Status: implemented

English | [中文](2026-09-17-enterprise-multi-organization.zh.md)

## Problem

The enterprise login accepted an organization field, but the configured default organization still acted as the implicit authority for session issuance, organization listing, and Host-wide administration. Creating a second organization was not an atomic bootstrap operation, and newly provisioned managed Workspaces did not include the organization in their filesystem compartment. A tenant administrator could therefore not be treated as an independent tenant administrator without risking peer discovery, incomplete setup, or accidental Host authority.

## Decision

SUNFLECK treats the configured default organization as the platform organization. Only an administrator authenticated in that organization is a platform administrator and may bootstrap another organization or manage Host-global model, Credential, and developer-inspection services.

Organization bootstrap is one identity-repository transaction. It creates the organization, one enabled administrator, that user's one-way password verifier, and the administrator role together; any failure rolls back the whole operation. Platform administrators may enumerate organizations. Tenant administrators see only their current organization and cannot create peers.

Local login resolves the username inside the submitted organization and issues the browser Session for that same organization. SSO follows its validated organization mapping and rejects an existing external identity when the mapped organization changes. `/auth/status` exposes the current organization, the configured platform organization, and whether the current principal is a platform administrator.

Organization-local reads and writes derive `orgId` from the authenticated principal. New managed Workspaces live below `organizations/<org-hash>/users|departments`; existing persisted grants retain their durable paths. Employee, capability, team, memory, channel, Workspace, Session, policy, and audit repositories continue applying their organization predicates.

This boundary does not automatically isolate storage owned by an out-of-tree plugin. A document-knowledge plugin must carry and enforce the authenticated organization in its own database and HTTP operations before its contents can be shared safely between tenants on one Host.

## Alternatives considered

**Treat every organization administrator as a Host administrator.** Rejected because organization RBAC would then grant model credentials, runtime configuration, and peer-tenant bootstrap authority. Tenant administration remains scoped to tenant-owned resources.

**Create the organization first and add its administrator in later requests.** Rejected because a partial failure leaves an unusable organization with no accountable administrator. One repository transaction makes the bootstrap result complete or absent.

**Move existing Workspace grants into the new organization-prefixed layout.** Rejected because persisted paths are durable user data and an eager migration would add avoidable deployment risk. The organization prefix applies to newly provisioned Workspaces; existing grants continue to resolve exactly as stored.

**Assume plugin-owned knowledge storage inherits core isolation.** Rejected because an out-of-tree plugin owns its schema and HTTP boundary. Core authentication cannot prove isolation for data it does not address or authorize.

## Consequences

- The same username may exist in separate organizations and authenticate to different principals and Sessions.
- A platform administrator can create a ready-to-use tenant in one operation; tenant administrators cannot discover or create peers.
- Host-global administration is explicitly narrower than the organization administrator role.
- New managed Workspace paths are physically separated by organization while old grants remain compatible.
- Document knowledge remains a named coverage gap until the external plugin persists and checks organization identity itself; the product must not describe that plugin data as tenant-isolated before that work ships.
