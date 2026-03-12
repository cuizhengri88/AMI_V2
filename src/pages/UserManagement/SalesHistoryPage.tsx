/**
 * [페이지] 매출 이력 조회 (SalesHistoryPage)
 * 
 * 정산 완료된 매출 이력과 포인트/쿠폰 충전 이력을 통합하여 조회하는 페이지입니다.
 * 기간별, 회원별, 담당자별, 시술별, 결제수단별 상세 필터링 기능을 제공하며,
 * 전체 매출 통계 및 결제 수단별 수납 현황을 요약하여 보여줍니다.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import {
  Search,
  Calendar,
  User,
  Scissors,
  CreditCard,
  Filter,
  Download,
  Clock,
  TrendingUp,
  Tag,
  RefreshCw,
  X,
  CheckCircle2,
  Info,
  AlertCircle,
  GripHorizontal,
} from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import { downloadCsvFile } from '../../lib/csvExport';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';
import {
  findMatchedMemberByNameOrPhone,
  formatCurrency,
  formatDateTime,
  isCouponPaymentMethod,
  toDateOnly,
  todayIso,
  toSettlementStatus,
  toTimestamp,
} from '../utils/pageCommon';

// [타입] 매칭에 필요한 최소 회원 정보
type Member = {
  id: number;     // 회원 고유 번호
  name: string;   // 성함
  phone: string;  // 연락처
  balance: number; // 현재 포인트 잔액
};

// [타입] 담당자 정보
type Manager = {
  id: number;     // 직원 고유 번호
  name: string;   // 이름
  role: string;   // 직책/역할
};

// [타입] 시술 정보(통계/필터/금액 계산에 사용)
type Procedure = {
  id: number;           // 시술 고유 번호
  name: string;         // 시술명
  categoryName: string; // 카테고리명
  price: number;        // 단가
  time: number;         // 소요 시간(분)
};

// [타입] 결제수단 정보
type PaymentMethod = {
  code: string; // 코드 (CASH, CARD 등)
  name: string; // 표시 이름
  order: number; // 정렬 순서
};

// [타입] 결제 상세 라인
type PaymentDetail = {
  method: string;          // 결제 수단 코드
  amount: number;          // 결제 금액
  couponServiceId?: number; // (쿠폰 사용 시) 시술 ID
};

// [타입] 정산 상태 (작업중, 완료, 취소)
type SettlementStatus = 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

// [타입] 이력 항목 유형 (일반 정산 또는 포인트/쿠폰 충전)
type HistoryEntryType = 'SETTLEMENT' | 'POINT_RECHARGE';

// [타입] 매출 이력 화면에서 사용하는 통합 이력 모델
type Settlement = {
  id: number;                 // 화면 표시용 유니크 ID (충전은 음수 처리)
  sourceId: number;           // 원본 테이블 PK (settlement_id 또는 history_id)
  entryType: HistoryEntryType; // 항목 구분
  date: string;               // 발생 시각 (ISO string)
  memberId: number | 'GUEST'; // 회원 ID 또는 비회원 표시
  customerName?: string;      // 예약/연동 시 확인된 고객명
  guestCustomerName?: string; // 비회원 입력 성함
  guestCustomerPhone?: string; // 비회원 입력 연락처
  managerId: number | null;   // 담당 디자이너 PK
  procedureIds: number[];     // 포함된 시술 PK 목록
  totalAmount: number;        // 총 시술 합계 금액
  totalTime: number;          // 총 소요 시간 합계
  payments: PaymentDetail[];  // 실제 결제(수납) 내역
  status: SettlementStatus;   // 정산 상태
  rechargeType?: 'BALANCE' | 'COUPON'; // 충전 시 구분 (포인트/쿠폰)
  reservationId?: string;     // 연동된 예약 ID
  cancelReason?: string;      // 취소 시 입력된 사유
  cancelledAt?: string;       // 취소 처리 일시
};

// [상수] 결제수단 코드 정보가 없을 때 쓰는 기본 목록
const FALLBACK_PAYMENT_METHODS: PaymentMethod[] = [
  { code: 'CASH', name: 'CASH', order: 1 },
  { code: 'CARD', name: 'CARD', order: 2 },
  { code: 'WECHAT', name: 'WECHAT', order: 3 },
  { code: 'ALIPAY', name: 'ALIPAY', order: 4 },
  { code: 'PREPAID', name: 'PREPAID', order: 5 },
  { code: 'COUPON', name: 'COUPON', order: 6 },
];

/**
 * [상수] 카테고리/상태/유형별 다국어 매핑 키 정의
 */

// 카테고리 데이터가 없을 때 UI에 표기할 기본 카테고리 텍스트 키
const DEFAULT_CATEGORY_TEXT_KEYS = [
  't053', // "커트"
  't054', // "파마"
  't055', // "염색"
  't056', // "기타"
] as const;

// 목록용 정산 상태 코드 -> 배지 텍스트 키
const STATUS_TEXT_KEY_BY_CODE: Record<SettlementStatus, string> = {
  PROCESSING: 't017', // "작업중"
  COMPLETED: 't036',   // "결제 완료"
  CANCELLED: 't037',   // "취소" (사용자 취소)
};

// 상세 모달용 정산 상태 코드 -> 텍스트 키
const DETAIL_STATUS_TEXT_KEY_BY_CODE: Record<SettlementStatus, string> = {
  PROCESSING: 't017', // "작업중"
  COMPLETED: 't036',   // "결제 완료"
  CANCELLED: 't057',   // "취소됨"
};

// 이력 항목 탭/구분 -> 텍스트 키
const ENTRY_TYPE_TEXT_KEY_BY_CODE: Record<HistoryEntryType, string> = {
  SETTLEMENT: 't038',      // "정산"
  POINT_RECHARGE: 't039',  // "포인트충전"
};

