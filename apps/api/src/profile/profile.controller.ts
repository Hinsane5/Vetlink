import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors, UnprocessableEntityException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { IsArray, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { ApiErrorResponseDto } from '../common/http/api-error.dto.js';
import { ProfileService } from './profile.service.js';
import { AddressResponseDto, FarmResponseDto, ProfessionalDocumentResponseDto } from './profile.dto.js';
import type { Response } from 'express';

class AddressDto { @IsString() @MinLength(1) @MaxLength(80) label!:string; @IsString() @MinLength(1) @MaxLength(120) recipientName!:string; @IsString() @MinLength(5) @MaxLength(32) phone!:string; @IsString() @MinLength(1) @MaxLength(500) addressLine!:string; @IsString() @MaxLength(120) city!:string; @IsString() @MaxLength(120) province!:string; @IsString() @MaxLength(16) postalCode!:string; @IsOptional() latitude?:number; @IsOptional() longitude?:number; }
class AddressPatchDto extends AddressDto { @IsInt() @Min(1) expectedVersion!:number; }
class FarmDto { @IsString() @MinLength(1) @MaxLength(120) name!:string; @IsOptional() @IsArray() species?:string[]; @IsOptional() @IsString() @MaxLength(80) timezone?:string; @IsOptional() @IsObject() location?:Record<string,unknown>; @IsOptional() @IsUUID() visitAddressId?:string; }
class SubmissionDto { @IsArray() @IsString({each:true}) documentIds!:string[]; }
class ReviewDto { @IsString() status!: 'verified'|'revision_required'; @IsOptional() @IsString() @MaxLength(1000) reason?:string; }
class ProfileDto { @IsOptional() @IsString() @MaxLength(120) fullName?:string; @IsOptional() @IsString() @MaxLength(120) professionalName?:string; @IsOptional() @IsString() @MaxLength(120) registrationReference?:string; }
class FarmPatchDto extends FarmDto { @IsInt() @Min(1) expectedVersion!:number; }

@ApiTags('Profile') @ApiBearerAuth('bearer') @Controller('me') @UseGuards(AccessTokenGuard,RoleGuard) @RequireRoles('farmer','vet')
export class ProfileController {
  constructor(private readonly service:ProfileService){}
  @Get('farmer') @RequireRoles('farmer') getFarmerProfile(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.profile(p);}
  @Get('vet') @RequireRoles('vet') getVetProfile(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.profile(p);}
  @Patch('farmer') @RequireRoles('farmer') patchFarmerProfile(@AuthenticatedUser() p:AuthenticatedPrincipal,@Body() body:ProfileDto){return this.service.patchProfile(p,{...body});}
  @Patch('vet') @RequireRoles('vet') patchVetProfile(@AuthenticatedUser() p:AuthenticatedPrincipal,@Body() body:ProfileDto){return this.service.patchProfile(p,{...body});}
  @Get('farms') @RequireRoles('farmer') @ApiOkResponse({type:[FarmResponseDto],description:'Farm milik Peternak aktif, dalam urutan pembuatan stabil.'}) @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto})
  farms(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.farms(p);}
  @Get('farms/:id') @RequireRoles('farmer') @ApiOkResponse({type:FarmResponseDto}) @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto}) @ApiNotFoundResponse({type:ApiErrorResponseDto})
  farm(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string){return this.service.farm(p,id);}
  @Post('farms') @RequireRoles('farmer') @ApiCreatedResponse({type:FarmResponseDto})
  addFarm(@AuthenticatedUser() p:AuthenticatedPrincipal,@Body() body:FarmDto){return this.service.addFarm(p,body);}
  @Patch('farms/:id') @RequireRoles('farmer') @ApiOkResponse({type:FarmResponseDto})
  patchFarm(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Body() body:FarmPatchDto){const {expectedVersion,...patch}=body;return this.service.patchFarm(p,id,patch,expectedVersion);}
  @Get('addresses') @RequireRoles('farmer') @ApiOkResponse({type:[AddressResponseDto],description:'Alamat milik Peternak aktif, dalam urutan pembuatan stabil.'}) @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto})
  addresses(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.addresses(p);}
  @Get('addresses/:id') @RequireRoles('farmer') @ApiOkResponse({type:AddressResponseDto}) @ApiUnauthorizedResponse({type:ApiErrorResponseDto}) @ApiForbiddenResponse({type:ApiErrorResponseDto}) @ApiNotFoundResponse({type:ApiErrorResponseDto})
  addressDetail(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string){return this.service.address(p,id);}
  @Post('addresses') @RequireRoles('farmer') @ApiCreatedResponse({type:AddressResponseDto})
  address(@AuthenticatedUser() p:AuthenticatedPrincipal,@Body() body:AddressDto){return this.service.addAddress(p,body);}
  @Patch('addresses/:id') @RequireRoles('farmer') @ApiOkResponse({type:AddressResponseDto})
  patchAddress(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Body() body:AddressPatchDto){return this.service.patchAddress(p,id,body);}
  @Delete('addresses/:id') async deleteAddress(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string){await this.service.deleteAddress(p,id);return {deleted:true};}
  @Post('vet/professional-documents') @RequireRoles('vet') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1,fields:0,parts:1}})) @ApiConsumes('multipart/form-data') @ApiBody({schema:{type:'object',required:['file'],properties:{file:{type:'string',format:'binary'}}}}) @ApiCreatedResponse({type:ProfessionalDocumentResponseDto})
  upload(@AuthenticatedUser() p:AuthenticatedPrincipal,@Headers('idempotency-key') key:string|undefined,@UploadedFile() file?:{originalname:string;mimetype:string;buffer:Buffer;size:number}){return this.service.uploadDocument(p,file,key);}
  @Post('vet/verification-submissions') @RequireRoles('vet') submit(@AuthenticatedUser() p:AuthenticatedPrincipal,@Body() b:SubmissionDto){return this.service.submit(p,b.documentIds);}
  @Get('vet/verification') @RequireRoles('vet') verification(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.verification(p);}
  @Get('internal/reviews') reviews(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.reviewQueue(p);}
  @Get('internal/reviews/documents/:id/content') async reviewDocument(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Res({passthrough:true}) response:Response){const opened=await this.service.reviewerDocument(p,id);response.setHeader('Cache-Control','private, no-store');response.setHeader('X-Content-Type-Options','nosniff');return new StreamableFile(opened.media.stream,{type:opened.mime,length:opened.media.byteSize,disposition:`attachment; filename*=UTF-8''${encodeURIComponent(opened.filename)}`});}
  @Post('internal/reviews/:id') review(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Body() b:ReviewDto){if(!['verified','revision_required'].includes(b.status))throw new UnprocessableEntityException({code:'VALIDATION_FAILED',message:'Keputusan review tidak valid.'});return this.service.review(p,id,b.status,b.reason);}
}
