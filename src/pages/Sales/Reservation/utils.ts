import { normalizeNameKey, toIsoDate } from '../../utils/pageCommon';
import type {
    LinkedSettlementState,
    QuickPaymentLine,
    ReservationForm,
    ReservationRecord,
    ReservationRow,
    ReservationService,
    SalesSettlementRow,
    StatusTone,
} from './types';

// yyyy-mm-dd 문자열을 Date 객체로 변환합니다. (로컬 시간 기준 안전하게 파싱)
export function parseIsoDate(iso: string) {
    const [y, m, d] = iso.split('-').map((value) => Number(value));
    return new Date(y, (m || 1) - 1, d || 1);
}

// 주어진 날짜(ISO)를 특정 일수(diffDays)만큼 이동시킨 후 다시 ISO 형식으로 반환합니다.
export function shiftDate(iso: string, diffDays: number) {
    const base = parseIsoDate(iso);
    base.setDate(base.getDate() + diffDays);
    return toIsoDate(base);
}

// 특정 날짜의 월 정보를 diffMonths만큼 이동시킵니다. (항상 월의 1일로 초기화됨)
export function shiftMonth(iso: string, diffMonths: number) {
    const base = parseIsoDate(iso);
    base.setDate(1);
    base.setMonth(base.getMonth() + diffMonths);
    return toIsoDate(base);
}

// 특정 연도를 diffYears만큼 이동시킵니다. (연도 이동 시 항상 1월 1일로 초기화됨)
export function shiftYear(iso: string, diffYears: number) {
    const base = parseIsoDate(iso);
    base.setDate(1);
    base.setMonth(0);
    base.setFullYear(base.getFullYear() + diffYears);
    return toIsoDate(base);
}

// 문자열 또는 숫자 입력을 검증하여 안전한 양수(결제금액 등)로 변환합니다.
export function toAmountNumber(value: string | number) {
    const numeric = typeof value === 'number' ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, numeric);
}

