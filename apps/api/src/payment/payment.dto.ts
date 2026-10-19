import { IsIn, IsUUID } from 'class-validator';

export class CreatePaymentDto {
  @IsIn(['consultation', 'order']) payableType!: 'consultation' | 'order';
  @IsUUID() payableId!: string;
  @IsIn(['bank_transfer', 'e_wallet']) method!: 'bank_transfer' | 'e_wallet';
}
