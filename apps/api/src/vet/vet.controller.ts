import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import { BlockedTimeDto, BlockedTimePatchDto, DirectoryPageQueryDto, DirectoryQueryDto, ScheduleQueryDto, SlotsQueryDto, VetAvailabilityDto, VetDirectoryDetailResponseDto, VetDirectoryPageResponseDto, VetDirectoryResponseDto, VetSlotResponseDto } from './vet.dto.js';
import { VetService } from './vet.service.js';

class BlockVersionDto { @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number; }

@ApiTags('Veterinarians') @ApiBearerAuth('bearer') @UseGuards(AccessTokenGuard,RoleGuard) @RequireRoles('farmer','vet')
@Controller()
export class VetController {
  constructor(private readonly service:VetService){}
  @Get('vets/page')
  @ApiQuery({name:'name',required:false,type:String,maxLength:120}) @ApiQuery({name:'species',required:false,type:String,maxLength:80})
  @ApiQuery({name:'service',required:false,enum:['chat','visit']}) @ApiQuery({name:'location',required:false,type:String,maxLength:120})
  @ApiQuery({name:'available',required:false,enum:['true','false']}) @ApiQuery({name:'minFee',required:false,type:Number,minimum:0,maximum:Number.MAX_SAFE_INTEGER})
  @ApiQuery({name:'maxFee',required:false,type:Number,minimum:0,maximum:Number.MAX_SAFE_INTEGER})
  @ApiQuery({name:'cursor',required:false,type:String,maxLength:512,description:'Cursor opaque dari halaman sebelumnya; hanya berlaku untuk filter yang sama.'})
  @ApiQuery({name:'limit',required:false,type:Number,minimum:1,maximum:100,description:'Jumlah maksimum item per halaman; default 20.'})
  @ApiOkResponse({type:VetDirectoryPageResponseDto,description:'Dokter verified yang menerima request, diurutkan stabil menurut nama lowercase dan ID.'})
  @ApiBadRequestResponse({type:ApiErrorResponseDto}) @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto}) @ApiServiceUnavailableResponse({type:ApiErrorResponseDto})
  directoryPage(@Query() query:DirectoryPageQueryDto){return this.service.directoryPage(query);}
  @Get('vets') @ApiOkResponse({type:[VetDirectoryResponseDto],description:'Route daftar lama tetap mengembalikan array; field sama dengan item pada endpoint page.'})
  directory(@Query() query:DirectoryQueryDto){return this.service.directory(query);}
  @Get('vets/:id') @ApiOkResponse({type:VetDirectoryDetailResponseDto}) @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto}) @ApiNotFoundResponse({type:ApiErrorResponseDto}) @ApiServiceUnavailableResponse({type:ApiErrorResponseDto})
  detail(@Param('id',ParseUUIDPipe) id:string){return this.service.detail(id);}
  @Get('vets/:id/slots') @ApiOkResponse({type:[VetSlotResponseDto],description:'Slot yang masih tersedia; waktu berupa timestamp ISO-8601 dengan zona UTC.'}) @ApiBadRequestResponse({type:ApiErrorResponseDto}) @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto}) @ApiNotFoundResponse({type:ApiErrorResponseDto}) @ApiServiceUnavailableResponse({type:ApiErrorResponseDto})
  slots(@Param('id',ParseUUIDPipe) id:string,@Query() query:SlotsQueryDto){return this.service.slots(id,query);}
  @Get('me/vet/availability') availability(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.availability(p);}
  @Put('me/vet/availability') updateAvailability(@AuthenticatedUser() p:AuthenticatedPrincipal,@Body() body:VetAvailabilityDto){return this.service.updateAvailability(p,body);}
  @Get('me/vet/blocked-times') blocked(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.blocked(p);}
  @Post('me/vet/blocked-times') createBlocked(@AuthenticatedUser() p:AuthenticatedPrincipal,@Body() body:BlockedTimeDto){return this.service.createBlocked(p,body);}
  @Put('me/vet/blocked-times/:id') updateBlocked(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Body() body:BlockedTimePatchDto){return this.service.updateBlocked(p,id,body);}
  @Delete('me/vet/blocked-times/:id') cancelBlocked(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Query() query:BlockVersionDto){return this.service.cancelBlocked(p,id,query.expectedVersion);}
  @Get('me/vet/schedule') schedule(@AuthenticatedUser() p:AuthenticatedPrincipal,@Query() query:ScheduleQueryDto){return this.service.schedule(p,query);}
}
