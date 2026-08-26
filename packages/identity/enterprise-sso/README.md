# `@deepseek-ai/dsh-enterprise-sso`

English | [中文](README.zh.md)

Enterprise login adapters:

- Scrypt local bootstrap authentication.
- OIDC discovery and Authorization Code flow with PKCE, state, and nonce.
- Signed SAML 2.0 responses with IdP certificate and InResponseTo validation.
- LDAP authentication over LDAPS or StartTLS with RFC 4515 filter escaping.
- Canonical claim/group-to-organization/user/role mapping.

## Model Experience

### Authentication adapters

#### What the model sees

Nothing. `EnterpriseOidcProvider`, SAML, LDAP, and local password verification run before browser or Host access and add no model-visible surface.

#### Token effect

Zero tokens. Authentication completes before any Agent request exists.

#### KV Cache effect

None; authentication does not mutate provider requests made by Agents.

## Known Limitations and Deferred Work

- Protocol-library tests do not substitute for validation against the deployment's real IdP, metadata, certificate chain, and LDAP directory.
- Clustered OIDC transactions require a shared one-time state store.
