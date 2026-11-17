import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import { CareEventDto, CreateLivestockDto, PatchLivestockDto } from './livestock.dto.js';
import { LivestockListQueryDto, LivestockPageResponseDto, LivestockResponseDto } from './livestock-read.dto.js';
import { CareEventResponseDto, LivestockHealthEventResponseDto, PatientResponseDto } from './livestock-response.dto.js';
import { LivestockService } from './livestock.service.js';

@ApiTags('Livestock') @ApiBearerAuth('bearer') @Controller() @UseGuards(AccessTokenGuard,RoleGuard)
export class LivestockController {
  constructor(private readonly service:LivestockService){}
  @Get('livestock/page') @RequireRoles('farmer','vet')
  @ApiQuery({name:'cursor',required:false,type:String,maxLength:512,description:'Cursor opaque dari halaman sebelumnya; gunakan pada scope dan role yang sama.'})
  @ApiQuery({name:'limit',required:false,type:Number,minimum:1,maximum:100,description:'Jumlah maksimum item per halaman; default 20.'})
  @ApiOkResponse({type:LivestockPageResponseDto,description:'Daftar berturutan stabil; Peternak membaca ternak miliknya, Dokter hanya pasien dari layanan terkait.'})
  @ApiBadRequestResponse({type:ApiErrorResponseDto}) @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto})
  listPage(@AuthenticatedUser() p:AuthenticatedPrincipal,@Query() query:LivestockListQueryDto){return this.service.listPage(p,query);}
  @Get('livestock') @RequireRoles('farmer','vet') @ApiOkResponse({type:[LivestockResponseDto],description:'Daftar penuh tetap berupa array; Peternak membaca seluruh ternak miliknya.'})
  list(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.list(p);}
  @Post('livestock') @RequireRoles('farmer') create(@AuthenticatedUser() p:AuthenticatedPrincipal,@Body() b:CreateLivestockDto){return this.service.create(p,b);}
  @Get('livestock/:id') @RequireRoles('farmer','vet') @ApiOkResponse({type:LivestockResponseDto}) @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto}) @ApiNotFoundResponse({type:ApiErrorResponseDto})
  get(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string){return this.service.get(p,id);}
  @Patch('livestock/:id') @RequireRoles('farmer') patch(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Body() b:PatchLivestockDto){return this.service.patch(p,id,b);}
  @Delete('livestock/:id') @RequireRoles('farmer') delete(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string){return this.service.delete(p,id);}
  @Get('livestock/:id/health-events') @RequireRoles('farmer','vet')
  @ApiOkResponse({ type:[LivestockHealthEventResponseDto], description:'Array timeline pemilik ternak atau Dokter terkait; hanya event laporan/perawatan dan catatan klinis final, tanpa draft atau metadata privat.' })
  @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto}) @ApiNotFoundResponse({type:ApiErrorResponseDto})
  history(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string){return this.service.timeline(p,id);}

  @Post('livestock/:id/care-events') @RequireRoles('farmer')
  @ApiCreatedResponse({ type:CareEventResponseDto, description:'Event laporan Peternak yang tersimpan; retry menggunakan sourceKey dan payload yang sama.' })
  @ApiBadRequestResponse({type:ApiErrorResponseDto}) @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto}) @ApiNotFoundResponse({type:ApiErrorResponseDto}) @ApiConflictResponse({type:ApiErrorResponseDto})
  care(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Body() b:CareEventDto){return this.service.addCare(p,id,b);}

  @Get('patients') @RequireRoles('vet')
  @ApiOkResponse({ type:[PatientResponseDto], description:'Array pasien distinct dari konsultasi Dokter yang ditugaskan; draft dan awaiting_payment tidak membuka pasien.' })
  @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto})
  patients(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.patients(p);}
}
