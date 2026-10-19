import type { DomainRepository } from './DomainRepository';

/** A domain repository that can group earning and ledger writes in one transaction. */
export interface EarningsRepository extends DomainRepository {
  transact<T>(work: (repository: DomainRepository) => Promise<T>): Promise<T>;
}
