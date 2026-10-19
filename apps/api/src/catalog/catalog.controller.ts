import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { RequireRoles } from '../auth/auth.decorators.js';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import { ProductPageResponseDto, ProductResponseDto, ProductSearchQueryDto } from './catalog.dto.js';
import { CatalogService } from './catalog.service.js';

@ApiTags('Katalog produk')
@ApiBearerAuth('bearer')
@Controller('products')
@UseGuards(AccessTokenGuard, RoleGuard)
@RequireRoles('farmer', 'vet')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiQuery({ name: 'name', required: false, type: String, maxLength: 120, description: 'Pencarian substring nama.' })
  @ApiQuery({ name: 'category', required: false, type: String, maxLength: 80, description: 'Kategori, pencocokan tanpa membedakan huruf besar/kecil.' })
  @ApiQuery({ name: 'species', required: false, type: String, maxLength: 80, description: 'Spesies yang didukung produk.' })
  @ApiQuery({ name: 'minPrice', required: false, type: Number, minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Harga minimum dalam rupiah integer.' })
  @ApiQuery({ name: 'maxPrice', required: false, type: Number, minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Harga maksimum dalam rupiah integer.' })
  @ApiQuery({ name: 'cursor', required: false, type: String, maxLength: 512, description: 'Cursor opaque untuk halaman berikutnya.' })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100, description: 'Jumlah maksimum item per halaman; default 20.' })
  @ApiOkResponse({ type: ProductPageResponseDto, description: 'Produk active dengan harga authoritative dan cursor stabil.' })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  search(@Query() query: ProductSearchQueryDto) {
    return this.catalog.search(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: ProductResponseDto, description: 'Detail produk active; harga dibaca dari katalog server.' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.detail(id);
  }
}
