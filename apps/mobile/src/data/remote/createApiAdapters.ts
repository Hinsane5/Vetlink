import { ApiPaymentGateway } from '../../application/ApiPaymentGateway';
import { ServerAuthService } from '../../application/ServerAuthService';
import { ApiClient } from './ApiClient';
import { HttpServerAuthRepository } from './ApiAuthRepository';
import { ExpoApiPaymentOperationStore } from './ExpoApiPaymentOperationStore';
import { ExpoServerSessionStore } from './ExpoServerSessionStore';
import { HttpApiPaymentRepository } from './HttpApiPaymentRepository';
import { HttpApiCatalogRepository } from './HttpApiCatalogRepository';
import { HttpApiFarmReadRepository } from './HttpApiFarmReadRepository';
import { HttpApiFarmWriteRepository } from './HttpApiFarmWriteRepository';
import { HttpApiLivestockReadRepository } from './HttpApiLivestockReadRepository';
import { HttpApiLivestockWriteRepository } from './HttpApiLivestockWriteRepository';
import { HttpApiLivestockHealthRepository } from './HttpApiLivestockHealthRepository';
import { HttpApiPatientReadRepository } from './HttpApiPatientReadRepository';
import { HttpApiVetDirectoryReadRepository } from './HttpApiVetDirectoryReadRepository';
import { HttpApiConsultationRepository } from './HttpApiConsultationRepository';
import { HttpApiEarningsRepository } from './HttpApiEarningsRepository';
import { HttpApiVetScheduleRepository } from './HttpApiVetScheduleRepository';
import { HttpApiClinicalRepository } from './HttpApiClinicalRepository';
import { HttpApiChatRepository } from './HttpApiChatRepository';
import { HttpApiCareCoordinationRepository } from './HttpApiCareCoordinationRepository';
import { HttpApiCommerceRepository } from './HttpApiCommerceRepository';

/** Build API-only services from an explicitly configured development base URL. */
export function createApiAdapters(baseUrl: string) {
  const sessions = new ExpoServerSessionStore();
  const api = new ApiClient(baseUrl, sessions);
  return {
    auth: new ServerAuthService(new HttpServerAuthRepository(api), sessions),
    payments: new ApiPaymentGateway(new HttpApiPaymentRepository(api), new ExpoApiPaymentOperationStore()),
    catalog: new HttpApiCatalogRepository(api),
    farms: new HttpApiFarmReadRepository(api),
    farmWrites: new HttpApiFarmWriteRepository(api),
    livestock: new HttpApiLivestockReadRepository(api),
    livestockWrites: new HttpApiLivestockWriteRepository(api),
    livestockHealth: new HttpApiLivestockHealthRepository(api),
    patients: new HttpApiPatientReadRepository(api),
    vets: new HttpApiVetDirectoryReadRepository(api),
    consultations: new HttpApiConsultationRepository(api),
    earnings: new HttpApiEarningsRepository(api),
    vetSchedule: new HttpApiVetScheduleRepository(api),
    clinical: new HttpApiClinicalRepository(api),
    chat: new HttpApiChatRepository(api),
    careCoordination: new HttpApiCareCoordinationRepository(api),
    commerce: new HttpApiCommerceRepository(api),
  };
}
