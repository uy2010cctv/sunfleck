# Enterprise security deployment

English | [中文](enterprise-deployment.zh.md)

The ordinary `dsh web` profile remains the loopback developer profile. Enable authenticated single-enterprise mode with the enterprise overlay:

```sh
export DSH_ENTERPRISE_MASTER_KEY='<base64 32-byte key>'
export DSH_ENTERPRISE_ADMIN_PASSWORD='<initial 12+ character password>'
pnpm dsh web --patch apps/cli/config/enterprise.cordis.patch.yml --host 127.0.0.1 --port 3081
```

Generate and custody `DSH_ENTERPRISE_MASTER_KEY` in the deployment secret manager. Do not store it beside the encrypted credential document. The initial administrator password is read through the Credential seam and is used only when the bootstrap administrator does not exist.

Persistent enterprise state lives under `$DSH_HOME/enterprise/`: `identity.sqlite` stores organizations, users, role memberships, hashed sessions, resource policies, and audit; `credentials.enc.json` stores AES-256-GCM envelopes only.

## SSO configuration

Provider arrays are JSON environment values:

- `DSH_ENTERPRISE_OIDC`: issuer, client id, client-secret reference, callback, claim/group mapping.
- `DSH_ENTERPRISE_SAML`: entry point, callback, issuer, IdP certificate, claim/group mapping.
- `DSH_ENTERPRISE_LDAP`: LDAPS or StartTLS URL, bind DN/password reference, base DN, escaped user filter, attribute/group mapping.

OIDC requires Authorization Code + PKCE/state/nonce. SAML requires signed assertions, IdP certificate validation, and InResponseTo. LDAP refuses clear transport without StartTLS and binds the selected user after the service-account search.

## Deployment modes

- Desktop: bind loopback, keep `secureCookies` false unless the desktop shell terminates HTTPS.
- LAN: bind `0.0.0.0`, configure trusted authorities, use authenticated identity/RBAC/encrypted credentials/audit, and terminate TLS when credentials traverse the network.
- Public: TLS is mandatory, set `DSH_ENTERPRISE_SECURE_COOKIES=true`, use a real external IdP, protect the master key with KMS/secret manager, and validate proxy Host/Origin forwarding.

Real OIDC/SAML/LDAP production readiness requires a controlled login against the deployment's actual endpoint, metadata, certificate chain, group mapping, and directory. Unit and simulated-provider tests do not establish that external state.
