# Enterprise memory: automatic activation with exception handling

User request: requiring administrator approval for every enterprise memory is too burdensome. Routine confirmed knowledge now activates through the Agent tool without a per-user autonomy policy. The optional needsConfirmation flag leaves uncertain or conflicting statements proposed. Existing actor identity, workspace scope, privacy validation and retired-memory protections remain. Admin-authenticated manual creation activates in the same request unless needsConfirmation is explicit.

The UI replaces mandatory approval wording with automatic activation and exception confirmation, hides the empty pending lane, and allows active memory deactivation. Exception confirmation no longer requires a boilerplate reason. Existing approved memory remains unchanged.

Validation: 49 focused tests across memory context, HTTP and governance UI; targeted TypeScript build. Deployment and visible readback recorded after rollout.