// 달력 상단에 표시할 "yyyy.mm" 형식의 라벨을 생성합니다.
export function formatMonthLabel(date: Date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${yyyy}.${mm}`;
}

// 특정 ISO 날짜 뒤에 해당 요일을 괄호로 붙여 반환합니다. (예: 2024-03-12 (화))
export function formatDateLabel(isoDate: string, weekdayLabels: string[]) {
    const date = parseIsoDate(isoDate);
    const dayOfWeek = weekdayLabels[date.getDay()] || '';
    return `${isoDate} (${dayOfWeek})`;
}

// 시간 입력값을 "HH:mm" 형식으로 최소한의 정규화를 수행합니다.
export function normalizeTimeValue(raw: string) {
    if (!raw) return '';
    const match = raw.match(/^(\d{2}:\d{2})/);
    if (match) return match[1];
    const parsed = new Date(`1970-01-01T${raw}`);
    if (Number.isNaN(parsed.getTime())) return raw;
    return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
}

// 텍스트 뭉치에서 전화번호 형태(숫자/대시 조합)를 우선적으로 추출합니다.
export function extractPhoneText(raw?: string | null) {
    const source = (raw || '').trim();
    if (!source) return '';

    const fullPhoneLike = source.match(/^\+?[\d\s-]{7,}$/);
    if (fullPhoneLike) return source;

    const embeddedPhoneLike = source.match(/(\+?\d[\d\s-]{6,}\d)/);
    return embeddedPhoneLike ? embeddedPhoneLike[1].trim() : '';
}

// 예약 상태(status) 코드를 바탕으로 정산 테이블에 저장할 상태 문자열을 결정합니다.
export function toSettlementStatusByReservationStatus(status: string): 'PROCESSING' | 'COMPLETED' {
    return status.trim().toUpperCase() === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING';
}

// 현재 상태가 문자열상 "진행중" 또는 "처리중"을 포함하는지 확인합니다.
export function isReservationProcessingStatus(status: string) {
    const normalized = status.trim().toUpperCase();
    return normalized.includes('PROCESS') || normalized.includes('PROGRESS');
}

// 정산 상태 문자열을 화면 상태값으로 정규화
export function normalizeSettlementState(raw?: string | null): LinkedSettlementState {
    const normalized = (raw || '').trim().toUpperCase();
    if (normalized === 'COMPLETED') return 'COMPLETED';
    if (normalized === 'CANCELLED') return 'CANCELLED';
    if (normalized === 'PROCESSING') return 'PROCESSING';
    return 'NONE';
}

// 완료된 정산 데이터를 빠른 결제 계산기 스냅샷으로 변환
export function buildQuickCalculatorSnapshotFromSettlement(
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

// 달력 6주(42칸) 셀 생성
export function buildCalendarCells(monthCursor: Date) {
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

// 요일 헤더 색상 결정
export function getWeekendHeaderTone(dayOfWeek: number) {
    if (dayOfWeek === 0) return 'text-rose-500';
    if (dayOfWeek === 6) return 'text-blue-500';
    return 'text-slate-600';
}

// 날짜 셀 텍스트 색상 결정(주말/당월 여부 반영)
export function getCalendarDateTone(dayOfWeek: number, inMonth: boolean) {
    if (dayOfWeek === 0) return inMonth ? 'text-rose-500' : 'text-rose-300';
    if (dayOfWeek === 6) return inMonth ? 'text-blue-500' : 'text-blue-300';
    return inMonth ? 'text-slate-700' : 'text-slate-400';
}

// 시술 합계 소요시간 계산
export function getExpectedMinutes(services: ReservationService[]) {
    return services.reduce((sum, service) => sum + service.durationMinutes, 0);
}

// 시술 합계 예상금액 계산
export function getExpectedAmount(services: ReservationService[]) {
    return services.reduce((sum, service) => sum + service.unitPrice, 0);
}

// 상태 스타일 분기를 위한 비교 문자열 생성
export function normalizeStatusText(code: string, label: string) {
    return `${code} ${label}`.toUpperCase();
}

// 상태별 배지/칩 톤 반환
export function getStatusTone(code: string, label: string): StatusTone {
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

// 날짜/시간 기준 예약 정렬
export function sortReservations(items: ReservationRecord[]) {
    return [...items].sort((a, b) => {
        const dateCompare = a.reservationDate.localeCompare(b.reservationDate);
        if (dateCompare !== 0) return dateCompare;
        return a.startTime.localeCompare(b.startTime);
    });
}

// DB 응답(row) 구조를 화면에서 쓰는 예약 구조로 변환한다.
export function mapReservationRowToRecord(
    row: ReservationRow,
    memberPhoneByName: Map<string, string>,
): ReservationRecord {
    const explicitPhone = (row.customer_phone || '').trim();
    const phoneByName = memberPhoneByName.get(normalizeNameKey(row.customer_name)) || '';
    const phoneFromCustomerName = extractPhoneText(row.customer_name);
    return {
        id: row.reservation_id,
        reservationDate: row.reservation_date,
        startTime: normalizeTimeValue(row.start_time),
        customerName: row.customer_name,
        customerId:
            typeof row.customer_id === 'number' && Number.isFinite(row.customer_id) && row.customer_id > 0
                ? row.customer_id
                : null,
        gender: row.gender || '',
        customerPhone: explicitPhone || phoneByName || phoneFromCustomerName,
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
export function getNextLineIdSeed(items: ReservationRecord[]) {
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
export function toUniqueSortedNames(items: string[]) {
    return Array.from(
        new Set(
            items
                .map((value) => value.trim())
                .filter((value) => value.length > 0),
        ),
    ).sort((a, b) => a.localeCompare(b, 'ko'));
}

// 모달 신규 등록 기본 폼 생성
export function createEmptyForm(
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
