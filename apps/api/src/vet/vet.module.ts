import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { VetController } from './vet.controller.js';
import { VetService } from './vet.service.js';

@Module({imports:[AuthModule],controllers:[VetController],providers:[VetService]})
export class VetModule{}
