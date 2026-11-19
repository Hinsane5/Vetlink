import type { ApiMediaFile } from './ApiMediaRepository';
import type { ApiMessageAttachment } from './ApiChatRepository';
import type { SelectedAsset } from '../../domain/profiles';

/** Private device storage for the exact upload bytes and downloaded chat media. */
export interface ServerChatMediaStore {
  copyToPrivateStorage(userId: string, file: SelectedAsset): Promise<ApiMediaFile>;
  storeDownloadedFile(userId: string, attachment: ApiMessageAttachment, bytes: ArrayBuffer): Promise<string>;
  removePrivateFile(uri: string): Promise<void>;
}