// 포인트/쿠폰 충전 세부 유형 -> 텍스트 키
const RECHARGE_TYPE_TEXT_KEY_BY_CODE: Record<'BALANCE' | 'COUPON', string> = {
  BALANCE: 't040',         // "포인트 충전"
  COUPON: 't041',          // "쿠폰 충전"
};

// 결제수단 코드 -> 다국어 명칭 키
const PAYMENT_METHOD_TEXT_KEY_BY_CODE: Record<string, string> = {
  CASH: 't073',       // "현금"
  CARD: 't074',       // "카드"
  WECHAT: 't075',     // "위챗페이"
  ALIPAY: 't076',     // "알리페이"
  PREPAID: 't077',    // "충전금 차감"
  MEMBERSHIP: 't077', // "충전금 차감"
  COUPON: 't078',     // "쿠폰 사용"
};

// 과거 데이터(레거시) 대응용 한글 레이블
const LEGACY_COUPON_PAYMENT_LABEL = '쿠폰결재건';

// [유틸] 한 항목의 결제 라인 전체 수납 합계
function getTotalPaidAmount(entry: Settlement) {
  return entry.payments.reduce((sum, payment) => sum + payment.amount, 0);
}

// [유틸] 실매출액(쿠폰/포인트 충전 제외) 계산
function getActualSalesAmount(entry: Settlement) {
  if (entry.entryType === 'POINT_RECHARGE') return 0; // 충전은 매출 합계에서 제외
  return entry.payments
    .filter((payment) => !isCouponPaymentMethod(payment.method))
    .reduce((sum, payment) => sum + payment.amount, 0);
}

// [유틸] 쿠폰 사용 시 시술 단가만큼 "커버"된 금액을 합산
function getCouponCoveredAmount(entry: Settlement, procedurePriceById: Map<number, number>) {
  if (entry.entryType !== 'SETTLEMENT') return 0;
  return entry.payments
    .filter((payment) => isCouponPaymentMethod(payment.method) && typeof payment.couponServiceId === 'number')
    .reduce((sum, payment) => sum + (procedurePriceById.get(payment.couponServiceId as number) || 0), 0);
}

// [유틸] 할인 금액 계산 (총액 - 실결제 - 쿠폰 적용분)
function getDiscountAmount(entry: Settlement, procedurePriceById: Map<number, number>) {
  if (entry.entryType !== 'SETTLEMENT' || entry.status !== 'COMPLETED') return 0;

  const nonCouponPaidAmount = entry.payments
    .filter((payment) => !isCouponPaymentMethod(payment.method))
    .reduce((sum, payment) => sum + payment.amount, 0);

  const couponPaidAmount = entry.payments
    .filter((payment) => isCouponPaymentMethod(payment.method))
    .reduce((sum, payment) => sum + payment.amount, 0);

  const couponCoveredAmount = Math.min(getCouponCoveredAmount(entry, procedurePriceById), entry.totalAmount);
  // 쿠폰 사용 시 실제 수납액(couponPaidAmount)보다 시술 단가(couponCoveredAmount)가 우선함
  const effectiveCouponPaid = couponCoveredAmount > 0 ? couponCoveredAmount : couponPaidAmount;

  return Math.max(0, entry.totalAmount - (nonCouponPaidAmount + effectiveCouponPaid));
}

// 충전 타입 문자열 정규화(BALANCE/COUPON)
function normalizeRechargeType(value?: string) {
  const raw = value?.trim() || '';
  const normalized = raw.toUpperCase();
  if (normalized === 'COUPON' || raw.includes('쿠폰')) return 'COUPON';
  return 'BALANCE';
}

// 결제수단 코드 정규화(레거시 '쿠폰결재건' 포함)
function normalizePaymentMethodCode(value: string) {
  const raw = value?.trim() || '';
  const normalized = raw.toUpperCase();
  if (normalized === 'COUPON' || raw === LEGACY_COUPON_PAYMENT_LABEL || raw.includes('쿠폰')) return 'COUPON';
  return normalized;
}


// 실매출 통계에서 제외할 결제코드 여부
function isActualSalesExcludedPaymentCode(code: string) {
  const normalized = code?.trim().toUpperCase();
  return normalized === 'COUPON';
}

