import * as SecureStore from 'expo-secure-store';
import type { ServerSessionStore, ServerTokenSet } from '../../application/ports/ServerAuthRepository';

const serverSessionKey = 'vetlink.auth.server-session.v1';

/** Server access and refresh tokens are isolated from the local-auth session key. */
export class ExpoServerSessionStore implements ServerSessionStore {
  async read(): Promise<ServerTokenSet | null> {
    const stored = await SecureStore.getItemAsync(serverSessionKey);
    if (!stored) return null;
    try {
      const value: unknown = JSON.parse(stored);
      if (!isServerTokenSet(value)) {
        await this.clear();
        return null;
      }
      return value;
    } catch {
      await this.clear();
      return null;
    }
  }

  save(session: ServerTokenSet): Promise<void> {
    return SecureStore.setItemAsync(serverSessionKey, JSON.stringify(session));
  }

  clear(): Promise<void> {
    return SecureStore.deleteItemAsync(serverSessionKey);
  }
}

function isServerTokenSet(value: unknown): value is ServerTokenSet {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  return typeof session.accessToken === 'string'
    && session.accessToken.length >= 40
    && typeof session.refreshToken === 'string'
    && session.refreshToken.length >= 40
    && typeof session.sessionId === 'string'
    && (session.activeRole === 'farmer' || session.activeRole === 'vet')
    && typeof session.accessExpiresAt === 'string'
    && typeof session.expiresAt === 'string';
}
