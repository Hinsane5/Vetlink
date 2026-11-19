import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ServerFarmService } from '../../application/ServerFarmService';
import type { ApiAddressRecord, ApiFarmRecord } from '../../application/ports/FarmReadRepository';
import type { AddressWriteInput } from '../../application/ports/FarmWriteRepository';
import { DomainError } from '../../domain/errors';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { LoadingState } from '../components/Feedback';
import { TextArea, TextField } from '../components/TextField';
import { colors, fonts, spacing, typeScale } from '../theme/tokens';

type Draft = AddressWriteInput;
type UncertainAddressWrite = { id: string | null; values: AddressWriteInput };

const emptyDraft: Draft = { label: '', recipientName: '', phone: '', addressLine: '', city: '', province: '', postalCode: '' };

export function ServerFarmAddressesSection({ service, farms, onFarmsChanged, backHandlerRef }: {
  service: ServerFarmService;
  farms: ApiFarmRecord[];
  onFarmsChanged: (farms: ApiFarmRecord[]) => void;
  backHandlerRef: { current: (() => boolean) | null };
}) {
  const [addresses, setAddresses] = useState<ApiAddressRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [addressBusy, setAddressBusy] = useState(false);
  const [farmBusyId, setFarmBusyId] = useState<string | null>(null);
  const [addressUncertain, setAddressUncertain] = useState<UncertainAddressWrite | null>(null);
  const [addressConflict, setAddressConflict] = useState(false);
  const [farmUncertain, setFarmUncertain] = useState<{ farmId: string; addressId: string } | null>(null);
  const [discardVisible, setDiscardVisible] = useState(false);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditingId(null);
    setDraft(emptyDraft);
    setDiscardVisible(false);
    setError('');
    setAddressConflict(false);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      service.listAddresses('farmer').then(
        (records) => { if (active) { setAddresses(records); setLoaded(true); setError(''); } },
        (cause) => { if (active) { setAddresses([]); setLoaded(true); setError(messageFor(cause)); } },
      ).finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [service]);

  const formDirty = editingId
    ? addressChanged(addresses.find((address) => address.id === editingId), draft)
    : Object.values(draft).some((value) => typeof value === 'string' && value.trim().length > 0);

  useEffect(() => {
    backHandlerRef.current = () => {
      if (discardVisible) { setDiscardVisible(false); return true; }
      if (addressBusy || farmBusyId) return true;
      if (!formOpen) return false;
      if (formDirty) setDiscardVisible(true);
      else closeForm();
      return true;
    };
    return () => { backHandlerRef.current = null; };
  }, [addressBusy, backHandlerRef, closeForm, discardVisible, farmBusyId, formDirty, formOpen]);

  const refresh = async () => {
    if (loading || addressBusy || farmBusyId) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const [nextAddresses, nextFarms] = await Promise.all([service.listAddresses('farmer'), service.list('farmer')]);
      setAddresses(nextAddresses);
      onFarmsChanged(nextFarms);
      setLoaded(true);
      if (addressUncertain) {
        const saved = addressUncertain.id
          ? nextAddresses.find((item) => item.id === addressUncertain.id && addressMatches(item, addressUncertain.values))
          : nextAddresses.find((item) => addressMatches(item, addressUncertain.values));
        setAddressUncertain(null);
        if (saved) {
          setNotice('Perubahan alamat sudah tersimpan di server.');
          closeForm();
        } else if (addressUncertain.id && nextAddresses.some((item) => item.id === addressUncertain.id)) {
          setAddressConflict(true);
          setNotice('Data alamat berubah di server. Draft ini tidak akan dikirim ulang; muat ulang dan tinjau data terbaru terlebih dahulu.');
        } else {
          setNotice('Alamat dengan isi tersebut belum ditemukan. Periksa daftar sebelum mencoba menyimpan lagi.');
        }
      }
      if (farmUncertain) {
        const saved = nextFarms.find((farm) => farm.id === farmUncertain.farmId && farm.visitAddressId === farmUncertain.addressId);
        setFarmUncertain(null);
        setNotice(saved ? 'Alamat kunjungan Farm sudah diperbarui.' : 'Farm belum memakai alamat yang dipilih. Periksa ulang sebelum mencoba lagi.');
      }
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  };

  const saveAddress = async () => {
    if (addressBusy || addressUncertain || addressConflict) return;
    setAddressBusy(true);
    setError('');
    setNotice('');
    const values = normalizeDraft(draft);
    try {
      if (editingId) {
        const current = addresses.find((address) => address.id === editingId);
        if (!current) throw new DomainError('NOT_FOUND', 'Alamat tidak ditemukan. Muat ulang daftar alamat.');
        const saved = await service.updateAddress('farmer', editingId, { ...values, expectedVersion: current.version });
        setAddresses((currentAddresses) => currentAddresses.map((address) => address.id === saved.id ? saved : address));
        setNotice('Alamat berhasil diperbarui.');
      } else {
        const saved = await service.createAddress('farmer', values);
        setAddresses((currentAddresses) => [saved, ...currentAddresses.filter((address) => address.id !== saved.id)]);
        setNotice('Alamat berhasil disimpan. Pilih alamat tersebut pada Farm untuk menggunakannya saat kunjungan.');
      }
      closeForm();
    } catch (cause) {
      setError(messageFor(cause));
      if (cause instanceof DomainError && cause.code === 'SERVICE_UNAVAILABLE') {
        setAddressUncertain({ id: editingId, values });
      }
    } finally {
      setAddressBusy(false);
    }
  };

  const chooseVisitAddress = async (farmId: string, addressId: string) => {
    if (farmBusyId || addressBusy || farmUncertain) return;
    setFarmBusyId(farmId);
    setError('');
    setNotice('');
    try {
      const saved = await service.setVisitAddress('farmer', farmId, addressId);
      onFarmsChanged(farms.map((farm) => farm.id === saved.id ? saved : farm));
      setNotice('Alamat kunjungan Farm berhasil diperbarui.');
    } catch (cause) {
      setError(messageFor(cause));
      if (cause instanceof DomainError && cause.code === 'SERVICE_UNAVAILABLE') setFarmUncertain({ farmId, addressId });
    } finally {
      setFarmBusyId(null);
    }
  };

  const startEdit = (address: ApiAddressRecord) => {
    setDraft({
      label: address.label,
      recipientName: address.recipientName,
      phone: address.phone,
      addressLine: address.addressLine,
      city: address.city,
      province: address.province,
      postalCode: address.postalCode,
      ...(address.latitude === null ? {} : { latitude: Number(address.latitude), longitude: Number(address.longitude) }),
    });
    setEditingId(address.id);
    setFormOpen(true);
    setAddressConflict(false);
    setError('');
    setNotice('');
  };

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Alamat Farm</Text>
    <Text style={styles.body}>Alamat disimpan pada akun Peternak. Tautkan satu alamat ke setiap Farm untuk dipakai pada booking kunjungan.</Text>
    {loading && !loaded ? <LoadingState label="Memuat alamat tersimpan…" /> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
    {!loading && loaded && addresses.length === 0 ? <Text style={styles.body}>Belum ada alamat tersimpan.</Text> : null}
    {farms.map((farm) => {
      const selected = addresses.find((address) => address.id === farm.visitAddressId) ?? null;
      return <View key={farm.id} style={styles.card}>
        <Text style={styles.cardTitle}>{farm.name}</Text>
        <Text style={styles.body}>{selected ? `${selected.label} · ${selected.addressLine}, ${selected.city}` : 'Alamat kunjungan belum dipilih'}</Text>
        {farmBusyId === farm.id ? <LoadingState label="Menyimpan alamat Farm…" /> : null}
        {addresses.map((address) => <Button key={`${farm.id}:${address.id}`} label={`${address.label} · ${address.city}`} role="farmer" variant="secondary" selected={farm.visitAddressId === address.id} disabled={!!farmBusyId || addressBusy || !!farmUncertain} onPress={() => { void chooseVisitAddress(farm.id, address.id); }} />)}
        {farmUncertain?.farmId === farm.id ? <Text style={styles.body}>Status tautan belum pasti. Muat ulang Farm sebelum mencoba lagi.</Text> : null}
      </View>;
    })}
    {addresses.map((address) => <View key={address.id} style={styles.card}>
      <Text style={styles.cardTitle}>{address.label} · {address.city}</Text>
      <Text style={styles.body}>{address.recipientName} · {address.phone}</Text>
      <Text style={styles.body}>{address.addressLine}, {address.city}, {address.province} {address.postalCode}</Text>
      <Button label={`Ubah alamat ${address.label}`} role="farmer" variant="secondary" disabled={addressBusy || !!addressUncertain || !!farmBusyId} onPress={() => startEdit(address)} />
    </View>)}
    {addressUncertain ? <Text style={styles.body}>Status simpan alamat belum pasti. Muat ulang sebelum mencoba lagi.</Text> : null}
    <Button label={formOpen ? 'Tutup formulir' : 'Tambah alamat'} role="farmer" variant="secondary" disabled={addressBusy || !!farmBusyId} onPress={() => { if (formOpen && formDirty) setDiscardVisible(true); else if (formOpen) closeForm(); else { setDraft(emptyDraft); setEditingId(null); setFormOpen(true); setError(''); setNotice(''); } }} />
    {formOpen ? <View style={styles.form}>
      <Text style={styles.cardTitle}>{editingId ? 'Ubah alamat' : 'Alamat baru'}</Text>
      <TextField label="Label alamat" value={draft.label} onChangeText={(value) => setDraft((current) => ({ ...current, label: value }))} maxLength={80} />
      <TextField label="Nama penerima" value={draft.recipientName} onChangeText={(value) => setDraft((current) => ({ ...current, recipientName: value }))} maxLength={120} />
      <TextField label="Nomor telepon" value={draft.phone} onChangeText={(value) => setDraft((current) => ({ ...current, phone: value }))} keyboardType="phone-pad" maxLength={32} />
      <TextArea label="Alamat lengkap" value={draft.addressLine} onChangeText={(value) => setDraft((current) => ({ ...current, addressLine: value }))} maxLength={500} />
      <TextField label="Kota/kabupaten" value={draft.city} onChangeText={(value) => setDraft((current) => ({ ...current, city: value }))} maxLength={120} />
      <TextField label="Provinsi" value={draft.province} onChangeText={(value) => setDraft((current) => ({ ...current, province: value }))} maxLength={120} />
      <TextField label="Kode pos" value={draft.postalCode} onChangeText={(value) => setDraft((current) => ({ ...current, postalCode: value }))} maxLength={16} />
      <Button label={editingId ? 'Simpan perubahan alamat' : 'Simpan alamat'} role="farmer" onPress={saveAddress} loading={addressBusy} disabled={addressUncertain !== null || addressConflict} />
      {addressConflict ? <Text style={styles.error}>Simpan diblokir sampai data server ditinjau.</Text> : null}
      {addressConflict ? <Button label="Buang draft dan tutup" role="farmer" variant="secondary" onPress={() => setDiscardVisible(true)} /> : null}
      <Button label="Batal" role="farmer" variant="secondary" disabled={addressBusy} onPress={() => formDirty ? setDiscardVisible(true) : closeForm()} />
    </View> : null}
    <Button label="Muat ulang alamat dan Farm" role="farmer" variant="secondary" disabled={loading || !!addressBusy || !!farmBusyId} onPress={() => { void refresh(); }} />
    <ConfirmationDialog visible={discardVisible} title="Buang perubahan alamat?" message="Perubahan yang belum disimpan akan hilang." role="farmer" confirmLabel="Buang" cancelLabel="Tetap Mengedit" onConfirm={closeForm} onCancel={() => setDiscardVisible(false)} destructive />
  </View>;
}

