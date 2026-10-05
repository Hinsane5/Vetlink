import type { DomainRepository } from './DomainRepository';
import type { AttachmentMedia, ProfileRepository } from './ProfileRepository';
import type { SelectedAsset } from '../../domain/profiles';
export type BookingUnit = { repository: DomainRepository; profiles: ProfileRepository };
export interface BookingRepository {
  read: BookingUnit;
  transaction<T>(action: (unit: BookingUnit) => Promise<T>): Promise<T>;
}
export interface BookingMedia extends AttachmentMedia {
  pickBookingMedia(): Promise<SelectedAsset[]>;
}
