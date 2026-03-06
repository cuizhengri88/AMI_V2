export const STORE_CODE_GROUP_ID = 'STR_CD';
export const STORE_CODE_STORAGE_KEY = 'activeStoreCode';
export const DEFAULT_STORE_CODE = 'HAIR_001';

export function normalizeStoreCode(value: string | null | undefined): string {
  const normalized = (value || '').trim().toUpperCase();
  return normalized || DEFAULT_STORE_CODE;
}
