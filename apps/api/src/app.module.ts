import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { RequestIdMiddleware } from './common/http/request-id.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommunicationModule } from './communication/communication.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { LivestockModule } from './livestock/livestock.module.js';
import { VetModule } from './vet/vet.module.js';
import { PaymentModule } from './payment/payment.module.js';
import { ClinicalModule } from './clinical/clinical.module.js';
import { ConsultationModule } from './consultation/consultation.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CommerceModule } from './commerce/commerce.module.js';
import { EarningsModule } from './earnings/earnings.module.js';

@Module({
  imports: [DatabaseModule, HealthModule, AuthModule, CommunicationModule, ProfileModule, LivestockModule, VetModule, ConsultationModule, PaymentModule, CatalogModule, CommerceModule, ClinicalModule, EarningsModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
