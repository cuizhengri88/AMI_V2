/**
 * [페이지] 회원 관리 (UserManagementPage)
 * 
 * 시스템의 전체 회원을 목록 형태로 조회하고, 신규 등록 및 정보 수정을 수행하는 페이지입니다.
 * 회원의 기본 정보(이름, 연락처, 이메일 등) 관리뿐만 아니라, 
 * 특정 회원의 시술 이력, 예약 이력, 포인트/쿠폰 잔액 정보를 통합하여 확인할 수 있는 히스토리 모달 기능을 제공합니다.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Users, UserPlus, Mail, MapPin, Phone, FileText, Search, Edit2, X, GripHorizontal, Trash2, Loader2, Database, Calendar, CreditCard, Clock3 } from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';
import {
  formatCurrency,
  formatDateTime,
  isSamePhoneDigits,
  normalizeNameKey,
  normalizePhoneDigits,
  toTimestamp,
} from '../utils/pageCommon';

// 회원 관리 테이블 1행 모델
type User = {
  // 회원 ID
  user_id: number;
  // 회원명
  name: string;
  // 이메일
  email?: string;
  // 성별
  gender?: string;
  // 전화번호
  phone?: string;
  // 주소
  address?: string;
  // 비고
  remarks?: string;
};

// 회원 등록/수정 모달 폼 모델
type FormData = {
  // 수정 시 대상 회원 ID
  user_id?: number;
  // 필수 입력: 회원명
  name: string;
  // 선택 입력: 이메일
  email?: string;
  // 선택 입력: 성별
  gender?: string;
  // 선택 입력: 전화번호
  phone?: string;
  // 선택 입력: 주소
  address?: string;
  // 선택 입력: 비고
  remarks?: string;
};

// 회원 보유 쿠폰 모델
type MemberPointCoupon = {
  service_id: number;   // 시술 ID
  service_name: string; // 시술명
  count: number;        // 보유한 쿠폰 수량
};

// 포인트/쿠폰 조회 결과의 회원 모델
type MemberPointMember = {
  user_id: number;               // 회원 고유 ID
  user_name: string;             // 회원 성성함
  phone: string | null;          // 연락처
  point_balance: number;         // 현재 포인트 잔액
  coupons: MemberPointCoupon[];  // 보유 중인 쿠폰 목록
};

// 정산 결제 상세 모델
type SalesSettlementPayment = {
  payment_method_code: string;   // 결제수단 코드 (CASH, CARD, POINT 등)
  amount: number;               // 해당 수단으로 결제한 금액
  coupon_service_id: number | null; // 쿠폰 결제 시 적용된 시술 ID
};

// 정산 데이터 모델 (회원 히스토리 구성용)
type SalesSettlement = {
  settlement_id: number;         // 정산 고유 ID
  settlement_datetime: string;   // 정산 처리 일시
  member_user_id: string | null; // 회원 식별자
  guest_customer_name?: string | null;  // 비회원일 경우 고객명
  guest_customer_phone?: string | null; // 비회원일 경우 연락처
  manager_employee_id: number;   // 담당 직원 ID
  service_ids: number[];         // 포함된 시술 ID 목록
  total_amount: number;          // 총 결합 금액
  payments: SalesSettlementPayment[]; // 결제 상세 목록
  status: string;                // 정산 상태 (COMPLETED, CANCELLED 등)
  reservation_ref: string | null; // 연결된 예약 ID 참조
  cancel_reason: string | null;  // 취소 사유
  cancelled_at: string | null;   // 취소 일시
};

// 예약 시술 최소 모델
type ReservationService = {
  service_name: string;          // 시술 명칭
};

// 예약 히스토리 원본 모델 (DB 응답 객체)
type Reservation = {
  reservation_id: number;        // 예약 고유 ID
  reservation_date: string;      // 예약일 (YYYY-MM-DD)
  start_time: string;            // 예약 시작 시간
  customer_name: string;         // 고객 성함
  designer_name: string;         // 담당 디자이너(직원) 명칭
  status: string;                // 예약 상태
  note: string | null;           // 예약 관련 메모
  services: ReservationService[]; // 예약된 시술 목록
};

// 직원 최소 모델 (데이터 매핑용)
type Employee = {
  employee_id: number;           // 직원 ID
  employee_name: string;         // 직원 성함
};

// 시술 카탈로그 최소 모델
type ServiceCatalogItem = {
  service_id: number;            // 시술 고유 ID
  service_name: string;          // 시술 명칭
};

// 공통코드 상세 모델 (결제수단 라벨 표시용)
type CommonCodeDetail = {
  group: string;                 // 코드 그룹 명칭
  code: string;                  // 코드값
  name: string;                  // 코드 표시 명칭
  use_yn: 'Y' | 'N';             // 사용 여부
};

// 회원 시술 이력 행 모델 (정산 및 예약 데이터를 통합한 결과)
type MemberTreatmentHistoryRow = {
  history_key: string;           // 행 식별 키 (settlement-N 또는 reservation-N)
  datetime: string;              // 시술 일시
  manager_name: string;          // 담당자명
  service_names: string[];       // 시술 항목 목록
  payment_labels: string[];      // 결제 수단 및 금액 라벨 목록
  total_amount: number | null;   // 총 결제 금액
  status: string;                // 상태값
  cancel_reason: string | null;  // 취소 사유
  cancelled_at: string | null;   // 취소 일시
  source: 'SETTLEMENT' | 'RESERVATION'; // 데이터 출처
};

// 회원 예약 이력 행 모델 (미완료 예약 위주)
type MemberReservationHistoryRow = {
  reservation_id: number;        // 예약 ID
  datetime: string;              // 예약 일시
  status: string;                // 상태
  designer_name: string;         // 담당자명
  service_names: string[];       // 예약 시술 항목
  note: string | null;           // 예약 메모
  is_linked: boolean;            // 정산 데이터와 연결되었는지 여부
};

// 예약일/시간 조합 문자열 표시
function formatReservationDateTime(date: string | null | undefined, time: string | null | undefined) {
  const dateValue = (date || '').trim();
  const timeValue = (time || '').trim();
  if (!dateValue && !timeValue) return '-';
  if (!dateValue) return timeValue || '-';
  if (!timeValue) return dateValue;
  return `${dateValue} ${timeValue}`;
}

// 회원-예약/정산 매칭 규칙(이름/전화)
function isMatchedByNameOrPhone(
  customerName?: string | null,
  customerPhone?: string | null,
  memberName?: string | null,
  memberPhone?: string | null,
) {
  const memberNameKey = normalizeNameKey(memberName);
  const customerNameKey = normalizeNameKey(customerName);
  const memberPhoneDigits = normalizePhoneDigits(memberPhone);
  const customerPhoneDigits = normalizePhoneDigits(customerPhone);
  const customerNameDigits = normalizePhoneDigits(customerName);

  const isNameMatched =
    memberNameKey.length > 0
    && customerNameKey.length > 0
    && memberNameKey === customerNameKey;

  if (isNameMatched) return true;
  if (memberPhoneDigits.length < 7) return false;
  if (customerPhoneDigits.length >= 7 && isSamePhoneDigits(memberPhoneDigits, customerPhoneDigits)) return true;
  if (customerNameDigits.length >= 7 && isSamePhoneDigits(memberPhoneDigits, customerNameDigits)) return true;
  return false;
}

// 예약 상태가 완료인지 판정
function isCompletedReservationStatus(status?: string | null) {
  const normalized = (status || '').trim().toUpperCase();
  return normalized === 'COMPLETED' || normalized === '완료';
}

// 정산 상태가 완료인지 판정
function isCompletedSettlementStatus(status?: string | null) {
  const normalized = (status || '').trim().toUpperCase();
  return normalized === 'COMPLETED';
}

export default function UserManagementPage() {
  // [상태] 페이지 번역 및 기본 번역 훅
  const pt = usePageText('user_management_user_management');
  const { t } = useTranslation();

  // [상태] 회원 데이터 실시간 관리
  const [users, setUsers] = useState<User[]>([]); // DB에서 가져온 전체 회원 원본 목록
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]); // 검색 조건이 적용된 화면 표시 목록
  const [searchText, setSearchText] = useState(''); // 이름/전화번호 통합 검색 입력값

  // [상태] 로딩 및 처리 중 상태 표시
  const [isLoading, setIsLoading] = useState(false); // 전체 목록 조회 로딩 여부
  const [isMutating, setIsMutating] = useState(false); // 저장, 삭제 등 데이터 변경 처리 중 여부

  // [상태] 등록/수정 모달 관련 제어
  const [isModalOpen, setIsModalOpen] = useState(false); // 회원 추가/수정 모달 오픈 상태
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add'); // 'add': 신규 등록, 'edit': 기존 정보 수정
  const [formData, setFormData] = useState<FormData>({ name: '', email: '', gender: '' }); // 현재 모달의 입력 데이터

  // [상태] 회원 상세 히스토리(이력) 모달 관련 제어
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false); // 히스토리 모달 오픈 여부
  const [isHistoryLoading, setIsHistoryLoading] = useState(false); // 상세 데이터 로딩 여부
  const [historyError, setHistoryError] = useState(''); // 데이터 로드 실패 시 에러 메시지
  const [selectedHistoryUser, setSelectedHistoryUser] = useState<User | null>(null); // 현재 상세 정보를 보고 있는 대상 회원

  // [상태] 상세 모달 내 표시 정보 (포인트, 쿠폰, 시술/예약 이력)
  const [memberPointBalance, setMemberPointBalance] = useState(0); // 대상 회원의 실시간 포인트 잔액
  const [memberCoupons, setMemberCoupons] = useState<MemberPointCoupon[]>([]); // 대상 회원의 보유 쿠폰 목록
  const [memberTreatmentHistories, setMemberTreatmentHistories] = useState<MemberTreatmentHistoryRow[]>([]); // 가공된 시술 이력 목록
  const [memberReservationHistories, setMemberReservationHistories] = useState<MemberReservationHistoryRow[]>([]); // 가공된 예약 이력 목록
  const [hasNameMatchedReservation, setHasNameMatchedReservation] = useState(false); // 이름 일치로 자동 연동된 정보가 있는지 여부
  const [expandedServiceHistoryKey, setExpandedServiceHistoryKey] = useState<string | null>(null); // 아코디언 형태로 펼쳐진 시술 정보의 키값

  // [동작] DB에서 회원 목록을 새로고침하여 상태 업데이트
  const loadUsers = async () => {
    try {
      setIsLoading(true);
      // DB 커맨드 호출하여 전체 회원 목록 수신
      const result = await invokeDbCommand<{ success: boolean; users: User[] }>('get_user_management_data');
      setUsers(result.users || []); // 원본 데이터 보관
      setFilteredUsers(result.users || []); // 초기 화면 표시 데이터 설정
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '회원 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 컴포넌트 마운트 시 최초 1회 데이터 로드
  useEffect(() => {
    loadUsers();
  }, []);

  // [로직] 검색어 입력 시 실시간으로 화면 목록 필터링
  useEffect(() => {
    const normalizedSearchText = searchText.trim().toLowerCase();
    const normalizedSearchPhone = searchText.replace(/\D/g, ''); // 숫자만 추출하여 비교

    const filtered = users.filter((user) => {
      // 1. 이름 매칭 확인
      const nameMatched = user.name.toLowerCase().includes(normalizedSearchText);
      // 2. 연락처 숫자 매칭 확인
      const phoneMatched =
        normalizedSearchPhone.length > 0 &&
        (user.phone || '').replace(/\D/g, '').includes(normalizedSearchPhone);
      return nameMatched || phoneMatched;
    });
    setFilteredUsers(filtered);
  }, [searchText, users]);

  // 성별 표현값을 M/F로 정규화
  const normalizeGenderForForm = (gender?: string) => {
    const normalized = (gender || '').trim().toUpperCase();
    if (normalized === 'M' || normalized === 'MALE' || normalized === '남' || normalized === '남성') return 'M';
    if (normalized === 'F' || normalized === 'FEMALE' || normalized === '여' || normalized === '여성') return 'F';
    return '';
  };

  // 신규 회원 모달 오픈
  const handleAddClick = () => {
    setModalMode('add');
    setFormData({ name: '', email: '', gender: '' });
    setIsModalOpen(true);
  };

  // 수정 모달 오픈 + 선택 회원 데이터 주입
  const handleEditClick = (user: User) => {
    setModalMode('edit');
    setFormData({ ...user, email: user.email || '', gender: normalizeGenderForForm(user.gender) });
    setIsModalOpen(true);
  };

  // [동작] 회원 정보 저장 (등록 및 수정 통합 처리)
  const handleSave = async (e: React.FormEvent) => {
    // 폼 제출에 의한 페이지 새로고침 방지
    e.preventDefault();

    // 필수 입력값 검증
    if (!formData.name) {
      alert(pt('t001') /* "이름을 입력해주세요." */);
      return;
    }

    try {
      setIsMutating(true);
      // DB에 회원 정보 저장 요청
      await invokeDbCommand('upsert_user_management', {
        user: formData,
      });
      // 저장 성공 후 목록 새로고침 및 모달 닫기
      await loadUsers();
      setIsModalOpen(false);
      alert(modalMode === 'add' ? '회원이 추가되었습니다.' : '회원이 수정되었습니다.');
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '저장에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  // [동작] 회원 삭제 처리
  const handleDelete = async (userId: number) => {
    // 사용자 삭제 컨펌 확인
    if (!window.confirm(pt('t003') /* "정말 이 회원을 삭제하시겠습니까?" */)) return;

    try {
      setIsMutating(true);
      // DB 삭제 요청
      await invokeDbCommand('delete_user_management', { user_id: userId });
      // 삭제 후 목록 새로고침
      await loadUsers();
      alert(pt('t006') /* "회원이 삭제되었습니다." */);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  // [로직] 성별 표시 텍스트 반환
  const getGenderLabel = (gender?: string) => {
    const normalized = (gender || '').trim().toUpperCase();
    if (normalized === 'M') return pt('t009') /* "남성" */;
    if (normalized === 'F') return pt('t010') /* "여성" */;
    return gender?.trim() || '-';
  };

  // [로직] 정산 상태 표시 텍스트 반환
  const getSettlementStatusLabel = (status: string) => {
    const normalized = status?.trim().toUpperCase();
    if (normalized === 'COMPLETED') return pt('t053') /* "정산 완료" */;
    if (normalized === 'PROCESSING') return pt('t054') /* "시술 중" */;
    if (normalized === 'CANCELLED') return pt('t046') /* "취소됨" */;
    return pt('t047') /* "알 수 없음" */;
  };

  // [로직] 예약 상태 표시 텍스트 반환
  const getReservationStatusLabel = (status: string) => {
    const normalized = status?.trim().toUpperCase();
    if (normalized === 'RESERVED') return pt('t044') /* "예약됨" */;
    if (normalized === 'COMPLETED') return pt('t045') /* "완료" */;
    if (normalized === 'CANCELLED') return pt('t046') /* "취소됨" */;
    return status?.trim() || pt('t047') /* "알 수 없음" */;
  };

  // 히스토리 모달 내부 상태 초기화
  const resetHistoryState = () => {
    setHistoryError('');
    setMemberPointBalance(0);
    setMemberCoupons([]);
    setMemberTreatmentHistories([]);
    setMemberReservationHistories([]);
    setHasNameMatchedReservation(false);
    setExpandedServiceHistoryKey(null);
  };

  // 시술 목록 펼침/접힘 토글
  const toggleServiceList = (historyKey: string) => {
    setExpandedServiceHistoryKey((prev) => (prev === historyKey ? null : historyKey));
  };

  // [로직] 특정 회원의 모든 이력(포인트, 정산, 예약) 상세 조회 및 필터링/가공
  const loadMemberHistory = async (user: User) => {
    const targetUserId = user.user_id;
    setIsHistoryLoading(true);
    resetHistoryState();

    try {
      // 포인트, 정산, 예약, 직원명, 시술명 등을 병렬로 일괄 로드
      const [
        pointResult,
        settlementResult,
        reservationResult,
        employeeResult,
        serviceResult,
        commonCodeResult,
      ] = await Promise.all([
        invokeDbCommand<{ members: MemberPointMember[] }>('get_member_point_management_data'),
        invokeDbCommand<{ settlements: SalesSettlement[] }>('get_sales_settlement_data'),
        invokeDbCommand<{ reservations: Reservation[] }>('get_reservation_calendar_data'),
        invokeDbCommand<{ employees: Employee[] }>('get_employee_management_data'),
        invokeDbCommand<{ items: ServiceCatalogItem[] }>('get_service_catalog_data'),
        invokeDbCommand<{ details: CommonCodeDetail[] }>('get_common_code_management_data'),
      ]);

      // 1. 해당 회원의 실시간 포인트 및 쿠폰 잔액 추출
      const memberSnapshot = (pointResult.members || []).find((entry) => entry.user_id === targetUserId);
      setMemberPointBalance(Number(memberSnapshot?.point_balance || 0));
      setMemberCoupons(memberSnapshot?.coupons || []);

      // 시술 및 담당자 이름 매핑을 위한 Lookup Map 생성
      const managerNameById = new Map((employeeResult.employees || []).map((entry) => [entry.employee_id, entry.employee_name]));
      const serviceNameById = new Map((serviceResult.items || []).map((entry) => [entry.service_id, entry.service_name]));
      const paymentMethodNameByCode = new Map(
        (commonCodeResult.details || [])
          .filter((entry) => entry.group === 'PAYMENT_METHOD' && entry.use_yn === 'Y')
          .map((entry) => [entry.code.trim().toUpperCase(), entry.name]),
      );

      // 2. 이름/전화번호 매칭 기반으로 이 회원과 연관된 예약 ID 세트 생성
      const nameMatchedReservationIdSet = new Set<number>();
      (reservationResult.reservations || []).forEach((entry) => {
        if (isMatchedByNameOrPhone(entry.customer_name, null, user.name, user.phone)) {
          nameMatchedReservationIdSet.add(entry.reservation_id);
        }
      });

      // 3. 정산 내역 중 이 회원과 연관된 건만 필터링 (회원ID 일치 OR 이름/전화 매칭)
      const matchedSettlements = (settlementResult.settlements || [])
        .filter((entry) => {
          const reservationId = Number(entry.reservation_ref || 0);
          // 예약 기반으로 생성된 정산 건인 경우, 해당 예약이 이 회원의 것인지 확인
          if (
            Number.isFinite(reservationId)
            && reservationId > 0
            && nameMatchedReservationIdSet.has(reservationId)
            && isCompletedSettlementStatus(entry.status)
          ) {
            return true;
          }

          const memberIdentifier = (entry.member_user_id || '').trim();
          if (memberIdentifier) {
            // 회원 ID(숫자)가 정확히 일치하는 경우
            if (/^\d+$/.test(memberIdentifier) && Number(memberIdentifier) === targetUserId) {
              return true;
            }
            // 식별자 텍스트에 이름이나 연락처 매칭이 있는 경우
            if (isMatchedByNameOrPhone(memberIdentifier, memberIdentifier, user.name, user.phone)) {
              return true;
            }
          }
          // 비회원 수기 입력 정보가 이 회원의 정보와 일치하는 경우
          return isMatchedByNameOrPhone(
            entry.guest_customer_name,
            entry.guest_customer_phone,
            user.name,
            user.phone,
          );
        });

      // 4. 필터링된 정산 내역을 화면 표시용 모델로 변환
      const settlementTreatments = matchedSettlements
        .sort((a, b) => (toTimestamp(b.settlement_datetime) - toTimestamp(a.settlement_datetime)) || (b.settlement_id - a.settlement_id))
        .map((entry): MemberTreatmentHistoryRow => {
          // 시술 ID 리스트를 이름 리스트로 변환
          const serviceNames = (entry.service_ids || []).map((serviceId) => serviceNameById.get(serviceId) || `${pt('t055') /* "미등록" */}#${serviceId}`);

          // 결제 상세 라인을 수단+금액 문자열로 변환
          const paymentLabels = (entry.payments || []).map((payment) => {
            const code = payment.payment_method_code?.trim().toUpperCase() || '';
            const methodName = paymentMethodNameByCode.get(code) || payment.payment_method_code || pt('t056') /* "기타" */;
            const amountText = formatCurrency(payment.amount);

            // 쿠폰 결제인 경우 어떤 시술의 쿠폰을 썼는지 부가 정보 추가
            if (code === 'COUPON' && payment.coupon_service_id) {
              const couponServiceName = serviceNameById.get(payment.coupon_service_id) || `${pt('t055') /* "미등록" */}#${payment.coupon_service_id}`;
              return `${methodName} ${amountText} (${couponServiceName})`;
            }
            return `${methodName} ${amountText}`;
          });

          return {
            history_key: `settlement-${entry.settlement_id}`,
            datetime: entry.settlement_datetime,
            manager_name: managerNameById.get(entry.manager_employee_id) || `#${entry.manager_employee_id}`,
            service_names: serviceNames,
            payment_labels: paymentLabels,
            total_amount: entry.total_amount || 0,
            status: entry.status || '',
            cancel_reason: entry.cancel_reason,
            cancelled_at: entry.cancelled_at,
            source: 'SETTLEMENT',
          };
        });

      // 5. 정산 데이터에서 참조하고 있는 예약 ID 목록 수집 (중복 매핑 방지용)
      const linkedReservationIdSet = new Set<number>();
      matchedSettlements.forEach((entry) => {
        const reservationId = Number(entry.reservation_ref || 0);
        if (Number.isFinite(reservationId) && reservationId > 0) {
          linkedReservationIdSet.add(reservationId);
        }
      });

      let nameMatchFlag = false;

      // 6. 회원과 연관된 예약 정보를 시각화 데이터로 변환
      const reservationMap = new Map<number, MemberReservationHistoryRow>();
      (reservationResult.reservations || []).forEach((entry) => {
        const isLinked = linkedReservationIdSet.has(entry.reservation_id);
        const isNameOrPhoneMatched = nameMatchedReservationIdSet.has(entry.reservation_id);

        // 정산에 연결되었거나, 단순 이름 매칭 정보인 경우만 수집
        if (!isLinked && !isNameOrPhoneMatched) return;
        if (isNameOrPhoneMatched && !isLinked) nameMatchFlag = true;

        reservationMap.set(entry.reservation_id, {
          reservation_id: entry.reservation_id,
          datetime: formatReservationDateTime(entry.reservation_date, entry.start_time),
          status: entry.status || '',
          designer_name: entry.designer_name || '-',
          service_names: (entry.services || []).map((service) => service.service_name).filter(Boolean),
          note: entry.note || null,
          is_linked: isLinked,
        });
      });

      // 최신순 정렬
      const sortedReservations = Array.from(reservationMap.values())
        .sort((a, b) => (toTimestamp(b.datetime) - toTimestamp(a.datetime)) || (b.reservation_id - a.reservation_id));

      // 7. 정산되지 않은 '완료' 상태의 예약을 별도 시술 이력 행으로 매핑 (누락 데이터 보완)
      const completedReservationTreatments = sortedReservations
        .filter((entry) => isCompletedReservationStatus(entry.status) && !entry.is_linked)
        .map((entry): MemberTreatmentHistoryRow => ({
          history_key: `reservation-${entry.reservation_id}`,
          datetime: entry.datetime,
          manager_name: entry.designer_name || '-',
          service_names: entry.service_names,
          payment_labels: [],
          total_amount: null,
          status: entry.status || 'COMPLETED',
          cancel_reason: null,
          cancelled_at: null,
          source: 'RESERVATION',
        }));

      // 최종 시술 이력 리스트 병합 및 정렬
      const mergedTreatments = [...settlementTreatments, ...completedReservationTreatments]
        .sort((a, b) => (toTimestamp(b.datetime) - toTimestamp(a.datetime)) || b.history_key.localeCompare(a.history_key));

      setMemberTreatmentHistories(mergedTreatments);
      // '예약됨' 등 아직 시술 단계가 아닌 정보만 노출
      setMemberReservationHistories(sortedReservations.filter((entry) => !isCompletedReservationStatus(entry.status)));
      setHasNameMatchedReservation(nameMatchFlag);
    } catch (error: any) {
      setHistoryError(typeof error === 'string' ? error : error?.message || pt('t023') /* "상세 정보를 불러오지 못했습니다." */);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const openHistoryModal = (user: User) => {
    setSelectedHistoryUser(user);
    setIsHistoryModalOpen(true);
    void loadMemberHistory(user);
  };

  const closeHistoryModal = () => {
    setIsHistoryModalOpen(false);
    setSelectedHistoryUser(null);
    resetHistoryState();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <LoadingOverlay visible={isLoading} message="로딩 중..." />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t('user.title')}</h1>
          <p className="text-slate-500 mt-1">{t('user.description')}</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={loadUsers}
            disabled={isLoading}
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
            {isLoading ? '불러오는 중...' : 'DB 새로고침'}
          </button>
          <button
            onClick={handleAddClick}
            disabled={isLoading}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            <UserPlus size={18} />
            {t('user.add_button')}</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder={t('user.search_placeholder') /* "이름 또는 전화번호로 검색" */} value={searchText}
              onChange={(e) => setSearchText(e.target.value)} className="w-full pl-10 pr-4 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
          <div className="text-xs text-slate-400 font-medium">{t('user.total_count', { count: filteredUsers.length }) /* "총 {{count}}명의 회원이 있습니다." */}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead>
              <tr className="bg-slate-900 text-slate-200">
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">ID</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_name') /* "이름" */}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_email') /* "이메일" */}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t007') /* "성별" */}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_address') /* "주소" */}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_phone') /* "전화번호" */}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_remarks') /* "비고" */}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('common.action') /* "작업" */}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400 text-sm">
                    회원 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.user_id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6 text-sm font-mono font-bold text-slate-500">{user.user_id}</td>
                    <td className="py-4 px-6">
                      <span className="text-sm font-bold text-slate-900">{user.name}</span>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <Mail size={14} className="text-slate-400" />
                        {user.email || '-'}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">{getGenderLabel(user.gender)}</td>
                    <td className="py-4 px-6 text-sm text-slate-600 max-w-[200px] truncate">
                      <div className="flex items-center gap-2">
                        <MapPin size={14} className="text-slate-400 flex-shrink-0" />
                        {user.address || '-'}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <Phone size={14} className="text-slate-400" />
                        {user.phone || '-'}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-slate-400" />
                        {user.remarks || '-'}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openHistoryModal(user)}
                          className="text-sky-700 hover:text-sky-800 font-bold text-xs flex items-center justify-center gap-1 bg-sky-50 px-2 py-1 rounded transition-colors"
                        >
                          <Clock3 size={14} />
                          {pt('t011') /* "히스토리" */}</button>
                        <button
                          onClick={() => handleEditClick(user)} disabled={isMutating}
                          className="text-primary hover:text-primary/80 font-bold text-xs flex items-center justify-center gap-1 bg-primary/5 px-2 py-1 rounded transition-colors disabled:opacity-50"
                        >
                          <Edit2 size={14} />
                          {t('common.edit') /* "수정" */}</button>
                        <button
                          onClick={() => handleDelete(user.user_id)} disabled={isMutating}
                          className="text-red-500 hover:text-red-600 font-bold text-xs flex items-center justify-center gap-1 bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}</tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={modalMode === 'add' ? '새 회원 추가' : '회원 정보 수정'}
              onClose={() => setIsModalOpen(false)} icon={<UserPlus size={20} className="text-primary" />}
            >
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">이름</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder={pt('t005')} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">이메일</label>
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder={pt('t002')} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t007') /* "성별" */}</label>
                  <select
                    value={formData.gender || ''}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="">{pt('t008') /* "미선택" */}</option>
                    <option value="M">{pt('t009') /* "남성" */}</option>
                    <option value="F">{pt('t010') /* "여성" */}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">전화번호</label>
                  <input
                    type="text"
                    value={formData.phone || ''}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="010-1234-5678"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">주소</label>
                  <input
                    type="text"
                    value={formData.address || ''}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="주소"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">비고</label>
                  <textarea
                    value={formData.remarks || ''}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} placeholder={pt('t004')} rows={3}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)} disabled={isMutating}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
                  >
                    {t('common.cancel')}</button>
                  <button
                    type="submit"
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                  >
                    {isMutating ? '저장 중...' : t('common.save')}</button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}</AnimatePresence>

      <AnimatePresence>
        {isHistoryModalOpen && selectedHistoryUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeHistoryModal}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <DraggableModal
              title={pt('t012', { name: selectedHistoryUser.name })}
              onClose={closeHistoryModal}
              icon={<Users size={20} className="text-primary" />}
              containerClassName="max-w-6xl"
            >
              <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
                {isHistoryLoading ? (
                  <div className="py-16 text-center text-sm font-bold text-slate-500">{pt('t022') /* "상세 정보를 불러오는 중입니다..." */}</div>
                ) : historyError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 font-semibold">{historyError || pt('t023') /* "상세 정보를 불러오지 못했습니다." */}</div>
                ) : (
                  <>
                    {/* [섹션] 개요 통계 */}
                    <section className="space-y-4">
                      <h4 className="text-sm font-black text-slate-800 tracking-wide uppercase">{pt('t013') /* "최근 방문 개요" */}</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t014') /* "포인트 잔액" */}</p>
                          <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(memberPointBalance)}</p>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t016') /* "시술 이력" */}</p>
                          <p className="mt-1 text-lg font-black text-slate-900">{memberTreatmentHistories.length}{pt('t049') /* "건" */}</p>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t018') /* "대기/예약" */}</p>
                          <p className="mt-1 text-lg font-black text-slate-900">{memberReservationHistories.length}{pt('t049') /* "건" */}</p>
                        </div>
                      </div>

                      {/* [섹션] 비고 및 보유 쿠폰 */}
                      <div className="bg-white border border-slate-200 rounded-xl p-4">
                        <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">{pt('t052') /* "회원 상세 정보" */}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                          <div className="text-slate-700"><span className="font-bold text-slate-900">{t('user.col_name') /* "이름" */}:</span> {selectedHistoryUser.name}</div>
                          <div className="text-slate-700"><span className="font-bold text-slate-900">{pt('t060') /* "연락처" */}:</span> {selectedHistoryUser.phone || '-'}</div>
                        </div>
                        <div className="mt-3 space-y-1">
                          <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">{pt('t040') /* "비고" */}</p>
                          <div className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-slate-50 min-h-[84px] whitespace-pre-wrap break-words">
                            {selectedHistoryUser.remarks?.trim() || '-'}
                          </div>
                        </div>
                        <div className="mt-3">
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">{pt('t015') /* "보유 중인 쿠폰" */}</p>
                          <div className="flex flex-wrap gap-2">
                            {memberCoupons.length === 0 ? (
                              <span className="text-xs text-slate-400">-</span>
                            ) : (
                              memberCoupons.map((coupon) => (
                                <span key={`${coupon.service_id}-${coupon.count}`} className="px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">
                                  {coupon.service_name} {coupon.count}{pt('t050') /* "회" */}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* [섹션] 시술 완료 내역 */}
                    <section className="space-y-3">
                      <h4 className="text-sm font-black text-slate-800 tracking-wide uppercase flex items-center gap-2">
                        <CreditCard size={16} className="text-primary" />
                        {pt('t019') /* "시술 내역 (정산 완료)" */}
                      </h4>
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full min-w-[900px] text-left">
                          <thead className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500 uppercase tracking-wide">
                            <tr>
                              <th className="py-3 px-4">{pt('t024') /* "일시" */}</th>
                              <th className="py-3 px-4">{pt('t025') /* "상태" */}</th>
                              <th className="py-3 px-4">{pt('t026') /* "담당자" */}</th>
                              <th className="py-3 px-4">{pt('t027') /* "시술항목" */}</th>
                              <th className="py-3 px-4">{pt('t028') /* "결제방법" */}</th>
                              <th className="py-3 px-4">{pt('t029') /* "합계금액" */}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {memberTreatmentHistories.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-10 text-center text-sm text-slate-400">{pt('t031')}</td>
                              </tr>
                            ) : (
                              memberTreatmentHistories.map((entry) => (
                                <tr key={entry.history_key} className="align-top">
                                  <td className="py-3 px-4 text-sm font-semibold text-slate-700">{formatDateTime(entry.datetime)}</td>
                                  <td className="py-3 px-4 text-xs text-slate-600">
                                    <div className="font-bold text-slate-700">
                                      {entry.source === 'SETTLEMENT' ? getSettlementStatusLabel(entry.status) : getReservationStatusLabel(entry.status)}
                                    </div>
                                    {entry.cancel_reason && (
                                      <p className="mt-1 text-[11px] text-red-600">{pt('t030', { reason: entry.cancel_reason })}</p>
                                    )}
                                    {entry.cancelled_at && (
                                      <p className="text-[11px] text-red-500">{pt('t057', { date: formatDateTime(entry.cancelled_at) })}</p>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 text-sm text-slate-700">{entry.manager_name}</td>
                                  <td className="py-3 px-4 text-xs text-slate-600">
                                    {entry.service_names.length === 0 ? (
                                      '-'
                                    ) : (
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-slate-700">{entry.service_names[0]}</span>
                                          <button
                                            type="button"
                                            onClick={() => toggleServiceList(entry.history_key)}
                                            className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                                          >
                                            {expandedServiceHistoryKey === entry.history_key ? pt('t062') /* "접기" */ : pt('t061') /* "전체보기" */}
                                          </button>
                                        </div>
                                        {expandedServiceHistoryKey === entry.history_key && (
                                          <div className="rounded-lg border border-slate-200 bg-white p-2 space-y-1">
                                            {entry.service_names.map((serviceName, index) => (
                                              <p
                                                key={`${entry.history_key}-${index}`}
                                                className="text-[11px] text-slate-600"
                                              >
                                                <span className="inline-block min-w-4 text-slate-400 font-bold">{index + 1}.</span>
                                                {serviceName}
                                              </p>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 text-xs text-slate-600">{entry.payment_labels.length > 0 ? entry.payment_labels.join(', ') : '-'}</td>
                                  <td className="py-3 px-4 text-sm font-bold text-slate-900">{entry.total_amount === null ? '-' : formatCurrency(entry.total_amount)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    {/* [섹션] 예약/대기 내역 */}
                    <section className="space-y-3">
                      <h4 className="text-sm font-black text-slate-800 tracking-wide uppercase flex items-center gap-2">
                        <Calendar size={16} className="text-primary" />
                        {pt('t021') /* "예약/상담 현황 (미완료)" */}
                      </h4>
                      {hasNameMatchedReservation && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{pt('t048') /* "* 이름/연락처가 일치하는 예약 정보가 자동으로 매칭되었습니다." */}</p>
                      )}
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full min-w-[820px] text-left">
                          <thead className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500 uppercase tracking-wide">
                            <tr>
                              <th className="py-3 px-4">{pt('t038') /* "날짜/시간" */}</th>
                              <th className="py-3 px-4">{pt('t025') /* "상태" */}</th>
                              <th className="py-3 px-4">{pt('t039') /* "디자이너" */}</th>
                              <th className="py-3 px-4">{pt('t027') /* "시술항목" */}</th>
                              <th className="py-3 px-4">{pt('t040') /* "비고" */}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {memberReservationHistories.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="py-10 text-center text-sm text-slate-400">{pt('t041')}</td>
                              </tr>
                            ) : (
                              memberReservationHistories.map((entry) => (
                                <tr key={entry.reservation_id} className="align-top">
                                  <td className="py-3 px-4 text-sm font-semibold text-slate-700">
                                    <div>{entry.datetime}</div>
                                    <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded text-[10px] font-black ${entry.is_linked ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
                                      {entry.is_linked ? pt('t058') : pt('t059')}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-xs font-bold text-slate-700">{getReservationStatusLabel(entry.status)}</td>
                                  <td className="py-3 px-4 text-sm text-slate-700">{entry.designer_name}</td>
                                  <td className="py-3 px-4 text-xs text-slate-600">{entry.service_names.length > 0 ? entry.service_names.join(', ') : '-'}</td>
                                  <td className="py-3 px-4 text-xs text-slate-600">{entry.note || '-'}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                )}

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={closeHistoryModal}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg transition-colors"
                  >
                    {pt('t051') /* "닫기" */}
                  </button>
                </div>
              </div>
            </DraggableModal>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DraggableModal({
  title,
  children,
  onClose,
  icon,
  containerClassName,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  icon: React.ReactNode;
  containerClassName?: string;
}) {
  const dragControls = useDragControls();

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`bg-white rounded-2xl shadow-2xl w-full overflow-hidden relative max-h-[90vh] flex flex-col ${containerClassName || 'max-w-md'}`}
    >
      <div
        // 드래그 시작 지점 설정 (헤더 영역에서만 드래그 가능)
        onPointerDown={(e) => dragControls.start(e)} className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 cursor-move active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <GripHorizontal size={18} className="text-slate-300" />
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X size={20} className="text-slate-500" />
          </button>
        </div>
      </div>
      {children}
    </motion.div>
  );
}
