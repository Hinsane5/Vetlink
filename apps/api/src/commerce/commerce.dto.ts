import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class SetCartItemDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) quantity!: number;
}

export class DeleteCartItemQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class OrderListQueryDto {
  @IsOptional() @IsString() @MaxLength(512) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class CreateCheckoutQuoteDto {
  @IsUUID() addressId!: string;
}

export class CreateOrderDto {
  @IsUUID() quoteId!: string;
}

export class CartItemResponseDto {
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() category!: string;
  @ApiProperty({ type: 'integer', nullable: true }) unitPriceIdr!: number | null;
  @ApiProperty({ type: 'integer', minimum: 1 }) quantity!: number;
  @ApiProperty({ type: 'integer', nullable: true }) lineTotalIdr!: number | null;
  @ApiProperty() active!: boolean;
}

export class CartResponseDto {
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) id!: string | null;
  @ApiProperty({ format: 'uuid' }) farmerId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiProperty({ enum: ['IDR'] }) currency!: 'IDR';
  @ApiProperty({ type: [CartItemResponseDto] }) items!: CartItemResponseDto[];
  @ApiProperty({ type: 'integer', minimum: 0 }) subtotalIdr!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) itemCount!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) quantityCount!: number;
  @ApiProperty() hasUnavailableItems!: boolean;
}

export class CheckoutAddressSnapshotDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() recipientName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() addressLine!: string;
  @ApiProperty() city!: string;
  @ApiProperty() province!: string;
  @ApiProperty() postalCode!: string;
}

export class CheckoutLineSnapshotDto {
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() nameSnapshot!: string;
  @ApiProperty() categorySnapshot!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) unitPriceIdr!: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) quantity!: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) lineTotalIdr!: number;
}

export class CheckoutQuoteResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) cartId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) cartVersion!: number;
  @ApiProperty({ format: 'uuid' }) addressId!: string;
  @ApiProperty({ type: CheckoutAddressSnapshotDto }) addressSnapshot!: CheckoutAddressSnapshotDto;
  @ApiProperty({ type: [CheckoutLineSnapshotDto] }) items!: CheckoutLineSnapshotDto[];
  @ApiProperty({ type: 'integer', minimum: 0 }) subtotalIdr!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) shippingAmountIdr!: number;
  @ApiProperty() shippingLabel!: string;
  @ApiProperty({ type: 'integer', minimum: 0 }) totalIdr!: number;
  @ApiProperty({ enum: ['IDR'] }) currency!: 'IDR';
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class OrderItemResponseDto extends CheckoutLineSnapshotDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
}

export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayCode!: string;
  @ApiProperty({ enum: ['awaiting_payment', 'paid', 'processing', 'shipped', 'delivered'] }) status!: string;
  @ApiProperty({ format: 'uuid' }) checkoutQuoteId!: string;
  @ApiProperty({ format: 'uuid' }) addressId!: string;
  @ApiProperty({ type: CheckoutAddressSnapshotDto }) addressSnapshot!: CheckoutAddressSnapshotDto;
  @ApiProperty({ type: [OrderItemResponseDto] }) items!: OrderItemResponseDto[];
  @ApiProperty({ type: 'integer', minimum: 0 }) subtotalIdr!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) shippingAmountIdr!: number;
  @ApiProperty() shippingLabel!: string;
  @ApiProperty({ type: 'integer', minimum: 0 }) totalIdr!: number;
  @ApiProperty({ enum: ['IDR'] }) currency!: 'IDR';
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true }) paymentId!: string | null;
  @ApiProperty({ type: 'string', enum: ['pending', 'succeeded', 'failed', 'expired'], nullable: true }) paymentStatus!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
}

export class ShipmentTimelineEventDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: 'string', nullable: true }) eventId!: string | null;
  @ApiProperty({ enum: ['order_created', 'payment_succeeded', 'shipment_adapter'] }) type!: string;
  @ApiProperty({ enum: ['pending', 'succeeded', 'failed'] }) outcome!: string;
  @ApiProperty({ type: 'string', nullable: true, enum: ['awaiting_payment', 'paid', 'processing', 'shipped', 'delivered'] }) orderStatus!: string | null;
  @ApiProperty({ type: 'string', nullable: true, enum: ['pending', 'processing', 'shipped', 'delivered', 'failed'] }) shipmentStatus!: string | null;
  @ApiProperty({ type: 'string', nullable: true }) trackingCode!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
}

export class OrderShipmentSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['pending', 'processing', 'shipped', 'delivered', 'failed'] }) status!: string;
  @ApiProperty({ type: 'string', nullable: true }) trackingCode!: string | null;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
}

export class OrderShipmentResponseDto {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ enum: ['awaiting_payment', 'paid', 'processing', 'shipped', 'delivered'] }) orderStatus!: string;
  @ApiProperty({ type: OrderShipmentSummaryDto, nullable: true }) shipment!: OrderShipmentSummaryDto | null;
  @ApiProperty({ type: [ShipmentTimelineEventDto] }) events!: ShipmentTimelineEventDto[];
}

export class OrderListResponseDto {
  @ApiProperty({ type: [OrderResponseDto] }) items!: OrderResponseDto[];
  @ApiProperty({ type: 'string', nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}

export class CreateOrderResponseDto {
  @ApiProperty({ format: 'uuid' }) operationId!: string;
  @ApiProperty() replayed!: boolean;
  @ApiProperty({ type: OrderResponseDto }) order!: OrderResponseDto;
}
