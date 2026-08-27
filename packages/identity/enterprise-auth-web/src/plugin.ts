/** Cordis/WebServer composition for enterprise identity and authentication routes. */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { EnterpriseIdentityRepository, type EnterpriseIdentityStore } from '@deepseek-ai/dsh-enterprise-identity'
import {
  EnterpriseLdapProvider,
  EnterpriseOidcProvider,
  EnterpriseSamlProvider,
  createPasswordVerifier,
  type EnterpriseLdapConfig,
  type EnterpriseOidcConfig,
  type EnterpriseSamlConfig,
} from '@deepseek-ai/dsh-enterprise-sso'
import { EnterpriseAuthHttpHandler } from './http.ts'
import { EnterpriseSecurity, type EnterpriseSecurityConfig } from './security.ts'

export interface BootstrapAdminConfig {
  readonly userId: string
  readonly username: string
  readonly displayName: string
  readonly passwordRef: string
}

export interface OidcPluginConfig extends Omit<EnterpriseOidcConfig, 'clientSecret'> {
  readonly clientSecretRef?: string
}

export interface EnterpriseAuthWebConfig extends EnterpriseSecurityConfig {
  /** Existing SQLite fallback. Omit when `identityStore` is supplied. */
  readonly databasePath?: string
  /** Production selects the deployment-provided PostgreSQL composition. */
  readonly databaseMode?: 'sqlite' | 'postgres'
  /** Deployment-owned identity store. This is the seam for enterprise persistence adapters. */
  readonly identityStore?: EnterpriseIdentityStore
  readonly organizationName: string
  readonly localEnabled: boolean
  readonly bootstrapAdmin?: BootstrapAdminConfig
  readonly oidc: readonly OidcPluginConfig[]
  readonly saml: readonly EnterpriseSamlConfig[]
  readonly ldap: readonly EnterpriseLdapConfig[]
}

export const inject = ['webServer', 'credentials']

async function authRequest(req: IncomingMessage, handler: EnterpriseAuthHttpHandler): Promise<Response> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > 1024 * 1024) return new Response('payload too large', { status: 413 })
    chunks.push(buffer)
  }
  const host = typeof req.headers.host === 'string' ? req.headers.host : 'dsh.internal'
  const forwarded = req.headers['x-forwarded-proto']
  const protocol = forwarded === 'https' ? 'https' : 'http'
  return handler.fetch(new Request(`${protocol}://${host}${req.url ?? '/auth'}`, {
    method: req.method ?? 'GET',
    headers: Object.fromEntries(Object.entries(req.headers).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string')),
    ...chunks.length === 0 ? {} : { body: Buffer.concat(chunks) },
  }))
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  if (response.body === null) {
    res.end()
    return
  }
  for await (const chunk of response.body) res.write(chunk)
  res.end()
}

/** Mount the persistent identity service and authentication endpoints. */
export async function apply(ctx: Context, config: EnterpriseAuthWebConfig): Promise<void> {
  const databasePath = config.databasePath
  const postgres = ctx.get('enterprisePostgres') as { identity: EnterpriseIdentityStore } | undefined
  const repository: EnterpriseIdentityStore = config.identityStore
    ?? (config.databaseMode === 'postgres' ? postgres?.identity : undefined)
    ?? (() => {
      if (databasePath === undefined) throw new Error('enterprise identity store or databasePath is required')
      return new EnterpriseIdentityRepository(databasePath)
    })()
  try {
    if (!(await repository.listOrganizations()).some(org => org.id === config.organizationId)) {
      await repository.createOrganization({ id: config.organizationId, name: config.organizationName })
    }
    if (config.bootstrapAdmin !== undefined
      && await repository.findUser(config.organizationId, config.bootstrapAdmin.username) === undefined) {
      const resolved = await ctx.credentials.resolve(credentialRef(config.bootstrapAdmin.passwordRef))
      if (resolved === undefined) throw new Error('enterprise bootstrap administrator password is not configured')
      await repository.createUser({
        id: config.bootstrapAdmin.userId,
        orgId: config.organizationId,
        username: config.bootstrapAdmin.username,
        displayName: config.bootstrapAdmin.displayName,
        disabled: false,
      })
      await repository.setRoles(config.bootstrapAdmin.userId, ['administrator'])
      await repository.setPasswordVerifier(config.bootstrapAdmin.userId, createPasswordVerifier(resolved.value))
    }

    const security = new EnterpriseSecurity(repository, config)
    const oidc = await Promise.all(config.oidc.map(async (provider) => {
      const clientSecret = provider.clientSecretRef === undefined
        ? undefined
        : (await ctx.credentials.resolve(credentialRef(provider.clientSecretRef)))?.value
      if (provider.clientSecretRef !== undefined && clientSecret === undefined) {
        throw new Error(`OIDC provider ${provider.id} client secret is not configured`)
      }
      return new EnterpriseOidcProvider({ ...provider, ...clientSecret === undefined ? {} : { clientSecret } })
    }))
    const saml = config.saml.map(provider => new EnterpriseSamlProvider(provider))
    const ldap = config.ldap.map(provider => new EnterpriseLdapProvider(provider, {
      resolveCredential: async ref => (await ctx.credentials.resolve(credentialRef(ref)))?.value,
    }))
    const handler = new EnterpriseAuthHttpHandler(security, {
      localEnabled: config.localEnabled, oidc, saml, ldap,
    })
    ctx.provide('enterpriseSecurity', security)
    const route: WebRoute = {
      kind: 'prefix',
      path: '/auth',
      handler: async (req, res) => { await writeResponse(res, await authRequest(req, handler)) },
    }
    ctx.effect(() => {
      const disposeRoute = ctx.webServer.register(route)
      return () => {
        disposeRoute()
        void repository.close()
      }
    }, 'enterprise-auth-web: identity database and /auth routes')
  } catch (error) {
    repository.close()
    throw error
  }
}
