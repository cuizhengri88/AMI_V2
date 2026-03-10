import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import { motion, useDragControls } from 'motion/react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit2,
  GripHorizontal,
  Loader2,
  PlusCircle,
  Scissors,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';

type CodeOption = {
  code: string;
  label: string;
  order: number;
};

type PaymentMethodOption = {
  code: string;
  label: string;
  order: number;
};

type QuickPaymentLine = {
  lineId: number;
  methodCode: string;
  amount: number;
};

type ServiceItem = {
  id: number;
  categoryCode: string;
  categoryName: string;
  serviceName: string;
  unitPrice: number;
  durationMinutes: number;
};

type ReservationService = {
  lineId: number;
  serviceId: number;
  categoryCode: string;
  categoryName: string;
  serviceName: string;
  unitPrice: number;
  durationMinutes: number;
};

type ReservationRecord = {
  id: number;
  reservationDate: string;
  startTime: string;
  customerName: string;
  gender?: string;
  customerPhone: string;
  designerName: string;
  status: string;
  note: string;
  services: ReservationService[];
};

type ReservationForm = {
  reservationDate: string;
  startTime: string;
  customerName: string;
  gender: string;
  designerName: string;
  status: string;
  note: string;
  selectedCategory: string;
  selectedServiceId: string;
  services: ReservationService[];
};

type MemberLookup = {
  id: number;
  name: string;
  phone: string;
  phoneDigits: string;
};

// 백엔드에서 내려주는 예약 시술 라인 원본 타입
type ReservationServiceRow = {
  line_id: number;
  service_id: number;
  category_code: string;
  category_name: string;
  service_name: string;
  unit_price: number;
  duration_minutes: number;
};

// 백엔드에서 내려주는 예약 헤더 원본 타입
type ReservationRow = {
  reservation_id: number;
  reservation_date: string;
  start_time: string;
  customer_name: string;
  gender?: string | null;
  designer_name: string;
  status: string;
  note: string | null;
  services: ReservationServiceRow[];
};

type SalesSettlementPaymentRow = {
  payment_method_code: string;
  amount: number;
  coupon_service_id?: number | null;
};

type SalesSettlementRow = {
  settlement_id: number;
  reservation_ref?: string | null;
  member_user_id?: string | null;
  manager_employee_id?: number | null;
  service_ids?: number[] | null;
  total_amount?: number;
  status?: string | null;
  payments: SalesSettlementPaymentRow[];
};

type LinkedSettlementState = 'NONE' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

type StatusTone = {
  badge: string;
  chip: string;
  dot: string;
};

type ReservationViewMode = 'calendar' | 'list';
type ListRangeMode = 'day' | 'month' | 'year';

const STATUS_GROUP_ID = 'RESERVATION_STATUS';
const CATEGORY_GROUP_ID = 'T_CATEGORY';
const PAYMENT_METHOD_GROUP_ID = 'PAYMENT_METHOD';

const FALLBACK_STATUS_CODES = ['RESERVED', 'COMPLETED', 'CANCELLED'] as const;
const FALLBACK_CATEGORY_CODES = ['CUT', 'PERM', 'COLOR'] as const;

const FALLBACK_STATUSES: CodeOption[] = FALLBACK_STATUS_CODES.map((code, index) => ({
  code,
  label: '',
  order: index + 1,
}));

const FALLBACK_CATEGORIES: CodeOption[] = FALLBACK_CATEGORY_CODES.map((code, index) => ({
  code,
  label: '',
  order: index + 1,
}));

const FALLBACK_PAYMENT_METHODS: PaymentMethodOption[] = [
  { code: 'CASH', label: '', order: 1 },
  { code: 'CARD', label: '', order: 2 },
  { code: 'WECHAT', label: '', order: 3 },
  { code: 'ALIPAY', label: '', order: 4 },
];

const WEEKDAY_TEXT_KEYS = [
  't028', // 일
  't029', // 월
  't030', // 화
  't031', // 수
  't032', // 목
  't033', // 금
  't034', // 토
] as const;

const STATUS_TEXT_KEY_BY_CODE: Record<string, string> = {
  RESERVED: 't080', // 예약중
  COMPLETED: 't081', // 완료
  CANCELLED: 't082', // 예약취소
};

const CATEGORY_TEXT_KEY_BY_CODE: Record<string, string> = {
  CUT: 't083', // 커트
  PERM: 't084', // 파마
  COLOR: 't085', // 염색
};

const PAYMENT_METHOD_TEXT_KEY_BY_CODE: Record<string, string> = {
  CASH: 't112',
  CARD: 't113',
  WECHAT: 't114',
  ALIPAY: 't115',
  PREPAID: 't116',
};

const A11Y_TEXT_KEYS = {
  PREVIOUS_MONTH: 't086', // 이전 달
  NEXT_MONTH: 't087', // 다음 달
  CLOSE_MODAL: 't088', // 모달 닫기
} as const;

// 예약 데이터는 항상 DB에서 불러오므로 초기값은 빈 배열로 유지한다.
const INITIAL_RESERVATIONS: ReservationRecord[] = [];

function toIsoDate(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function todayIso() {
  return toIsoDate(new Date());
}

function parseIsoDate(iso: string) {
  const [y, m, d] = iso.split('-').map((value) => Number(value));
  return new Date(y, (m || 1) - 1, d || 1);
}

function shiftDate(iso: string, diffDays: number) {
  const base = parseIsoDate(iso);
  base.setDate(base.getDate() + diffDays);
  return toIsoDate(base);
}

function shiftMonth(iso: string, diffMonths: number) {
  const base = parseIsoDate(iso);
  base.setDate(1);
  base.setMonth(base.getMonth() + diffMonths);
  return toIsoDate(base);
}

function shiftYear(iso: string, diffYears: number) {
  const base = parseIsoDate(iso);
  base.setDate(1);
  base.setMonth(0);
  base.setFullYear(base.getFullYear() + diffYears);
  return toIsoDate(base);
}

function formatCurrency(value: number) {
  return `¥${value.toLocaleString()}`;
}

function toAmountNumber(value: string | number) {
  const numeric = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, numeric);
}

