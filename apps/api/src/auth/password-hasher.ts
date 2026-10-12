import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEMORY = 64 * 1024 * 1024;
const DUMMY_SALT = Buffer.from('vetlink-auth-dummy-salt', 'utf8');

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEMORY },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await derive(password, salt);
    return [
      'scrypt',
      String(SCRYPT_N),
      String(SCRYPT_R),
      String(SCRYPT_P),
      salt.toString('base64url'),
      key.toString('base64url'),
    ].join('$');
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const [scheme, n, r, p, saltValue, keyValue, extra] = encoded.split('$');
    if (
      scheme !== 'scrypt' ||
      n !== String(SCRYPT_N) ||
      r !== String(SCRYPT_R) ||
      p !== String(SCRYPT_P) ||
      !saltValue ||
      !keyValue ||
      extra !== undefined
    ) {
      return false;
    }

    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(keyValue, 'base64url');
    if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;

    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected);
  }

  async verifyUnknownAccount(password: string): Promise<void> {
    await derive(password, DUMMY_SALT);
  }
}
