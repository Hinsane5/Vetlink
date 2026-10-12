import { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { LocalStore } from '../../data/local/sqlite/LocalStore';
import type { AccountRole, SessionSnapshot } from '../../domain/auth';
import type { DashboardConsultationItem, DashboardContextDetail, DashboardSnapshot, FarmerDashboardSnapshot, VetDashboardSnapshot } from '../../domain/dashboard';
import type { ReminderSnapshot } from '../../domain/careCoordination';
import { DomainError } from '../../domain/errors';
import { AppointmentRow } from '../components/AppointmentRow';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, InlineFeedback, LoadingState } from '../components/Feedback';
import { Icon, type IconName } from '../components/Icon';
import { StatusBadge, type StatusTone } from '../components/StatusBadge';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { LivestockFlow, type LivestockRoute } from '../livestock/LivestockFlow';
import { PatientFlow } from '../patients/PatientFlow';
import { VetScheduleFlow } from '../availability/VetScheduleFlow';
import { ConsultationFlow } from '../consultations/ConsultationFlow';
import { ClinicalNoteFlow } from '../consultations/ClinicalNoteFlow';
import { RecommendationFlow } from '../consultations/RecommendationFlow';
import { CareCoordinationFlow } from '../consultations/CareCoordinationFlow';
import { ChatFlow } from '../chat/ChatFlow';
import { BookingFlow } from '../booking/BookingFlow';
import { VetDirectoryFlow } from '../directory/VetDirectoryFlow';
import { MarketplaceFlow, type MarketplaceRoute } from '../marketplace/MarketplaceFlow';
import { colors, fonts, layout, radii, roleTokens, spacing, typeScale } from '../theme/tokens';

type DashboardRoute =
  | { type: 'home' }
  | { type: 'list'; kind: 'consultations' | 'appointments' }
  | { type: 'detail'; kind: 'consultation' | 'reminder'; id: string }
  | { type: 'chat'; consultationId: string }
  | { type: 'clinicalNote'; consultationId: string }
  | { type: 'recommendation'; consultationId: string }
  | { type: 'care'; consultationId: string }
  | { type: 'patients'; patientId?: string }
  | { type: 'doctors'; vetId?: string }
  | { type: 'booking'; vetId: string }
  | { type: 'schedule' }
  | MarketplaceRoute
  | LivestockRoute;

type Props = {
  store: LocalStore;
  session: SessionSnapshot;
  onOpenProfile: () => void;
  onSwitchRole: () => void;
  onLogout?: () => void;
};

