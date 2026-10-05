import type { DomainEntity, EntityKind, EntityRelation } from '../domain/entities';

const fixtureDate = '2026-10-03T03:00:00.000Z';
const fixtureUpdate = '2026-10-03T04:00:00.000Z';

const id = (number: number) =>
  `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;

export const fixtureIds = {
  budi: id(1),
  sari: id(2),
  rani: id(3),
  damar: id(4),
  budiAddress: id(6),
  sariAddress: id(7),
  budiFarm: id(8),
  sariFarm: id(9),
  budiProfile: id(10),
  sariProfile: id(11),
  raniProfile: id(12),
  damarProfile: id(13),
  damarVerification: id(15),
  raniAvailability: id(16),
  yudaAvailability: id(17),
  raniChatRate: id(18),
  yudaVisitRate: id(19),
  cow: id(20),
  goat: id(21),
  request: id(22),
  awaitingPayment: id(23),
  chat: id(24),
  visit: id(25),
  completed: id(26),
  followUp: id(27),
  proposal: id(28),
  visitStage: id(29),
  draftNote: id(30),
  finalNote: id(31),
  healthEvent: id(32),
  reminderPending: id(33),
  reminderSent: id(34),
  reminderDone: id(35),
  product: id(36),
  budiCart: id(37),
  sariCart: id(38),
  cartItem: id(39),
  order: id(40),
  shipment: id(41),
  paymentSucceeded: id(42),
  paymentPending: id(43),
  paymentFailed: id(44),
  earningAvailable: id(45),
  earningPending: id(46),
  creditEntry: id(47),
  pendingEntry: id(48),
  withdrawal: id(49),
  reserveEntry: id(50),
  notification: id(51),
  message: id(52),
  emptyCartItem: id(53),
  vetZero: id(54),
  yudaProfile: id(55),
  preferences: id(57),
  completedPending: id(58),
  paymentSucceededPending: id(59),
  finalNotePending: id(60),
  orderPaymentSucceeded: id(61),
  requestPaymentSucceeded: id(62),
  chatPaymentSucceeded: id(63),
  visitPaymentSucceeded: id(64),
} as const;

function entity(
  kind: EntityKind,
  entityId: string,
  payload: Record<string, unknown>,
  ownerId: string | null = null,
): DomainEntity {
  return {
    id: entityId,
    kind,
    ownerId,
    contextId: null,
    createdAt: fixtureDate,
    updatedAt: fixtureUpdate,
    version: 1,
    payload,
  };
}

const ids = fixtureIds;

export const fixtureEntities: DomainEntity[] = [
  entity('user', ids.budi, { name: 'Budi Santoso', email: 'budi@example.test', roles: ['farmer'], status: 'active' }),
  entity('user', ids.sari, { name: 'Sari Lestari', email: 'sari@example.test', roles: ['farmer'], status: 'active' }),
  entity('user', ids.rani, { name: 'drh. Rani Putri', email: 'rani@example.test', roles: ['vet'], status: 'active' }),
  entity('user', ids.damar, { name: 'drh. Damar Wijaya', email: 'damar@example.test', roles: ['vet'], status: 'active' }),
  entity('user', ids.vetZero, { name: 'drh. Yuda Pratama', email: 'yuda@example.test', roles: ['vet'], status: 'active' }),
  entity('address', ids.budiAddress, { label: 'Kandang Budi', recipient: 'Budi', city: 'Bogor', province: 'Jawa Barat', postalCode: '16111', timezone: 'Asia/Jakarta' }, ids.budi),
  entity('address', ids.sariAddress, { label: 'Kandang Sari', recipient: 'Sari', city: 'Sleman', province: 'DI Yogyakarta', postalCode: '55511', timezone: 'Asia/Jakarta' }, ids.sari),
  entity('farm', ids.budiFarm, { name: 'Ternak Budi', species: ['cattle'], visitAddressId: ids.budiAddress }, ids.budi),
  entity('farm', ids.sariFarm, { name: 'Kebun Sari', species: ['goat'], visitAddressId: ids.sariAddress }, ids.sari),
  entity('farmerProfile', ids.budiProfile, { userId: ids.budi, farmId: ids.budiFarm }, ids.budi),
  entity('farmerProfile', ids.sariProfile, { userId: ids.sari, farmId: ids.sariFarm }, ids.sari),
  entity('vetProfile', ids.raniProfile, { userId: ids.rani, professionalName: 'drh. Rani Putri', verificationStatus: 'verified', services: ['chat'] }, ids.rani),
  entity('vetProfile', ids.damarProfile, { userId: ids.damar, professionalName: 'drh. Damar Wijaya', verificationStatus: 'pending', services: ['visit'] }, ids.damar),
  entity('vetProfile', ids.yudaProfile, { userId: ids.vetZero, professionalName: 'drh. Yuda Pratama', verificationStatus: 'verified', services: ['visit'] }, ids.vetZero),
  entity('verificationSubmission', ids.damarVerification, { vetId: ids.damar, status: 'pending', submittedAt: fixtureDate }, ids.damar),
  entity('availability', ids.raniAvailability, { vetId: ids.rani, acceptingNewRequests: true, timezone: 'Asia/Jakarta', services: ['chat'] }, ids.rani),
  entity('availability', ids.yudaAvailability, { vetId: ids.vetZero, acceptingNewRequests: true, timezone: 'Asia/Jakarta', services: ['visit'] }, ids.vetZero),
  entity('serviceRate', ids.raniChatRate, { vetId: ids.rani, serviceType: 'chat', amount: 75000, currency: 'IDR', effectiveAt: fixtureDate }, ids.rani),
  entity('serviceRate', ids.yudaVisitRate, { vetId: ids.vetZero, serviceType: 'visit', amount: 150000, currency: 'IDR', effectiveAt: fixtureDate }, ids.vetZero),
  entity('livestock', ids.cow, { displayCode: 'BUD-01', name: 'Mawar', species: 'cattle', breed: 'Sapi fiktif', sex: 'female', weightKg: 340, estimatedAgeMonths: 48 }, ids.budi),
  entity('livestock', ids.goat, { displayCode: 'SAR-01', name: 'Luna', species: 'goat', breed: 'Kambing fiktif', sex: 'female', weightKg: 42, estimatedAgeMonths: 24 }, ids.sari),
  entity('consultation', ids.request, { displayCode: 'VL-C-104', farmerId: ids.budi, vetId: ids.rani, animalId: ids.cow, type: 'chat', status: 'requested', complaint: 'Nafsu makan berkurang.', startsAt: '2026-10-06T02:00:00.000Z', endsAt: '2026-10-06T02:30:00.000Z', feeSnapshot: 75000, commissionSnapshot: 7500 }, ids.budi),
  entity('consultation', ids.awaitingPayment, { displayCode: 'VL-C-105', farmerId: ids.sari, vetId: ids.rani, animalId: ids.goat, type: 'chat', status: 'awaiting_payment', complaint: 'Perlu konsultasi umum.', startsAt: '2026-10-07T02:00:00.000Z', endsAt: '2026-10-07T02:30:00.000Z', feeSnapshot: 75000, commissionSnapshot: 7500 }, ids.sari),
  entity('consultation', ids.chat, { displayCode: 'VL-C-102', farmerId: ids.sari, vetId: ids.rani, animalId: ids.goat, type: 'chat', status: 'in_progress', complaint: 'Memeriksa kondisi ternak.', startsAt: '2026-10-03T02:00:00.000Z', endsAt: '2026-10-03T02:30:00.000Z', feeSnapshot: 75000, commissionSnapshot: 7500 }, ids.sari),
  entity('consultation', ids.visit, { displayCode: 'VL-V-103', farmerId: ids.budi, vetId: ids.vetZero, animalId: ids.cow, type: 'visit', status: 'scheduled', complaint: 'Pemeriksaan terjadwal.', startsAt: '2026-10-08T02:00:00.000Z', endsAt: '2026-10-08T03:00:00.000Z', feeSnapshot: 150000, commissionSnapshot: 15000, visitAddressSnapshot: 'Kandang Budi, Bogor' }, ids.budi),
  entity('consultation', ids.completed, { displayCode: 'VL-V-100', farmerId: ids.sari, vetId: ids.vetZero, animalId: ids.goat, type: 'visit', status: 'completed', complaint: 'Pemeriksaan kondisi umum.', startsAt: '2026-10-01T02:00:00.000Z', endsAt: '2026-10-01T03:00:00.000Z', completionAt: '2026-10-01T03:00:00.000Z', feeSnapshot: 120000, commissionSnapshot: 12000 }, ids.sari),
  entity('consultation', ids.completedPending, { displayCode: 'VL-C-099', farmerId: ids.budi, vetId: ids.vetZero, animalId: ids.cow, type: 'chat', status: 'completed', complaint: 'Pemeriksaan umum melalui chat.', startsAt: '2026-09-30T02:00:00.000Z', endsAt: '2026-09-30T02:30:00.000Z', completionAt: '2026-09-30T02:30:00.000Z', feeSnapshot: 90000, commissionSnapshot: 9000 }, ids.budi),
  entity('visit', ids.visitStage, { consultationId: ids.visit, stage: 'scheduled', departureAt: null, arrivalAt: null, examinationStartedAt: null }, ids.vetZero),
  entity('scheduleProposal', ids.proposal, { consultationId: ids.visit, proposedByVetId: ids.vetZero, startsAt: '2026-10-08T03:00:00.000Z', endsAt: '2026-10-08T04:00:00.000Z', reason: 'Penyesuaian jadwal fiktif.', status: 'pending' }, ids.vetZero),
  entity('clinicalNote', ids.draftNote, { consultationId: ids.chat, animalId: ids.goat, vetId: ids.rani, complaint: 'Perubahan nafsu makan.', findings: 'Catatan awal.', assessment: '', actions: '', careInstructions: '', status: 'draft', finalizedAt: null }, ids.rani),
  entity('clinicalNote', ids.finalNote, { consultationId: ids.completed, animalId: ids.goat, vetId: ids.vetZero, complaint: 'Pemeriksaan kondisi umum.', findings: 'Temuan fiktif dicatat.', assessment: 'Evaluasi umum fiktif.', actions: 'Tindakan pemeriksaan fiktif.', careInstructions: 'Pantau kondisi dan hubungi dokter bila berubah.', status: 'final', finalizedAt: '2026-10-01T03:00:00.000Z', finalizedBy: ids.vetZero }, ids.vetZero),
  entity('clinicalNote', ids.finalNotePending, { consultationId: ids.completedPending, animalId: ids.cow, vetId: ids.vetZero, complaint: 'Pemeriksaan umum melalui chat.', findings: 'Temuan fiktif dicatat.', assessment: 'Evaluasi umum fiktif.', actions: 'Tindakan pemeriksaan fiktif.', careInstructions: 'Pantau kondisi dan hubungi dokter bila berubah.', status: 'final', finalizedAt: '2026-09-30T02:30:00.000Z', finalizedBy: ids.vetZero }, ids.vetZero),
  entity('healthEvent', ids.healthEvent, { animalId: ids.goat, kind: 'examination', occurredAt: '2026-10-01T03:00:00.000Z', description: 'Pemeriksaan fiktif.', clinicalNoteId: ids.finalNote, sourceKey: `clinical-note:${ids.finalNote}` }, ids.sari),
  entity('followUp', ids.followUp, { consultationId: ids.completed, animalId: ids.goat, vetId: ids.vetZero, startsAt: '2026-10-15T02:00:00.000Z', endsAt: '2026-10-15T02:30:00.000Z', kind: 'recheck', status: 'scheduled' }, ids.sari),
  entity('reminder', ids.reminderPending, { animalId: ids.goat, ownerId: ids.sari, kind: 'care', dueAt: '2026-10-10T02:00:00.000Z', instructions: 'Ingat pemeriksaan rutin.', careStatus: 'scheduled', deliveryStatus: 'pending' }, ids.sari),
  entity('reminder', ids.reminderSent, { animalId: ids.cow, ownerId: ids.budi, kind: 'follow_up', dueAt: '2026-10-09T02:00:00.000Z', instructions: 'Jadwal tindak lanjut.', careStatus: 'scheduled', deliveryStatus: 'sent' }, ids.budi),
  entity('reminder', ids.reminderDone, { animalId: ids.goat, ownerId: ids.sari, kind: 'care', dueAt: '2026-10-02T02:00:00.000Z', instructions: 'Perawatan fiktif selesai.', careStatus: 'done', deliveryStatus: 'sent', completedAt: '2026-10-02T03:00:00.000Z' }, ids.sari),
  entity('product', ids.product, { name: 'Paket perawatan ternak fiktif', category: 'care', species: ['cattle', 'goat'], description: 'Produk contoh non-dosis untuk alur katalog.', unitPrice: 45000, currency: 'IDR', active: true }),
  entity('cart', ids.budiCart, { farmerId: ids.budi, itemCount: 1 }, ids.budi),
  entity('cart', ids.sariCart, { farmerId: ids.sari, itemCount: 0 }, ids.sari),
  entity('cartItem', ids.cartItem, { cartId: ids.budiCart, productId: ids.product, quantity: 2 }, ids.budi),
  entity('order', ids.order, { displayCode: 'VL-O-201', farmerId: ids.budi, status: 'shipped', totalSnapshot: 90000, addressSnapshot: 'Kandang Budi, Bogor' }, ids.budi),
  entity('shipment', ids.shipment, { orderId: ids.order, status: 'shipped', trackingCode: 'TRK-FIKTIF-201', events: [{ status: 'shipped', time: fixtureDate, description: 'Paket diserahkan ke kurir fiktif.' }] }, ids.budi),
  entity('payment', ids.paymentSucceeded, { ownerId: ids.sari, payableType: 'consultation', payableId: ids.completed, method: 'bank_transfer', amount: 120000, status: 'succeeded', operationKey: 'fixture-consultation-paid' }, ids.sari),
  entity('payment', ids.paymentSucceededPending, { ownerId: ids.budi, payableType: 'consultation', payableId: ids.completedPending, method: 'bank_transfer', amount: 90000, status: 'succeeded', operationKey: 'fixture-consultation-paid-pending-earning' }, ids.budi),
  entity('payment', ids.requestPaymentSucceeded, { ownerId: ids.budi, payableType: 'consultation', payableId: ids.request, method: 'bank_transfer', amount: 75000, status: 'succeeded', operationKey: 'fixture-consultation-requested-paid' }, ids.budi),
  entity('payment', ids.chatPaymentSucceeded, { ownerId: ids.sari, payableType: 'consultation', payableId: ids.chat, method: 'bank_transfer', amount: 75000, status: 'succeeded', operationKey: 'fixture-consultation-chat-paid' }, ids.sari),
  entity('payment', ids.visitPaymentSucceeded, { ownerId: ids.budi, payableType: 'consultation', payableId: ids.visit, method: 'bank_transfer', amount: 150000, status: 'succeeded', operationKey: 'fixture-consultation-visit-paid' }, ids.budi),
  entity('payment', ids.paymentPending, { ownerId: ids.sari, payableType: 'consultation', payableId: ids.awaitingPayment, method: 'bank_transfer', amount: 75000, status: 'pending', operationKey: 'fixture-consultation-pending' }, ids.sari),
  entity('payment', ids.orderPaymentSucceeded, { ownerId: ids.budi, payableType: 'order', payableId: ids.order, method: 'wallet', amount: 90000, status: 'succeeded', operationKey: 'fixture-order-paid' }, ids.budi),
  entity('paymentAttempt', ids.paymentFailed, { paymentId: ids.orderPaymentSucceeded, method: 'wallet', amount: 90000, status: 'failed', operationKey: 'fixture-order-failed', attemptedAt: fixtureDate }, ids.budi),
  entity('earningTransaction', ids.earningAvailable, { vetId: ids.vetZero, consultationId: ids.completed, gross: 120000, commission: 12000, net: 108000, status: 'available', earnedAt: fixtureUpdate }, ids.vetZero),
  entity('earningTransaction', ids.earningPending, { vetId: ids.vetZero, consultationId: ids.completedPending, gross: 90000, commission: 9000, net: 81000, status: 'pending', earnedAt: fixtureUpdate }, ids.vetZero),
  entity('ledgerEntry', ids.creditEntry, { vetId: ids.vetZero, earningId: ids.earningAvailable, kind: 'credit_available', amount: 108000, operationKey: 'fixture-credit-available', occurredAt: fixtureUpdate }, ids.vetZero),
  entity('ledgerEntry', ids.pendingEntry, { vetId: ids.vetZero, earningId: ids.earningPending, kind: 'earn_pending', amount: 81000, operationKey: 'fixture-earn-pending', occurredAt: fixtureUpdate }, ids.vetZero),
  entity('payoutDestination', id(56), { vetId: ids.vetZero, bankLabel: 'Bank Contoh', accountMasked: '•••• 1234', accountHolder: 'Yuda Pratama' }, ids.vetZero),
  entity('withdrawal', ids.withdrawal, { vetId: ids.vetZero, destinationSnapshot: 'Bank Contoh •••• 1234', amount: 20000, feeSnapshot: 0, netAmount: 20000, status: 'submitted', operationKey: 'fixture-withdrawal-submitted' }, ids.vetZero),
  entity('ledgerEntry', ids.reserveEntry, { vetId: ids.vetZero, withdrawalId: ids.withdrawal, kind: 'reserve_withdrawal', amount: 20000, operationKey: 'fixture-reserve-withdrawal', occurredAt: fixtureUpdate }, ids.vetZero),
  entity('notification', ids.notification, { recipientId: ids.budi, eventId: 'fixture-consultation-requested', type: 'consultation_requested', contextId: ids.request, title: 'Permintaan konsultasi tersimpan', body: 'Dokter akan meninjau permintaan Anda.', deliveryStatus: 'sent', readAt: null }, ids.budi),
  entity('message', ids.message, { consultationId: ids.chat, senderId: ids.budi, clientMessageId: 'fixture-chat-message-1', text: 'Terima kasih, Dok.', deliveryStatus: 'sent', sentAt: fixtureUpdate }, ids.budi),
  entity('preferences', ids.preferences, { userId: ids.budi, notifications: { consultations: true, reminders: true, commerce: false } }, ids.budi),
];

export const fixtureRelations: EntityRelation[] = [];

function link(sourceId: string, relationship: string, targetId: string) {
  fixtureRelations.push({ sourceId, relationship, targetId });
}

for (const [profile, user, farm, address] of [
  [ids.budiProfile, ids.budi, ids.budiFarm, ids.budiAddress],
  [ids.sariProfile, ids.sari, ids.sariFarm, ids.sariAddress],
]) {
  link(profile, 'user', user);
  link(profile, 'farm', farm);
  link(profile, 'address', address);
  link(farm, 'owner', user);
  link(farm, 'visitAddress', address);
}
for (const [profile, user] of [
  [ids.raniProfile, ids.rani],
  [ids.damarProfile, ids.damar],
  [ids.yudaProfile, ids.vetZero],
]) link(profile, 'user', user);
link(ids.damarProfile, 'verificationSubmission', ids.damarVerification);
link(ids.raniProfile, 'availability', ids.raniAvailability);
link(ids.yudaProfile, 'availability', ids.yudaAvailability);
link(ids.raniProfile, 'serviceRate', ids.raniChatRate);
link(ids.yudaProfile, 'serviceRate', ids.yudaVisitRate);
link(ids.cow, 'farmer', ids.budi);
link(ids.cow, 'farm', ids.budiFarm);
link(ids.goat, 'farmer', ids.sari);
link(ids.goat, 'farm', ids.sariFarm);

for (const [consultation, farmer, vet, animal] of [
  [ids.request, ids.budi, ids.rani, ids.cow],
  [ids.awaitingPayment, ids.sari, ids.rani, ids.goat],
  [ids.chat, ids.sari, ids.rani, ids.goat],
  [ids.visit, ids.budi, ids.vetZero, ids.cow],
  [ids.completed, ids.sari, ids.vetZero, ids.goat],
  [ids.completedPending, ids.budi, ids.vetZero, ids.cow],
]) {
  link(consultation, 'farmer', farmer);
  link(consultation, 'veterinarian', vet);
  link(consultation, 'animal', animal);
}
link(ids.visitStage, 'consultation', ids.visit);
link(ids.proposal, 'consultation', ids.visit);
link(ids.draftNote, 'consultation', ids.chat);
link(ids.draftNote, 'animal', ids.goat);
link(ids.draftNote, 'veterinarian', ids.rani);
link(ids.finalNote, 'consultation', ids.completed);
link(ids.finalNote, 'animal', ids.goat);
link(ids.finalNote, 'veterinarian', ids.vetZero);
link(ids.finalNotePending, 'consultation', ids.completedPending);
link(ids.finalNotePending, 'animal', ids.cow);
link(ids.finalNotePending, 'veterinarian', ids.vetZero);
link(ids.healthEvent, 'animal', ids.goat);
link(ids.healthEvent, 'clinicalNote', ids.finalNote);
link(ids.followUp, 'consultation', ids.completed);
link(ids.followUp, 'animal', ids.goat);
link(ids.reminderPending, 'animal', ids.goat);
link(ids.reminderSent, 'animal', ids.cow);
link(ids.reminderDone, 'animal', ids.goat);
link(ids.cartItem, 'cart', ids.budiCart);
link(ids.cartItem, 'product', ids.product);
link(ids.shipment, 'order', ids.order);
link(ids.paymentSucceeded, 'payable', ids.completed);
link(ids.paymentSucceededPending, 'payable', ids.completedPending);
link(ids.requestPaymentSucceeded, 'payable', ids.request);
link(ids.chatPaymentSucceeded, 'payable', ids.chat);
link(ids.visitPaymentSucceeded, 'payable', ids.visit);
link(ids.paymentPending, 'payable', ids.awaitingPayment);
link(ids.orderPaymentSucceeded, 'payable', ids.order);
link(ids.paymentFailed, 'payment', ids.orderPaymentSucceeded);
link(ids.earningAvailable, 'consultation', ids.completed);
link(ids.earningPending, 'consultation', ids.completedPending);
link(ids.creditEntry, 'earning', ids.earningAvailable);
link(ids.pendingEntry, 'earning', ids.earningPending);
link(ids.withdrawal, 'vet', ids.vetZero);
link(ids.reserveEntry, 'withdrawal', ids.withdrawal);
link(ids.notification, 'recipient', ids.budi);
link(ids.notification, 'context', ids.request);
link(ids.message, 'consultation', ids.chat);
link(ids.preferences, 'user', ids.budi);

export const fixtureSeedVersion = 'fe02-v1';
