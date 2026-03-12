import type { Member, Reservation, SettlementStatus } from './types';

// 정산 저장 시 사용할 회원 식별값(전화 우선, 없으면 이름) 생성
export function getMemberIdentifier(member?: Member | null) {
    if (!member) return null;
    const phone = (member.phone || '').trim();
    if (phone && phone !== '-') return phone;
    const name = (member.name || '').trim();
    return name || null;
}

// 예약 상태 문자열을 화면 enum으로 정규화
export function toReservationStatus(value: string): Reservation['status'] {
    const normalized = value.trim().toUpperCase();
    if (normalized.includes('CANCEL')) return 'CANCELLED';
    if (normalized.includes('PROCESS')) return 'PROCESSING';
    if (normalized.includes('COMPLETE')) return 'COMPLETED';
    if (normalized.includes('RESERV')) return 'RESERVED';
    return 'RESERVED';
}

// 읽기전용 상태(완료/취소) 여부
export function isClosedSettlementStatus(status: SettlementStatus) {
    return status === 'COMPLETED' || status === 'CANCELLED';
}
