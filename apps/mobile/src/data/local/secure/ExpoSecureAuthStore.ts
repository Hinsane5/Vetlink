import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import type {
  CredentialVerifierStore,
  IdFactory,
  OnboardingStore,
  PasswordVerifier,
  SessionMaterialStore,
} from '../../../application/ports/AuthRepository';

const sessionKey = 'vetlink.auth.local-session.v1';
const onboardingKey = 'vetlink.onboarding.completed.v1';
const verifierKey = (userId: string) => `vetlink.auth.local-verifier.v1:${userId}`;

export class ExpoSecureAuthStore implements CredentialVerifierStore, SessionMaterialStore, OnboardingStore {
  save(userId: string, verifier: string): Promise<void> {
    return SecureStore.setItemAsync(verifierKey(userId), verifier);
  }

  read(userId: string): Promise<string | null> {
    return SecureStore.getItemAsync(verifierKey(userId));
  }

  remove(userId: string): Promise<void> {
    return SecureStore.deleteItemAsync(verifierKey(userId));
  }

  saveSessionId(value: string): Promise<void> {
    return SecureStore.setItemAsync(sessionKey, value);
  }

  readSessionId(): Promise<string | null> {
    return SecureStore.getItemAsync(sessionKey);
  }

  clearSessionId(): Promise<void> {
    return SecureStore.deleteItemAsync(sessionKey);
  }

  async hasCompletedOnboarding(): Promise<boolean> {
    return (await SecureStore.getItemAsync(onboardingKey)) === 'true';
  }

  markOnboardingCompleted(): Promise<void> {
    return SecureStore.setItemAsync(onboardingKey, 'true');
  }
}

export class ExpoPasswordVerifier implements PasswordVerifier {
  async create(password: string): Promise<string> {
    const salt = bytesToHex(Crypto.getRandomBytes(16));
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
    return `sha256:${salt}:${digest}`;
  }

  async verify(password: string, verifier: string): Promise<boolean> {
    const [algorithm, salt, expected] = verifier.split(':');
    if (algorithm !== 'sha256' || !salt || !expected) return false;
    const actual = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
    return constantTimeEqual(actual, expected);
  }
}

export class ExpoIdFactory implements IdFactory {
  create(): string {
    return Crypto.randomUUID();
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) {
    mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}
