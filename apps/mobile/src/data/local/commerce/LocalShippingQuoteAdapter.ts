import type { CheckoutAddressSnapshot } from '../../../domain/commerce';
import type { ShippingQuoteProvider, ShippingQuoteResult } from '../../../application/ports/ShippingQuoteProvider';

/** Fictional local rates for the supported fixture regions; no courier is contacted. */
export class LocalShippingQuoteAdapter implements ShippingQuoteProvider {
  async quote(address: CheckoutAddressSnapshot): Promise<ShippingQuoteResult> {
    const city = normalize(address.city);
    const province = normalize(address.province);
    if (province === 'jawa barat' && ['bogor', 'depok'].includes(city)) {
      return { outcome: 'succeeded', amount: 9000, label: 'Ongkir lokal · Bogor/Depok' };
    }
    if (province === 'di yogyakarta' && ['sleman', 'kota yogyakarta', 'yogyakarta'].includes(city)) {
      return { outcome: 'succeeded', amount: 12000, label: 'Ongkir lokal · Yogyakarta' };
    }
    return {
      outcome: 'failed',
      code: 'SHIPPING_AREA_UNAVAILABLE',
      message: 'Estimasi ongkir lokal belum tersedia untuk kota dan provinsi ini.',
      retryable: false,
    };
  }
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
}
