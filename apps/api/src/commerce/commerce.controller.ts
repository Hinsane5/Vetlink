import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import {
  CartResponseDto,
  CheckoutQuoteResponseDto,
  CreateCheckoutQuoteDto,
  CreateOrderDto,
  CreateOrderResponseDto,
  DeleteCartItemQueryDto,
  OrderListResponseDto,
  OrderListQueryDto,
  OrderShipmentResponseDto,
  OrderResponseDto,
  SetCartItemDto,
} from './commerce.dto.js';
import { CommerceService } from './commerce.service.js';

@ApiTags('Keranjang dan pesanan')
@ApiBearerAuth('bearer')
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('farmer')
@Controller()
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}

  @Get('me/cart')
  @ApiOkResponse({ type: CartResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto, description: 'Hanya Peternak.' })
  getCart(@AuthenticatedUser() principal: AuthenticatedPrincipal) {
    return this.commerce.getCart(principal);
  }

  @Put('me/cart/items/:productId')
  @ApiOkResponse({ type: CartResponseDto, description: 'Mengatur jumlah item positif dan mengembalikan harga terkini.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  setItem(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: SetCartItemDto,
  ) {
    return this.commerce.setItem(principal, productId, body);
  }

  @Delete('me/cart/items/:productId')
  @ApiOkResponse({ type: CartResponseDto, description: 'Menghapus item secara idempotent.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  removeItem(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() query: DeleteCartItemQueryDto,
  ) {
    return this.commerce.removeItem(principal, productId, query);
  }

  @Post('checkout-quotes')
  @ApiCreatedResponse({ type: CheckoutQuoteResponseDto, description: 'Quote memakai harga produk dan alamat Farm terkini.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto, description: 'Adapter ongkir tidak menyelesaikan hasil.' })
  createQuote(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Body() body: CreateCheckoutQuoteDto) {
    return this.commerce.createQuote(principal, body);
  }

  @Post('orders')
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', minLength: 8, maxLength: 128 } })
  @ApiCreatedResponse({ type: CreateOrderResponseDto, description: 'Membuat pesanan menunggu pembayaran dan mengosongkan cart secara atomik.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  createOrder(
    @AuthenticatedUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateOrderDto,
  ) {
    return this.commerce.createOrder(principal, key, body);
  }

  @Get('orders')
  @ApiQuery({ name: 'cursor', required: false, type: String, maxLength: 512, description: 'Cursor opaque urutan terbaru.' })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100, description: 'Jumlah maksimum item, default 20.' })
  @ApiOkResponse({ type: OrderListResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  listOrders(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Query() query: OrderListQueryDto) {
    return this.commerce.listOrders(principal, query);
  }

  @Get('orders/:id')
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  getOrder(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.commerce.getOrder(principal, id);
  }

  @Get('orders/:id/shipment')
  @ApiOkResponse({ type: OrderShipmentResponseDto, description: 'Status pengiriman dan timeline event adapter untuk pemilik order.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto, description: 'Hanya Peternak.' })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: 'Order yang bukan milik actor disembunyikan.' })
  getOrderShipment(@AuthenticatedUser() principal: AuthenticatedPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.commerce.getShipment(principal, id);
  }
}