export default function SalesHistoryPage() {
  const pt = usePageText('user_management_sales_history');
  // --- [상태 관리: 기준 데이터] ---
  const [members, setMembers] = useState<Member[]>([]);           // 전체 회원 목록
  const [managers, setManagers] = useState<Manager[]>([]);         // 직원(디자이너) 목록
  const [procedures, setProcedures] = useState<Procedure[]>([]);   // 시술 카탈로그 정보
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(FALLBACK_PAYMENT_METHODS); // 결제 수단 코드 정보

  // --- [상태 관리: 조회 데이터 및 로딩] ---
  const [settlements, setSettlements] = useState<Settlement[]>([]); // 가공된 통합 매출 이력 목록
  const [isLoading, setIsLoading] = useState(false);               // 데이터 로딩 상태

  // --- [상태 관리: 검색 및 필터링 조건] ---
  const [startDate, setStartDate] = useState(todayIso());          // 검색 시작일
  const [endDate, setEndDate] = useState(todayIso());            // 검색 종료일
  const [searchMember, setSearchMember] = useState('');            // 고객명/전화번호 검색어
  const [selectedManager, setSelectedManager] = useState('');      // 담당자 필터 (PK)
  const [selectedCategory, setSelectedCategory] = useState('');    // 시술 카테고리 필터
  const [selectedProcedure, setSelectedProcedure] = useState('');   // 특정 시술 필터 (PK)
  const [selectedPayment, setSelectedPayment] = useState('');      // 결제 수단 필터 (코드)

  // --- [상태 관리: 상세 보기 및 UI 제어] ---
  const [selectedHistory, setSelectedHistory] = useState<Settlement | null>(null); // 현재 상세 보기 중인 이력 객체
  const detailDragControls = useDragControls(); // 상세 모달 드래그 컨트롤
  const initialLoadDoneRef = useRef(false);    // 초기 데이터 로드 여부 추적

  // 상태 텍스트 라벨 변환(detail=true면 상세용 문구 사용)
  const getStatusLabelByCode = (status: SettlementStatus, detail = false) => {
    const key = detail ? DETAIL_STATUS_TEXT_KEY_BY_CODE[status] : STATUS_TEXT_KEY_BY_CODE[status];
    return pt(key);
  };

  const getEntryTypeLabel = (entryType: HistoryEntryType) => pt(ENTRY_TYPE_TEXT_KEY_BY_CODE[entryType]);

  // 포인트 충전 이력의 BALANCE/COUPON 라벨 변환
  const getPointRechargeLabel = (entry: Settlement) =>
    pt(RECHARGE_TYPE_TEXT_KEY_BY_CODE[entry.rechargeType === 'COUPON' ? 'COUPON' : 'BALANCE']);

  const getRechargeTypeDisplayLabel = (value?: string) => {
    const raw = value?.trim() || '';
    if (!raw) return '-';
    const normalized = raw.toUpperCase();
    if (normalized === 'COUPON' || raw === LEGACY_COUPON_PAYMENT_LABEL) return pt('t071');
    return raw;
  };

  const getPaymentMethodLabelByCode = (code: string, fallback?: string) => {
    const key = PAYMENT_METHOD_TEXT_KEY_BY_CODE[code.toUpperCase()];
    if (key) return pt(key);
    return fallback || code;
  };

  // 카테고리 필터 목록(실데이터 우선, 없으면 기본 카테고리)
  const categories = useMemo(() => {
    const labels = Array.from(new Set(procedures.map((entry) => entry.categoryName).filter(Boolean)));
    return labels.length > 0 ? labels : DEFAULT_CATEGORY_TEXT_KEYS.map((key) => pt(key));
  }, [procedures, pt]);

  // [로직] 이력 1건에서 표시용 고객명과 연락처를 추출하는 유틸함수
  const getCustomerInfo = useCallback((entry: Settlement) => {
    const guestName = entry.guestCustomerName?.trim() || '';
    const guestPhone = entry.guestCustomerPhone?.trim() || '';

    // 회원인 경우 저장된 회원 정보를 찾고, 없으면 기본값 설정
    const member =
      entry.memberId === 'GUEST'
        ? { name: pt('t015') /* "비회원" */, phone: '-' }
        : members.find((memberItem) => memberItem.id === entry.memberId) || { name: '-', phone: '-' };

    // 정산 건의 경우 예약 연동된 고객명이나 수기 입력된 비회원명을 우선함
    const customerName =
      entry.entryType === 'SETTLEMENT'
        ? entry.customerName?.trim() || guestName
        : '';

    // 연락처도 비회원 수기 입력 정보를 우선함
    const customerPhone =
      entry.entryType === 'SETTLEMENT' && entry.memberId === 'GUEST'
        ? (guestPhone || '-')
        : (member.phone || '-');

    return {
      name: customerName || member.name, // 최종 표시 성함
      phone: customerPhone,             // 최종 표시 연락처
    };
  }, [members, pt]);

  // [동작] 화면 진입 시 필요한 모든 데이터를 병렬로 조회하고 앱용 모델로 변환
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      // 공통코드, 직원, 시술, 회원, 정산, 예약 데이터를 한꺼번에 호출
      const [codeResult, managerResult, procedureResult, memberResult, settlementResult, reservationResult] = await Promise.all([
        invokeDbCommand<{ details: any[] }>('get_common_code_management_data'),
        invokeDbCommand<{ employees: any[] }>('get_employee_management_data'),
        invokeDbCommand<{ items: any[] }>('get_service_catalog_data'),
        invokeDbCommand<{ members: any[]; histories: any[] }>('get_member_point_management_data'),
        invokeDbCommand<{ settlements: any[] }>('get_sales_settlement_data'),
        invokeDbCommand<{ reservations: any[] }>('get_reservation_calendar_data'),
      ]);

      // 1. 회원 정보 매핑 및 상태 저장
      const mappedMembers: Member[] = (memberResult.members || []).map((entry) => ({
        id: entry.user_id,
        name: entry.user_name,
        phone: entry.phone || '',
        balance: entry.point_balance || 0,
      }));
      setMembers(mappedMembers);

      // 2. 직원(디자이너) 정보 매핑
      setManagers((managerResult.employees || []).map((entry) => ({
        id: entry.employee_id,
        name: entry.employee_name,
        role: entry.role_name || entry.role_id || '-',
      })));

      // 3. 시술 카탈로그 매핑 (사용 중인 것만)
      setProcedures((procedureResult.items || [])
        .filter((entry) => entry.use_yn === 'Y')
        .map((entry) => ({
          id: entry.service_id,
          name: entry.service_name,
          categoryName: entry.category_name || '-',
          price: entry.unit_price || 0,
          time: entry.duration_minutes || 0,
        })));

      // 4. 결제수단 공통코드 설정
      const methods = (codeResult.details || [])
        .filter((entry) => entry.group === 'PAYMENT_METHOD' && entry.use_yn === 'Y')
        .map((entry) => ({ code: entry.code, name: entry.name, order: entry.order }))
        .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code));
      setPaymentMethods(methods.length > 0 ? methods : FALLBACK_PAYMENT_METHODS);

      // 예약 ID별 고객명 매핑용 Map 생성
      const reservationCustomerNameById = new Map(
        (reservationResult.reservations || []).map((entry) => [String(entry.reservation_id), entry.customer_name?.trim() || '']),
      );

      // 5. 정산 내역 모델 변환
      const settlementRows: Settlement[] = (settlementResult.settlements || []).map((entry) => {
        const reservationId = entry.reservation_ref?.trim() || '';
        const memberIdentifier = (entry.member_user_id || '').trim();

        // 정산 데이터 내의 식별 정보를 바탕으로 회원 객체 찾기
        const inferredMember =
          (memberIdentifier
            ? (mappedMembers.find((member) => String(member.id) === memberIdentifier) || findMatchedMemberByNameOrPhone(mappedMembers, memberIdentifier, memberIdentifier))
            : null)
          || findMatchedMemberByNameOrPhone(mappedMembers, entry.guest_customer_name, entry.guest_customer_phone);

        return {
          id: entry.settlement_id,
          sourceId: entry.settlement_id,
          entryType: 'SETTLEMENT',
          date: entry.settlement_datetime,
          memberId: inferredMember?.id || 'GUEST',
          customerName: reservationId ? reservationCustomerNameById.get(reservationId) : undefined,
          guestCustomerName: entry.guest_customer_name?.trim() || undefined,
          guestCustomerPhone: entry.guest_customer_phone?.trim() || undefined,
          managerId: entry.manager_employee_id,
          procedureIds: entry.service_ids || [],
          totalAmount: entry.total_amount || 0,
          totalTime: entry.total_time_minutes || 0,
          payments: (entry.payments || []).map((payment) => ({
            method: payment.payment_method_code,
            amount: payment.amount,
            couponServiceId: payment.coupon_service_id ?? undefined,
          })),
          status: toSettlementStatus(entry.status),
          reservationId: reservationId || undefined,
          cancelReason: entry.cancel_reason || undefined,
          cancelledAt: entry.cancelled_at || undefined,
        };
      });

      // 6. 포인트/쿠폰 충전 내역 모델 변환 (취소되지 않은 충전건만)
      const pointRechargeRows: Settlement[] = (memberResult.histories || [])
        .filter((entry) => entry.action_type === 'RECHARGE' && !entry.is_cancelled)
        .map((entry) => {
          const rechargeAmount = Number(entry.amount || 0);
          const paidAmount = Number(entry.received_amount ?? entry.amount ?? 0);
          return {
            id: -entry.id, // 정산건 ID와 겹치지 않게 음수로 처리
            sourceId: entry.id,
            entryType: 'POINT_RECHARGE',
            date: entry.created_at,
            memberId: entry.user_id,
            managerId: null,
            procedureIds: [],
            totalAmount: rechargeAmount,
            totalTime: 0,
            payments: [{ method: entry.payment_method_code, amount: paidAmount }],
            status: 'COMPLETED',
            rechargeType: normalizeRechargeType(entry.recharge_type),
          };
        });

      setSettlements(
        [...settlementRows, ...pointRechargeRows]
          .sort((a, b) => {
            // 날짜 내림차순(최신순) 정렬, 날짜 같으면 ID 역순
            const timeDiff = toTimestamp(b.date) - toTimestamp(a.date);
            if (timeDiff !== 0) return timeDiff;
            return b.id - a.id;
          }),
      );
    } catch (error: any) {
      // 데이터 로드 실패 시 알림 (다국어 "매출내역 데이터를 불러오지 못했습니다." 활용)
      alert(typeof error === 'string' ? error : error?.message || pt('t042') /* "매출내역 데이터를 불러오지 못했습니다." */);
    } finally {
      setIsLoading(false);
    }
  }, [pt]);

  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    void loadData();
  }, [loadData]);

  const paymentMethodNameMap = useMemo(
    () => new Map(paymentMethods.map((entry) => [entry.code.toUpperCase(), entry.name])),
    [paymentMethods],
  );
  const procedurePriceById = useMemo(
    () => new Map(procedures.map((entry) => [entry.id, entry.price])),
    [procedures],
  );

  // [유틸] 결제수단 코드 -> 최종 화면 표시용 명칭 (공통코드 또는 fallback)
  const getPaymentMethodName = (code: string) => {
    const normalizedCode = normalizePaymentMethodCode(code);
    const commonCodeName = paymentMethodNameMap.get(normalizedCode)?.trim();
    if (commonCodeName) return commonCodeName === LEGACY_COUPON_PAYMENT_LABEL ? pt('t071') /* "쿠폰 결재" */ : commonCodeName;
    return getPaymentMethodLabelByCode(normalizedCode, code);
  };

  // [로직] 화면에 표시할 최종 이력 목록 필터링
  const filteredHistory = useMemo(() => {
    // 검색어 및 전화번호 검색용 정규화
    const keyword = searchMember.trim().toLowerCase();
    const searchPhone = searchMember.replace(/-/g, '').trim();

    return settlements.filter((entry) => {
      const customer = getCustomerInfo(entry);
      // 현재 항목에 포함된 시술 객체 매핑
      const procedureRows = entry.procedureIds
        .map((id) => procedures.find((procedure) => procedure.id === id))
        .filter(Boolean) as Procedure[];
      const day = toDateOnly(entry.date);

      // 1. 기간 필터: 시작일과 종료일 사이에 포함되는지 확인
      const matchesDate = (!!day || (!startDate && !endDate))
        && (!startDate || day >= startDate)
        && (!endDate || day <= endDate);

      // 2. 회원 필터: 이름 포함 또는 전화번호(숫자만) 매칭
      const matchesMember = keyword.length === 0
        || customer.name.toLowerCase().includes(keyword)
        || customer.phone.replace(/-/g, '').includes(searchPhone);

      // 3. 담당자 필터: 선택된 담당자 ID가 일치하는지 확인
      const matchesManager = selectedManager === ''
        || (entry.managerId != null && String(entry.managerId) === selectedManager);

      // 4. 카테고리 필터: 정산 건 내부의 시술 중 하나라도 해당 카테고리에 속하는지 확인
      const matchesCategory = selectedCategory === ''
        || (entry.entryType === 'SETTLEMENT'
          && procedureRows.some((procedure) => procedure.categoryName === selectedCategory));

      // 5. 시술 필터: 특정 시술 ID가 포함되어 있는지 확인
      const matchesProcedure = selectedProcedure === ''
        || (entry.entryType === 'SETTLEMENT' && entry.procedureIds.includes(Number(selectedProcedure)));

      // 6. 결제수단 필터: 수납 라인 중 하나라도 해당 결제수단을 사용했는지 확인
      const matchesPayment = selectedPayment === '' || entry.payments.some((payment) => payment.method === selectedPayment);

      // 모든 조건을 만족하는 항목만 반환
      return matchesDate && matchesMember && matchesManager && matchesCategory && matchesProcedure && matchesPayment;
    });
  }, [settlements, searchMember, procedures, startDate, endDate, selectedManager, selectedCategory, selectedProcedure, selectedPayment, getCustomerInfo]);

  // [로직] 필터링된 결과에 대한 매출 요약 통계 계산
  const stats = useMemo(() => {
    return filteredHistory.reduce((acc, entry) => {
      // 취소된 건은 통계에서 제외
      if (entry.status === 'CANCELLED') return acc;

      // 실매출액 가산 (충전금 수납액 합계)
      acc.totalSales += getActualSalesAmount(entry);

      if (entry.entryType === 'SETTLEMENT') {
        // 정산 건인 경우 할인액 산출 및 건수 증가
        acc.totalDiscount += getDiscountAmount(entry, procedurePriceById);
        acc.count += 1;
      }
      return acc;
    }, { totalSales: 0, totalDiscount: 0, count: 0 });
  }, [filteredHistory, procedurePriceById]);

  // [로직] 결제 수단별 수납 총액 및 건수 집계
  const paymentStats = useMemo(() => {
    const totals = new Map<string, number>(); // 금액 합계 Map
    const counts = new Map<string, number>(); // 쿠폰 등 건수 Map

    filteredHistory.forEach((entry) => {
      // 취소건 및 단순 포인트 충전은 결제 분석에서 제외(매출 관점)
      if (entry.status === 'CANCELLED' || entry.entryType === 'POINT_RECHARGE') return;

      entry.payments.forEach((payment) => {
        const normalizedCode = normalizePaymentMethodCode(payment.method);
        if (normalizedCode === 'COUPON') {
          // 쿠폰은 금액이 아닌 사용 회수로 집계
          counts.set('COUPON', (counts.get('COUPON') || 0) + 1);
          return;
        }
        // 일반 결제 수단은 금액 합산
        totals.set(normalizedCode, (totals.get(normalizedCode) || 0) + payment.amount);
      });
    });

    // 화면 표시 순서를 공통 코드 정의 순서에 맞춤
    const orderedCodes = paymentMethods
      .map((entry) => normalizePaymentMethodCode(entry.code))
      .filter((code, index, source) => source.indexOf(code) === index);

    // 정의되지 않은 레거시 코드가 있다면 뒤에 추가
    totals.forEach((_, code) => {
      if (!orderedCodes.includes(code)) {
        orderedCodes.push(code);
      }
    });

    // 최종 통계 객체 배열 생성
    return orderedCodes.map((code) => {
      const commonCodeName = paymentMethodNameMap.get(code)?.trim();
      let name = code;
      if (commonCodeName) {
        name = commonCodeName === LEGACY_COUPON_PAYMENT_LABEL ? pt('t071') /* "쿠폰 결재" */ : commonCodeName;
      } else {
        const labelKey = PAYMENT_METHOD_TEXT_KEY_BY_CODE[code];
        if (labelKey) {
          name = pt(labelKey);
        }
      }
      return {
        code,
        name,
        amount: totals.get(code) || 0,
        count: counts.get(code) || 0,
        isCouponStat: code === 'COUPON',
        isActualSalesExcluded: isActualSalesExcludedPaymentCode(code),
      };
    });
  }, [filteredHistory, paymentMethods, paymentMethodNameMap, pt]);

  // [동작] 필터 조건 초기화
  const resetFilters = () => {
    setStartDate(todayIso());
    setEndDate(todayIso());
    setSearchMember('');
    setSelectedManager('');
    setSelectedCategory('');
    setSelectedProcedure('');
    setSelectedPayment('');
  };

  // [동작] 조회된 이력 목록을 CSV 파일로 내보내기
  const exportCsv = async () => {
    // CSV 헤더 정의 (다국어 키 활용)
    const csvHeader = [
      pt('t063') /* "구분" */,
      pt('t064') /* "ID" */,
      pt('t016') /* "일시" */,
      pt('t065') /* "고객명" */,
      pt('t066') /* "전화번호" */,
      pt('t007') /* "담당자" */,
      pt('t067') /* "시술/항목" */,
      pt('t068') /* "결제수단" */,
      pt('t069') /* "상태" */,
      pt('t014') /* "총액" */,
      pt('t070') /* "실매출액" */,
      pt('t034') /* "할인액" */,
    ];

    // 데이터 행 구성
    const rows = filteredHistory.map((entry) => {
      const customer = getCustomerInfo(entry);
      const managerName = entry.entryType === 'POINT_RECHARGE'
        ? '-'
        : managers.find((manager) => manager.id === entry.managerId)?.name || '-';

      // 시술명 또는 충전 유형 텍스트 구성
      const procedureNames = entry.entryType === 'POINT_RECHARGE'
        ? getPointRechargeLabel(entry)
        : entry.procedureIds.map((id) => procedures.find((procedure) => procedure.id === id)?.name).filter(Boolean).join(', ') || '-';

      const paymentNames = entry.payments.map((payment) => getPaymentMethodName(payment.method)).join(', ');

      const statusLabel = entry.entryType === 'POINT_RECHARGE'
        ? pt('t058', { type: getPointRechargeLabel(entry) }) /* "{{type}} 내역" */
        : getStatusLabelByCode(entry.status);

      return [
        getEntryTypeLabel(entry.entryType),
        entry.sourceId,
        formatDateTime(entry.date),
        customer.name,
        customer.phone || '-',
        managerName,
        procedureNames,
        paymentNames,
        statusLabel,
        entry.totalAmount,
        getActualSalesAmount(entry),
        getDiscountAmount(entry, procedurePriceById),
      ];
    });

    // CSV 파일 생성 및 다운로드 실행
    const result = await downloadCsvFile({
      filename: `sales-history-${todayIso()}.csv`,
      headers: csvHeader,
      rows,
    });

    // 결과 처리 및 알림
    if (!result.success && !result.cancelled) {
      alert(pt('t083') /* "파일 다운로드에 실패했습니다." - ko.json에 없는 경우 직접 메시지 출력 가능하나 가이드 준수 */ || '파일 다운로드에 실패했습니다.');
      return;
    }

    if (result.method === 'tauri' && result.outputPath) {
      alert(`${pt('t084') /* "파일이 저장되었습니다." */}\n${result.outputPath}`);
    }
  };

  const selectedCustomerInfo = selectedHistory ? getCustomerInfo(selectedHistory) : null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="max-w-7xl mx-auto space-y-6 pb-20">
      <LoadingOverlay visible={isLoading} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t008') /* "매출 내역 조회" */}</h1>
          <p className="text-slate-500 mt-1">{pt('t004') /* "다양한 조건으로 시술 및 결제 내역을 조회합니다." */}</p>
        </div>
        <button onClick={() => { void exportCsv(); }} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all">
          <Download size={18} />
          {pt('t043') /* "엑셀 다운로드(CSV)" */}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-800 font-bold"><Filter size={18} className="text-primary" />{pt('t044') /* "상세 필터" */}</div>
          <button onClick={resetFilters} className="text-xs font-bold text-slate-400 hover:text-primary flex items-center gap-1"><RefreshCw size={12} />{pt('t033') /* "필터 초기화" */}</button>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="space-y-2 lg:col-span-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Calendar size={12} />{pt('t021') /* "조회 기간" */}</label>
            <div className="flex items-center gap-2">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20" />
              <span className="text-slate-300 font-bold">~</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><User size={12} />{pt('t035') /* "회원명/전화번호" */}</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input type="text" placeholder={pt('t002') /* "검색어 입력..." */} value={searchMember} onChange={(e) => setSearchMember(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><TrendingUp size={12} />{pt('t006') /* "담당 매니저" */}</label>
            <select value={selectedManager} onChange={(e) => setSelectedManager(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">{pt('t018') /* "전체 매니저" */}</option>
              {managers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.role})</option>)}</select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Tag size={12} /> {pt('t045') /* "카테고리" */}</label>
            <select value={selectedCategory} onChange={(e) => { setSelectedCategory(e.target.value); setSelectedProcedure(''); }} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">{pt('t046') /* "전체 카테고리" */}</option>
              {categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Scissors size={12} />{pt('t011') /* "시술별 조회" */}</label>
            <select value={selectedProcedure} onChange={(e) => setSelectedProcedure(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">{pt('t019') /* "전체 시술" */}</option>
              {procedures.filter((entry) => selectedCategory === '' || entry.categoryName === selectedCategory).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><CreditCard size={12} />{pt('t023') /* "지불 방식" */}</label>
            <select value={selectedPayment} onChange={(e) => setSelectedPayment(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">{pt('t020') /* "전체 지불방식" */}</option>
              {paymentMethods.map((entry) => <option key={entry.code} value={entry.code}>{getPaymentMethodName(entry.code)}</option>)}</select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4"><div className="size-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center"><TrendingUp size={24} /></div><div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t027') /* "총 실매출액" */}</p><h3 className="text-xl font-black text-slate-900">{formatCurrency(stats.totalSales)}</h3></div></div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4"><div className="size-12 bg-red-50 text-red-500 rounded-xl flex items-center justify-center"><Tag size={24} /></div><div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t029') /* "총 할인액" */}</p><h3 className="text-xl font-black text-slate-900">{formatCurrency(stats.totalDiscount)}</h3></div></div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4"><div className="size-12 bg-blue-50 text-blue-500 rounded-xl flex items-center justify-center"><Scissors size={24} /></div><div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t025') /* "총 시술 건수" */}</p><h3 className="text-xl font-black text-slate-900">{stats.count}{pt('t047') /* "건" */}</h3></div></div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
            <CreditCard size={20} />
          </div>
          <div>
            <p className="text-sm font-black text-slate-900">{pt('t080') /* "결제 방식별 수납 현황" */}</p>
            <p className="text-xs text-slate-500">{pt('t081') /* "매출이 어떤 결제 방식으로 수납되었는지 확인합니다." */}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {paymentStats.map((entry) => (
            <div key={entry.code} className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center gap-3">
              <div className="size-10 bg-white text-emerald-500 rounded-lg border border-slate-200 flex items-center justify-center">
                <CreditCard size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t023') /* "지불 방식" */}</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-black text-slate-600 truncate">{entry.name}</p>
                  {entry.isActualSalesExcluded && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-black whitespace-nowrap">
                      {pt('t079') /* "실매출 제외" */}
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-black text-slate-900">
                  {entry.isCouponStat
                    ? `${entry.count.toLocaleString()}${pt('t082') /* "회" */}`
                    : formatCurrency(entry.amount)}
                </h3>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-2 text-[11px] text-slate-400 border-b border-slate-100 bg-slate-50/60">
          {pt('t048') /* "상세 내역은 행을 더블클릭하면 열립니다." */}
        </div>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[1120px]">
            <thead className="bg-slate-50 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
              <tr>
                <th className="py-4 px-6">{pt('t016') /* "일시" */}</th>
                <th className="py-4 px-6">{pt('t049') /* "고객명" */}</th>
                <th className="py-4 px-6">{pt('t050') /* "전화번호" */}</th>
                <th className="py-4 px-6">{pt('t007') /* "담당자" */}</th>
                <th className="py-4 px-6">{pt('t010') /* "시술 항목" */}</th>
                <th className="py-4 px-6">{pt('t023') /* "지불 방식" */}</th>
                <th className="py-4 px-6">{pt('t009') /* "시술 금액" */}</th>
                <th className="py-4 px-6">{pt('t014') /* "실수납액" */}</th>
                <th className="py-4 px-6">{pt('t034') /* "할인/상태" */}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredHistory.map((entry) => {
                const customer = getCustomerInfo(entry);
                const managerName = entry.entryType === 'POINT_RECHARGE'
                  ? '-'
                  : managers.find((manager) => manager.id === entry.managerId)?.name || '-';
                const procedureNames = entry.entryType === 'POINT_RECHARGE'
                  ? getPointRechargeLabel(entry)
                  : entry.procedureIds.map((id) => procedures.find((procedure) => procedure.id === id)?.name).filter(Boolean).join(', ');
                const paid = getActualSalesAmount(entry);
                const discount = getDiscountAmount(entry, procedurePriceById);
                const discountRate = entry.totalAmount > 0 ? Math.round((discount / entry.totalAmount) * 100) : 0;
                return (
                  <tr
                    key={`${entry.entryType}-${entry.id}`}
                    onDoubleClick={() => setSelectedHistory(entry)} className="hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <td className="py-4 px-6 text-xs font-bold text-slate-500">{formatDateTime(entry.date)}</td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <div className={`size-8 rounded-full flex items-center justify-center text-[10px] font-black ${entry.memberId === 'GUEST' ? 'bg-slate-100 text-slate-400' : 'bg-primary/10 text-primary'}`}>
                          {customer.name[0] || '?'}
                        </div>
                        <span className="text-sm font-bold text-slate-900">{customer.name}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600 font-mono">{customer.phone || '-'}</td>
                    <td className="py-4 px-6 text-sm font-bold text-slate-700">{managerName}</td>
                    <td className="py-4 px-6 text-xs text-slate-500 max-w-[200px] truncate">{procedureNames || '-'}</td>
                    <td className="py-4 px-6">
                      <div className="flex flex-wrap gap-1">
                        {entry.payments.map((payment, index) => (
                          <span key={`${entry.id}-${index}`} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold">
                            {getPaymentMethodName(payment.method)}</span>
                        ))}</div>
                    </td>
                    <td className={`py-4 px-6 text-sm font-bold ${entry.entryType === 'POINT_RECHARGE' ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                      {formatCurrency(entry.totalAmount)}</td>
                    <td className="py-4 px-6 text-sm font-black text-slate-900">{formatCurrency(paid)}</td>
                    <td className="py-4 px-6">
                      {entry.entryType === 'POINT_RECHARGE' ? (
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px] font-black">{getPointRechargeLabel(entry)}</span>
                      ) : entry.status === 'CANCELLED' ? (
                        <span className="px-2 py-0.5 bg-rose-50 text-rose-600 rounded text-[10px] font-black">{getStatusLabelByCode('CANCELLED')}</span>
                      ) : entry.status === 'PROCESSING' ? (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-black">{getStatusLabelByCode('PROCESSING')}</span>
                      ) : discount > 0 ? (
                        <span className="px-2 py-0.5 bg-red-50 text-red-500 rounded text-[10px] font-black">{discountRate}% ({formatCurrency(discount)})</span>
                      ) : (
                        <span className="text-slate-300 text-[10px]">-</span>
                      )}</td>
                  </tr>
                );
              })} {filteredHistory.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-20 text-center text-slate-400 font-bold">{pt('t022') /* "조회 조건에 맞는 내역이 없습니다." */}</td>
                </tr>
              )}</tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {selectedHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedHistory(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              drag
              dragControls={detailDragControls}
              dragListener={false}
              dragMomentum={false}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div
                onPointerDown={(e) => detailDragControls.start(e)} className="p-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10 cursor-move active:cursor-grabbing"
              >
                <div className="flex items-center gap-3">
                  <div className="size-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center"><Info size={20} /></div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900">{selectedHistory.entryType === 'POINT_RECHARGE' ? pt('t051') /* "포인트 충전 상세" */ : pt('t052') /* "매출 상세 내역" */}</h2>
                    <p className="text-xs text-slate-500 font-bold">{selectedHistory.entryType === 'POINT_RECHARGE' ? pt('t064') /* "ID" - 원본 t053 키 오용 수정 가능성 염두 */ : pt('t064') /* "ID" */}: {selectedHistory.sourceId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <GripHorizontal size={18} className="text-slate-300" />
                  <button onClick={() => setSelectedHistory(null)} className="size-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t001') /* "거래 일시" */}</p>
                    <div className="flex items-center gap-2 text-slate-900 font-bold"><Clock size={14} className="text-slate-400" />{formatDateTime(selectedHistory.date)}</div>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t024') /* "진행 상태" */}</p>
                    <div className={`flex items-center gap-2 font-bold ${selectedHistory.status === 'COMPLETED' ? 'text-emerald-500' : selectedHistory.status === 'CANCELLED' ? 'text-rose-500' : 'text-blue-500'}`}>
                      {selectedHistory.status === 'COMPLETED' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                      {selectedHistory.entryType === 'POINT_RECHARGE'
                        ? pt('t072') /* "충전 완료" */
                        : getStatusLabelByCode(selectedHistory.status, true)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6 bg-slate-50 rounded-2xl">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{pt('t003') /* "고객 정보" */}</p>
                    <div>
                      <p className="text-sm font-black text-slate-900">{selectedCustomerInfo?.name || '-'}</p>
                      <p className="text-xs text-slate-500 font-bold">{selectedCustomerInfo?.phone || '-'}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{pt('t006') /* "담당 매니저" */}</p>
                    {selectedHistory.entryType === 'POINT_RECHARGE' ? (
                      <div>
                        <p className="text-sm font-black text-slate-900">-</p>
                        <p className="text-xs text-slate-500 font-bold">{pt('t058', { type: getPointRechargeLabel(selectedHistory) }) /* "{{type}} 내역" */}</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-black text-slate-900">{managers.find((entry) => entry.id === selectedHistory.managerId)?.name || '-'}</p>
                        <p className="text-xs text-slate-500 font-bold">{managers.find((entry) => entry.id === selectedHistory.managerId)?.role || '-'}</p>
                      </div>
                    )}</div>
                </div>

                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                    {selectedHistory.entryType === 'POINT_RECHARGE' ? pt('t063') /* "구분" */ : pt('t010') /* "시술 항목" */}
                  </p>
                  {selectedHistory.entryType === 'POINT_RECHARGE' ? (
                    <div className="p-3 border border-slate-100 rounded-xl bg-emerald-50/40">
                      <p className="text-sm font-bold text-slate-900">{getPointRechargeLabel(selectedHistory)} ({getRechargeTypeDisplayLabel(selectedHistory.rechargeType)})</p>
                      <p className="text-[10px] text-slate-500 font-bold">{pt('t079') /* "실매출 제외" */}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedHistory.procedureIds.map((id) => {
                        const procedure = procedures.find((entry) => entry.id === id);
                        const isCouponProcedure = selectedHistory.payments.some(
                          (payment) => isCouponPaymentMethod(payment.method) && payment.couponServiceId === id,
                        );
                        return (
                          <div key={id} className="flex items-center justify-between p-3 border border-slate-100 rounded-xl">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-bold text-slate-900">{procedure?.name || pt('t059') /* "미등록 시술" */}</p>
                                {isCouponProcedure && (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-700">{pt('t032') /* "쿠폰결재" */}</span>
                                )}</div>
                              <p className="text-[10px] text-slate-400 font-bold">{procedure?.categoryName || '-'} | {procedure?.time || 0}{pt('t060') /* "분" */}</p>
                            </div>
                            <p className="text-sm font-black text-slate-900">{formatCurrency(procedure?.price || 0)}</p>
                          </div>
                        );
                      })}</div>
                  )}</div>

                <div className="bg-slate-900 text-white rounded-2xl p-6 space-y-3">
                  {selectedHistory.entryType === 'POINT_RECHARGE' ? (
                    <>
                      <div className="flex justify-between text-sm font-bold text-slate-400"><span>{pt('t031') /* "충전 금액" */}</span><span>{formatCurrency(selectedHistory.totalAmount)}</span></div>
                      <div className="h-px bg-white/10" />
                      <div className="flex justify-between items-end"><span className="text-sm font-bold text-slate-400">{pt('t012') /* "실매출 반영 금액" */}</span><span className="text-2xl font-black text-primary">{formatCurrency(getActualSalesAmount(selectedHistory))}</span></div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between text-sm font-bold text-slate-400"><span>{pt('t026') /* "총 시술 금액" */}</span><span>{formatCurrency(selectedHistory.totalAmount)}</span></div>
                      <div className="flex justify-between text-sm font-bold text-red-400"><span>{pt('t028') /* "총 할인 금액" */}</span><span>- {formatCurrency(getDiscountAmount(selectedHistory, procedurePriceById))}</span></div>
                      <div className="h-px bg-white/10" />
                      <div className="flex justify-between text-sm font-bold text-slate-400"><span>{pt('t030') /* "최종 결제 금액" */}</span><span>{formatCurrency(getTotalPaidAmount(selectedHistory))}</span></div>
                      <div className="flex justify-between items-end"><span className="text-sm font-bold text-slate-400">{pt('t012') /* "실매출 반영 금액" */}</span><span className="text-2xl font-black text-primary">{formatCurrency(getActualSalesAmount(selectedHistory))}</span></div>
                    </>
                  )}</div>

                {selectedHistory.entryType === 'SETTLEMENT' && selectedHistory.cancelReason && (
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-sm text-rose-900 font-medium">
                    {pt('t061', { reason: selectedHistory.cancelReason }) /* "취소 사유: {{reason}}" */}
                    {selectedHistory.cancelledAt && <p className="text-xs text-rose-700 mt-2">{pt('t062', { date: formatDateTime(selectedHistory.cancelledAt) }) /* "취소일시: {{date}}" */}</p>}
                  </div>
                )}</div>

              <div className="p-6 border-t border-slate-100 bg-slate-50">
                <button onClick={() => setSelectedHistory(null)} className="w-full py-3 bg-white border border-slate-200 rounded-xl text-sm font-black text-slate-600 hover:bg-slate-100 transition-all">{pt('t005') /* "닫기" */}</button>
              </div>
            </motion.div>
          </div>
        )}</AnimatePresence>
    </motion.div>
  );
}

