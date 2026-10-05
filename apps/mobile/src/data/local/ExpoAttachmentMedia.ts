import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import type { AttachmentMedia } from '../../application/ports/ProfileRepository';
import type { SelectedAsset } from '../../domain/profiles';

export class ExpoAttachmentMedia implements AttachmentMedia {
  async pickPhoto(): Promise<SelectedAsset | null> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return null;
    const asset = result.assets[0];
    return {
      uri: asset.uri,
      filename: asset.fileName ?? 'foto-profil.jpg',
      mimeType: asset.mimeType ?? 'image/jpeg',
      byteSize: asset.fileSize ?? null,
      kind: 'image',
    };
  }

  async pickDocuments(): Promise<SelectedAsset[]> {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return [];
    return result.assets.map((asset) => ({
      uri: asset.uri,
      filename: asset.name,
      mimeType: asset.mimeType ?? 'application/octet-stream',
      byteSize: asset.size ?? null,
      kind: 'document',
    }));
  }

  async store(asset: SelectedAsset, attachmentId: string) {
    const directory = new Directory(Paths.document, 'attachments');
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    const extension = extensionOf(asset.filename);
    const filename = `${attachmentId}${extension}`;
    const source = new File(asset.uri);
    const destination = new File(directory, filename);
    source.copy(destination);
    return {
      localUri: destination.uri,
      filename: asset.filename,
      mimeType: asset.mimeType || destination.type,
      byteSize: destination.size || asset.byteSize || 0,
    };
  }

  async remove(localUri: string): Promise<void> {
    const file = new File(localUri);
    if (file.exists) file.delete();
  }
}

function extensionOf(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0 || filename.length - lastDot > 12) return '';
  return filename.slice(lastDot).replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();
}
