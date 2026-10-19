import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LivestockController } from './livestock.controller.js';
import { LivestockService } from './livestock.service.js';

@Module({ imports:[AuthModule], controllers:[LivestockController], providers:[LivestockService] })
export class LivestockModule {}
