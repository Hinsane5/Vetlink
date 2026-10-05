import { DomainError } from './errors';
import type { DomainEntity } from './entities';
import type { SelectedAsset } from './profiles';

export type MessageDeliveryStatus = 'pending' | 'sent' | 'failed';
export type ChatSendInput = { clientMessageId: string; text: string; assets: SelectedAsset[] };
export type NormalizedChatInput = { clientMessageId: string; text: string; assets: SelectedAsset[]; fingerprint: string };

export type ChatAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  kind: 'image' | 'video';
  localUri: string;
};

export type ChatMessage = { record: DomainEntity; attachments: ChatAttachment[] };

export type ChatConversation = {
  consultation: DomainEntity;
  otherPartyName: string;
  animalName: string;
  timezone: string;
  readOnly: boolean;
  messages: ChatMessage[];
};

export function validateChatInput(input: ChatSendInput): NormalizedChatInput {
  const clientMessageId = typeof input?.clientMessageId === 'string' ? input.clientMessageId.trim() : '';
  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  if (!clientMessageId || clientMessageId.length > 200) throw new DomainError('VALIDATION_FAILED', 'Identitas pesan tidak valid.');
  if (text.length > 4000) throw new DomainError('VALIDATION_FAILED', 'Pesan maksimal 4.000 karakter.');
  if (!Array.isArray(input?.assets) || input.assets.length > 5) throw new DomainError('VALIDATION_FAILED', 'Pilih maksimal 5 lampiran per pesan.');
  if (!text && !input.assets.length) throw new DomainError('VALIDATION_FAILED', 'Tulis pesan atau pilih lampiran terlebih dahulu.');
  for (const asset of input.assets) {
    if (!asset || !['image', 'video'].includes(asset.kind) || typeof asset.mimeType !== 'string' || !asset.mimeType.toLowerCase().startsWith(`${asset.kind}/`) || typeof asset.uri !== 'string' || !/^(file|content):\/\//.test(asset.uri) || typeof asset.filename !== 'string' || !asset.filename.trim() || asset.filename.length > 255 || (asset.byteSize !== null && (!Number.isSafeInteger(asset.byteSize) || asset.byteSize < 0))) {
      throw new DomainError('VALIDATION_FAILED', 'Lampiran foto atau video tidak valid.');
    }
  }
  const fingerprint = JSON.stringify({ text, assets: input.assets.map(({ uri, filename, mimeType, byteSize, kind }) => ({ uri, filename, mimeType, byteSize, kind })) });
  return { clientMessageId, text, assets: [...input.assets], fingerprint };
}