export function DashboardFlow({ store, session, onOpenProfile, onSwitchRole, onLogout }: Props) {
  const role = session.activeRole;
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [route, setRoute] = useState<DashboardRoute>({ type: 'home' });
  const [detail, setDetail] = useState<DashboardContextDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);

  const reload = useCallback(async () => {
    setError('');
    try {
      const next = await store.dashboard.load(session.userId, role);
      setSnapshot(next);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }, [role, session.userId, store]);

  useEffect(() => {
    const request = setTimeout(() => { void reload(); }, 0);
    return () => clearTimeout(request);
  }, [reload]);

  useEffect(() => {
    if (route.type !== 'detail' || route.kind === 'consultation') return;
    let mounted = true;
    store.dashboard.loadContext(session.userId, role, route.kind, route.id).then((next) => {
      if (mounted) setDetail(next);
    }).catch((cause: unknown) => {
      if (mounted) setDetailError(messageFor(cause));
    }).finally(() => {
      if (mounted) setDetailLoading(false);
    });
    return () => { mounted = false; };
  }, [role, route, session.userId, store]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menuVisible) {
        setMenuVisible(false);
        return true;
      }
      if (route.type === 'patients') {
        setRoute(route.patientId ? { type: 'patients' } : { type: 'home' });
        return true;
      }
      if (route.type === 'doctors') {
        setRoute(route.vetId ? { type: 'doctors' } : { type: 'home' });
        return true;
      }
      if (route.type === 'livestock' || route.type === 'booking' || route.type === 'list' || route.type === 'recommendation' || route.type === 'marketplace' || route.type === 'care' || (route.type === 'detail' && route.kind === 'consultation')) return false;
      if (route.type !== 'home') {
        setRoute({ type: 'home' });
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [menuVisible, route]);

  const openContext = (kind: 'consultation' | 'reminder', id: string) => {
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    setRoute({ type: 'detail', kind, id });
  };
  const changeAvailability = async (accepting: boolean) => {
    setAvailabilityBusy(true);
    setError('');
    try {
      await store.dashboard.setAvailability(session.userId, accepting);
      await reload();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setAvailabilityBusy(false);
    }
  };

  if (loading && !snapshot) return <View style={styles.fullScreen}><LoadingState label="Memuat beranda…" /></View>;
  if (!snapshot) {
    return (
      <View style={styles.fullScreen}>
        <ErrorState message={error || 'Ringkasan belum dapat dimuat.'} role={role} onRetry={() => { setLoading(true); void reload(); }} />
      </View>
    );
  }

  return (
    <View style={styles.fullScreen}>
      {route.type === 'clinicalNote' ? (
        <ClinicalNoteFlow key={route.consultationId} store={store} session={session} consultationId={route.consultationId} onExit={() => setRoute({ type: 'detail', kind: 'consultation', id: route.consultationId })} />
      ) : route.type === 'recommendation' ? (
        <RecommendationFlow key={route.consultationId} store={store} session={session} consultationId={route.consultationId} onExit={() => setRoute({ type: 'detail', kind: 'consultation', id: route.consultationId })} />
      ) : route.type === 'marketplace' ? (
        <MarketplaceFlow key={`${route.recommendationId}:${route.productId ?? 'catalog'}`} store={store} session={session} route={route} onExit={() => setRoute({ type: 'detail', kind: 'consultation', id: route.consultationId })} />
      ) : route.type === 'care' ? (
        <CareCoordinationFlow key={route.consultationId} store={store} session={session} consultationId={route.consultationId} onExit={() => setRoute({ type: 'detail', kind: 'consultation', id: route.consultationId })} />
      ) : route.type === 'chat' ? (
        <ChatFlow key={route.consultationId} store={store} session={session} consultationId={route.consultationId} onExit={() => setRoute({ type: 'detail', kind: 'consultation', id: route.consultationId })} />
      ) : route.type === 'schedule' ? (
        <VetScheduleFlow store={store} session={session} onExit={() => { setRoute({ type: 'home' }); void reload(); }} />
      ) : route.type === 'list' || (route.type === 'detail' && route.kind === 'consultation') ? (
        <ConsultationFlow key={route.type === 'detail' ? route.id : route.kind} store={store} session={session} initialId={route.type === 'detail' ? route.id : undefined} initialTab={route.type === 'list' && route.kind === 'appointments' ? 'appointments' : 'requests'} onExit={() => { setRoute({ type: 'home' }); void reload(); }} onOpenAnimal={(id) => setRoute(role === 'vet' ? { type: 'patients', patientId: id } : { type: 'livestock', screen: 'detail', livestockId: id })} onOpenChat={(consultationId) => setRoute({ type: 'chat', consultationId })} onOpenClinicalNote={(consultationId) => setRoute({ type: 'clinicalNote', consultationId })} onOpenRecommendation={(consultationId) => setRoute({ type: 'recommendation', consultationId })} onOpenCare={(consultationId) => setRoute({ type: 'care', consultationId })} onOpenMarketplace={(context) => setRoute({ type: 'marketplace', ...context, entry: context.productId ? 'recommendation' : 'catalog' })} />
      ) : route.type === 'booking' ? (
        <BookingFlow store={store} userId={session.userId} vetId={route.vetId} onBack={() => setRoute({ type: 'doctors', vetId: route.vetId })} onComplete={(id) => { void reload(); openContext('consultation', id); }} />
      ) : route.type === 'livestock' ? (
        <LivestockFlow
          store={store}
          session={session}
          route={route}
          onNavigate={setRoute}
          onExit={() => setRoute({ type: 'home' })}
          onOpenProfile={onOpenProfile}
        />
      ) : route.type === 'doctors' ? (
        <VetDirectoryFlow store={store} onBook={(vetId) => setRoute({ type: 'booking', vetId })} vetId={route.vetId} onOpenVet={(vetId) => setRoute({ type: 'doctors', vetId })} onBack={() => setRoute(route.vetId ? { type: 'doctors' } : { type: 'home' })} />
      ) : (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {route.type === 'home' ? (
          snapshot.role === 'farmer'
            ? <FarmerDashboard snapshot={snapshot} error={error} onOpenMenu={() => setMenuVisible(true)} onOpenList={(kind) => setRoute({ type: 'list', kind })} onAddLivestock={() => setRoute({ type: 'livestock', screen: 'form', mode: 'create', returnTo: 'list' })} onOpenContext={openContext} />
            : <VetDashboard snapshot={snapshot} error={error} availabilityBusy={availabilityBusy} onAvailability={(value) => void changeAvailability(value)} onOpenList={(kind) => setRoute({ type: 'list', kind })} onOpenContext={openContext} onOpenMenu={() => setMenuVisible(true)} />
        ) : null}
        {route.type === 'detail' ? (
          <DashboardDetail
            key={`${route.kind}:${route.id}`}
            store={store}
            userId={session.userId}
            role={role}
            detail={detail}
            loading={detailLoading}
            error={detailError}
            onCareCompleted={() => { void reload(); }}
            onBack={() => setRoute({ type: 'home' })}
            onRetry={() => {
              setDetail(null);
              setDetailError('');
              setDetailLoading(true);
              setRoute({ ...route });
            }}
          />
        ) : null}
        {route.type === 'patients' ? (
          <PatientFlow
            store={store}
            session={session}
            patientId={route.patientId}
            onOpenPatient={(animalId) => setRoute({ type: 'patients', patientId: animalId })}
            onBackToList={() => setRoute({ type: 'patients' })}
          />
        ) : null}
      </ScrollView>
      )}
      {route.type !== 'booking' && route.type !== 'schedule' && route.type !== 'list' && route.type !== 'chat' && route.type !== 'clinicalNote' && route.type !== 'recommendation' && route.type !== 'marketplace' && route.type !== 'care' && !(route.type === 'detail' && route.kind === 'consultation') && !(route.type === 'patients' && route.patientId) && !(route.type === 'livestock' && route.screen !== 'list') && !(route.type === 'doctors' && route.vetId) ? (
        <BottomNavigation role={role} route={route} onSelect={(next) => setRoute(next)} onOpenProfile={onOpenProfile} />
      ) : null}
      <AccountMenu
        visible={menuVisible}
        role={role}
        onClose={() => setMenuVisible(false)}
        onProfile={() => { setMenuVisible(false); onOpenProfile(); }}
        onSwitchRole={() => { setMenuVisible(false); onSwitchRole(); }}
        onLogout={onLogout ? () => { setMenuVisible(false); onLogout(); } : undefined}
      />
    </View>
  );
}

