/**
 * 공통코드(상태, 카테고리 등) 선택 옵션을 위한 타입 정의
 */
export type CodeOption = {
    code: string;  // 서버와 통신하는 코드값 (예: 'RESERVED')
    label: string; // 화면에 표시될 텍스트
    order: number; // 표시 순서
};

/**
 * 결제 수단 선택 드롭다운용 옵션 타입
 */
export type PaymentMethodOption = {
    code: string;  // 결제수단 코드 (예: 'CASH', 'CARD')
    label: string; // 화면 표시 라벨
    order: number; // 정렬 순서
};

/**
 * 모달 하단 간편 결제 계산기의 각 결제 라인 정보
 */
export type QuickPaymentLine = {
    lineId: number;     // 화면 내 식별을 위한 임시 ID
    methodCode: string; // 선태한 결제수단 코드
    amount: number;     // 해당 수단으로 지불할 금액
};

/**
 * 시술 항목(카탈로그) 데이터 모델
 */
export type ServiceItem = {
    id: number;           // 시술 고유 ID
    categoryCode: string; // 카테고리 코드 (예: 'CUT')
    categoryName: string; // 카테고리명 (현재 언어 기준)
    serviceName: string;  // 시술명
    unitPrice: number;    // 기본 단가
    durationMinutes: number; // 소요 시간(분)
};

/**
 * 예약 1건 내에 포함된 개별 시술 항목 정보
 */
export type ReservationService = {
    lineId: number;          // 예약 시술 라인 고유 ID
    serviceId: number;       // 대상 시술 ID
    categoryCode: string;    // 카테고리 코드
    categoryName: string;    // 카테고리명
    serviceName: string;     // 시술명
    unitPrice: number;       // 실제 적용 단가
    durationMinutes: number; // 소요 시간
};

/**
 * 화면에서 렌더링에 사용하는 예약 데이터의 최종 구조
 */
export type ReservationRecord = {
    id: number;                // 예약 ID
    reservationDate: string;   // 예약일 (yyyy-mm-dd)
    startTime: string;         // 시작 시각 (HH:mm)
    customerName: string;      // 고객명
    customerId: number | null; // 연결된 회원 ID (비회원시 null)
    gender?: string;           // 성별 (M/F)
    customerPhone: string;     // 연락처
    designerName: string;      // 담당 디자이너명
    status: string;            // 예약 상태 코드
    note: string;              // 특이사항/메모
    services: ReservationService[]; // 선택한 시술 목록
};

/**
 * 예약 등록/수정 모달에서 관리하는 폼 데이터 구조
 */
export type ReservationForm = {
    reservationDate: string; // 예약 날짜
    startTime: string;       // 시작 시간
    customerName: string;    // 고객명
    gender: string;          // 성별
    designerName: string;    // 디자이너명
    status: string;          // 상태
    note: string;            // 메모
    selectedCategory: string; // 폼 내 "추가"를 위해 선택된 현재 카테고리
    selectedServiceId: string; // 폼 내 "추가"를 위해 선택된 현재 시술ID
    services: ReservationService[]; // 폼 상의 시술 목록
};

/**
 * 회원 자동 매칭 및 검색을 위한 데이터 구조
 */
export type MemberLookup = {
    id: number;          // 회원 고유 ID
    name: string;        // 회원명
    phone: string;       // 연락처 원문
    phoneDigits: string; // 숫자만 추출된 연락처 (검색 효율 최적화용)
};

/**
 * 예약 저장 전 고객 정보를 정규화한 스냅샷 구조
 */
export type ReservationCustomerSnapshot = {
    customerName: string;      // 최종 저장용 고객명
    customerId: number | null; // 확정된 회원 ID
    customerPhone: string;     // 확정된 연락처
};

/**
 * 고객 정보 확정 시 추가로 넘길 수 있는 옵션
 */
export type ReservationCustomerSnapshotOptions = {
    forcedMember?: MemberLookup | null; // 자동 탐지 대신 명시적으로 지정할 회원
};

/**
 * DB에서 내려받는 예약 시술 테이블 로우 원형
 */
export type ReservationServiceRow = {
    line_id: number;
    service_id: number;
    category_code: string;
    category_name: string;
    service_name: string;
    unit_price: number;
    duration_minutes: number;
};

/**
 * DB에서 내려받는 예약 헤더 테이블 로우 원형
 */
export type ReservationRow = {
    reservation_id: number;
    reservation_date: string;
    start_time: string;
    customer_name: string;
    customer_id?: number | null;
    customer_phone?: string | null;
    gender?: string | null;
    designer_name: string;
    status: string;
    note: string | null;
    services: ReservationServiceRow[];
};

/**
 * DB 정산 데이터의 개별 결제 수단 정보 로우
 */
export type SalesSettlementPaymentRow = {
    payment_method_code: string;    // 결제수단 코드
    amount: number;                 // 해당 수단 결제액
    coupon_service_id?: number | null; // 쿠폰 결제 시 해당 시술 ID
};

/**
 * DB에서 내려받는 매출 정산 테이블 로우 원형
 */
export type SalesSettlementRow = {
    settlement_id: number;          // 정산 고유 번호
    reservation_ref?: string | null; // 연결된 예약 번호 (문자열)
    member_user_id?: string | null;  // 회원 식별값
    manager_employee_id?: number | null; // 담당 직원 ID
    service_ids?: number[] | null;   // 포함된 시술 ID 목록
    total_amount?: number;           // 총 매출액
    status?: string | null;          // 정산 상태 (COMPLETED, PROCESSING 등)
    payments: SalesSettlementPaymentRow[]; // 결제 상세 목록
};

/**
 * 예약 건에 대한 정산 진행 상태를 정의 (화면 분기용)
 */
export type LinkedSettlementState = 'NONE' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

/**
 * 상태 배지 및 디자인 테마를 구성하는 색상 세트
 */
export type StatusTone = {
    badge: string; // 외부 배지 Tailwind 클래스
    chip: string;  // 내부 칩 Tailwind 클래스
    dot: string;   // 상태 점 색상 Tailwind 클래스
};

/**
 * 예약 화면의 보기 모드 (달력 vs 리스트)
 */
export type ReservationViewMode = 'calendar' | 'list';

/**
 * 리스트 모드에서 데이터를 조회할 날짜 범위 모드
 */
export type ListRangeMode = 'day' | 'month' | 'year';
