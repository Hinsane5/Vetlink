import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { APP_CONFIG, loadAppConfig, loadMediaConfig } from '../config/app-config.js';
import { ChatController } from './chat.controller.js';
import { CHAT_DELIVERY_ADAPTER, LocalPollingChatDeliveryAdapter } from './chat-delivery.js';
import { CommunicationService } from './communication.service.js';
import { MEDIA_CONFIG, MEDIA_STORAGE_ADAPTER, LocalPrivateMediaStorageAdapter } from './media-storage.js';
import { MediaController } from './media.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [ChatController, MediaController],
  providers: [
    CommunicationService,
    { provide: APP_CONFIG, useFactory: () => loadAppConfig() },
    { provide: MEDIA_CONFIG, useFactory: () => loadMediaConfig() },
    { provide: MEDIA_STORAGE_ADAPTER, useClass: LocalPrivateMediaStorageAdapter },
    { provide: CHAT_DELIVERY_ADAPTER, useClass: LocalPollingChatDeliveryAdapter },
  ],
})
export class CommunicationModule {}
