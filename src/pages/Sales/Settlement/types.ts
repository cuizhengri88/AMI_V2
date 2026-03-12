import type React from 'react';

// [타입정의] 회원이 현재 보유 중인 쿠폰 정보
export type Coupon = {
    serviceId: number; // 대상 시술 PK (어느 시술에 사용할 수 있는지 결정)
    name: string;      // 시술 명칭 (화면 표시용)
    count: number;     // 현재 남은 사용 가능 횟수
};

// [타입정의] 매출 입력 화면에서 사용되는 회원 데이터 모델
export type Member = {
    id: number;           // 회원 고유 식별자 (user_id)
    name: string;         // 회원 성함
    phone: string;        // 연락처 정보
    balance: number;      // 현재 보유 중인 포인트 또는 선불 충전금 잔액
    coupons: Coupon[];    // 사용 가능한 시술 횟수권/쿠폰 목록
};

// [타입정의] 매출을 담당하는 직원(디자이너/시술자) 정보
export type Manager = {
    id: number;     // 직원 고유 PK (employee_id)
    name: string;   // 성함
    role: string;   // 직책 또는 권한 그룹명 (화면 표시용)
};

// [타입정의] 시술 카테고리 정보 (필터링용)
export type ServiceCategoryOption = {
    code: string;   // 카테고리 식별 코드 (예: T_CATEGORY 내 코드)
    name: string;   // 카테고리 표시 한글명 (예: 커트, 펌)
    order: number;  // 화면 정렬 순서
};

// [타입정의] 시술 서비스 항목 상세 모델
export type Procedure = {
    id: number;           // 시술 항목 PK (service_id)
    name: string;         // 시술 상품명
    categoryCode: string; // 소속 카테고리 코드
    categoryName: string; // 카테고리 명칭
    price: number;        // 해당 시술의 기본 책정 단가
    time: number;         // 시술에 소요되는 예정 시간 (단위: 분)
};

// [타입정의] 예약 내역에서 매출로 전환(Import)하기 위해 가공된 모델
export type Reservation = {
    id: string;                // 예약 고유 ID (문자열 PK)
    date: string;              // 예약 지정 날짜
    time: string;              // 예약 시작 시각 (HH:mm 형식)
    customerName: string;      // 방문 예약 고객 성함
    customerPhone?: string;    // 연락처 정보
    designerName: string;      // 예약 당시 지정된 담당 디자이너 성함
    memberId?: number;         // DB 매칭 결과 확인된 회원 PK (있을 경우만)
    managerId?: number;        // DB 매칭 결과 확인된 담당 직원 PK (있을 경우만)
    procedureIds: number[];    // 예약 시 선택한 시술 항목 번호 목록
    status: 'RESERVED' | 'PROCESSING' | 'CANCELLED' | 'COMPLETED'; // 현재 예약 상태 (정규화됨)
};

// 결제수단 통일성을 위한 별칭
export type PaymentMethodCode = string;

// [타입정의] 공통코드로 정의된 결제수단 옵션
export type PaymentMethodOption = {
    code: PaymentMethodCode; // 결제수단 코드 (예: CASH, CARD, PREPAID, COUPON)
    name: string;            // 사용자에게 보일 결제수단 명칭
    order: number;           // 목록 정렬 순서
};

// [타입정의] 최종 정산 결과에 포함되는 각 결제 수단별 세부 거래 명세
export type PaymentDetail = {
    method: PaymentMethodCode; // 사용된 결제수단 식별 코드
    amount: number;            // 해당 수단으로 결제한 실 금액
    couponServiceId?: number;  // 'COUPON' 결제 시 사용된 시술 횟수권의 시술 ID
};

// 정산(매출) 처리의 워크플로우 상태 정의
export type SettlementStatus = 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

// 매출 취소 시 어떤 데이터를 무효화할지 결정하는 속성
export type SettlementCancelType = 'PAYMENT' | 'PROCEDURE';

// 매출 리스트 화면 상단의 정렬/필터링 탭 종류
export type SettlementListTab = 'RESERVATION' | Extract<SettlementStatus, 'PROCESSING' | 'COMPLETED'>;

// [타입정의] 최종 매출 정산(Settlement) 데이터의 전체 명세 정보
export type Settlement = {
    id: number;                     // 정산 레코드 PK
    date: string;                   // 매출 발생 시각 (ISO 8601 통합 포맷)
    memberId: number | 'GUEST';    // 연결된 회원 ID 혹은 비회원('GUEST') 구분
    guestCustomerName?: string;     // 비회원일 경우 기록된 고객 성함
    guestCustomerPhone?: string;    // 비회원일 경우 기록된 고객 연락처
    managerId: number;              // 시술을 집행한 담당자(직원) PK
    procedureIds: number[];         // 이번 매출에 포함된 모든 시술 PK 목록
    totalAmount: number;            // 할인 전 원가 기준 합계 금액
    totalTime: number;              // 포함된 전체 시술 소요 시간 합계
    payments: PaymentDetail[];      // 실제 지불이 완료된 상세 결제 수단 배열
    status: SettlementStatus;       // 정산 현재 상태 (작업중/정산완료/취소)
    reservationId?: string;         // 참조된 원본 예약 PK (연동 시 보관)
    cancelType?: SettlementCancelType; // 취소 건일 경우, 결제만 취소인지 시술 전체 취소인지 기록
    cancelReason?: string;          // 취소 시 입력받은 관리자용 메모
    cancelledAt?: string;           // 취소 처리가 발생한 실 시각
};

// 공통 드래그 모달 props
export type ModalProps = {
    title: string;
    children: React.ReactNode;
    onClose: () => void;
    icon: React.ReactNode;
};