function formatMonthLabel(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}.${mm}`;
}

function formatDateLabel(isoDate: string, weekdayLabels: string[]) {
  const date = parseIsoDate(isoDate);
  const dayOfWeek = weekdayLabels[date.getDay()] || '';
  return `${isoDate} (${dayOfWeek})`;
}

function normalizeTimeValue(raw: string) {
  if (!raw) return '';
  const match = raw.match(/^(\d{2}:\d{2})/);
  if (match) return match[1];
  const parsed = new Date(`1970-01-01T${raw}`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
}

function normalizeNameKey(raw: string) {
  return raw.trim().toLowerCase();
}

function normalizePhoneDigits(raw?: string | null) {
  return (raw || '').replace(/\D/g, '');
}

function extractPhoneText(raw?: string | null) {
  const source = (raw || '').trim();
  if (!source) return '';

  const fullPhoneLike = source.match(/^\+?[\d\s-]{7,}$/);
  if (fullPhoneLike) return source;

  const embeddedPhoneLike = source.match(/(\+?\d[\d\s-]{6,}\d)/);
  return embeddedPhoneLike ? embeddedPhoneLike[1].trim() : '';
}

function isBalancePaymentMethod(code: string) {
  const normalized = code.trim().toUpperCase();
  return normalized === 'PREPAID' || normalized === 'MEMBERSHIP';
}

function toSettlementStatusByReservationStatus(status: string): 'PROCESSING' | 'COMPLETED' {
  return status.trim().toUpperCase() === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING';
}

function isReservationProcessingStatus(status: string) {
  const normalized = status.trim().toUpperCase();
  return normalized.includes('PROCESS') || normalized.includes('PROGRESS');
}

function normalizeSettlementState(raw?: string | null): LinkedSettlementState {
  const normalized = (raw || '').trim().toUpperCase();
  if (normalized === 'COMPLETED') return 'COMPLETED';
  if (normalized === 'CANCELLED') return 'CANCELLED';
  if (normalized === 'PROCESSING') return 'PROCESSING';
  return 'NONE';
}

function buildQuickCalculatorSnapshotFromSettlement(
  settlement: SalesSettlementRow,
): { discountAmount: number; paymentLines: QuickPaymentLine[] } {
  const payments = settlement.payments || [];
  const nonCouponPayments = payments
    .filter((payment) => payment.payment_method_code?.trim().toUpperCase() !== 'COUPON')
    .map((payment, index) => ({
      lineId: index + 1,
      methodCode: payment.payment_method_code?.trim().toUpperCase() || '',
      amount: toAmountNumber(payment.amount),
    }))
    .filter((payment) => payment.methodCode.length > 0);

  const nonCouponPaidAmount = nonCouponPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const settlementTotalAmount = toAmountNumber(settlement.total_amount ?? 0);
  const discountAmount = Math.max(settlementTotalAmount - nonCouponPaidAmount, 0);

  return {
    discountAmount,
    paymentLines: nonCouponPayments,
  };
}

function normalizeGenderForForm(raw?: string | null) {
  const normalized = (raw || '').trim().toUpperCase();
  if (normalized === 'M' || normalized === 'MALE' || normalized === '남' || normalized === '남성') {
    return 'M';
  }
  if (normalized === 'F' || normalized === 'FEMALE' || normalized === '여' || normalized === '여성') {
    return 'F';
  }
  return '';
}

function buildCalendarCells(monthCursor: Date) {
  const firstDay = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const startOffset = firstDay.getDay();
  return Array.from({ length: 42 }, (_, index) => {
    const cellDate = new Date(
      monthCursor.getFullYear(),
      monthCursor.getMonth(),
      index - startOffset + 1,
    );
    return {
      date: cellDate,
      isoDate: toIsoDate(cellDate),
      inMonth: cellDate.getMonth() === monthCursor.getMonth(),
    };
  });
}

function getWeekendHeaderTone(dayOfWeek: number) {
  if (dayOfWeek === 0) return 'text-rose-500';
  if (dayOfWeek === 6) return 'text-blue-500';
  return 'text-slate-600';
}

function getCalendarDateTone(dayOfWeek: number, inMonth: boolean) {
  if (dayOfWeek === 0) return inMonth ? 'text-rose-500' : 'text-rose-300';
  if (dayOfWeek === 6) return inMonth ? 'text-blue-500' : 'text-blue-300';
  return inMonth ? 'text-slate-700' : 'text-slate-400';
}

function getExpectedMinutes(services: ReservationService[]) {
  return services.reduce((sum, service) => sum + service.durationMinutes, 0);
}

function getExpectedAmount(services: ReservationService[]) {
  return services.reduce((sum, service) => sum + service.unitPrice, 0);
}

function normalizeStatusText(code: string, label: string) {
  return `${code} ${label}`.toUpperCase();
}

function getStatusTone(code: string, label: string): StatusTone {
  const normalized = normalizeStatusText(code, label);
  if (normalized.includes('CANCEL')) {
    return {
      badge: 'bg-rose-50 text-rose-700 border-rose-200',
      chip: 'bg-rose-100 text-rose-700',
      dot: 'bg-rose-500',
    };
  }
  if (normalized.includes('COMPLETE')) {
    return {
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      chip: 'bg-emerald-100 text-emerald-700',
      dot: 'bg-emerald-500',
    };
  }
  return {
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    chip: 'bg-sky-100 text-sky-700',
    dot: 'bg-sky-500',
  };
}

function sortReservations(items: ReservationRecord[]) {
  return [...items].sort((a, b) => {
    const dateCompare = a.reservationDate.localeCompare(b.reservationDate);
    if (dateCompare !== 0) return dateCompare;
    return a.startTime.localeCompare(b.startTime);
  });
}

// DB 응답(row) 구조를 화면에서 쓰는 예약 구조로 변환한다.
function mapReservationRowToRecord(
  row: ReservationRow,
  memberPhoneByName: Map<string, string>,
): ReservationRecord {
  const phoneByName = memberPhoneByName.get(normalizeNameKey(row.customer_name)) || '';
  const phoneFromCustomerName = extractPhoneText(row.customer_name);
  return {
    id: row.reservation_id,
    reservationDate: row.reservation_date,
    startTime: normalizeTimeValue(row.start_time),
    customerName: row.customer_name,
    gender: row.gender || '',
    customerPhone: phoneByName || phoneFromCustomerName,
    designerName: row.designer_name,
    status: row.status,
    note: row.note || '',
    services: (row.services || []).map((service) => ({
      lineId: service.line_id,
      serviceId: service.service_id,
      categoryCode: service.category_code,
      categoryName: service.category_name,
      serviceName: service.service_name,
      unitPrice: service.unit_price,
      durationMinutes: service.duration_minutes,
    })),
  };
}

// 새로 추가하는 시술의 임시 lineId가 기존 DB lineId와 겹치지 않도록 보정한다.
function getNextLineIdSeed(items: ReservationRecord[]) {
  const maxLineId = items.reduce((max, reservation) => {
    const currentMax = reservation.services.reduce(
      (lineMax, service) => Math.max(lineMax, service.lineId),
      0,
    );
    return Math.max(max, currentMax);
  }, 0);

  return Math.max(maxLineId + 1, 2000);
}

// 이름 목록은 중복/공백 제거 후 한글 정렬로 맞춰 셀렉트 품질을 일정하게 유지한다.
function toUniqueSortedNames(items: string[]) {
  return Array.from(
    new Set(
      items
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b, 'ko'));
}

function createEmptyForm(
  date: string,
  status: string,
  category: string,
  selectedServiceId = '',
): ReservationForm {
  return {
    reservationDate: date,
    startTime: '10:00',
    customerName: '',
    gender: '',
    designerName: '',
    status,
    note: '',
    selectedCategory: category,
    selectedServiceId,
    services: [],
  };
}

export default function ReservationCalendarPage() {
  const pt = usePageText('user_management_reservation_calendar');
  const [statusOptions, setStatusOptions] = useState<CodeOption[]>(FALLBACK_STATUSES);
  const [categories, setCategories] = useState<CodeOption[]>(FALLBACK_CATEGORIES);
  const [serviceItems, setServiceItems] = useState<ServiceItem[]>([]);
  const [paymentMethodOptions, setPaymentMethodOptions] =
    useState<PaymentMethodOption[]>(FALLBACK_PAYMENT_METHODS);
  const [members, setMembers] = useState<MemberLookup[]>([]);
  const [memberPhoneByName, setMemberPhoneByName] = useState<Map<string, string>>(new Map());
  const [memberIdByName, setMemberIdByName] = useState<Map<string, number | null>>(new Map());
  const [designerNames, setDesignerNames] = useState<string[]>([]);
  const [designerIdByName, setDesignerIdByName] = useState<Map<string, number>>(new Map());
  const [reservations, setReservations] = useState<ReservationRecord[]>(INITIAL_RESERVATIONS);
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [viewMode, setViewMode] = useState<ReservationViewMode>('calendar');
  const [listRangeMode, setListRangeMode] = useState<ListRangeMode>('day');
  const [listSearchKeyword, setListSearchKeyword] = useState('');
  const modalDragControls = useDragControls();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [nextLineId, setNextLineId] = useState(2000);
  const [calculatorDiscountAmount, setCalculatorDiscountAmount] = useState(0);
  const [quickPaymentLines, setQuickPaymentLines] = useState<QuickPaymentLine[]>([]);
  const [nextQuickPaymentLineId, setNextQuickPaymentLineId] = useState(1);
  const [customerPhoneQuery, setCustomerPhoneQuery] = useState('');
  const [isCustomerLookupOpen, setIsCustomerLookupOpen] = useState(false);
  const [selectedCustomerMemberId, setSelectedCustomerMemberId] = useState<string>('');
  const [linkedSettlementState, setLinkedSettlementState] =
    useState<LinkedSettlementState>('NONE');
  const [isSettlementStateLoading, setIsSettlementStateLoading] = useState(false);
  const linkedSettlementRequestIdRef = useRef(0);
  const [form, setForm] = useState<ReservationForm>(() =>
    createEmptyForm(
      todayIso(),
      FALLBACK_STATUSES[0].code,
      FALLBACK_CATEGORIES[0].code,
      '',
    ),
  );

  const isDbBusy = isLoading || isMutating;
  const isOverlayVisible = isDbBusy || isSettlementStateLoading;
  const overlayMessage = isMutating
    ? pt('t042')
    : isSettlementStateLoading
      ? pt('t137')
      : pt('t041');

  const weekdayLabels = WEEKDAY_TEXT_KEYS.map((key) => pt(key));

  const getStatusLabelByCode = (code: string, fallback?: string) => {
    const textKey = STATUS_TEXT_KEY_BY_CODE[code.toUpperCase()];
    if (textKey) return pt(textKey);
    return fallback || code;
  };

  const getCategoryLabelByCode = (code: string, fallback?: string) => {
    const textKey = CATEGORY_TEXT_KEY_BY_CODE[code.toUpperCase()];
    if (textKey) return pt(textKey);
    return fallback || code;
  };

  const getPaymentMethodLabelByCode = (code: string, fallback?: string) => {
    const textKey = PAYMENT_METHOD_TEXT_KEY_BY_CODE[code.toUpperCase()];
    if (textKey) return pt(textKey);
    return fallback || code;
  };

  const getGenderLabel = (gender?: string) => {
    const normalized = (gender || '').trim().toUpperCase();
    if (normalized === 'M' || normalized === 'MALE' || normalized === '남' || normalized === '남성') {
      return pt('t102');
    }
    if (normalized === 'F' || normalized === 'FEMALE' || normalized === '여' || normalized === '여성') {
      return pt('t103');
    }
    return gender?.trim() || '-';
  };

  const statusMap = useMemo(
    () => new Map(statusOptions.map((status) => [status.code, status])),
    [statusOptions],
  );

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.code, category])),
    [categories],
  );

  const calendarCells = useMemo(() => buildCalendarCells(monthCursor), [monthCursor]);

  const reservationsByDate = useMemo(() => {
    const map = new Map<string, ReservationRecord[]>();
    reservations.forEach((reservation) => {
      const current = map.get(reservation.reservationDate) || [];
      current.push(reservation);
      map.set(reservation.reservationDate, current);
    });
    map.forEach((value, key) => {
      map.set(
        key,
        [...value].sort((a, b) => a.startTime.localeCompare(b.startTime)),
      );
    });
    return map;
  }, [reservations]);

  const selectedDateReservations = useMemo(
    () => reservationsByDate.get(selectedDate) || [],
    [reservationsByDate, selectedDate],
  );

  const listReservations = useMemo(() => {
    const keyword = listSearchKeyword.trim().toLowerCase();
    const searchPhoneDigits = normalizePhoneDigits(listSearchKeyword);
    const selectedYear = selectedDate.slice(0, 4);
    const selectedMonth = selectedDate.slice(0, 7);

    return sortReservations(
      reservations.filter((reservation) => {
        if (listRangeMode === 'day' && reservation.reservationDate !== selectedDate) return false;
        if (listRangeMode === 'month' && !reservation.reservationDate.startsWith(selectedMonth)) return false;
        if (listRangeMode === 'year' && !reservation.reservationDate.startsWith(selectedYear)) return false;

        if (!keyword && !searchPhoneDigits) return true;

        const customerName = reservation.customerName.toLowerCase();
        const customerPhone = (reservation.customerPhone || '').toLowerCase();
        const customerPhoneDigits = normalizePhoneDigits(reservation.customerPhone);

        if (keyword && (customerName.includes(keyword) || customerPhone.includes(keyword))) return true;
        if (searchPhoneDigits && customerPhoneDigits.includes(searchPhoneDigits)) return true;
        return false;
      }),
    );
  }, [listRangeMode, listSearchKeyword, reservations, selectedDate]);

  const listYearOptions = useMemo(() => {
    const years = new Set<string>();
    reservations.forEach((reservation) => {
      years.add(reservation.reservationDate.slice(0, 4));
    });
    years.add(selectedDate.slice(0, 4));
    years.add(String(new Date().getFullYear()));
    return Array.from(years).sort((a, b) => a.localeCompare(b));
  }, [reservations, selectedDate]);

  const listHeaderLabel = useMemo(() => {
    if (listRangeMode === 'year') return pt('t096', { year: selectedDate.slice(0, 4) });
    if (listRangeMode === 'month') return pt('t097', { month: selectedDate.slice(0, 7) });
    return formatDateLabel(selectedDate, weekdayLabels);
  }, [listRangeMode, pt, selectedDate, weekdayLabels]);

  const categoryServices = useMemo(() => {
    return serviceItems.filter((service) => service.categoryCode === form.selectedCategory);
  }, [serviceItems, form.selectedCategory]);

  const selectedService = useMemo(
    () => categoryServices.find((service) => String(service.id) === form.selectedServiceId) || null,
    [categoryServices, form.selectedServiceId],
  );

  const formExpectedMinutes = useMemo(
    () => getExpectedMinutes(form.services),
    [form.services],
  );

  const formExpectedAmount = useMemo(
    () => getExpectedAmount(form.services),
    [form.services],
  );

  const customerPhoneQueryDigits = useMemo(
    () => normalizePhoneDigits(customerPhoneQuery),
    [customerPhoneQuery],
  );

  const filteredCustomerMembers = useMemo(() => {
    if (!customerPhoneQueryDigits) return members;
    return members.filter((member) => member.phoneDigits.includes(customerPhoneQueryDigits));
  }, [customerPhoneQueryDigits, members]);

  const selectedCustomerMember = useMemo(() => {
    const memberId = Number.parseInt(selectedCustomerMemberId, 10);
    if (!Number.isFinite(memberId) || memberId <= 0) return null;
    return members.find((member) => member.id === memberId) || null;
  }, [members, selectedCustomerMemberId]);

  const customerLookupMembers = useMemo(() => {
    if (!customerPhoneQueryDigits) return [];
    if (!selectedCustomerMember) return filteredCustomerMembers.slice(0, 8);
    if (filteredCustomerMembers.some((member) => member.id === selectedCustomerMember.id)) {
      return filteredCustomerMembers.slice(0, 8);
    }
    return [selectedCustomerMember, ...filteredCustomerMembers].slice(0, 8);
  }, [customerPhoneQueryDigits, filteredCustomerMembers, selectedCustomerMember]);

  const selectedCustomerSummary = useMemo(() => {
    const memberName = (selectedCustomerMember?.name || '').trim();
    const memberPhone = (selectedCustomerMember?.phone || '').trim();
    if (memberName) {
      return memberPhone ? `${memberName} (${memberPhone})` : memberName;
    }

    const fallbackName = (form.customerName || '').trim();
    const fallbackPhone = (customerPhoneQuery || '').trim();
    if (fallbackName && fallbackPhone) {
      const fallbackNameDigits = normalizePhoneDigits(fallbackName);
      const fallbackPhoneDigits = normalizePhoneDigits(fallbackPhone);
      if (fallbackNameDigits && fallbackNameDigits === fallbackPhoneDigits) return fallbackPhone;
      return `${fallbackName} (${fallbackPhone})`;
    }
    if (fallbackName) return fallbackName;
    if (fallbackPhone) return fallbackPhone;
    return '';
  }, [customerPhoneQuery, form.customerName, selectedCustomerMember]);

  const selectedMemberUserId = useMemo(() => {
    const selectedMemberId = Number.parseInt(selectedCustomerMemberId, 10);
    if (Number.isFinite(selectedMemberId) && selectedMemberId > 0) {
      return selectedMemberId;
    }
    const key = normalizeNameKey(form.customerName);
    if (!key) return null;
    const memberId = memberIdByName.get(key);
    return typeof memberId === 'number' && Number.isFinite(memberId) && memberId > 0
      ? memberId
      : null;
  }, [form.customerName, memberIdByName, selectedCustomerMemberId]);

  const resolveMemberUserIdFromIdentifier = useCallback((identifier?: string | null) => {
    const raw = (identifier || '').trim();
    if (!raw) return null;

    if (/^\d+$/.test(raw)) {
      const numericId = Number(raw);
      if (Number.isFinite(numericId) && numericId > 0) {
        const matchedById = members.find((member) => member.id === numericId);
        if (matchedById) return matchedById.id;
      }
    }

    const digits = normalizePhoneDigits(raw);
    if (digits.length >= 7) {
      const matchedByPhone = members.find((member) => {
        const memberDigits = member.phoneDigits;
        if (!memberDigits || memberDigits.length < 7) return false;
        return memberDigits === digits || memberDigits.endsWith(digits) || digits.endsWith(memberDigits);
      });
      if (matchedByPhone) return matchedByPhone.id;
    }

    const nameKey = normalizeNameKey(raw);
    if (!nameKey) return null;
    const matchedByName = members.find((member) => normalizeNameKey(member.name) === nameKey);
    return matchedByName?.id || null;
  }, [members]);

  const resolveMemberIdentifierByUserId = useCallback((memberId?: number | null) => {
    if (!memberId || !Number.isFinite(memberId) || memberId <= 0) return null;
    const matchedMember = members.find((member) => member.id === memberId);
    if (!matchedMember) return null;
    const phone = matchedMember.phone.trim();
    if (phone) return phone;
    const name = matchedMember.name.trim();
    return name || null;
  }, [members]);

  const serviceStartStatusCode = useMemo(() => {
    const processingStatus = statusOptions.find((status) =>
      status.code.trim().toUpperCase().includes('PROCESS'),
    )?.code;
    if (processingStatus) return processingStatus;

    const reservedStatus = statusOptions.find((status) =>
      status.code.trim().toUpperCase().includes('RESERV'),
    )?.code;
    if (reservedStatus) return reservedStatus;

    return statusOptions[0]?.code || FALLBACK_STATUSES[0].code;
  }, [statusOptions]);

  const isPaymentCompleted = linkedSettlementState === 'COMPLETED';
  const isCompletedSettlementLocked = modalMode === 'edit' && isPaymentCompleted;
  const isReservationFormLocked =
    isDbBusy || isSettlementStateLoading || isCompletedSettlementLocked;
  const isQuickPaymentReadOnly = isPaymentCompleted || isSettlementStateLoading;
  const isPaymentCancelAction = modalMode === 'edit' && isPaymentCompleted;
  const isPaymentActionDisabled = isPaymentCancelAction
    ? isDbBusy || isSettlementStateLoading || !editingId
    : isDbBusy || isSettlementStateLoading || isPaymentCompleted;
  const paymentActionLabel = isPaymentCancelAction ? pt('t130') : pt('t122');

  const manualPaymentMethodOptions = useMemo(
    () => {
      const filtered = paymentMethodOptions.filter((method) => {
        const methodCode = method.code.trim().toUpperCase();
        if (methodCode === 'COUPON') return false;
        if (!selectedMemberUserId && isBalancePaymentMethod(methodCode)) return false;
        return true;
      });
      if (filtered.length > 0) return filtered;
      return FALLBACK_PAYMENT_METHODS;
    },
    [paymentMethodOptions, selectedMemberUserId],
  );

  const calculatorPayableAmount = useMemo(
    () => Math.max(formExpectedAmount - calculatorDiscountAmount, 0),
    [formExpectedAmount, calculatorDiscountAmount],
  );

  const calculatorPaidTotal = useMemo(
    () => quickPaymentLines.reduce((sum, line) => sum + line.amount, 0),
    [quickPaymentLines],
  );

  const calculatorRemainingAmount = calculatorPayableAmount - calculatorPaidTotal;

  // 공통코드/시술목록 조회: 예약 폼에서 쓰는 선택값을 준비한다.
  const loadLookupData = async () => {
    const [commonResult, serviceResult, memberResult, employeeResult] = await Promise.all([
      invokeDbCommand<{
        success: boolean;
        message: string;
        details: Array<{
          group: string;
          code: string;
          name: string;
          order: number;
          use_yn: 'Y' | 'N';
        }>;
      }>('get_common_code_management_data'),
      invokeDbCommand<{
        success: boolean;
        message: string;
        items: Array<{
          service_id: number;
          category_code: string;
          category_name: string;
          service_name: string;
          unit_price: number;
          duration_minutes: number;
          use_yn: 'Y' | 'N';
          note: string | null;
        }>;
      }>('get_service_catalog_data'),
      invokeDbCommand<{
        success: boolean;
        message: string;
        users: Array<{
          user_id: number;
          name: string;
          phone: string | null;
        }>;
      }>('get_user_management_data'),
      invokeDbCommand<{
        success: boolean;
        message: string;
        employees: Array<{
          employee_id: number;
          employee_name: string;
        }>;
      }>('get_employee_management_data'),
    ]);

    const details = commonResult.details || [];
    const loadedStatuses = details
      .filter((detail) => detail.group === STATUS_GROUP_ID && detail.use_yn === 'Y')
      .sort(
        (a, b) => (a.order - b.order) || a.code.localeCompare(b.code),
      )
      .map((detail) => ({
        code: detail.code,
        label: detail.name?.trim() || getStatusLabelByCode(detail.code),
        order: detail.order,
      }));

    const loadedServices = (serviceResult.items || [])
      .filter((item) => item.use_yn === 'Y')
      .map((item) => ({
        id: item.service_id,
        categoryCode: item.category_code,
        categoryName: item.category_name?.trim() || getCategoryLabelByCode(item.category_code),
        serviceName: item.service_name,
        unitPrice: item.unit_price,
        durationMinutes: item.duration_minutes,
      }))
      .sort((a, b) => {
        const categoryCompare = a.categoryCode.localeCompare(b.categoryCode);
        if (categoryCompare !== 0) return categoryCompare;
        return a.serviceName.localeCompare(b.serviceName);
      });

    const loadedCategories = details
      .filter((detail) => detail.group === CATEGORY_GROUP_ID && detail.use_yn === 'Y')
      .sort(
        (a, b) => (a.order - b.order) || a.code.localeCompare(b.code),
      )
      .map((detail) => ({
        code: detail.code,
        label: detail.name?.trim() || getCategoryLabelByCode(detail.code),
        order: detail.order,
      }));

    const loadedPaymentMethods = details
      .filter((detail) => detail.group === PAYMENT_METHOD_GROUP_ID && detail.use_yn === 'Y')
      .sort(
        (a, b) => (a.order - b.order) || a.code.localeCompare(b.code),
      )
      .map((detail) => ({
        code: detail.code,
        label: detail.name?.trim() || getPaymentMethodLabelByCode(detail.code),
        order: detail.order,
      }));

    const serviceDerivedCategories = Array.from(
      loadedServices.reduce((map, item) => {
        if (!map.has(item.categoryCode)) {
          map.set(item.categoryCode, {
            code: item.categoryCode,
            label: item.categoryName?.trim() || getCategoryLabelByCode(item.categoryCode),
            order: map.size + 1,
          });
        }
        return map;
      }, new Map<string, CodeOption>()),
    ).map(([, value]) => value);

    const nextStatuses =
      loadedStatuses.length > 0 ? loadedStatuses : FALLBACK_STATUSES;
    const nextCategories =
      loadedCategories.length > 0
        ? loadedCategories
        : serviceDerivedCategories.length > 0
          ? serviceDerivedCategories
          : FALLBACK_CATEGORIES;
    const nextPaymentMethods =
      loadedPaymentMethods.length > 0
        ? loadedPaymentMethods
        : FALLBACK_PAYMENT_METHODS.map((method) => ({
          ...method,
          label: getPaymentMethodLabelByCode(method.code),
        }));

    // 고객 선택은 회원명/전화번호를 함께 제공해 예약 등록 시 식별 정확도를 높인다.
    const nextMembers = (memberResult.users || [])
      .map((user) => {
        const memberId = Number(user.user_id);
        const memberName = (user.name || '').trim();
        const memberPhone = (user.phone || '').trim();
        if (!Number.isFinite(memberId) || memberId <= 0 || !memberName) return null;
        return {
          id: memberId,
          name: memberName,
          phone: memberPhone,
          phoneDigits: normalizePhoneDigits(memberPhone),
        };
      })
      .filter((member): member is MemberLookup => member !== null)
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, 'ko')
          || a.phone.localeCompare(b.phone)
          || (a.id - b.id),
      );
    const nextMemberPhoneByName = (memberResult.users || []).reduce((map, user) => {
      const key = normalizeNameKey(user.name || '');
      const phone = (user.phone || '').trim();
      if (!key || !phone || map.has(key)) return map;
      map.set(key, phone);
      return map;
    }, new Map<string, string>());
    const nextMemberIdByName = (memberResult.users || []).reduce((map, user) => {
      const key = normalizeNameKey(user.name || '');
      const userId = Number(user.user_id);
      if (!key || !Number.isFinite(userId) || userId <= 0) return map;

      if (!map.has(key)) {
        map.set(key, userId);
        return map;
      }

      const existingValue = map.get(key);
      if (typeof existingValue === 'number' && existingValue !== userId) {
        // 동일 이름 회원이 복수인 경우 자동 매핑을 막아 잘못된 차감을 방지한다.
        map.set(key, null);
      }

      return map;
    }, new Map<string, number | null>());
    const nextDesignerNames = toUniqueSortedNames(
      (employeeResult.employees || []).map((employee) => employee.employee_name || ''),
    );
    const nextDesignerIdByName = (employeeResult.employees || []).reduce((map, employee) => {
      const key = normalizeNameKey(employee.employee_name || '');
      const employeeId = Number(employee.employee_id);
      if (!key || !Number.isFinite(employeeId) || employeeId <= 0 || map.has(key)) return map;
      map.set(key, employeeId);
      return map;
    }, new Map<string, number>());

    setStatusOptions(nextStatuses);
    setCategories(nextCategories);
    setServiceItems(loadedServices);
    setPaymentMethodOptions(nextPaymentMethods);
    setMembers(nextMembers);
    setMemberPhoneByName(nextMemberPhoneByName);
    setMemberIdByName(nextMemberIdByName);
    setDesignerNames(nextDesignerNames);
    setDesignerIdByName(nextDesignerIdByName);

    return nextMemberPhoneByName;
  };

  // 예약 목록 조회: 헤더 + 시술라인을 화면에서 쓰는 구조로 변환한다.
  const loadReservations = async (phoneMap?: Map<string, string>) => {
    const result = await invokeDbCommand<{
      success: boolean;
      message: string;
      reservations: ReservationRow[];
    }>('get_reservation_calendar_data');

    const safePhoneMap = phoneMap || memberPhoneByName;
    const mappedReservations = sortReservations(
      (result.reservations || []).map((row) => mapReservationRowToRecord(row, safePhoneMap)),
    );
    setReservations(mappedReservations);
    setNextLineId(getNextLineIdSeed(mappedReservations));
  };

  const findLinkedSettlementByReservationId = async (reservationId: number) => {
    const result = await invokeDbCommand<{
      success: boolean;
      message: string;
      settlements: SalesSettlementRow[];
    }>('get_sales_settlement_data');

    return (result.settlements || []).find((settlement) => {
      const reservationRef = (settlement.reservation_ref || '').trim();
      return reservationRef === String(reservationId);
    }) || null;
  };

  const loadLinkedSettlementState = async (
    reservation: ReservationRecord,
    requestId: number,
  ) => {
    try {
      setIsSettlementStateLoading(true);
      const linkedSettlement = await findLinkedSettlementByReservationId(reservation.id);
      if (linkedSettlementRequestIdRef.current !== requestId) return;
      const settlementState = normalizeSettlementState(linkedSettlement?.status);
      setLinkedSettlementState(settlementState);

      if (settlementState !== 'COMPLETED' || !linkedSettlement) return;

      const settlementMemberId = resolveMemberUserIdFromIdentifier(linkedSettlement.member_user_id);
      if (settlementMemberId) {
        setSelectedCustomerMemberId(String(settlementMemberId));
      }

      const quickSnapshot = buildQuickCalculatorSnapshotFromSettlement(linkedSettlement);
      setCalculatorDiscountAmount(quickSnapshot.discountAmount);
      setQuickPaymentLines(quickSnapshot.paymentLines);
      setNextQuickPaymentLineId(quickSnapshot.paymentLines.length + 1);
    } catch (error) {
      if (linkedSettlementRequestIdRef.current !== requestId) return;
      console.error('Failed to load linked settlement state:', error);
      setLinkedSettlementState('NONE');
    } finally {
      if (linkedSettlementRequestIdRef.current === requestId) {
        setIsSettlementStateLoading(false);
      }
    }
  };

  // 초기 진입 시 조회성 데이터는 한 번에 불러와 화면 깜빡임을 줄인다.
  const loadInitialData = async () => {
    try {
      setIsLoading(true);
      const phoneMap = await loadLookupData();
      await loadReservations(phoneMap);
    } catch (error) {
      console.error('Failed to load reservation page data:', error);
      setStatusOptions(FALLBACK_STATUSES);
      setCategories(FALLBACK_CATEGORIES);
      setPaymentMethodOptions(FALLBACK_PAYMENT_METHODS);
      setMembers([]);
      setMemberPhoneByName(new Map());
      setMemberIdByName(new Map());
      setDesignerNames([]);
      setDesignerIdByName(new Map());
      setReservations([]);
      alert(
        typeof error === 'string'
          ? error
          : (error as { message?: string })?.message || pt('t035'),
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setForm((prev) => {
      const nextStatus = statusOptions.some((status) => status.code === prev.status)
        ? prev.status
        : (statusOptions[0]?.code || prev.status);

      const nextCategory = categories.some((category) => category.code === prev.selectedCategory)
        ? prev.selectedCategory
        : (categories[0]?.code || prev.selectedCategory);

      const nextCategoryServices = serviceItems.filter(
        (service) => service.categoryCode === nextCategory,
      );
      const nextSelectedService = nextCategoryServices.some(
        (service) => String(service.id) === prev.selectedServiceId,
      )
        ? prev.selectedServiceId
        : (nextCategoryServices[0] ? String(nextCategoryServices[0].id) : '');

      if (
        nextStatus === prev.status
        && nextCategory === prev.selectedCategory
        && nextSelectedService === prev.selectedServiceId
      ) {
        return prev;
      }

      return {
        ...prev,
        status: nextStatus,
        selectedCategory: nextCategory,
        selectedServiceId: nextSelectedService,
      };
    });
  }, [statusOptions, categories, serviceItems]);

  useEffect(() => {
    setCalculatorDiscountAmount((prev) => Math.min(prev, formExpectedAmount));
  }, [formExpectedAmount]);

  useEffect(() => {
    if (selectedMemberUserId) return;
    setQuickPaymentLines((prev) =>
      prev.filter((line) => !isBalancePaymentMethod(line.methodCode)),
    );
  }, [selectedMemberUserId]);

  const getStatusLabel = (statusCode: string) => {
    const commonCodeLabel = statusMap.get(statusCode)?.label?.trim();
    if (commonCodeLabel) return commonCodeLabel;
    return getStatusLabelByCode(statusCode, statusCode);
  };

  const resetQuickCalculator = () => {
    setCalculatorDiscountAmount(0);
    setQuickPaymentLines([]);
    setNextQuickPaymentLineId(1);
  };

  const addQuickPaymentLine = () => {
    if (isQuickPaymentReadOnly) return;
    if (calculatorRemainingAmount <= 0) return;
    const defaultMethodCode =
      manualPaymentMethodOptions[0]?.code || FALLBACK_PAYMENT_METHODS[0].code;
    const nextAmount = Math.max(calculatorRemainingAmount, 0);
    setQuickPaymentLines((prev) => [
      ...prev,
      {
        lineId: nextQuickPaymentLineId,
        methodCode: defaultMethodCode,
        amount: nextAmount,
      },
    ]);
    setNextQuickPaymentLineId((prev) => prev + 1);
  };

  const removeQuickPaymentLine = (lineId: number) => {
    if (isQuickPaymentReadOnly) return;
    setQuickPaymentLines((prev) => prev.filter((line) => line.lineId !== lineId));
  };

  const updateQuickPaymentLine = (
    lineId: number,
    field: 'methodCode' | 'amount',
    value: string | number,
  ) => {
    if (isQuickPaymentReadOnly) return;
    setQuickPaymentLines((prev) =>
      prev.map((line) => (line.lineId === lineId
        ? {
          ...line,
          [field]: field === 'amount' ? toAmountNumber(value) : String(value),
        }
        : line)),
    );
  };

  const openCreateModal = (date = selectedDate) => {
    const defaultStatus = statusOptions[0]?.code || FALLBACK_STATUSES[0].code;
    const defaultCategory =
      categories[0]?.code || serviceItems[0]?.categoryCode || FALLBACK_CATEGORIES[0].code;
    const defaultServiceId =
      serviceItems.find((service) => service.categoryCode === defaultCategory)?.id;
    const defaultDesignerName = designerNames[0] || '';

    linkedSettlementRequestIdRef.current += 1;
    setModalMode('create');
    setEditingId(null);
    setLinkedSettlementState('NONE');
    setIsSettlementStateLoading(false);
    setSelectedCustomerMemberId('');
    setCustomerPhoneQuery('');
    setIsCustomerLookupOpen(false);
    setForm(
      {
        ...createEmptyForm(
          date,
          defaultStatus,
          defaultCategory,
          defaultServiceId ? String(defaultServiceId) : '',
        ),
        // 디자이너는 직원 목록에서 선택하는 구조라 첫 번째 직원을 기본값으로 둔다.
        designerName: defaultDesignerName,
      },
    );
    resetQuickCalculator();
    setIsModalOpen(true);
  };

  const openEditModal = (reservation: ReservationRecord) => {
    const preferredCategory =
      reservation.services[0]?.categoryCode
      || categories[0]?.code
      || serviceItems[0]?.categoryCode
      || FALLBACK_CATEGORIES[0].code;
    const defaultServiceId =
      serviceItems.find((service) => service.categoryCode === preferredCategory)?.id;
    const customerNameKey = normalizeNameKey(reservation.customerName);
    const mappedMemberId = memberIdByName.get(customerNameKey);
    const customerPhoneDigits = normalizePhoneDigits(reservation.customerPhone);
    const matchedMemberByPhone = customerPhoneDigits
      ? members.find(
        (member) =>
          member.phoneDigits === customerPhoneDigits
          && normalizeNameKey(member.name) === customerNameKey,
      ) || members.find((member) => member.phoneDigits === customerPhoneDigits)
      : null;
    const matchedMemberByName =
      typeof mappedMemberId === 'number'
        ? members.find((member) => member.id === mappedMemberId) || null
        : null;
    const matchedMember = matchedMemberByPhone || matchedMemberByName;
    const nextRequestId = linkedSettlementRequestIdRef.current + 1;
    linkedSettlementRequestIdRef.current = nextRequestId;

    setModalMode('edit');
    setEditingId(reservation.id);
    setLinkedSettlementState('NONE');
    setSelectedCustomerMemberId(matchedMember ? String(matchedMember.id) : '');
    setCustomerPhoneQuery(matchedMember?.phone || reservation.customerPhone || '');
    setIsCustomerLookupOpen(false);
    setForm({
      reservationDate: reservation.reservationDate,
      startTime: reservation.startTime,
      customerName: reservation.customerName,
      gender: normalizeGenderForForm(reservation.gender),
      designerName: reservation.designerName,
      status: reservation.status,
      note: reservation.note,
      selectedCategory: preferredCategory,
      selectedServiceId: defaultServiceId ? String(defaultServiceId) : '',
      services: reservation.services.map((service, index) => ({
        ...service,
        lineId: service.lineId || Date.now() + index,
      })),
    });
    resetQuickCalculator();
    setIsModalOpen(true);
    void loadLinkedSettlementState(reservation, nextRequestId);
  };

  const closeModal = () => {
    linkedSettlementRequestIdRef.current += 1;
    resetQuickCalculator();
    setLinkedSettlementState('NONE');
    setIsSettlementStateLoading(false);
    setSelectedCustomerMemberId('');
    setCustomerPhoneQuery('');
    setIsCustomerLookupOpen(false);
    setIsModalOpen(false);
  };

  const handleCustomerMemberSelect = (memberIdRaw: string) => {
    if (isCompletedSettlementLocked) return;
    setIsCustomerLookupOpen(false);
    setSelectedCustomerMemberId(memberIdRaw);
    const memberId = Number.parseInt(memberIdRaw, 10);
    if (!Number.isFinite(memberId) || memberId <= 0) return;
    const matchedMember = members.find((member) => member.id === memberId);
    if (!matchedMember) return;
    setForm((prev) => ({
      ...prev,
      customerName: matchedMember.name,
    }));
    setCustomerPhoneQuery(matchedMember.phone);
  };

  const handleCustomerPhoneQueryChange = (value: string) => {
    if (isCompletedSettlementLocked) return;
    setCustomerPhoneQuery(value);
    setIsCustomerLookupOpen(true);
    const digits = normalizePhoneDigits(value);
    if (!digits) {
      setIsCustomerLookupOpen(false);
      if (!value.trim()) {
        setSelectedCustomerMemberId('');
        setForm((prev) => ({ ...prev, customerName: '' }));
      }
      return;
    }
    if (selectedCustomerMember && !selectedCustomerMember.phoneDigits.includes(digits)) {
      setSelectedCustomerMemberId('');
      setForm((prev) => ({ ...prev, customerName: '' }));
    }
    const matchedMembers = members.filter((member) => member.phoneDigits.includes(digits));
    if (matchedMembers.length !== 1) return;
    const matchedMember = matchedMembers[0];
    setSelectedCustomerMemberId(String(matchedMember.id));
    setForm((prev) => ({
      ...prev,
      customerName: matchedMember.name,
    }));
    setIsCustomerLookupOpen(false);
  };

  const addSelectedService = () => {
    if (isCompletedSettlementLocked) return;
    if (!selectedService) {
      alert(pt('t011'));
      return;
    }

    if (form.services.some((service) => service.serviceId === selectedService.id)) {
      alert(pt('t023'));
      return;
    }

    setForm((prev) => ({
      ...prev,
      services: [
        ...prev.services,
        {
          lineId: nextLineId,
          serviceId: selectedService.id,
          categoryCode: selectedService.categoryCode,
          categoryName:
            getCategoryLabelByCode(
              selectedService.categoryCode,
              categoryMap.get(selectedService.categoryCode)?.label || selectedService.categoryName,
            ),
          serviceName: selectedService.serviceName,
          unitPrice: selectedService.unitPrice,
          durationMinutes: selectedService.durationMinutes,
        },
      ],
    }));
    setNextLineId((prev) => prev + 1);
  };

  const removeService = (lineId: number) => {
    if (isCompletedSettlementLocked) return;
    setForm((prev) => ({
      ...prev,
      services: prev.services.filter((service) => service.lineId !== lineId),
    }));
  };

  const validateReservationForm = (targetForm: ReservationForm) => {
    if (!targetForm.reservationDate || !targetForm.startTime) {
      alert(pt('t017'));
      return false;
    }
    if (!targetForm.customerName.trim() || !targetForm.designerName.trim()) {
      alert(pt('t002'));
      return false;
    }
    if (!targetForm.status) {
      alert(pt('t018'));
      return false;
    }
    if (targetForm.services.length === 0) {
      alert(pt('t010'));
      return false;
    }
    return true;
  };

  const upsertReservationItem = async (targetForm: ReservationForm) => {
    return invokeDbCommand<{
      success: boolean;
      message: string;
      reservation_id: number;
    }>(
      'upsert_reservation_calendar_item',
      {
        item: {
          reservation_id: modalMode === 'edit' ? editingId : undefined,
          reservation_date: targetForm.reservationDate,
          start_time: normalizeTimeValue(targetForm.startTime),
          customer_name: targetForm.customerName.trim(),
          gender: targetForm.gender || null,
          designer_name: targetForm.designerName.trim(),
          status: targetForm.status,
          note: targetForm.note.trim() || null,
          service_ids: targetForm.services.map((service) => service.serviceId),
        },
      },
    );
  };

  const syncProcessingSettlementForReservation = async (
    reservationId: number,
    targetForm: ReservationForm,
  ) => {
    const linkedSettlement = await findLinkedSettlementByReservationId(reservationId);
    const linkedSettlementState = normalizeSettlementState(linkedSettlement?.status);
    const canReuseLinkedSettlement =
      linkedSettlement
      && linkedSettlementState !== 'CANCELLED'
      && linkedSettlementState !== 'COMPLETED';

    const designerManagerId = designerIdByName.get(normalizeNameKey(targetForm.designerName));
    const linkedManagerId = Number(linkedSettlement?.manager_employee_id);
    const managerEmployeeId =
      (typeof designerManagerId === 'number' && Number.isFinite(designerManagerId) && designerManagerId > 0)
        ? designerManagerId
        : (Number.isFinite(linkedManagerId) && linkedManagerId > 0 ? linkedManagerId : null);
    if (!managerEmployeeId) {
      throw new Error(pt('t064'));
    }

    const serviceIds = targetForm.services
      .map((service) => Number(service.serviceId))
      .filter((serviceId) => Number.isFinite(serviceId) && serviceId > 0);
    if (serviceIds.length === 0) {
      throw new Error(pt('t010'));
    }

    const linkedMemberUserId = resolveMemberUserIdFromIdentifier(linkedSettlement?.member_user_id);
    const memberUserId =
      selectedMemberUserId
      || linkedMemberUserId
      || null;
    const linkedMemberIdentifier = (linkedSettlement?.member_user_id || '').trim();
    const memberIdentifier =
      resolveMemberIdentifierByUserId(memberUserId)
      || linkedMemberIdentifier
      || (customerPhoneQuery || '').trim()
      || targetForm.customerName.trim()
      || null;

    const payments: Array<{
      payment_method_code: string;
      amount: number;
      coupon_service_id: number | null;
    }> = [];

    if (canReuseLinkedSettlement) {
      (linkedSettlement.payments || []).forEach((payment) => {
        const methodCode = (payment.payment_method_code || '').trim().toUpperCase();
        if (!methodCode) return;
        const parsedCouponServiceId = Number(payment.coupon_service_id);
        payments.push({
          payment_method_code: methodCode,
          amount: toAmountNumber(payment.amount),
          coupon_service_id:
            Number.isFinite(parsedCouponServiceId) && parsedCouponServiceId > 0
              ? parsedCouponServiceId
              : null,
        });
      });
    }

    await invokeDbCommand<{ success: boolean; message: string }>('upsert_sales_settlement', {
      settlement: {
        settlement_id: canReuseLinkedSettlement ? linkedSettlement.settlement_id : undefined,
        member_user_id: memberIdentifier,
        manager_employee_id: managerEmployeeId,
        service_ids: serviceIds,
        payments,
        status: 'PROCESSING',
        reservation_ref: String(reservationId),
      },
    });
  };

  const saveReservationRecord = async (
    targetForm: ReservationForm,
    successFallbackText: string,
    options?: {
      forceSyncProcessingSettlement?: boolean;
    },
  ) => {
    if (!validateReservationForm(targetForm)) return false;
    let reservationSaved = false;
    try {
      setIsMutating(true);
      const result = await upsertReservationItem(targetForm);
      reservationSaved = true;

      const shouldSyncProcessingSettlement =
        options?.forceSyncProcessingSettlement || isReservationProcessingStatus(targetForm.status);

      if (shouldSyncProcessingSettlement) {
        const savedReservationId = Number(result.reservation_id);
        if (!Number.isFinite(savedReservationId) || savedReservationId <= 0) {
          throw new Error('예약 저장 결과의 reservation_id가 올바르지 않습니다.');
        }
        await syncProcessingSettlementForReservation(savedReservationId, targetForm);
      }

      await loadReservations();
      setSelectedDate(targetForm.reservationDate);
      closeModal();
      alert(result.message || successFallbackText);
      return true;
    } catch (error) {
      alert(
        typeof error === 'string'
          ? error
          : (error as { message?: string })?.message
            || (reservationSaved ? pt('t138') : pt('t038')),
      );
      return false;
    } finally {
      setIsMutating(false);
    }
  };

  // 예약 등록/수정: 진행중 상태 저장 시 매출 정산(PROCESSING)도 동기화한다.
  const saveReservation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isCompletedSettlementLocked) return;
    await saveReservationRecord(
      form,
      modalMode === 'edit' ? pt('t036') : pt('t037'),
    );
  };

  const startReservationService = async () => {
    if (isCompletedSettlementLocked) return;
    const nextForm: ReservationForm = {
      ...form,
      status: serviceStartStatusCode,
    };
    await saveReservationRecord(nextForm, pt('t128'), {
      forceSyncProcessingSettlement: true,
    });
  };

  const cancelCompletedReservationPayment = async () => {
    if (modalMode !== 'edit' || !editingId) return;
    if (!window.confirm(pt('t131'))) return;

    try {
      setIsMutating(true);
      const latestLinkedSettlement = await findLinkedSettlementByReservationId(editingId);
      const latestState = normalizeSettlementState(latestLinkedSettlement?.status);
      setLinkedSettlementState(latestState);

      if (!latestLinkedSettlement || latestState !== 'COMPLETED') {
        alert(pt('t132'));
        return;
      }

      const result = await invokeDbCommand<{ success: boolean; message: string }>(
        'cancel_sales_settlement',
        {
          settlement_id: latestLinkedSettlement.settlement_id,
          cancel_type: 'PAYMENT',
          cancel_reason: pt('t133'),
        },
      );

      await loadReservations();
      setSelectedDate(form.reservationDate);
      closeModal();
      alert(result.message || pt('t134'));
    } catch (error) {
      alert(
        typeof error === 'string'
          ? error
          : (error as { message?: string })?.message || pt('t135'),
      );
    } finally {
      setIsMutating(false);
    }
  };

  // 결제 처리: 예약 저장 후 정산 저장(회원 충전금 차감 포함)을 수행한다.
  const processReservationPayment = async () => {
    if (!validateReservationForm(form)) return;
    if (isPaymentCompleted) {
      alert(pt('t129'));
      return;
    }
    if (modalMode === 'edit' && editingId) {
      try {
        const latestLinkedSettlement = await findLinkedSettlementByReservationId(editingId);
        if (normalizeSettlementState(latestLinkedSettlement?.status) === 'COMPLETED') {
          setLinkedSettlementState('COMPLETED');
          alert(pt('t129'));
          return;
        }
      } catch (error) {
        alert(
          typeof error === 'string'
            ? error
            : (error as { message?: string })?.message || pt('t038'),
        );
        return;
      }
    }
    const normalizedQuickPayments = quickPaymentLines
      .map((line) => ({
        methodCode: line.methodCode.trim().toUpperCase(),
        amount: toAmountNumber(line.amount),
      }))
      .filter((line) => line.methodCode.length > 0 && line.amount > 0);
    if (normalizedQuickPayments.length === 0) {
      alert(pt('t123'));
      return;
    }
    if (form.status.trim().toUpperCase() !== 'COMPLETED') {
      alert(pt('t124'));
      return;
    }

    if (
      normalizedQuickPayments.some((line) => isBalancePaymentMethod(line.methodCode))
      && !selectedMemberUserId
    ) {
      alert('회원 결제수단(충전금 차감)은 회원 고객 선택 시에만 사용할 수 있습니다.');
      return;
    }
    const managerEmployeeIdForSettlement = normalizedQuickPayments.length > 0
      ? designerIdByName.get(normalizeNameKey(form.designerName))
      : undefined;
    if (normalizedQuickPayments.length > 0 && !managerEmployeeIdForSettlement) {
      alert('결제 저장을 위해 담당자를 직원 목록에서 다시 선택해 주세요.');
      return;
    }

    let reservationSaved = false;

    try {
      setIsMutating(true);
      const result = await upsertReservationItem(form);
      reservationSaved = true;

      const savedReservationId = Number(result.reservation_id);
      if (!Number.isFinite(savedReservationId) || savedReservationId <= 0) {
        throw new Error('예약 저장 결과의 reservation_id가 올바르지 않습니다.');
      }

      const linkedSettlement = await findLinkedSettlementByReservationId(savedReservationId);
      const serviceIds = form.services.map((service) => service.serviceId);
      const selectedServiceCountMap = serviceIds.reduce((map, serviceId) => {
        map.set(serviceId, (map.get(serviceId) || 0) + 1);
        return map;
      }, new Map<number, number>());
      const couponUsageCountMap = new Map<number, number>();
      const preservedCouponPayments = (linkedSettlement?.payments || [])
        .filter((payment) => payment.payment_method_code?.trim().toUpperCase() === 'COUPON')
        .filter((payment) => {
          const couponServiceId = Number(payment.coupon_service_id);
          if (!Number.isFinite(couponServiceId) || couponServiceId <= 0) return false;
          const selectedCount = selectedServiceCountMap.get(couponServiceId) || 0;
          if (selectedCount <= 0) return false;

          const nextCount = (couponUsageCountMap.get(couponServiceId) || 0) + 1;
          if (nextCount > selectedCount) return false;
          couponUsageCountMap.set(couponServiceId, nextCount);
          return true;
        })
        .map((payment) => ({
          payment_method_code: 'COUPON',
          amount: 0,
          coupon_service_id: Number(payment.coupon_service_id),
        }));

      const settlementResult = await invokeDbCommand<{ success: boolean; message: string }>('upsert_sales_settlement', {
        settlement: {
          settlement_id: linkedSettlement?.settlement_id || undefined,
          member_user_id:
            resolveMemberIdentifierByUserId(selectedMemberUserId)
            || (customerPhoneQuery || '').trim()
            || form.customerName.trim()
            || null,
          manager_employee_id: managerEmployeeIdForSettlement!,
          service_ids: serviceIds,
          payments: [
            ...normalizedQuickPayments.map((payment) => ({
              payment_method_code: payment.methodCode,
              amount: payment.amount,
              coupon_service_id: null,
            })),
            ...preservedCouponPayments,
          ],
          status: toSettlementStatusByReservationStatus(form.status),
          reservation_ref: String(savedReservationId),
        },
      });

      await loadReservations();
      setSelectedDate(form.reservationDate);
      closeModal();
      alert(settlementResult.message || pt('t125'));
    } catch (error) {
      alert(
        typeof error === 'string'
          ? error
          : (error as { message?: string })?.message
            || (reservationSaved
              ? '예약은 저장되었지만 결제 저장 중 오류가 발생했습니다.'
              : pt('t038')),
      );
    } finally {
      setIsMutating(false);
    }
  };

  // 예약 삭제: 헤더를 삭제하면 시술 라인도 CASCADE로 함께 정리된다.
  const deleteReservation = async (reservationId: number) => {
    if (!window.confirm(pt('t006'))) return;

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>(
        'delete_reservation_calendar_item',
        { reservation_id: reservationId },
      );
      await loadReservations();
      alert(result.message || pt('t039'));
    } catch (error) {
      alert(
        typeof error === 'string'
          ? error
          : (error as { message?: string })?.message || pt('t040'),
      );
    } finally {
      setIsMutating(false);
    }
  };

  const moveMonth = (diff: number) => {
    setMonthCursor(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + diff, 1),
    );
  };

  const syncSelectedDate = (isoDate: string) => {
    setSelectedDate(isoDate);
    const parsed = parseIsoDate(isoDate);
    setMonthCursor(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
  };

  const moveListRange = (diff: number) => {
    if (listRangeMode === 'year') {
      syncSelectedDate(shiftYear(selectedDate, diff));
      return;
    }
    if (listRangeMode === 'month') {
      syncSelectedDate(shiftMonth(selectedDate, diff));
      return;
    }
    syncSelectedDate(shiftDate(selectedDate, diff));
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      <LoadingOverlay visible={isOverlayVisible} message={overlayMessage} zIndex={90} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t019')}</h1>
          <p className="text-slate-500 mt-1">
            {pt('t043')}
          </p>
        </div>
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1">
          <button
            onClick={() => setViewMode('calendar')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${viewMode === 'calendar' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {pt('t044')}
          </button>
          <button
            onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${viewMode === 'list' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {pt('t045')}
          </button>
        </div>
        <button
          onClick={() => openCreateModal(selectedDate)} disabled={isDbBusy}
          className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2.5 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-60"
        >
          <PlusCircle size={16} />
          {pt('t046')}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section
          className={`${viewMode === 'calendar' ? 'xl:col-span-12' : 'hidden'} bg-white border border-slate-200 rounded-xl overflow-hidden grid-shadow`}
        >
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-primary" />
              <h2 className="text-sm font-bold text-slate-700">{pt('t022')}</h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => moveMonth(-1)} className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600"
                aria-label={pt(A11Y_TEXT_KEYS.PREVIOUS_MONTH)}
              >
                <ChevronLeft size={16} />
              </button>
              <div className="w-28 text-center text-sm font-bold text-slate-800">
                {formatMonthLabel(monthCursor)}</div>
              <button
                onClick={() => moveMonth(1)} className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600"
                aria-label={pt(A11Y_TEXT_KEYS.NEXT_MONTH)}
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => {
                  const now = new Date();
                  setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
                  setSelectedDate(todayIso());
                }}
                className="px-2.5 py-1.5 rounded-md text-xs font-semibold border border-slate-200 hover:bg-slate-100 text-slate-600"
              >
                {pt('t047')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-100">
            {weekdayLabels.map((weekday, weekdayIndex) => (
              <div
                key={`${weekday}-${weekdayIndex}`}
                className={`px-2 py-2 text-center text-xs font-bold border-r border-slate-200 last:border-r-0 ${getWeekendHeaderTone(weekdayIndex)}`}
              >
                {weekday}
              </div>
            ))}</div>

          <div className="grid grid-cols-7">
            {calendarCells.map((cell) => {
              const dayReservations = reservationsByDate.get(cell.isoDate) || [];
              const isToday = cell.isoDate === todayIso();
              const isSelected = cell.isoDate === selectedDate;
              const dayOfWeek = cell.date.getDay();
              const dayTone = getCalendarDateTone(dayOfWeek, cell.inMonth);

              return (
                <button
                  key={cell.isoDate}
                  onClick={() => setSelectedDate(cell.isoDate)} className={`min-h-[126px] border-r border-b border-slate-200 p-2 align-top text-left transition-colors ${cell.inMonth ? 'bg-white hover:bg-slate-50' : 'bg-slate-50 text-slate-400'} ${isSelected ? 'ring-2 ring-primary/40 ring-inset' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${dayTone} ${isToday ? 'font-black' : ''}`}>{cell.date.getDate()}</span>
                    {dayReservations.length > 0 && (
                      <span className="text-[10px] font-semibold text-slate-400">
                        {pt('t048', { count: dayReservations.length })}
                      </span>
                    )}</div>

                  <div className="mt-1 space-y-1">
                    {dayReservations.slice(0, 3).map((reservation) => {
                      const statusLabel = getStatusLabel(reservation.status);
                      const tone = getStatusTone(reservation.status, statusLabel);
                      return (
                        <button
                          key={reservation.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditModal(reservation);
                          }}
                          disabled={isDbBusy}
                          className={`w-full text-left rounded px-1.5 py-1 text-[10px] font-semibold truncate ${tone.chip}`}
                        >
                          {reservation.startTime} {reservation.customerName}
                        </button>
                      );
                    })} {dayReservations.length > 3 && (
                      <p className="text-[10px] text-slate-400 font-semibold pl-1">
                        {pt('t049', { count: dayReservations.length - 3 })}
                      </p>
                    )}</div>
                </button>
              );
            })}</div>
        </section>

        <section className="hidden xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <div>
              <h2 className="text-sm font-bold text-slate-700">{pt('t005')}</h2>
              <p className="text-xs text-slate-500 mt-1">{formatDateLabel(selectedDate, weekdayLabels)}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[760px]">
              <thead>
                <tr className="bg-slate-900 text-slate-200">
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t007')}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t001')}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t100')}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t004')}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t008')}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-right">{pt('t015')}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-center">{pt('t051')}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-center">{pt('t052')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selectedDateReservations.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                      {pt('t053')}
                    </td>
                  </tr>
                ) : (
                  selectedDateReservations.map((reservation) => {
                    const statusLabel = getStatusLabel(reservation.status);
                    const tone = getStatusTone(reservation.status, statusLabel);
                    return (
                      <tr key={reservation.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-slate-700">{reservation.startTime}</td>
                        <td className="py-3 px-4 text-sm text-slate-700">
                          <div className="flex items-center gap-2">
                            <UserRound size={14} className="text-slate-400" />
                            <span className="font-semibold">{reservation.customerName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">{getGenderLabel(reservation.gender)}</td>
                        <td className="py-3 px-4 text-sm text-slate-600">{reservation.designerName}</td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {reservation.services.map((service) => service.serviceName).join(', ')}</td>
                        <td className="py-3 px-4 text-sm text-right font-semibold text-slate-700">
                          {formatCurrency(getExpectedAmount(reservation.services))}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border ${tone.badge}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openEditModal(reservation)} disabled={isDbBusy}
                              className="p-1.5 rounded text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                              title={pt('t054')}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => deleteReservation(reservation.id)} disabled={isDbBusy}
                              className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              title={pt('t055')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}</tbody>
            </table>
          </div>
        </section>
      </div>

      {viewMode === 'list' && (
      <section className="mt-6 bg-white border border-slate-200 rounded-xl overflow-hidden grid-shadow">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-700">{pt('t005')}</h2>
              <p className="text-xs text-slate-500 mt-1">{listHeaderLabel}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1">
                <button
                  onClick={() => setListRangeMode('day')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${listRangeMode === 'day' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {pt('t090')}
                </button>
                <button
                  onClick={() => setListRangeMode('month')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${listRangeMode === 'month' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {pt('t091')}
                </button>
                <button
                  onClick={() => setListRangeMode('year')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${listRangeMode === 'year' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {pt('t092')}
                </button>
              </div>

              <button
                onClick={() => moveListRange(-1)}
                className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600"
                aria-label={pt(A11Y_TEXT_KEYS.PREVIOUS_MONTH)}
              >
                <ChevronLeft size={16} />
              </button>

              {listRangeMode === 'day' ? (
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    syncSelectedDate(event.target.value);
                  }}
                  className="px-3 py-1.5 rounded-md text-sm border border-slate-200 text-slate-700 bg-white"
                />
              ) : listRangeMode === 'month' ? (
                <input
                  type="month"
                  value={selectedDate.slice(0, 7)}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    syncSelectedDate(`${event.target.value}-01`);
                  }}
                  className="px-3 py-1.5 rounded-md text-sm border border-slate-200 text-slate-700 bg-white"
                />
              ) : (
                <select
                  value={selectedDate.slice(0, 4)}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    syncSelectedDate(`${event.target.value}-01-01`);
                  }}
                  className="px-3 py-1.5 rounded-md text-sm border border-slate-200 text-slate-700 bg-white"
                >
                  {listYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              )}

              <button
                onClick={() => moveListRange(1)}
                className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600"
                aria-label={pt(A11Y_TEXT_KEYS.NEXT_MONTH)}
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => syncSelectedDate(todayIso())}
                className="px-2.5 py-1.5 rounded-md text-xs font-semibold border border-slate-200 hover:bg-slate-100 text-slate-600"
              >
                {pt('t047')}
              </button>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center gap-2">
            <label className="text-xs font-bold text-slate-500">{pt('t093')}</label>
            <input
              type="text"
              value={listSearchKeyword}
              onChange={(event) => setListSearchKeyword(event.target.value)}
              placeholder={pt('t094')}
              className="w-full md:max-w-sm px-3 py-2 rounded-md text-sm border border-slate-200 text-slate-700 bg-white focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
        </div>

        <div className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[1140px]">
              <thead>
                <tr className="bg-slate-900 text-slate-200">
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t021')}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t007')}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t001')}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t100')}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t098')}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t004')}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t016')}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider text-right">{pt('t015')}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider text-center">{pt('t051')}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t057')}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider text-center">{pt('t052')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {listReservations.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-sm text-slate-400">
                      {pt('t099')}
                    </td>
                  </tr>
                ) : (
                  listReservations.map((reservation) => {
                    const statusLabel = getStatusLabel(reservation.status);
                    const tone = getStatusTone(reservation.status, statusLabel);
                    return (
                      <tr key={reservation.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-4 text-sm font-medium text-slate-700">{reservation.reservationDate}</td>
                        <td className="py-2.5 px-4 text-sm font-semibold text-slate-700">{reservation.startTime}</td>
                        <td className="py-2.5 px-4 text-sm text-slate-700">{reservation.customerName}</td>
                        <td className="py-2.5 px-4 text-sm text-slate-600">{getGenderLabel(reservation.gender)}</td>
                        <td className="py-2.5 px-4 text-sm text-slate-600">{reservation.customerPhone || '-'}</td>
                        <td className="py-2.5 px-4 text-sm text-slate-600">{reservation.designerName}</td>
                        <td className="py-2.5 px-4 text-sm text-slate-600">
                          {pt('t058', { count: getExpectedMinutes(reservation.services) })}
                        </td>
                        <td className="py-2.5 px-4 text-sm text-right font-semibold text-slate-700">
                          {formatCurrency(getExpectedAmount(reservation.services))}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border ${tone.badge}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-sm text-slate-500">{reservation.note || '-'}</td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openEditModal(reservation)} disabled={isDbBusy}
                              className="p-1.5 rounded text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                              title={pt('t054')}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => deleteReservation(reservation.id)} disabled={isDbBusy}
                              className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              title={pt('t055')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      )}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <motion.div
            drag
            dragControls={modalDragControls}
            dragListener={false}
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-5xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()} >
            <div
              onPointerDown={(event) => modalDragControls.start(event)} className="px-5 py-4 border-b border-slate-200 flex items-center justify-between cursor-move active:cursor-grabbing"
            >
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  {modalMode === 'edit' ? pt('t059') : pt('t060')}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {pt('t061')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <GripHorizontal size={16} className="text-slate-300" />
                <button
                  onClick={closeModal}
                  disabled={isDbBusy}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  aria-label={pt(A11Y_TEXT_KEYS.CLOSE_MODAL)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <form noValidate onSubmit={saveReservation} className="max-h-[calc(90vh-80px)] overflow-y-auto p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t021')}</label>
                  <input
                    type="date"
                    value={form.reservationDate}
                    disabled={isReservationFormLocked}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, reservationDate: event.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t007')}</label>
                  <input
                    type="time"
                    step={60}
                    value={form.startTime}
                    disabled={isReservationFormLocked}
                    onChange={(event) => setForm((prev) => ({ ...prev, startTime: event.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t020')}</label>
                  <select
                    value={form.status}
                    disabled={isReservationFormLocked}
                    onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    {statusOptions.map((status) => (
                      <option key={status.code} value={status.code}>
                        {getStatusLabelByCode(status.code, status.label)}
                      </option>
                    ))}</select>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700">
                    {pt('t001')}: <span className="font-black text-slate-900">{selectedCustomerSummary || pt('t136')}</span>
                  </p>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={customerPhoneQuery}
                        disabled={isReservationFormLocked}
                        onChange={(event) => handleCustomerPhoneQueryChange(event.target.value)}
                        onFocus={() => {
                          if (isReservationFormLocked) return;
                          if (!customerPhoneQueryDigits) return;
                          setIsCustomerLookupOpen(true);
                        }}
                        onBlur={() => {
                          window.setTimeout(() => setIsCustomerLookupOpen(false), 120);
                        }}
                        placeholder={pt('t094')}
                        className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                      />
                      {isCustomerLookupOpen && customerPhoneQueryDigits && !isReservationFormLocked && (
                        <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 max-h-36 overflow-y-auto shadow-lg">
                          {customerLookupMembers.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-slate-400">{pt('t027')}</p>
                          ) : (
                            customerLookupMembers.map((member) => (
                              <button
                                key={member.id}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  handleCustomerMemberSelect(String(member.id));
                                }}
                                className={`w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors ${
                                  selectedCustomerMemberId === String(member.id) ? 'bg-primary/5' : ''
                                }`}
                              >
                                <p className="text-sm font-semibold text-slate-700">{member.name}</p>
                                <p className="text-xs text-slate-500">{member.phone || '-'}</p>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t100')}</label>
                  <select
                    value={form.gender}
                    disabled={isReservationFormLocked}
                    onChange={(event) => setForm((prev) => ({ ...prev, gender: event.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none bg-white"
                  >
                    <option value="">{pt('t101')}</option>
                    <option value="M">{pt('t102')}</option>
                    <option value="F">{pt('t103')}</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t004')}</label>
                  <select
                    value={form.designerName}
                    disabled={isReservationFormLocked}
                    onChange={(event) => setForm((prev) => ({ ...prev, designerName: event.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none bg-white"
                  >
                    <option value="">
                      {designerNames.length > 0 ? pt('t063') : pt('t064')}
                    </option>
                    {designerNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))} {/* 기존 예약 수정 시, 현재 직원 목록에 없는 이름도 값 유지를 위해 임시 옵션으로 노출한다. */}
                    {form.designerName && !designerNames.includes(form.designerName) && (
                      <option value={form.designerName}>
                        {pt('t065', { name: form.designerName })}
                      </option>
                    )}</select>
                </div>

                <div className="space-y-1 md:col-span-2 lg:col-span-3">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t066')}</label>
                  <textarea
                    value={form.note}
                    rows={4}
                    disabled={isReservationFormLocked}
                    onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                    placeholder={pt('t025')}
                    className="w-full min-h-[105px] px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none resize-none disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <section className="lg:col-span-5 border border-slate-200 rounded-xl p-4 bg-slate-50/60">
                  <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-3">
                    <Scissors size={16} className="text-primary" />
                    {pt('t067')}
                  </h4>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">{pt('t068')}</label>
                      <select
                        value={form.selectedCategory}
                        disabled={isReservationFormLocked}
                        onChange={(event) => {
                          const nextCategory = event.target.value;
                          const firstService = serviceItems.find(
                            (service) => service.categoryCode === nextCategory,
                          );
                          setForm((prev) => ({
                            ...prev,
                            selectedCategory: nextCategory,
                            selectedServiceId: firstService ? String(firstService.id) : '',
                          }));
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary/20 outline-none"
                      >
                        {categories.map((category) => (
                          <option key={category.code} value={category.code}>
                            {getCategoryLabelByCode(category.code, category.label)}
                          </option>
                        ))}</select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">{pt('t009')}</label>
                      <select
                        value={form.selectedServiceId}
                        disabled={isReservationFormLocked}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, selectedServiceId: event.target.value }))
                        }
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary/20 outline-none"
                      >
                        {categoryServices.length === 0 ? (
                          <option value="">{pt('t003')}</option>
                        ) : (
                          categoryServices.map((service) => (
                            <option key={service.id} value={String(service.id)}>
                              {service.serviceName} ({pt('t058', { count: service.durationMinutes })} / {formatCurrency(service.unitPrice)})
                            </option>
                          ))
                        )}</select>
                    </div>

                    {selectedService && (
                      <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 space-y-1">
                        <p className="font-semibold text-slate-700">{selectedService.serviceName}</p>
                        <p>{pt('t070', { count: selectedService.durationMinutes })}</p>
                        <p>{pt('t071', { amount: formatCurrency(selectedService.unitPrice) })}</p>
                      </div>
                    )}<button
                      type="button"
                      onClick={addSelectedService}
                      disabled={!selectedService || isReservationFormLocked}
                      className="w-full bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                    >
                      <PlusCircle size={16} />
                      {pt('t069')}
                    </button>
                  </div>
                </section>

                <section className="lg:col-span-7 border border-slate-200 rounded-xl p-4">
                  <h4 className="text-sm font-bold text-slate-700 mb-3">{pt('t024')}</h4>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left min-w-[620px]">
                      <thead>
                        <tr className="bg-slate-900 text-slate-200">
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider">{pt('t072')}</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider">{pt('t012')}</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-right">{pt('t016')}</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-right">{pt('t073')}</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-center">{pt('t074')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {form.services.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-sm text-slate-400">
                              {pt('t075')}
                            </td>
                          </tr>
                        ) : (
                          form.services.map((service) => (
                            <tr key={service.lineId} className="hover:bg-slate-50 transition-colors">
                              <td className="py-2.5 px-3 text-sm text-slate-700">{getCategoryLabelByCode(service.categoryCode, service.categoryName)}</td>
                              <td className="py-2.5 px-3 text-sm font-semibold text-slate-700">{service.serviceName}</td>
                              <td className="py-2.5 px-3 text-sm text-right text-slate-600">{pt('t058', { count: service.durationMinutes })}</td>
                              <td className="py-2.5 px-3 text-sm text-right font-semibold text-slate-700">
                                {formatCurrency(service.unitPrice)}</td>
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeService(service.lineId)} disabled={isReservationFormLocked}
                                  className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}</tbody>
                    </table>
                  </div>
                </section>
              </div>

              <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h4 className="text-sm font-bold text-slate-700">{pt('t104')}</h4>
                  <p className="text-[11px] text-slate-500">
                    {isPaymentCompleted ? pt('t129') : pt('t117')}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t105')}</label>
                    <input
                      type="number"
                      min={0}
                      value={calculatorDiscountAmount}
                      disabled={isQuickPaymentReadOnly || isReservationFormLocked}
                      onChange={(event) =>
                        setCalculatorDiscountAmount(Math.min(toAmountNumber(event.target.value), formExpectedAmount))
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-bold text-slate-500 uppercase">{pt('t106')}</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{formatCurrency(calculatorPayableAmount)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-bold text-slate-500 uppercase">{pt('t109')}</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{formatCurrency(calculatorPaidTotal)}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500 uppercase">{pt('t107')}</p>
                    <button
                      type="button"
                      onClick={addQuickPaymentLine}
                      disabled={isQuickPaymentReadOnly || isReservationFormLocked || manualPaymentMethodOptions.length === 0 || calculatorRemainingAmount <= 0}
                      className="text-xs font-bold text-primary disabled:opacity-40 flex items-center gap-1"
                    >
                      <PlusCircle size={14} />
                      {pt('t108')}
                    </button>
                  </div>

                  {manualPaymentMethodOptions.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-400">
                      {pt('t118')}
                    </div>
                  ) : quickPaymentLines.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-400">
                      {pt('t119')}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {quickPaymentLines.map((line) => (
                        <div key={line.lineId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <select
                            value={line.methodCode}
                            disabled={isQuickPaymentReadOnly || isReservationFormLocked}
                            onChange={(event) => updateQuickPaymentLine(line.lineId, 'methodCode', event.target.value)}
                            className="flex-1 px-2 py-1.5 border border-slate-200 rounded text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                          >
                            {manualPaymentMethodOptions.map((method) => (
                              <option key={method.code} value={method.code}>
                                {getPaymentMethodLabelByCode(method.code, method.label)}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={0}
                            value={line.amount}
                            disabled={isQuickPaymentReadOnly || isReservationFormLocked}
                            onChange={(event) => updateQuickPaymentLine(line.lineId, 'amount', event.target.value)}
                            className="w-36 px-2 py-1.5 border border-slate-200 rounded text-xs font-black text-right outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                          />
                          <button
                            type="button"
                            disabled={isQuickPaymentReadOnly || isReservationFormLocked}
                            onClick={() => removeQuickPaymentLine(line.lineId)}
                            className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2.5">
                  <span className="text-xs font-semibold text-slate-500">{pt('t109')}: {formatCurrency(calculatorPaidTotal)}</span>
                  <span
                    className={`text-xs font-black ${
                      calculatorRemainingAmount === 0
                        ? 'text-emerald-600'
                        : calculatorRemainingAmount > 0
                          ? 'text-rose-600'
                          : 'text-amber-600'
                    }`}
                  >
                    {calculatorRemainingAmount === 0
                      ? pt('t120')
                      : calculatorRemainingAmount > 0
                        ? `${pt('t110')}: ${formatCurrency(calculatorRemainingAmount)}`
                        : `${pt('t111')}: ${formatCurrency(Math.abs(calculatorRemainingAmount))}`}
                  </span>
                </div>
              </section>

              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1">
                <div className="flex flex-wrap gap-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="text-xs font-bold text-slate-500 uppercase">{pt('t014')}</p>
                    <p className="font-black text-slate-900 mt-1">{pt('t058', { count: formExpectedMinutes })}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="text-xs font-bold text-slate-500 uppercase">{pt('t013')}</p>
                    <p className="font-black text-slate-900 mt-1">{formatCurrency(formExpectedAmount)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={isReservationFormLocked}
                    className="px-4 py-2.5 rounded-lg text-sm font-bold text-white bg-primary hover:bg-primary/90 flex items-center gap-2"
                  >
                    {isMutating ? <Loader2 size={15} className="animate-spin" /> : <Clock3 size={15} />}
                    {pt('t121')}
                  </button>
                  <button
                    type="button"
                    onClick={startReservationService}
                    disabled={isReservationFormLocked}
                    className={`px-4 py-2.5 rounded-lg text-sm font-bold text-white flex items-center gap-2 ${
                      isReservationFormLocked ? 'bg-slate-400 cursor-not-allowed' : 'bg-sky-600 hover:bg-sky-700'
                    }`}
                  >
                    {isMutating ? <Loader2 size={15} className="animate-spin" /> : <Scissors size={15} />}
                    {pt('t127')}
                  </button>
                  <button
                    type="button"
                    onClick={isPaymentCancelAction ? cancelCompletedReservationPayment : processReservationPayment}
                    disabled={isPaymentActionDisabled}
                    className={`px-4 py-2.5 rounded-lg text-sm font-bold text-white flex items-center gap-2 ${
                      isPaymentActionDisabled
                        ? 'bg-slate-400 cursor-not-allowed'
                        : isPaymentCancelAction
                          ? 'bg-rose-600 hover:bg-rose-700'
                          : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    {(isMutating || isSettlementStateLoading)
                      ? <Loader2 size={15} className="animate-spin" />
                      : <Clock3 size={15} />}
                    {paymentActionLabel}
                  </button>
                  
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      )}</motion.div>
  );
}


