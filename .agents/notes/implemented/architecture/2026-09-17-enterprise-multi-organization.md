# Enterprise multi-organization tenancy

English | [中文](2026-09-17-enterprise-multi-organization.zh.md)

SUNFLECK treats the configured enterprise organization as the platform organization and permits its administrators to bootstrap additional organizations. One bootstrap operation writes the organization, one enabled administrator, its one-way password verifier, and the administrator role in a single identity-repository transaction. A tenant administrator cannot create or enumerate peer organizations.

Local login looks up the organization-local username and issues the browser Session against that same organization. SSO mapping follows its validated organization and rejects an existing external identity when the mapped organization changes. `/auth/status` distinguishes the current organization, the default platform organization, and whether the principal is a platform administrator.

Organization-local reads and writes derive `orgId` from the authenticated principal. New managed Workspaces live below `organizations/<org-hash>/users|departments`; existing grants keep their durable paths. Employee, capability, team, memory, channel, Workspace, Session, policy, and audit repositories continue applying their organization predicates.

The model runtime, Credential service, and developer inspection are Host-global services. Only administrators in the platform organization may manage them. A tenant administrator receives `organization-mismatch`, so an organization role does not become Host authority.

This boundary does not automatically isolate storage owned by an out-of-tree plugin. A document-knowledge plugin must carry and enforce the authenticated organization in its own database and HTTP operations before its contents can be shared safely between tenants on one Host.
