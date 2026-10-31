import { DEFAULT_RESERVE_DAYS, validReserveDays } from './preferences.ts';
import { HISTORY_START, validDate, differenceDays } from './dates.ts';
import { activeBottles, stockFor } from './model.ts';
import type { Bottle, InitialMedication, Medication, State } from './model.ts';

export class InventoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
function fail(code: string, message: string): never { throw new InventoryError(code, message); }
function quantity(n: number, positive = false): void {
  if (!Number.isSafeInteger(n) || n < (positive ? 1 : 0) || n > 100000) fail('INVALID', '本数は0〜100000の整数で指定してください。');
}
function date(value: string, today: string): void {
  if (!validDate(value) || value < HISTORY_START || value > today) fail('INVALID_DATE', '日付は2026年6月1日から今日までで指定してください。');
}
export function validateMedication(m: Medication): void {
  if (!m.id || !m.name.trim() || m.name.length > 60 || !Number.isFinite(m.volumeMl) || m.volumeMl <= 0 || m.volumeMl > 100 || !Number.isInteger(m.parallel) || m.parallel < 1 || m.parallel > 4 || !Number.isInteger(m.timesPerDay) || m.timesPerDay < 1 || m.timesPerDay > 12 || !Number.isSafeInteger(m.version) || m.version < 1 || m.directions.length > 120 || m.expirationSource.length > 300) fail('INVALID', '薬剤名・容量・使用回数・並行本数を確認してください。');
  if (m.expirationDays !== null && (!Number.isInteger(m.expirationDays) || m.expirationDays < 1 || m.expirationDays > 365 || !m.expirationSource.trim())) fail('INVALID', '期限を設定する場合は1〜365日と、その根拠を入力してください。');
}
function bottle(id: string, med: Medication, openedOn: string, origin: Bottle['origin'], status: Bottle['status']): Bottle {
  return { id, medicationId: med.id, openedOn, origin, status, endedOn: null, endReason: null, replacesId: null, version: med.version, parallel: med.parallel, expirationDays: med.expirationDays };
}
export function initialize(items: InitialMedication[], today: string, nextVisitOn: string | null, ids: () => string = () => crypto.randomUUID()): State {
  if (!validDate(today) || !items.length || new Set(items.map(i => i.medication.id)).size !== items.length) fail('INVALID', '初期設定を確認してください。');
  if (nextVisitOn && (!validDate(nextVisitOn)||nextVisitOn<today||differenceDays(today,nextVisitOn)>730)) fail('INVALID_DATE', '次回受診日は今日から2年以内で指定してください。');
  const state: State = { schemaVersion: 1, revision: 0, initializedOn: today, reserveDays: DEFAULT_RESERVE_DAYS, medications: [], bottles: [], movements: [], receipts: [], visits: [], nextVisitOn, operations: [] };
  for (const item of items) {
    validateMedication(item.medication); quantity(item.stock);
    if (item.activeDates.length > item.medication.parallel) fail('LIMIT', '使用中本数が並行本数を超えています。');
    state.medications.push({ ...item.medication });
    state.movements.push({ id: ids(), medicationId: item.medication.id, delta: item.stock, kind: 'initial', date: today, referenceId: null, note: '現在の実数。過去履歴からは減算しません。', operationId: ids() });
    for (const d of item.activeDates) { date(d, today); state.bottles.push(bottle(ids(), item.medication, d, 'initial', 'in_use')); }
    for (const d of item.historicalDates) { date(d, today); state.bottles.push(bottle(ids(), item.medication, d, 'historical', 'historical')); }
  }
  return state;
}
export type Command =
  | { action: 'open'; medicationId: string; date: string; replaceId?: string; replacementReason?: 'empty' | 'discarded' }
  | { action: 'import'; medicationId: string; date: string }
  | { action: 'end'; bottleId: string; date: string; reason: 'empty' | 'discarded' }
  | { action: 'edit_opening'; bottleId: string; date: string }
  | { action: 'cancel_opening'; bottleId: string }
  | { action: 'receipt'; medicationId: string; prescribedOn: string; prescribedQuantity: number; receivedOn: string | null; receivedQuantity: number; note: string; visitId: string | null }
  | { action: 'receive'; receiptId: string; date: string; quantity: number }
  | { action: 'cancel_receipt'; receiptId: string }
  | { action: 'adjust'; medicationId: string; quantity: number; note: string }
  | { action: 'visit'; date: string; nextDate: string; note: string }
  | { action: 'preferences'; reserveDays: number }
  | { action: 'settings'; medication: Medication }
  | { action: 'add_medication'; medication: Medication; stock: number };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
