import * as SecureStore from 'expo-secure-store';
import { ApiPaymentOperationJournal } from '../../application/ApiPaymentOperationJournal';
import type { ApiPaymentOperationPersistence } from '../../application/ports/ApiPaymentOperationStore';

/** Expo SecureStore adapter for pending remote payment idempotency keys. */
export class ExpoApiPaymentOperationStore extends ApiPaymentOperationJournal {
  constructor() {
    super(new ExpoSecureOperationPersistence());
  }
}

class ExpoSecureOperationPersistence implements ApiPaymentOperationPersistence {
  getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  }

  setItem(key: string, value: string): Promise<void> {
    return SecureStore.setItemAsync(key, value);
  }

  deleteItem(key: string): Promise<void> {
    return SecureStore.deleteItemAsync(key);
  }
}