function FarmerDashboard({ snapshot, error, onOpenMenu, onOpenList, onAddLivestock, onOpenContext }: {
  snapshot: FarmerDashboardSnapshot;
  error: string;
  onOpenMenu: () => void;
  onOpenList: (kind: 'consultations') => void;
  onAddLivestock: () => void;
  onOpenContext: (kind: 'consultation' | 'reminder', id: string) => void;
}) {
  const reminder = snapshot.nextReminder;
  return (
    <View style={styles.dashboard}>
      <View style={styles.farmerHeader}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.farmerGreeting}>{greeting()}, {snapshot.displayName}</Text>
          <Text style={styles.farmLocation}>
            {snapshot.farmName || 'Peternakan belum dilengkapi'}
            {snapshot.farmLocation ? ` · ${snapshot.farmLocation}` : ''}
          </Text>
        </View>
        <RoundAction label="Buka menu akun" icon="user-round" onPress={onOpenMenu} />
      </View>

      {error ? <InlineFeedback message={error} tone="error" /> : null}

      <View style={styles.metricsRow}>
        <MetricCard value={String(snapshot.totalLivestock)} label="Ternak" />
        <MetricCard value={String(snapshot.activeConsultationCount)} label="Konsultasi aktif" />
        <MetricCard value={reminder ? `${snapshot.nextReminderDays ?? 0} hari` : '—'} label="Pengingat" />
      </View>

      <View style={styles.actionRow}>
        <Button label="Tambah ternak" role="farmer" variant="accent" onPress={onAddLivestock} style={styles.actionButton} />
        <Button label="Konsultasi saya" role="farmer" onPress={() => onOpenList('consultations')} style={styles.actionButton} />
      </View>

      {reminder ? (
        <View style={styles.reminderCard}>
          <View style={styles.reminderTop}>
            <Text style={styles.cardTitle}>
              {reminder.kind === 'follow_up' ? 'Tindak lanjut' : reminder.instructions || 'Pengingat perawatan'}
            </Text>
            <StatusBadge label={reminder.deliveryStatus === 'sent' ? 'Terkirim' : 'Belum dikirim'} role="farmer" tone={reminder.deliveryStatus === 'sent' ? 'success' : 'pending'} />
          </View>
          <Text style={styles.cardBody}>{reminder.animalName} · Jatuh tempo {formatDate(reminder.dueAt)}</Text>
          {reminder.instructions && reminder.kind === 'follow_up' ? <Text style={styles.cardBody}>{reminder.instructions}</Text> : null}
          <Button label="Lihat pengingat" role="farmer" variant="secondary" onPress={() => onOpenContext('reminder', reminder.id)} />
        </View>
      ) : (
        <EmptyState title="Belum ada pengingat" description="Pengingat perawatan dan tindak lanjut akan tampil di sini." role="farmer" style={styles.inlineEmpty} />
      )}

      <SectionHeader title="Konsultasi terbaru" actionLabel="Lihat semua" onAction={() => onOpenList('consultations')} />
      {snapshot.upcomingConsultations.length ? (
        <View style={styles.rows}>
          {snapshot.upcomingConsultations.map((item) => (
            <AppointmentRow
              key={item.id}
              role="farmer"
              title={item.otherPartyName}
              description={`${item.animalName} · ${serviceTypeLabel(item.type)}`}
              dateLabel={formatDateTime(item.startsAt)}
              statusLabel={consultationStatusLabel(item.status)}
              statusTone={statusTone(item.status)}
              leading={<LeadingIcon icon="stethoscope" role="farmer" />}
              onPress={() => onOpenContext('consultation', item.id)}
            />
          ))}
        </View>
      ) : (
        <EmptyState title="Belum ada konsultasi aktif" description="Permintaan dan jadwal aktif akan muncul setelah Anda membuat konsultasi." role="farmer" style={styles.inlineEmpty} />
      )}
    </View>
  );
}

