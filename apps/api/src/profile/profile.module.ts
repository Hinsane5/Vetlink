import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommunicationModule } from '../communication/communication.module.js';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

@Module({ imports: [AuthModule, CommunicationModule], controllers: [ProfileController], providers: [ProfileService] })
export class ProfileModule {}
