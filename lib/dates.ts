export const HISTORY_START = '2026-06-01';
const DAY = 86_400_000;
export function validDate(value: string): boolean {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function requireDate(value: string): void {
  if (!validDate(value)) throw new Error('日付を確認してください。');
}
export function japanToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (name: string) => parts.find(p => p.type === name)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function addDays(value: string, days: number): string {
  requireDate(value);
  if (!Number.isSafeInteger(days)) throw new Error('日数を確認してください。');
  return new Date(Date.parse(value + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
}
export function differenceDays(from: string, to: string): number {
  requireDate(from); requireDate(to);
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY);
}
export function addMonths(value: string, months: number): string {
  requireDate(value);
  if (!Number.isSafeInteger(months)) throw new Error('月数を確認してください。');
  const [year, month, day] = value.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}
export function displayDate(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
}
