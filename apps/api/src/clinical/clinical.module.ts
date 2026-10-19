import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ClinicalController } from './clinical.controller.js';
import { ClinicalService } from './clinical.service.js';
import { LocalRecommendationDeliveryAdapter, RECOMMENDATION_DELIVERY_ADAPTER } from './recommendation-delivery.js';

@Module({ imports: [AuthModule, CatalogModule], controllers: [ClinicalController], providers: [ClinicalService, { provide: RECOMMENDATION_DELIVERY_ADAPTER, useClass: LocalRecommendationDeliveryAdapter }] })
export class ClinicalModule {}
