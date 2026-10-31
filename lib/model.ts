export type Medication = {
  id: string; name: string; volumeMl: number; timesPerDay: number;
  parallel: number; expirationDays: number | null; expirationSource: string;
  directions: string; version: number;
};
export type Bottle = {
  id: string; medicationId: string; openedOn: string;
  origin: 'initial' | 'historical' | 'normal';
  status: 'in_use' | 'finished' | 'discarded' | 'historical' | 'cancelled';
  endedOn: string | null; endReason: 'empty' | 'discarded' | null;
  replacesId: string | null; version: number; parallel: number;
  expirationDays: number | null;
};
export type Movement = {
  id: string; medicationId: string; delta: number;
  kind: 'initial' | 'opening' | 'opening_cancel' | 'receipt' | 'receipt_correction' | 'adjustment';
  date: string; referenceId: string | null; note: string; operationId: string;
};
export type Receipt = {
  id: string; medicationId: string; prescribedOn: string;
  receivedOn: string | null; prescribedQuantity: number; receivedQuantity: number;
  note: string; visitId: string | null; cancelled: boolean;
};
export type Visit = { id: string; date: string; nextDate: string; note: string };
export type State = {
  schemaVersion: 1; revision: number; initializedOn: string; reserveDays: number;
  medications: Medication[]; bottles: Bottle[]; movements: Movement[];
  receipts: Receipt[]; visits: Visit[]; nextVisitOn: string | null;
  operations: { id: string; fingerprint: string }[];
};
export type InitialMedication = {
  medication: Medication; stock: number; activeDates: string[]; historicalDates: string[];
};
export function defaultMedications(): Medication[] {
  return [
    { id: 'dolmorol', name: 'ドルモロール', volumeMl: 5, timesPerDay: 2, parallel: 2, expirationDays: null, expirationSource: '', directions: '両眼・1日2回', version: 1 },
    { id: 'eybelis', name: 'エイベリス', volumeMl: 2.5, timesPerDay: 1, parallel: 1, expirationDays: null, expirationSource: '', directions: '両眼・1日1回、夜', version: 1 }
  ];
}
export function stockFor(state: State, medicationId: string): number {
  return state.movements.filter(m => m.medicationId === medicationId).reduce((sum, m) => sum + m.delta, 0);
}
export function activeBottles(state: State, medicationId: string): Bottle[] {
  return state.bottles.filter(b => b.medicationId === medicationId && b.status === 'in_use');
}