function VetDashboard({ snapshot, error, availabilityBusy, onAvailability, onOpenList, onOpenContext, onOpenMenu }: {
  snapshot: VetDashboardSnapshot;
  error: string;
  availabilityBusy: boolean;
  onAvailability: (value: boolean) => void;
  onOpenList: (kind: 'consultations' | 'appointments') => void;
  onOpenContext: (kind: 'consultation', id: string) => void;
  onOpenMenu: () => void;
}) {
  const verified = snapshot.verificationStatus === 'verified';
  const priority = snapshot.newRequests[0];
  return (
    <View style={styles.dashboard}>
      <View style={styles.vetHeader}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.vetPageTitle}>Beranda</Text>
          <Text style={styles.vetGreeting}>Selamat {greeting().toLowerCase()},</Text>
          <Text style={styles.vetName}>{snapshot.displayName}</Text>
        </View>
        <RoundAction label="Menu akun" icon="ellipsis" onPress={onOpenMenu} />
      </View>

      <Text style={styles.dateHeading}>{formatLongDate(new Date())}</Text>
      {error ? <InlineFeedback message={error} tone="error" /> : null}

      <View style={styles.availabilityCard}>
        <View style={styles.availabilityCopy}>
          <Text style={styles.cardTitle}>Menerima layanan</Text>
          <Text style={styles.cardBody}>Janji yang diterima tetap berjalan meski penerimaan layanan dimatikan.</Text>
          {!verified ? <Text style={styles.verificationHint}>{verificationLabel(snapshot.verificationStatus)} · Ajukan verifikasi dari profil untuk menerima layanan baru.</Text> : null}
        </View>
        <Switch
          accessibilityLabel="Menerima layanan baru"
          accessibilityHint="Mengubah ketersediaan untuk permintaan baru. Janji yang telah diterima tidak berubah."
          value={snapshot.acceptingNewRequests}
          onValueChange={onAvailability}
          disabled={!verified || availabilityBusy}
          trackColor={{ false: '#CDBFA7', true: colors.brown }}
          thumbColor={snapshot.acceptingNewRequests ? colors.white : '#F5F1E8'}
        />
      </View>

      <SectionHeader title="Prioritas kerja" actionLabel="Lihat semua" onAction={() => onOpenList('consultations')} />
      {priority ? (
        <View style={styles.priorityCard}>
          <Text style={styles.priorityCount}>{snapshot.newRequests.length} permintaan baru</Text>
          <Text style={styles.priorityTitle}>{priority.otherPartyName} · {priority.animalName}</Text>
          <Text style={styles.cardBody}>{priority.complaint || 'Keluhan belum ditambahkan.'}</Text>
          <Text style={styles.cardBody}>{serviceTypeLabel(priority.type)} · {formatTimeRange(priority.startsAt, priority.endsAt)}</Text>
          <Button label="Lihat Permintaan" role="vet" onPress={() => onOpenContext('consultation', priority.id)} />
        </View>
      ) : (
        <EmptyState title="Tidak ada permintaan baru" description="Permintaan layanan baru akan tampil di sini." role="vet" style={styles.inlineEmpty} />
      )}

      <SectionHeader title="Agenda hari ini" actionLabel="Jadwal" onAction={() => onOpenList('appointments')} />
      {snapshot.todayAppointments.length ? (
        <View style={styles.rows}>
          {snapshot.todayAppointments.map((item) => (
            <VetAgendaRow key={item.id} item={item} onPress={() => onOpenContext('consultation', item.id)} />
          ))}
        </View>
      ) : (
        <EmptyState
          title="Tidak ada janji hari ini"
          description={snapshot.acceptingNewRequests ? 'Janji yang diterima akan muncul di agenda.' : 'Janji yang sudah diterima tetap berjalan dan akan muncul di agenda.'}
          role="vet"
          style={styles.inlineEmpty}
        />
      )}

      {snapshot.upcomingAppointments.some((item) => !snapshot.todayAppointments.some((today) => today.id === item.id)) ? (
        <View style={styles.upcomingSection}>
          <SectionHeader title="Agenda mendatang" actionLabel="Lihat jadwal" onAction={() => onOpenList('appointments')} />
          <View style={styles.rows}>
            {snapshot.upcomingAppointments
              .filter((item) => !snapshot.todayAppointments.some((today) => today.id === item.id))
              .slice(0, 2)
              .map((item) => <VetAgendaRow key={item.id} item={item} onPress={() => onOpenContext('consultation', item.id)} />)}
          </View>
        </View>
      ) : null}

      <View style={styles.balanceCard}>
        <View style={styles.balanceIcon}><Icon name="wallet" size={22} color={colors.brown} /></View>
        <View style={styles.balanceCopy}>
          <Text style={styles.cardBody}>Saldo tersedia</Text>
          <Text style={styles.balanceAmount}>{formatRupiah(snapshot.availableBalance)}</Text>
          <Text style={styles.balancePending}>Pendapatan menunggu: {formatRupiah(snapshot.pendingBalance)}</Text>
        </View>
      </View>
    </View>
  );
}

