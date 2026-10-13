import type { DomainRepository } from './DomainRepository';

/** Commerce transaction boundary keeps cart, quote, order, and snapshots atomic. */
export interface CommerceRepository {
  readonly read: DomainRepository;
  transaction<T>(action: (repository: DomainRepository) => Promise<T>): Promise<T>;
}
