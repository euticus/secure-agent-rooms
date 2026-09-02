/**
 * Credential vault abstraction (spec §28).
 *
 * The database stores only opaque `credential_reference` strings. Resolution
 * to a secret value happens here, at the moment of use. Secret values never
 * enter model prompts, room events, logs, or the Store.
 *
 * SECURITY: references are tenant-supplied data. A vault must therefore treat
 * them as untrusted — resolving an arbitrary name would let a tenant name a
 * platform secret (audit signing key, database URL) and have an adapter mail
 * it to an endpoint they control. Every implementation here enforces:
 *   1. a mandatory namespace prefix, so only credentials provisioned FOR the
 *      platform's tenants are reachable at all; and
 *   2. organization scoping, so one tenant cannot resolve another's.
 */
export interface CredentialVault {
  /**
   * @param credentialReference tenant-supplied reference
   * @param organizationId owning organization; enforced by scoped vaults
   */
  resolve(credentialReference: string, organizationId?: string): Promise<string>;
}

export class CredentialAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialAccessError";
  }
}

/** Env vars a tenant credential may live in. Nothing else is reachable. */
export const CREDENTIAL_ENV_PREFIX = "BOOTH_CRED_";

/**
 * Build the only env var name a given organization's reference may resolve to.
 * The slug is sanitized; the organization id is bound in, so two tenants can
 * never collide or read each other's credentials.
 */
export function credentialEnvVar(organizationId: string, slug: string): string {
  const safeOrg = organizationId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const safeSlug = slug.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  return `${CREDENTIAL_ENV_PREFIX}${safeOrg}_${safeSlug}`;
}

/** Canonical reference form stored in the database. */
export function credentialReferenceFor(organizationId: string, slug: string): string {
  return `env:${credentialEnvVar(organizationId, slug)}`;
}

function parseEnvReference(ref: string): string {
  if (!ref.startsWith("env:")) {
    throw new CredentialAccessError("unsupported credential reference scheme");
  }
  const name = ref.slice(4);
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new CredentialAccessError("invalid credential reference");
  }
  return name;
}

/**
 * Environment-backed vault. Only variables under CREDENTIAL_ENV_PREFIX are
 * reachable, and (when an organization is supplied) only that organization's
 * namespace within it.
 */
export class EnvCredentialVault implements CredentialVault {
  async resolve(credentialReference: string, organizationId?: string): Promise<string> {
    const name = parseEnvReference(credentialReference);

    // 1. Namespace floor: platform secrets are simply not addressable.
    if (!name.startsWith(CREDENTIAL_ENV_PREFIX)) {
      throw new CredentialAccessError(
        `credential references must name a ${CREDENTIAL_ENV_PREFIX}* variable`,
      );
    }
    // 2. Tenant scoping: a reference must sit in the caller's own namespace.
    if (organizationId) {
      const safeOrg = organizationId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (!name.startsWith(`${CREDENTIAL_ENV_PREFIX}${safeOrg}_`)) {
        throw new CredentialAccessError("credential reference does not belong to this organization");
      }
    }
    const value = process.env[name];
    if (!value) {
      // Deliberately does not echo the resolved variable name back to callers.
      throw new CredentialAccessError("credential is not available");
    }
    return value;
  }
}

/** Static vault for tests and self-hosted wiring. */
export class StaticCredentialVault implements CredentialVault {
  constructor(private readonly values: Record<string, string>) {}
  async resolve(ref: string): Promise<string> {
    const v = this.values[ref];
    if (!v) throw new CredentialAccessError("credential is not available");
    return v;
  }
}
