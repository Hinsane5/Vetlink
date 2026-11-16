import { ApiPaymentGateway } from '../../application/ApiPaymentGateway';
import { ServerAuthService } from '../../application/ServerAuthService';
import { ApiClient } from './ApiClient';
import { HttpServerAuthRepository } from './ApiAuthRepository';
import { ExpoApiPaymentOperationStore } from './ExpoApiPaymentOperationStore';
import { ExpoServerSessionStore } from './ExpoServerSessionStore';
import { HttpApiPaymentRepository } from './HttpApiPaymentRepository';
import { HttpApiCatalogRepository } from './HttpApiCatalogRepository';

/** Build API-only services from an explicitly configured development base URL. */
export function createApiAdapters(baseUrl: string) {
  const sessions = new ExpoServerSessionStore();
  const api = new ApiClient(baseUrl, sessions);
  return {
    auth: new ServerAuthService(new HttpServerAuthRepository(api), sessions),
    payments: new ApiPaymentGateway(new HttpApiPaymentRepository(api), new ExpoApiPaymentOperationStore()),
    catalog: new HttpApiCatalogRepository(api),
  };
}