/** Pure, atomic reducer. No DB, network, clock, or mutation of the input. */
export function applyCommand(input: State, command: Command, operationId: string, expectedRevision: number, today: string, ids: () => string = () => crypto.randomUUID()): State {
  if (!validDate(today) || !operationId || operationId.length > 120) fail('INVALID', '操作情報を確認してください。');
  const fingerprint = canonical(command);
  const previous = input.operations.find(o => o.id === operationId);
  if (previous) {
    if (previous.fingerprint !== fingerprint) fail('RETRY_MISMATCH', '同じ操作IDを別の内容に再利用できません。');
    return input;
  }
  if (input.revision !== expectedRevision) fail('CONFLICT', '別の操作で更新されました。最新の内容を確認し、入力し直してください。');
  const state = structuredClone(input);
  const getMed = (id: string): Medication => state.medications.find(m => m.id === id) ?? fail('NOT_FOUND', '薬剤が見つかりません。');
  const getBottle = (id: string): Bottle => state.bottles.find(b => b.id === id && b.status !== 'cancelled') ?? fail('NOT_FOUND', 'ボトルが見つかりません。');
  const move = (medicationId: string, delta: number, kind: State['movements'][number]['kind'], referenceId: string | null, note: string, effectiveDate = today) => {
    state.movements.push({ id: ids(), medicationId, delta, kind, date: effectiveDate, referenceId, note, operationId });
  };
  switch (command.action) {
    case 'open': {
      const med = getMed(command.medicationId); date(command.date, today);
      if (command.date < state.initializedOn) fail('HISTORY_REQUIRED', '初期設定より前の開封は「過去履歴登録」を使ってください。');
      if (stockFor(state, med.id) < 1) fail('NO_STOCK', '未開封在庫がありません。受取または棚卸しを確認してください。');
      const next = bottle(ids(), med, command.date, 'normal', 'in_use');
      if (command.replaceId) {
        const old = getBottle(command.replaceId);
        if (old.medicationId !== med.id || old.status !== 'in_use' || old.openedOn > command.date || !command.replacementReason) fail('INVALID', '切替対象と終了理由を確認してください。');
        old.status = command.replacementReason === 'empty' ? 'finished' : 'discarded'; old.endedOn = command.date; old.endReason = command.replacementReason; next.replacesId = old.id;
      }
      if (activeBottles(state, med.id).length >= med.parallel) fail('LIMIT', '使用中の対象ボトルを1本選び、切り替えてください。');
      state.bottles.push(next); move(med.id, -1, 'opening', next.id, '1本開封', command.date); break;
    }
    case 'import': {
      const med = getMed(command.medicationId); date(command.date, today);
      state.bottles.push(bottle(ids(), med, command.date, 'historical', 'historical')); break;
    }
    case 'end': {
      const b = getBottle(command.bottleId); date(command.date, today);
      if (b.status !== 'in_use' || command.date < b.openedOn || !['empty','discarded'].includes(command.reason)) fail('INVALID', '使用中のボトルと終了日を確認してください。');
      b.status = command.reason === 'empty' ? 'finished' : 'discarded'; b.endReason = command.reason; b.endedOn = command.date; break;
    }
    case 'edit_opening': {
      const b = getBottle(command.bottleId); date(command.date, today);
      const predecessor = state.bottles.find(p => p.id === b.replacesId);
      if ((b.endedOn && command.date > b.endedOn) || (predecessor && command.date !== b.openedOn)) fail('DEPENDENCY', '切替を伴う開封日の変更は、連動する終了履歴も必要なため初期版では変更できません。');
      if (b.origin === 'normal' && command.date < state.initializedOn) fail('INVALID', '通常開封日は初期設定日以降にしてください。');
      b.openedOn = command.date;
      for (const m of state.movements) if (m.kind === 'opening' && m.referenceId === b.id) m.date = command.date;
      break;
    }
    case 'cancel_opening': {
      const b = getBottle(command.bottleId);
      if (b.endedOn || b.replacesId || state.bottles.some(p => p.replacesId === b.id && p.status !== 'cancelled')) fail('DEPENDENCY', '使用終了・切替に関連する履歴は、単独で取り消せません。');
      b.status = 'cancelled';
      if (b.origin === 'normal') move(b.medicationId, 1, 'opening_cancel', b.id, '実際には開封していなかった記録の訂正');
      break;
    }
    case 'receipt': {
      getMed(command.medicationId); date(command.prescribedOn, today); quantity(command.prescribedQuantity, true); quantity(command.receivedQuantity);
      if (command.note.length > 500 || (command.visitId && !state.visits.some(v => v.id === command.visitId))) fail('INVALID', '備考・受診記録を確認してください。');
      if (command.receivedOn) { date(command.receivedOn, today); if (command.receivedOn < command.prescribedOn) fail('INVALID', '受取日は処方日以降にしてください。'); if(command.receivedOn<state.initializedOn)fail('HISTORY_REQUIRED','初期設定前の受取は現在庫に含まれるため、重複加算できません。'); quantity(command.receivedQuantity, true); }
      else if (command.receivedQuantity !== 0) fail('INVALID', '未受取の場合、受取本数は0です。');
      if (command.receivedQuantity > command.prescribedQuantity) fail('INVALID', '受取本数が処方本数を超えています。');
      const id = ids(); state.receipts.push({ ...command, id, cancelled: false });
      if (command.receivedQuantity) move(command.medicationId, command.receivedQuantity, 'receipt', id, '実際の受取', command.receivedOn!);
      break;
    }
    case 'receive': {
      const r = state.receipts.find(r => r.id === command.receiptId && !r.cancelled) ?? fail('NOT_FOUND', '処方記録が見つかりません。');
      date(command.date, today); quantity(command.quantity, true);
      if (r.receivedOn || command.quantity > r.prescribedQuantity || command.date < r.prescribedOn || command.date<state.initializedOn) fail('INVALID', '受取済み、または受取日・本数が不正です。');
      r.receivedOn = command.date; r.receivedQuantity = command.quantity; move(r.medicationId, command.quantity, 'receipt', r.id, '後日の実受取', command.date); break;
    }
    case 'cancel_receipt': {
      const r = state.receipts.find(r => r.id === command.receiptId && !r.cancelled) ?? fail('NOT_FOUND', '処方記録が見つかりません。');
      if (stockFor(state, r.medicationId) < r.receivedQuantity) fail('NO_STOCK', '取消で未開封在庫が負数になります。棚卸しで実数を確認してください。');
      r.cancelled = true; if (r.receivedQuantity) move(r.medicationId, -r.receivedQuantity, 'receipt_correction', r.id, '受取取消'); break;
    }
    case 'adjust': {
      getMed(command.medicationId); quantity(command.quantity);
      if (!command.note.trim() || command.note.length > 500) fail('INVALID', '棚卸し理由を入力してください。');
      move(command.medicationId, command.quantity - stockFor(state, command.medicationId), 'adjustment', null, command.note); break;
    }
    case 'visit': {
      date(command.date, today);
      if (!validDate(command.nextDate) || command.nextDate <= command.date || command.note.length > 500) fail('INVALID', '次回受診日は受診日より後にしてください。');
      state.visits.push({ id: ids(), date: command.date, nextDate: command.nextDate, note: command.note });
      state.nextVisitOn = [...state.visits].sort((a,b) => b.date.localeCompare(a.date))[0].nextDate; break;
    }
    case 'preferences': {
      if(!validReserveDays(command.reserveDays))fail('INVALID','予備日数は0〜90日の整数で指定してください。');
      state.reserveDays=command.reserveDays;break;
    }
    case 'settings': {
      const old = getMed(command.medication.id); validateMedication(command.medication);
      if (activeBottles(state, old.id).length > command.medication.parallel) fail('LIMIT', '並行本数を減らす前に、対象ボトルの使用終了を記録してください。');
      state.medications = state.medications.map(m => m.id === old.id ? { ...command.medication, version: old.version + 1 } : m); break;
    }
    case 'add_medication': {
      validateMedication(command.medication); quantity(command.stock);
      if (state.medications.some(m => m.id === command.medication.id)) fail('INVALID', '薬剤IDが重複しています。');
      state.medications.push({ ...command.medication, version: 1 }); move(command.medication.id, command.stock, 'initial', null, '追加薬剤の現在実数'); break;
    }
    default: fail('INVALID', '対応していない操作です。');
  }
  for (const med of state.medications) quantity(stockFor(state, med.id));
  state.revision++; state.operations.push({ id: operationId, fingerprint });
  return state;
}