function VetAgendaRow({ item, onPress }: { item: DashboardConsultationItem; onPress: () => void }) {
  return (
    <AppointmentRow
      role="vet"
      title={`${formatTime(item.startsAt)} · ${item.type === 'visit' ? 'Kunjungan' : 'Konsultasi chat'}`}
      description={`${item.otherPartyName} · ${item.animalName} · ${item.displayCode}`}
      dateLabel={item.visitAddress || consultationStatusLabel(item.status)}
      statusLabel={consultationStatusLabel(item.status)}
      statusTone={statusTone(item.status)}
      leading={<LeadingIcon icon={item.type === 'visit' ? 'map-pin' : 'message-square'} role="vet" />}
      onPress={onPress}
    />
  );
}

function DashboardDetail({ store, userId, role, detail, loading, error, onBack, onRetry, onCareCompleted }: {
  store: LocalStore;
  userId: string;
  role: AccountRole;
  detail: DashboardContextDetail | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onRetry: () => void;
  onCareCompleted: () => void;
}) {
  const [reminderResult, setReminderResult] = useState<{ id: string; reminder: ReminderSnapshot | null; error: string }>({ id: '', reminder: null, error: '' });
  const [careBusy, setCareBusy] = useState(false);
  const [confirmCare, setConfirmCare] = useState(false);
  useEffect(() => {
    if (role !== 'farmer' || detail?.kind !== 'reminder') return;
    let mounted = true;
    store.careCoordination.getReminder(userId, detail.id).then((next) => {
      if (mounted) setReminderResult({ id: detail.id, reminder: next, error: '' });
    }).catch((cause: unknown) => {
      if (mounted) setReminderResult({ id: detail.id, reminder: null, error: messageFor(cause) });
    });
    return () => { mounted = false; };
  }, [detail?.id, detail?.kind, role, store, userId]);
  const reminder = reminderResult.id === detail?.id ? reminderResult.reminder : null;
  const reminderError = reminderResult.id === detail?.id ? reminderResult.error : '';
  const completeCare = async () => {
    if (!reminder || careBusy) return;
    setCareBusy(true);
    try {
      const completed = await store.careCoordination.completeCare(userId, reminder.record.id);
      setReminderResult({ id: detail?.id ?? reminder.record.id, reminder: completed, error: '' }); setConfirmCare(false); onCareCompleted();
    } catch (cause) { setReminderResult({ id: detail?.id ?? reminder.record.id, reminder, error: messageFor(cause) }); }
    finally { setCareBusy(false); }
  };
  return (
    <View style={styles.listScreen}>
      <View style={styles.routeHeader}>
        <RoundAction label="Kembali ke beranda" icon="arrow-left" onPress={onBack} />
        <Text accessibilityRole="header" style={styles.routeTitle}>{detail?.kind === 'reminder' ? 'Detail pengingat' : 'Detail layanan'}</Text>
        <View style={styles.headerSpacer} />
      </View>
      {loading ? <LoadingState label="Memuat detail…" /> : null}
      {error ? <ErrorState message={error} role={role} onRetry={onRetry} /> : null}
      {detail ? (
        <View style={styles.detailCard}>
          <View style={styles.detailTitleRow}>
            <Text accessibilityRole="header" style={styles.detailTitle}>{detail.title}</Text>
            <StatusBadge label={detail.statusLabel} role={role} tone={statusTone(detail.status)} />
          </View>
          {detail.otherPartyName ? <DetailLine label={role === 'vet' ? 'Peternak' : 'Dokter'} value={detail.otherPartyName} /> : null}
          <DetailLine label="Ternak" value={detail.animalName} />
          {detail.dateLabel ? <DetailLine label={detail.kind === 'reminder' ? 'Jatuh tempo' : 'Waktu layanan'} value={formatDateTime(detail.dateLabel)} /> : null}
          <DetailLine label={detail.kind === 'reminder' ? 'Instruksi' : 'Keluhan'} value={detail.description || 'Belum ada keterangan.'} />
          {detail.kind === 'reminder' && role === 'farmer' ? <>
            {reminderError ? <InlineFeedback message={reminderError} tone="error" /> : null}
            {reminder ? <>
              <DetailLine label="Status pengiriman" value={reminder.deliveryStatus === 'sent' ? 'Terkirim' : reminder.deliveryStatus === 'failed' ? 'Gagal' : 'Belum terkirim'} />
              <DetailLine label="Status perawatan" value={reminder.careStatus === 'done' ? `Dilakukan${reminder.completedAt ? ` · ${formatDateTime(reminder.completedAt)}` : ''}` : 'Belum dikonfirmasi'} />
              {reminder.deliveryStatus === 'sent' && reminder.careStatus === 'scheduled' ? <InlineFeedback message="Pengingat terkirim; perawatan belum dinyatakan dilakukan." /> : null}
              {reminder.kind === 'care' && reminder.careStatus === 'scheduled' ? <Button role={role} label="Tandai perawatan dilakukan" variant="secondary" disabled={careBusy} onPress={() => setConfirmCare(true)} /> : null}
            </> : null}
          </> : null}
          {detail.feeAmount !== undefined ? <DetailLine label="Biaya layanan" value={formatRupiah(detail.feeAmount)} /> : null}
          {detail.status === 'awaiting_payment' ? <InlineFeedback message="Menunggu pembayaran. Booking belum menjadi janji diterima dan chat belum dibuka." /> : null}
          {detail.visitAddress ? <DetailLine label="Alamat kunjungan" value={detail.visitAddress} /> : null}
        </View>
      ) : null}
      <ConfirmationDialog visible={confirmCare} role={role} title="Konfirmasi perawatan" message="Tandai perawatan sebagai dilakukan? Status pengiriman pengingat tetap terpisah; satu catatan perawatan akan ditambahkan ke riwayat kesehatan." confirmLabel="Tandai dilakukan" loading={careBusy} onCancel={() => setConfirmCare(false)} onConfirm={() => { void completeCare(); }} />
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function MetricCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <Pressable accessibilityRole="button" onPress={onAction} style={styles.sectionAction}>
        <Text style={styles.sectionActionText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

function LeadingIcon({ icon, role }: { icon: IconName; role: AccountRole }) {
  return (
    <View style={[styles.leadingIcon, { backgroundColor: role === 'farmer' ? colors.orange : colors.cream }]}>
      <Icon name={icon} size={22} color={role === 'farmer' ? colors.white : colors.brown} />
    </View>
  );
}

function RoundAction({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.roundAction}>
      <Icon name={icon} size={21} color={colors.brown} />
    </Pressable>
  );
}

function BottomNavigation({ role, route, onSelect, onOpenProfile }: {
  role: AccountRole;
  route: DashboardRoute;
  onSelect: (route: DashboardRoute) => void;
  onOpenProfile: () => void;
}) {
  const active = route.type === 'home' || route.type === 'chat' || route.type === 'clinicalNote' || route.type === 'recommendation' || route.type === 'care' ? 'home' : route.type === 'marketplace' ? 'consultations' : route.type === 'schedule' ? 'appointments' : route.type === 'patients' ? 'patients' : route.type === 'livestock' ? 'livestock' : route.type === 'doctors' || route.type === 'booking' ? 'consultations' : route.type === 'detail' ? 'home' : route.kind;
  const tabs: { key: string; label: string; icon: IconName; route?: DashboardRoute; action?: () => void; disabled?: boolean }[] = role === 'farmer'
    ? [
      { key: 'home', label: 'Beranda', icon: 'house', route: { type: 'home' } },
      { key: 'livestock', label: 'Ternak', icon: 'paw-print', route: { type: 'livestock', screen: 'list' } },
      { key: 'consultations', label: 'Konsultasi', icon: 'message-square', route: { type: 'doctors' } },
      { key: 'orders', label: 'Pesanan', icon: 'package', disabled: true },
      { key: 'profile', label: 'Profil', icon: 'user-round', action: onOpenProfile },
    ]
    : [
      { key: 'home', label: 'Beranda', icon: 'house', route: { type: 'home' } },
      { key: 'appointments', label: 'Jadwal', icon: 'calendar-days', route: { type: 'schedule' } },
      { key: 'consultations', label: 'Konsultasi', icon: 'message-square', route: { type: 'list', kind: 'consultations' } },
      { key: 'patients', label: 'Pasien', icon: 'notebook-tabs', route: { type: 'patients' } },
      { key: 'profile', label: 'Profil', icon: 'user-round', action: onOpenProfile },
    ];

  return (
    <View style={[styles.bottomNavigation, { minHeight: roleTokens[role].navigationHeight }]}>
      {tabs.map((tab) => {
        const selected = tab.key === active || (active === 'consultations' && tab.key === 'consultations') || (active === 'appointments' && tab.key === 'appointments');
        const disabled = Boolean(tab.disabled);
        const onPress = tab.action ?? (tab.route ? () => onSelect(tab.route!) : undefined);
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={onPress}
            style={styles.navTab}
          >
            <Icon name={tab.icon} size={22} color={disabled ? '#A89B8A' : selected ? colors.gold : colors.white} />
            <Text style={[styles.navLabel, { color: disabled ? '#A89B8A' : selected ? colors.gold : colors.white }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AccountMenu({ visible, role, onClose, onProfile, onSwitchRole, onLogout }: {
  visible: boolean;
  role: AccountRole;
  onClose: () => void;
  onProfile: () => void;
  onSwitchRole: () => void;
  onLogout?: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.menuCard}>
          <Text accessibilityRole="header" style={styles.menuTitle}>Menu VetLink</Text>
          <Button label="Profil" role={role} onPress={onProfile} />
          <Button label="Ganti Peran" role={role} variant="secondary" onPress={onSwitchRole} />
          {onLogout ? <Button label="Keluar" role={role} variant="secondary" onPress={onLogout} /> : null}
          <Button label="Tutup" role={role} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta',
  }).format(date);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Waktu belum ditentukan';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

function formatTime(value: string | null): string {
  if (!value) return 'Jadwal';
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value));
}

function formatTimeRange(startsAt: string | null, endsAt: string | null): string {
  return endsAt ? `${formatTime(startsAt)}–${formatTime(endsAt)}` : formatDateTime(startsAt);
}

function serviceTypeLabel(type: DashboardConsultationItem['type']): string {
  return type === 'visit' ? 'Kunjungan' : type === 'chat' ? 'Konsultasi chat' : 'Layanan';
}

function consultationStatusLabel(status: string): string {
  switch (status) {
    case 'requested': return 'Menunggu dokter';
    case 'awaiting_payment': return 'Menunggu pembayaran';
    case 'scheduled': return 'Terjadwal';
    case 'reschedule_pending': return 'Menunggu respons jadwal';
    case 'in_progress': return 'Berlangsung';
    case 'completed': return 'Selesai';
    case 'rejected': return 'Ditolak';
    case 'cancelled': return 'Dibatalkan';
    default: return status;
  }
}

function statusTone(status: string): StatusTone {
  if (status === 'in_progress' || status === 'completed' || status === 'verified' || status === 'done') return 'success';
  if (status === 'rejected' || status === 'cancelled' || status === 'revision_required') return 'error';
  if (status === 'requested' || status === 'scheduled' || status === 'pending' || status === 'not_submitted') return 'pending';
  return 'default';
}

function verificationLabel(status: VetDashboardSnapshot['verificationStatus']): string {
  switch (status) {
    case 'not_submitted': return 'Belum diajukan';
    case 'pending': return 'Menunggu verifikasi';
    case 'revision_required': return 'Perlu revisi';
    case 'verified': return 'Terverifikasi';
  }
}

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

function messageFor(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  return 'Data dashboard belum dapat dimuat. Periksa penyimpanan lokal lalu coba lagi.';
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: colors.cream },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center', paddingHorizontal: spacing[5], paddingTop: spacing[3], paddingBottom: spacing[5] },
  dashboard: { width: '100%', maxWidth: 430, gap: spacing[4] },
  farmerHeader: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  vetHeader: { minHeight: 104, flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  headerCopy: { flex: 1, minWidth: 0, gap: spacing[1] },
  farmerGreeting: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.title, lineHeight: 32, flexShrink: 1 },
  farmLocation: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 19, flexShrink: 1 },
  vetPageTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 28 },
  vetGreeting: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 20, marginTop: spacing[2] },
  vetName: { color: colors.brown, fontFamily: fonts.bold, fontSize: 27, lineHeight: 34, flexShrink: 1 },
  roundAction: { width: 52, minHeight: 52, borderRadius: radii.button, borderWidth: 1, borderColor: colors.brown, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: layout.minimumTouchTarget },
  metricsRow: { flexDirection: 'row', gap: spacing[2] },
  metricCard: { flex: 1, minWidth: 0, minHeight: 68, gap: spacing[1], paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radii.cardFarmer, backgroundColor: colors.white },
  metricValue: { color: colors.brown, fontFamily: fonts.bold, fontSize: 18, lineHeight: 23, flexShrink: 1 },
  metricLabel: { color: colors.muted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 14, flexShrink: 1 },
  actionRow: { flexDirection: 'row', gap: spacing[2] },
  actionButton: { flex: 1, minWidth: 0, paddingHorizontal: spacing[2] },
  reminderCard: { gap: spacing[2], padding: spacing[4], borderRadius: radii.cardFarmer, backgroundColor: colors.white },
  reminderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] },
  cardTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.body, lineHeight: 21, flexShrink: 1 },
  cardBody: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 21, flexShrink: 1 },
  sectionHeader: { minHeight: layout.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  sectionTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.section, lineHeight: 24, flexShrink: 1 },
  sectionAction: { minHeight: layout.minimumTouchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[2] },
  sectionActionText: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.small },
  rows: { gap: roleTokens.farmer.cardGap },
  inlineEmpty: { alignSelf: 'stretch', paddingVertical: spacing[4], paddingHorizontal: spacing[3], borderRadius: radii.cardFarmer, backgroundColor: colors.white },
  leadingIcon: { width: 54, height: 54, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  dateHeading: { color: colors.dark, fontFamily: fonts.medium, fontSize: typeScale.body, lineHeight: 21 },
  availabilityCard: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[4], borderRadius: radii.cardVet, backgroundColor: colors.white },
  availabilityCopy: { flex: 1, gap: spacing[1], minWidth: 0 },
  verificationHint: { color: colors.muted, fontFamily: fonts.medium, fontSize: typeScale.small, lineHeight: 18, flexShrink: 1 },
  priorityCard: { gap: spacing[3], padding: spacing[4], borderRadius: radii.cardVet, backgroundColor: colors.white },
  priorityCount: { color: colors.brown, fontFamily: fonts.medium, fontSize: typeScale.small },
  priorityTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 28, flexShrink: 1 },
  upcomingSection: { gap: spacing[2] },
  balanceCard: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[4], borderRadius: radii.cardVet, backgroundColor: colors.white },
  balanceIcon: { width: 48, height: 48, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  balanceCopy: { flex: 1, gap: spacing[1], minWidth: 0 },
  balanceAmount: { color: colors.brown, fontFamily: fonts.bold, fontSize: 22, lineHeight: 29, flexShrink: 1 },
  balancePending: { color: colors.muted, fontFamily: fonts.regular, fontSize: typeScale.small, lineHeight: 18, flexShrink: 1 },
  listScreen: { width: '100%', maxWidth: 430, gap: spacing[4], flex: 1 },
  routeHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  routeTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.heading, textAlign: 'center', flexShrink: 1 },
  detailCard: { gap: spacing[4], padding: spacing[4], borderRadius: roleTokens.farmer.cardRadius, backgroundColor: colors.white },
  detailTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[2] },
  detailTitle: { color: colors.brown, fontFamily: fonts.bold, fontSize: typeScale.heading, lineHeight: 28, flexShrink: 1 },
  detailLine: { gap: spacing[1] },
  detailLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: typeScale.small },
  detailValue: { color: colors.dark, fontFamily: fonts.regular, fontSize: typeScale.body, lineHeight: 22, flexShrink: 1 },
  bottomNavigation: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: spacing[2], paddingTop: spacing[2], paddingBottom: spacing[2], backgroundColor: colors.brown },
  navTab: { minWidth: layout.minimumTouchTarget, minHeight: layout.minimumTouchTarget, flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[1] },
  navLabel: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 13, flexShrink: 1, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing[5], backgroundColor: 'rgba(30, 20, 15, 0.45)' },
  menuCard: { width: '100%', maxWidth: 360, gap: spacing[3], padding: spacing[5], borderRadius: radii.cardFarmer, backgroundColor: colors.cream },
  menuTitle: { color: colors.brown, fontFamily: fonts.semiBold, fontSize: typeScale.heading, textAlign: 'center', marginBottom: spacing[1] },
});
