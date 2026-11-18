export type ApiMediaMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4';

export interface ApiMediaFile {
  uri: string;
  filename: string;
  mimeType: ApiMediaMimeType;
  byteSize: number;
}

export interface ApiMediaAttachment extends Omit<ApiMediaFile, 'uri'> {
  id: string;
  kind: 'image' | 'video';
  uploadStatus: 'uploaded' | 'committed';
  url: string;
  createdAt: string;
}

export interface ApiMediaRepository {
  /** Reuse the same key and file after an uncertain response; do not retry automatically. */
  upload(consultationId: string, file: ApiMediaFile, idempotencyKey: string): Promise<ApiMediaAttachment>;
  commit(attachmentId: string): Promise<ApiMediaAttachment>;
  get(attachmentId: string): Promise<ApiMediaAttachment>;
  /** Caller must persist bytes without treating the private URL as a public asset. */
  download(attachmentId: string): Promise<ArrayBuffer>;
}
