import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateConsultationQuoteDto {
  @IsUUID() vetId!: string;
  @IsUUID() animalId!: string;
  @IsIn(['chat', 'visit']) serviceType!: 'chat' | 'visit';
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsString() @MinLength(1) @MaxLength(4000) complaint!: string;
  @IsOptional() @IsUUID() addressId?: string;
}

export class CreateConsultationDto {
  @IsUUID() quoteId!: string;
}

export class ExpectedVersionDto {
  @IsInt() @Min(1) expectedVersion!: number;
}

export class RejectConsultationDto extends ExpectedVersionDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class ScheduleProposalDto extends ExpectedVersionDto {
  @IsISO8601({ strict: true }) startsAt!: string;
}

export class RespondScheduleProposalDto extends ExpectedVersionDto {
  @IsIn(['accept', 'decline']) decision!: 'accept' | 'decline';
  @IsBoolean() consent!: boolean;
}

export class CompleteConsultationDto extends ExpectedVersionDto {
  @IsBoolean() confirmation!: boolean;
  @IsOptional() @IsInt() @Min(1) expectedVisitVersion?: number;
}

export class VisitTransitionDto extends ExpectedVersionDto {
  @IsInt() @Min(1) expectedVisitVersion!: number;
}

export class ConsultationListQueryDto {
  @IsOptional() @IsIn(['awaiting_payment', 'requested', 'scheduled', 'reschedule_pending', 'in_progress', 'completed', 'rejected', 'cancelled']) status?: string;
}