function normalizeDraft(draft: Draft): AddressWriteInput {
  return {
    label: draft.label.trim(),
    recipientName: draft.recipientName.trim(),
    phone: draft.phone.trim(),
    addressLine: draft.addressLine.trim(),
    city: draft.city.trim(),
    province: draft.province.trim(),
    postalCode: draft.postalCode.trim(),
    ...(draft.latitude === undefined ? {} : { latitude: draft.latitude, longitude: draft.longitude }),
  };
}

function addressMatches(record: ApiAddressRecord, values: AddressWriteInput): boolean {
  return record.label === values.label && record.recipientName === values.recipientName && record.phone === values.phone
    && record.addressLine === values.addressLine && record.city === values.city && record.province === values.province
    && record.postalCode === values.postalCode;
}

function addressChanged(current: ApiAddressRecord | undefined, draft: Draft): boolean {
  return !current || !addressMatches(current, normalizeDraft(draft));
}

function messageFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Alamat belum dapat dimuat. Coba lagi.';
}

const styles = StyleSheet.create({
  section: { gap: spacing[4] },
  heading: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.section },
  body: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21 },
  card: { backgroundColor: colors.white, borderRadius: 14, padding: spacing[4], gap: spacing[2] },
  form: { gap: spacing[3] },
  cardTitle: { color: colors.dark, fontFamily: fonts.semiBold, fontSize: typeScale.body },
  error: { color: colors.orange, fontFamily: fonts.medium, fontSize: typeScale.body },
});
