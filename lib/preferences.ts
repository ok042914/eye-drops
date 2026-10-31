/** Initial value only. The account's saved setting is authoritative after login. */
export const DEFAULT_RESERVE_DAYS=14;
export const MAX_RESERVE_DAYS=90;
export function validReserveDays(value:number):boolean {
  return Number.isInteger(value)&&value>=0&&value<=MAX_RESERVE_DAYS;
}
