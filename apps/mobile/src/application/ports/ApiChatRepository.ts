export interface ApiMessageAttachment {
  id: string;
  kind: 'image' | 'video';
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4';
  filename: string;
  byteSize: number;
  /** Relative private API path; access still requires the server bearer session. */
  url: string;
}

export interface ApiChatMessage {
  id: string;
  clientMessageId: string;
  senderId: string;
  text: string | null;
  attachments: ApiMessageAttachment[];
  deliveryStatus: 'pending' | 'sent' | 'failed';
  deliveryAttempt: number;
  createdAt: string;
  sentAt: string | null;
}

export interface ApiChatMessagePage {
  items: ApiChatMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ApiSendMessageInput {
  /** Stable UUID must be reused with the exact same payload after an uncertain POST. */
  clientMessageId: string;
  text?: string;
  attachmentIds?: string[];
}

export interface ApiChatRepository {
  list(consultationId: string, query?: { limit?: number; cursor?: string }): Promise<ApiChatMessagePage>;
  send(consultationId: string, input: ApiSendMessageInput): Promise<ApiChatMessage>;
  retry(consultationId: string, messageId: string): Promise<ApiChatMessage>;
}
