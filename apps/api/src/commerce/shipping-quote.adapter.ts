import { Injectable } from '@nestjs/common';
import { adapterFailed, adapterSucceeded, type AdapterResult } from '../communication/adapter-result.js';

export const CHECKOUT_SHIPPING_ADAPTER = Symbol('CHECKOUT_SHIPPING_ADAPTER');

export interface ShippingAddressInput {
  city: string;
  province: string;
}

export interface ShippingQuoteValue {
  amountIdr: number;
  label: string;
}

export interface CheckoutShippingAdapter {
  estimate(address: ShippingAddressInput): Promise<AdapterResult<ShippingQuoteValue>>;
}

/** Fictional local rules shared with the mobile checkout; no courier is contacted. */
@Injectable()
export class LocalCheckoutShippingAdapter implements CheckoutShippingAdapter {
  async estimate(address: ShippingAddressInput): Promise<AdapterResult<ShippingQuoteValue>> {
    const city = normalize(address.city);
    const province = normalize(address.province);

    if (province === 'jawa barat' && ['bogor', 'depok'].includes(city)) {
      return adapterSucceeded({ amountIdr: 9000, label: 'Ongkir lokal · Bogor/Depok' });
    }
    if (province === 'di yogyakarta' && ['sleman', 'kota yogyakarta', 'yogyakarta'].includes(city)) {
      return adapterSucceeded({ amountIdr: 12000, label: 'Ongkir lokal · Yogyakarta' });
    }
    return adapterFailed('SHIPPING_AREA_UNAVAILABLE', 'Estimasi ongkir lokal belum tersedia untuk kota dan provinsi ini.', false);
  }
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
}
