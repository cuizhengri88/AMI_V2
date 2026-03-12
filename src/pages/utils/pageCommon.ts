type DateTimeFormatOptions = {
  hour12?: boolean;
  fallback?: string;
  locale?: string | string[];
};

type CurrencyFormatOptions = {
  symbol?: string;
  locale?: string | string[];
  round?: boolean;
};

type NamePhoneLike = {
  name?: string | null;
  phone?: string | null;
};

export type SettlementStatus = 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
export type DateRangeViewType = 'daily' | 'period';

export type DateRangeValue = {
  startDate: string;
  endDate: string;
};

export function pad2(value: number) {
  return String(value).padStart(2, '0');
}

export function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayIso(baseDate = new Date()) {
  return toIsoDate(baseDate);
}

export function monthStartIso(baseDate = new Date()) {
  return `${baseDate.getFullYear()}-${pad2(baseDate.getMonth() + 1)}-01`;
}

function toLocalDate(baseDate = new Date()) {
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
}

function parseIsoDateOnly(raw?: string | null) {
  const source = (raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return null;
  const parsed = new Date(`${source}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getDateRangeByViewType(viewType: DateRangeViewType, baseDate = new Date()): DateRangeValue {
  const todayDate = toLocalDate(baseDate);
  const today = toIsoDate(todayDate);

  if (viewType === 'period') {
    const start = new Date(todayDate);
    start.setDate(start.getDate() - 7);
    return { startDate: toIsoDate(start), endDate: today };
  }

  return { startDate: today, endDate: today };
}

export function shiftDailyDateRange(currentDate: string, dayOffset: number, baseDate = new Date()): DateRangeValue {
  const anchorDate = parseIsoDateOnly(currentDate) || toLocalDate(baseDate);
  anchorDate.setDate(anchorDate.getDate() + dayOffset);
  const nextDate = toIsoDate(anchorDate);
  return { startDate: nextDate, endDate: nextDate };
}

function parseDateTime(raw?: string | null) {
  const source = (raw || '').trim();
  if (!source) return null;
  const parsed = new Date(source.includes('T') ? source : source.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toDateOnly(raw?: string | null) {
  const source = (raw || '').trim();
  if (!source) return '';
  const match = source.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const parsed = parseDateTime(source);
  if (!parsed) return '';
  return toIsoDate(parsed);
}

export function formatDateTime(raw?: string | null, options: DateTimeFormatOptions = {}) {
  const { hour12 = false, fallback = '-', locale } = options;
  const source = (raw || '').trim();
  if (!source) return fallback;

  const parsed = parseDateTime(source);
  if (!parsed) return source;

  return parsed.toLocaleString(locale, { hour12 });
}

export function formatDateTimeYmdHms(raw?: string | null, fallback = '-') {
  const source = (raw || '').trim();
  if (!source) return fallback;

  const normalized = source.replace('T', ' ');
  const directMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
  if (directMatch) {
    return `${directMatch[1]} ${directMatch[2]}`;
  }

  const parsed = parseDateTime(source);
  if (!parsed) return source;
  return `${toIsoDate(parsed)} ${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}:${pad2(parsed.getSeconds())}`;
}

export function toTimestamp(raw?: string | null) {
  return parseDateTime(raw)?.getTime() ?? Number.MIN_SAFE_INTEGER;
}

export function formatCurrency(value: number | null | undefined, options: CurrencyFormatOptions = {}) {
  const { symbol = '¥', locale, round = false } = options;
  const numeric = Number(value ?? 0);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  const normalized = round ? Math.round(safeValue) : safeValue;
  return `${symbol}${normalized.toLocaleString(locale)}`;
}

export function normalizePhoneDigits(raw?: string | null) {
  return (raw || '').replace(/\D/g, '');
}

export function normalizeNameKey(raw?: string | null) {
  return (raw || '').trim().toLowerCase();
}

export function isSamePhoneDigits(lhs?: string | null, rhs?: string | null) {
  const left = normalizePhoneDigits(lhs);
  const right = normalizePhoneDigits(rhs);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

export function findMatchedMemberByNameOrPhone<T extends NamePhoneLike>(
  members: T[],
  customerName?: string | null,
  customerPhone?: string | null,
) {
  const normalizedName = normalizeNameKey(customerName);
  const phoneCandidates = [
    normalizePhoneDigits(customerPhone),
    normalizePhoneDigits(customerName),
  ].filter((digits) => digits.length >= 7);

  for (const customerDigits of phoneCandidates) {
    const matchedByPhone = members.find((member) => {
      const memberPhoneDigits = normalizePhoneDigits(member.phone);
      if (memberPhoneDigits.length < 7) return false;
      return isSamePhoneDigits(memberPhoneDigits, customerDigits);
    });
    if (matchedByPhone) return matchedByPhone;
  }

  if (normalizedName) {
    const matchedByName = members.find((member) => normalizeNameKey(member.name) === normalizedName);
    if (matchedByName) return matchedByName;
  }

  return null;
}

export function toSettlementStatus(value?: string | null): SettlementStatus {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'CANCELLED') return 'CANCELLED';
  if (normalized === 'COMPLETED') return 'COMPLETED';
  return 'PROCESSING';
}

export function isCouponPaymentMethod(method?: string | null) {
  return method?.trim().toUpperCase() === 'COUPON';
}

export function isBalancePaymentMethod(code?: string | null) {
  const normalized = code?.trim().toUpperCase();
  return normalized === 'PREPAID' || normalized === 'MEMBERSHIP';
}

export function normalizeGenderForForm(raw?: string | null): '' | 'M' | 'F' {
  const normalized = (raw || '').trim().toUpperCase();
  if (normalized === 'M' || normalized === 'MALE' || normalized === '남' || normalized === '남성') {
    return 'M';
  }
  if (normalized === 'F' || normalized === 'FEMALE' || normalized === '여' || normalized === '여성') {
    return 'F';
  }
  return '';
}
