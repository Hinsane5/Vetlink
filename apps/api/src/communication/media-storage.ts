import { Injectable, Inject } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { access, chmod, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { MediaConfig } from '../config/app-config.js';
import { adapterFailed, adapterSucceeded, type AdapterResult } from './adapter-result.js';

export const MEDIA_CONFIG = Symbol('MEDIA_CONFIG');
export const MEDIA_STORAGE_ADAPTER = Symbol('MEDIA_STORAGE_ADAPTER');

export interface OpenPrivateMedia {
  stream: Readable;
  byteSize: number;
}

export interface PrivateMediaStorageAdapter {
  store(storageKey: string, bytes: Buffer): Promise<AdapterResult<void>>;
  open(storageKey: string): Promise<AdapterResult<OpenPrivateMedia>>;
  remove(storageKey: string): Promise<AdapterResult<void>>;
}

@Injectable()
export class LocalPrivateMediaStorageAdapter implements PrivateMediaStorageAdapter {
  private readonly root: string;

  constructor(@Inject(MEDIA_CONFIG) config: MediaConfig) {
    this.root = resolve(config.storageDirectory);
  }

  async store(storageKey: string, bytes: Buffer): Promise<AdapterResult<void>> {
    let target: string;
    try {
      target = this.pathFor(storageKey);
      const directory = dirname(target);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      return adapterSucceeded(undefined);
    } catch {
      return adapterFailed('PRIVATE_STORAGE_UNAVAILABLE', 'Penyimpanan media privat lokal tidak tersedia.', true);
    }
  }

  async open(storageKey: string): Promise<AdapterResult<OpenPrivateMedia>> {
    try {
      const target = this.pathFor(storageKey);
      await access(target);
      const file = await stat(target);
      if (!file.isFile()) return adapterFailed('PRIVATE_MEDIA_NOT_FOUND', 'Berkas media tidak tersedia.', false);
      return adapterSucceeded({ stream: createReadStream(target), byteSize: file.size });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return adapterFailed('PRIVATE_MEDIA_NOT_FOUND', 'Berkas media tidak tersedia.', false);
      return adapterFailed('PRIVATE_STORAGE_UNAVAILABLE', 'Penyimpanan media privat lokal tidak tersedia.', true);
    }
  }

  async remove(storageKey: string): Promise<AdapterResult<void>> {
    try {
      await unlink(this.pathFor(storageKey));
      return adapterSucceeded(undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return adapterSucceeded(undefined);
      return adapterFailed('PRIVATE_STORAGE_UNAVAILABLE', 'Penyimpanan media privat lokal tidak tersedia.', true);
    }
  }

  private pathFor(storageKey: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storageKey)) {
      throw new Error('Invalid storage key');
    }
    const target = resolve(join(this.root, storageKey.slice(0, 2), storageKey));
    if (!target.startsWith(`${this.root}${sep}`)) throw new Error('Invalid storage path');
    return target;
  }
}

export function newStorageKey(): string {
  return randomUUID();
}
