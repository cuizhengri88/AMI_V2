export const SYSTEM_TYPE_GROUP_ID = 'SYSTEM_TYPE';
export const SYSTEM_TYPE_STORAGE_KEY = 'activeSystemType';
export const DEFAULT_SYSTEM_TYPE_CODE = 'ALL';

export function normalizeSystemTypeCode(value: string | null | undefined): string {
  const normalized = (value || '').trim().toUpperCase();
  return normalized || DEFAULT_SYSTEM_TYPE_CODE;
}
