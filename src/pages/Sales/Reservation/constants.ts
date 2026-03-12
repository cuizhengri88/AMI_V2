import type { CodeOption, PaymentMethodOption, ReservationRecord } from './types';

/**
 * 시스템 공통 코드 그룹 ID 상수 정의
 */
export const STATUS_GROUP_ID = 'RESERVATION_STATUS'; // 예약 상태 코드 그룹
export const CATEGORY_GROUP_ID = 'T_CATEGORY';        // 시술 카테고리 코드 그룹
export const PAYMENT_METHOD_GROUP_ID = 'PAYMENT_METHOD'; // 결제 수단 코드 그룹

/**
 * 서버 데이터가 없을 경우를 대비한 최하위 대체(Fallback) 코드 목록
 */
export const FALLBACK_STATUS_CODES = ['RESERVED', 'COMPLETED', 'CANCELLED'] as const;
export const FALLBACK_CATEGORY_CODES = ['CUT', 'PERM', 'COLOR'] as const;

export const FALLBACK_STATUSES: CodeOption[] = FALLBACK_STATUS_CODES.map((code, index) => ({
    code,
    label: '',
    order: index + 1,
}));

export const FALLBACK_CATEGORIES: CodeOption[] = FALLBACK_CATEGORY_CODES.map((code, index) => ({
    code,
    label: '',
    order: index + 1,
}));

export const FALLBACK_PAYMENT_METHODS: PaymentMethodOption[] = [
    { code: 'CASH', label: '', order: 1 },
    { code: 'CARD', label: '', order: 2 },
    { code: 'WECHAT', label: '', order: 3 },
    { code: 'ALIPAY', label: '', order: 4 },
];

/**
 * 요일 헤더를 위한 다국어 키 배열
 */
export const WEEKDAY_TEXT_KEYS = [
    't028', // 일
    't029', // 월
    't030', // 화
    't031', // 수
    't032', // 목
    't033', // 금
    't034', // 토
] as const;

/**
 * 예약 상태 코드별 다국어 키 매핑
 */
export const STATUS_TEXT_KEY_BY_CODE: Record<string, string> = {
    RESERVED: 't080',  // 예약중
    COMPLETED: 't081', // 완료
    CANCELLED: 't082', // 예약취소
};

/**
 * 시술 카테고리 코드별 다국어 키 매핑
 */
export const CATEGORY_TEXT_KEY_BY_CODE: Record<string, string> = {
    CUT: 't083',   // 커트
    PERM: 't084',  // 파마
    COLOR: 't085', // 염색
};

/**
 * 결제수단 코드별 다국어 키 매핑
 */
export const PAYMENT_METHOD_TEXT_KEY_BY_CODE: Record<string, string> = {
    CASH: 't112',    // 현금
    CARD: 't113',    // 카드
    WECHAT: 't114',  // 위챗페이
    ALIPAY: 't115',  // 알리페이
    PREPAID: 't116', // 충전금 차감
};

/**
 * 접근성 시각 보조용(Aria-label) 다국어 키 세트
 */
export const A11Y_TEXT_KEYS = {
    PREVIOUS_MONTH: 't086', // 이전 달
    NEXT_MONTH: 't087',     // 다음 달
    CLOSE_MODAL: 't088',    // 모달 닫기
} as const;

// 예약 데이터는 항상 DB에서 불러오므로 초기값은 빈 배열로 유지한다.
export const INITIAL_RESERVATIONS: ReservationRecord[] = [];
