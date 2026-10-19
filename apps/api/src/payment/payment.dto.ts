import { IsIn, IsString, IsUUID, Length } from 'class-validator';

export class CreatePaymentDto {
  @IsIn(['consultation', 'order']) payableType!: 'consultation' | 'order';
  @IsUUID() payableId!: string;
  @IsString() @Length(1, 40) method!: string;
}
