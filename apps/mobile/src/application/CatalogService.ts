import type { AccountRole } from '../domain/auth';
import type { CatalogProduct } from '../domain/catalog';
import { toCatalogProduct } from '../domain/catalog';
import type { DomainEntity } from '../domain/entities';
import { DomainError } from '../domain/errors';
import type { DomainRepository } from './ports/DomainRepository';
import type { ProfileRepository } from './ports/ProfileRepository';

/** Read-only marketplace access; Product records remain the single catalog source. */
export class CatalogService {
  constructor(
    private readonly repository: DomainRepository,
    private readonly profiles: ProfileRepository,
  ) {}

  async listProducts(userId: string, role: AccountRole): Promise<CatalogProduct[]> {
    await this.assertFarmer(userId, role);
    const products = await this.repository.listByKind('product');
    return products
      .filter((product) => product.payload.active === true)
      .map(toCatalogProduct)
      .sort((left, right) => left.name.localeCompare(right.name, 'id-ID') || left.id.localeCompare(right.id));
  }

  async getProduct(userId: string, role: AccountRole, productId: string): Promise<CatalogProduct> {
    await this.assertFarmer(userId, role);
    return this.activeProduct(productId);
  }

  async assertRecommendationContext(userId: string, recommendationId: string, consultationId: string): Promise<void> {
    await this.assertFarmer(userId, 'farmer');
    await this.sentRecommendation(userId, recommendationId, consultationId);
  }

  async getRecommendedProduct(
    userId: string,
    recommendationId: string,
    consultationId: string,
    productId: string,
  ): Promise<CatalogProduct> {
    await this.assertFarmer(userId, 'farmer');
    const recommendation = await this.sentRecommendation(userId, recommendationId, consultationId);
    const product = await this.repository.findById('product', productId);
    if (!product || product.kind !== 'product') {
      throw new DomainError('NOT_FOUND', 'Produk tidak ditemukan di katalog.');
    }

    const items = await this.repository.listByRelated('recommendationItem', recommendation.id, 'recommendation');
    const item = items.find((candidate) => candidate.kind === 'recommendationItem'
      && candidate.ownerId === recommendation.ownerId
      && candidate.contextId === recommendation.id
      && candidate.payload.recommendationId === recommendation.id
      && candidate.payload.productId === productId);
    if (!item) {
      throw new DomainError('FORBIDDEN', 'Produk ini tidak tertaut pada rekomendasi yang dipilih.');
    }

    const [recommendationLinks, productLinks] = await Promise.all([
      this.repository.listRelated('recommendationItem', item.id, 'recommendation'),
      this.repository.listRelated('recommendationItem', item.id, 'product'),
    ]);
    if (recommendationLinks.length !== 1 || recommendationLinks[0].id !== recommendation.id
      || productLinks.length !== 1 || productLinks[0].id !== productId || productLinks[0].kind !== 'product') {
      throw new DomainError('INVALID_STATE', 'Relasi item rekomendasi ke produk tidak valid.');
    }

    return toCatalogProduct(product);
  }

  private async sentRecommendation(userId: string, recommendationId: string, consultationId: string): Promise<DomainEntity> {
    const consultation = await this.repository.findById('consultation', consultationId);
    if (!consultation || consultation.kind !== 'consultation') {
      throw new DomainError('NOT_FOUND', 'Layanan terkait rekomendasi tidak ditemukan.');
    }
    if (consultation.ownerId !== userId || consultation.payload.farmerId !== userId) {
      throw new DomainError('FORBIDDEN', 'Rekomendasi ini bukan milik layanan akun Peternak ini.');
    }

    const [farmerLinks, recommendationLinks] = await Promise.all([
      this.repository.listRelated('consultation', consultationId, 'farmer'),
      this.repository.listRelated('consultation', consultationId, 'recommendation'),
    ]);
    if (!farmerLinks.some((farmer) => farmer.id === userId)) {
      throw new DomainError('FORBIDDEN', 'Relasi Peternak pada layanan tidak valid.');
    }

    const recommendation = await this.repository.findById('recommendation', recommendationId);
    if (!recommendation || recommendation.kind !== 'recommendation' || recommendation.payload.status !== 'sent') {
      throw new DomainError('NOT_FOUND', 'Rekomendasi terkirim tidak ditemukan.');
    }
    if (recommendation.contextId !== consultationId || recommendation.payload.consultationId !== consultationId
      || recommendation.payload.vetId !== consultation.payload.vetId || recommendation.ownerId !== consultation.payload.vetId
      || !recommendationLinks.some((item) => item.id === recommendation.id)) {
      throw new DomainError('FORBIDDEN', 'Rekomendasi tidak terkait dengan layanan ini.');
    }
    return recommendation;
  }

  private async activeProduct(productId: string): Promise<CatalogProduct> {
    const product = await this.repository.findById('product', productId);
    if (!product || product.kind !== 'product') {
      throw new DomainError('NOT_FOUND', 'Produk tidak ditemukan di katalog.');
    }
    return toCatalogProduct(product);
  }

  private async assertFarmer(userId: string, role: AccountRole): Promise<void> {
    if (role !== 'farmer') {
      throw new DomainError('FORBIDDEN', 'Marketplace hanya tersedia untuk Peternak.');
    }
    const aggregate = await this.profiles.loadProfile(userId, role);
    if (aggregate.profile.kind !== 'farmerProfile' || aggregate.profile.ownerId !== userId) {
      throw new DomainError('FORBIDDEN', 'Profil Peternak tidak sesuai dengan akun aktif.');
    }
  }
}
