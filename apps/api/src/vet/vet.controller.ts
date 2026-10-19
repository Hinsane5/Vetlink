import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { AccessTokenGuard, RoleGuard } from '../auth/auth.guards.js';
import { AuthenticatedUser, RequireRoles } from '../auth/auth.decorators.js';
import type { AuthenticatedPrincipal } from '../auth/auth.types.js';
import { BlockedTimeDto, BlockedTimePatchDto, DirectoryQueryDto, ScheduleQueryDto, SlotsQueryDto, VetAvailabilityDto } from './vet.dto.js';
import { VetService } from './vet.service.js';

class BlockVersionDto { @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number; }

@ApiTags('Veterinarians') @ApiBearerAuth('bearer') @UseGuards(AccessTokenGuard,RoleGuard) @RequireRoles('farmer','vet')
@Controller()
export class VetController {
  constructor(private readonly service:VetService){}
  @Get('vets') directory(@Query() query:DirectoryQueryDto){return this.service.directory(query);}
  @Get('vets/:id') detail(@Param('id',ParseUUIDPipe) id:string){return this.service.detail(id);}
  @Get('vets/:id/slots') slots(@Param('id',ParseUUIDPipe) id:string,@Query() query:SlotsQueryDto){return this.service.slots(id,query);}
  @Get('me/vet/availability') availability(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.availability(p);}
  @Put('me/vet/availability') updateAvailability(@AuthenticatedUser() p:AuthenticatedPrincipal,@Body() body:VetAvailabilityDto){return this.service.updateAvailability(p,body);}
  @Get('me/vet/blocked-times') blocked(@AuthenticatedUser() p:AuthenticatedPrincipal){return this.service.blocked(p);}
  @Post('me/vet/blocked-times') createBlocked(@AuthenticatedUser() p:AuthenticatedPrincipal,@Body() body:BlockedTimeDto){return this.service.createBlocked(p,body);}
  @Put('me/vet/blocked-times/:id') updateBlocked(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Body() body:BlockedTimePatchDto){return this.service.updateBlocked(p,id,body);}
  @Delete('me/vet/blocked-times/:id') cancelBlocked(@AuthenticatedUser() p:AuthenticatedPrincipal,@Param('id',ParseUUIDPipe) id:string,@Query() query:BlockVersionDto){return this.service.cancelBlocked(p,id,query.expectedVersion);}
  @Get('me/vet/schedule') schedule(@AuthenticatedUser() p:AuthenticatedPrincipal,@Query() query:ScheduleQueryDto){return this.service.schedule(p,query);}
}
