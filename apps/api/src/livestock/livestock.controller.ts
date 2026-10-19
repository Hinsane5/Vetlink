import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { CareEventDto, CreateLivestockDto, PatchLivestockDto } from './livestock.dto.js';
import { LivestockService } from './livestock.service.js';

@ApiTags('Livestock') @ApiBearerAuth('bearer') @Controller() @UseGuards(AccessTokenGuard,RoleGuard)
export class LivestockController {
  constructor(private readonly service:LivestockService){}
  @Get('livestock') @RequireRoles('farmer','vet') list(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.list(p);}
  @Post('livestock') @RequireRoles('farmer') create(@AuthenticatedUser() p:AuthenticatedPrincipal,@Body() b:CreateLivestockDto){return this.service.create(p,b);}
  @Get('livestock/:id') @RequireRoles('farmer','vet') get(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string){return this.service.get(p,id);}
  @Patch('livestock/:id') @RequireRoles('farmer') patch(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Body() b:PatchLivestockDto){return this.service.patch(p,id,b);}
  @Delete('livestock/:id') @RequireRoles('farmer') delete(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string){return this.service.delete(p,id);}
  @Get('livestock/:id/health-events') @RequireRoles('farmer','vet') history(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string){return this.service.timeline(p,id);}
  @Post('livestock/:id/care-events') @RequireRoles('farmer') care(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Body() b:CareEventDto){return this.service.addCare(p,id,b);}
  @Get('patients') @RequireRoles('vet') patients(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.patients(p);}
}
