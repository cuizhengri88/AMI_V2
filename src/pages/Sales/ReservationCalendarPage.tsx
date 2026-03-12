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
import CustomerLookupDropdown from '../../components/CustomerLookupDropdown';
import { usePageText } from '../../i18n/usePageText';
import {
  formatCurrency,
  isBalancePaymentMethod,
  normalizeGenderForForm,
  normalizeNameKey,
  normalizePhoneDigits,
  resolveMemberLookupInputValue,
  toIsoDate,
  todayIso,
} from '../utils/pageCommon';

// --- 분리된 모듈에서 import ---
import type {
  CodeOption,
  LinkedSettlementState,
  MemberLookup,
  PaymentMethodOption,
  QuickPaymentLine,
  ReservationCustomerSnapshot,
  ReservationCustomerSnapshotOptions,
  ReservationForm,
  ReservationRecord,
  ReservationRow,
  ReservationService,
  ReservationViewMode,
  ListRangeMode,
  SalesSettlementRow,
  ServiceItem,
  StatusTone,
} from './Reservation/types';

import {
  A11Y_TEXT_KEYS,
  CATEGORY_GROUP_ID,
  CATEGORY_TEXT_KEY_BY_CODE,
  FALLBACK_CATEGORIES,
  FALLBACK_PAYMENT_METHODS,
  FALLBACK_STATUSES,
  INITIAL_RESERVATIONS,
  PAYMENT_METHOD_GROUP_ID,
  PAYMENT_METHOD_TEXT_KEY_BY_CODE,
  STATUS_GROUP_ID,
  STATUS_TEXT_KEY_BY_CODE,
  WEEKDAY_TEXT_KEYS,
} from './Reservation/constants';

import {
  buildCalendarCells,
  buildQuickCalculatorSnapshotFromSettlement,
  createEmptyForm,
  extractPhoneText,
  formatDateLabel,
  formatMonthLabel,
  getCalendarDateTone,
  getExpectedAmount,
  getExpectedMinutes,
  getNextLineIdSeed,
  getStatusTone,
  getWeekendHeaderTone,
  isReservationProcessingStatus,
  mapReservationRowToRecord,
  normalizeSettlementState,
  normalizeTimeValue,
  parseIsoDate,
  shiftDate,
  shiftMonth,
  shiftYear,
  sortReservations,
  toAmountNumber,
  toSettlementStatusByReservationStatus,
  toUniqueSortedNames,
} from './Reservation/utils';


// 예약 캘린더 관리 페이지 메인 컴포넌트
/**
 * 예약 현황 및 캘린더 관리 페이지
 * - 달력(Calendar) 및 목록(List) 두 가지 뷰를 제공합니다.
 * - 예약 등록, 수정, 시술 시작(진행중 전환), 결제 처리 등 예약 라이프사이클 전체를 관리합니다.
 * - 매출 관리를 위해 예약 상태에 따라 정산(Sales Settlement) 데이터를 자동으로 생성하거나 동기화합니다.
 */
export default function ReservationCalendarPage() {
  // 다국어 텍스트 접근 도구 (user_management_reservation_calendar 영역)
  const pt = usePageText('user_management_reservation_calendar');

  /*
   * [페이지 동작 흐름]
   * 1. 기초 로드: 공통코드(상태/카테고리), 시술 카탈로그, 회원 정보, 직원 목록 등을 초기화합니다.
   * 2. 데이터 조회: 현재 선택된 날짜 또는 월 기준의 예약을 DB에서 가져옵니다.
   * 3. 렌더링 최적화: useMemo를 활용하여 달력 구조, 필터링된 리스트, 통계값 등을 산출합니다.
   * 4. 등록/수정: 모달 팝업에서 예약 상세와 시술 목록을 편집합니다.
   * 5. 정산 연동: 시술 시작 처리 및 결제 계산 기능을 통해 매출 데이터와 연결됩니다.
   */

  // --- 상태 관리 (1) 기준 데이터 영역 ---
  // 예약 상태 옵션 (RESERVED, COMPLETED 등)
  const [statusOptions, setStatusOptions] = useState<CodeOption[]>(FALLBACK_STATUSES);
  // 시술 카테고리 옵션 (컷, 펌 등)
  const [categories, setCategories] = useState<CodeOption[]>(FALLBACK_CATEGORIES);
  // 사용 가능한 전체 시술 항목
  const [serviceItems, setServiceItems] = useState<ServiceItem[]>([]);
  // 결제 수단 종류 (현금, 카드, 위챗 등)
  const [paymentMethodOptions, setPaymentMethodOptions] =
    useState<PaymentMethodOption[]>(FALLBACK_PAYMENT_METHODS);
  // 고객 자동매칭을 위한 회원 목록 루크업
  const [members, setMembers] = useState<MemberLookup[]>([]);
  // 회원 이름 바탕의 전화번호 매핑 (캐시)
  const [memberPhoneByName, setMemberPhoneByName] = useState<Map<string, string>>(new Map());
  // 회원 이름 바탕의 ID 매핑
  const [memberIdByName, setMemberIdByName] = useState<Map<string, number | null>>(new Map());
  // 목록용 디자이너(직원) 성함 리스트
  const [designerNames, setDesignerNames] = useState<string[]>([]);
  // 디자이너 성함별 직원 ID 매핑 맵
  const [designerIdByName, setDesignerIdByName] = useState<Map<string, number>>(new Map());

  // --- 상태 관리 (2) 화면 네비게이션 및 조회 상태 ---
  // 전체 예약 레코드 모음
  const [reservations, setReservations] = useState<ReservationRecord[]>(INITIAL_RESERVATIONS);
  // 달력 뷰에서 현재 바라보고 있는 기준 월 (항상 연-월-01)
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // 현재 활성화된(선택된) 기준 날짜
  const [selectedDate, setSelectedDate] = useState(todayIso());

  // 데이터 불러오는 중 여부(상단 로딩바 제어)
  const [isLoading, setIsLoading] = useState(false);
  // 저장/삭제 등 데이터 변경 중 여부
  const [isMutating, setIsMutating] = useState(false);

  // 현재 보기 모드 (calendar: 달력형, list: 리스트형)
  const [viewMode, setViewMode] = useState<ReservationViewMode>('calendar');
  // 리스트 모드에서의 날짜 필터 범위 (day: 일별, month: 월별, year: 연별)
  const [listRangeMode, setListRangeMode] = useState<ListRangeMode>('day');
  // 리스트 모드 전용 이름/전화번호 검색 키워드
  const [listSearchKeyword, setListSearchKeyword] = useState('');

  // 드래그 가능한 모달용 프레임워크 핸들
  const modalDragControls = useDragControls();

  // --- 상태 관리 (3) 예약 편집 모달 관련 ---
  // 팝업 오픈 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  // 팝업 동작 모드 (create: 신규 등록, edit: 기존 수정)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  // 수정을 시작한 해당 예약의 PK값
  const [editingId, setEditingId] = useState<number | null>(null);
  // 신규 시술 라인 추가 시 겹치지 않게 클라이언트에서 생성할 PK 시드
  const [nextLineId, setNextLineId] = useState(2000);

  // 결제 계산기: 총액에서 적용할 할인 금액
  const [calculatorDiscountAmount, setCalculatorDiscountAmount] = useState(0);
  // 결제 계산기: 사용자가 입력한 구체적인 결제 라인들
  const [quickPaymentLines, setQuickPaymentLines] = useState<QuickPaymentLine[]>([]);
  // 결제 라인 추가 시 사용할 임시 ID 시드
  const [nextQuickPaymentLineId, setNextQuickPaymentLineId] = useState(1);

  // 고객 조회용 텍스트 필드 상태
  const [customerPhoneQuery, setCustomerPhoneQuery] = useState('');
  // 고객 이름 입력 시 연관 회원 목록 패널 표시 여부
  const [isCustomerLookupOpen, setIsCustomerLookupOpen] = useState(false);
  // 폼에서 명시적으로 선택된 회원의 ID
  const [selectedCustomerMemberId, setSelectedCustomerMemberId] = useState<string>('');

  // 현재 예약 건과 연결된 매출 정산의 진행 단계 (NONE/PROCESSING/COMPLETED/CANCELLED)
  const [linkedSettlementState, setLinkedSettlementState] =
    useState<LinkedSettlementState>('NONE');
  // 정산 데이터(연결 상태)를 서버에서 다시 읽어오는 중인지 여부
  const [isSettlementStateLoading, setIsSettlementStateLoading] = useState(false);
  // 비동기 통신 선후관계 꼬임 방지를 위한 요청 식별자 관리
  const linkedSettlementRequestIdRef = useRef(0);

  // 예약 입력 폼 본체
  const [form, setForm] = useState<ReservationForm>(() =>
    createEmptyForm(
      todayIso(),
      FALLBACK_STATUSES[0].code,
      FALLBACK_CATEGORIES[0].code,
      '',
    ),
  );

  // DB 요청(조회/저장) 진행 여부
  // - 조회(isLoading) 또는 변경작업(isMutating) 중이면 주요 입력/버튼을 잠근다.
  const isDbBusy = isLoading || isMutating;
  // 오버레이 표시 여부(DB 작업 또는 정산 상태 조회 중)
  // - 정산상태 조회는 별도 비동기이므로 isSettlementStateLoading도 함께 고려한다.
  const isOverlayVisible = isDbBusy || isSettlementStateLoading;
  // 오버레이 메시지(저장/정산조회/일반조회 상황별)
  const overlayMessage = isMutating
    ? pt('t042')
    : isSettlementStateLoading
      ? pt('t137')
      : pt('t041');

  // 요일 라벨 배열(달력 헤더/날짜 라벨 공용)
  const weekdayLabels = WEEKDAY_TEXT_KEYS.map((key) => pt(key));

  // 코드 -> 라벨 변환 헬퍼
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

  // --- 상태값 파생 및 유틸리티 헬퍼 ---
  // 성별 코드를 화면 라벨로 변환합니다. (M/F -> 남성/여성)
  const getGenderLabel = (gender?: string) => {
    const normalized = (gender || '').trim().toUpperCase();
    if (normalized === 'M' || normalized === 'MALE' || normalized === '남' || normalized === '남성') {
      return pt('t102'); // pt('t102') -> 남성
    }
    if (normalized === 'F' || normalized === 'FEMALE' || normalized === '여' || normalized === '여성') {
      return pt('t103'); // pt('t103') -> 여성
    }
    return gender?.trim() || '-';
  };

  // 상위 상태/카테고리 객체에 O(1)로 접근하기 위한 Map 캐시
  const statusMap = useMemo(
    () => new Map(statusOptions.map((status) => [status.code, status])),
    [statusOptions],
  );

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.code, category])),
    [categories],
  );

  // 현재 선택된 월(monthCursor)의 달력 구조(42개 셀) 산칠
  const calendarCells = useMemo(() => buildCalendarCells(monthCursor), [monthCursor]);

  // 전체 예약 목록을 날짜별(yyyy-mm-dd)로 그룹화하여 맵에 보관 (달력 렌더링 최적화)
  const reservationsByDate = useMemo(() => {
    const map = new Map<string, ReservationRecord[]>();
    reservations.forEach((reservation) => {
      const current = map.get(reservation.reservationDate) || [];
      current.push(reservation);
      map.set(reservation.reservationDate, current);
    });
    // 각 날짜 내에서는 시간순으로 다시 정렬
    map.forEach((value, key) => {
      map.set(
        key,
        [...value].sort((a, b) => a.startTime.localeCompare(b.startTime)),
      );
    });
    return map;
  }, [reservations]);

  // 선택 날짜 예약 목록
  const selectedDateReservations = useMemo(
    () => reservationsByDate.get(selectedDate) || [],
    [reservationsByDate, selectedDate],
  );

  // 리스트 모드: 검색 키워드 및 선택된 범위(일/월/연)에 따른 실시간 필터링 결과 산출
  const listReservations = useMemo(() => {
    const keyword = listSearchKeyword.trim().toLowerCase();
    const searchPhoneDigits = normalizePhoneDigits(listSearchKeyword);
    const selectedYear = selectedDate.slice(0, 4);
    const selectedMonth = selectedDate.slice(0, 7);

    return sortReservations(
      reservations.filter((reservation) => {
        // 1. 날짜 범위 필터
        if (listRangeMode === 'day' && reservation.reservationDate !== selectedDate) return false;
        if (listRangeMode === 'month' && !reservation.reservationDate.startsWith(selectedMonth)) return false;
        if (listRangeMode === 'year' && !reservation.reservationDate.startsWith(selectedYear)) return false;

        // 2. 검색 키워드 필터 (이름 또는 전화번호)
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

  // 연도 선택 옵션 구성
  const listYearOptions = useMemo(() => {
    const years = new Set<string>();
    reservations.forEach((reservation) => {
      years.add(reservation.reservationDate.slice(0, 4));
    });
    years.add(selectedDate.slice(0, 4));
    years.add(String(new Date().getFullYear()));
    return Array.from(years).sort((a, b) => a.localeCompare(b));
  }, [reservations, selectedDate]);

  // 리스트 헤더 라벨(범위 모드별 포맷)
  const listHeaderLabel = useMemo(() => {
    if (listRangeMode === 'year') return pt('t096', { year: selectedDate.slice(0, 4) });
    if (listRangeMode === 'month') return pt('t097', { month: selectedDate.slice(0, 7) });
    return formatDateLabel(selectedDate, weekdayLabels);
  }, [listRangeMode, pt, selectedDate, weekdayLabels]);

  // 카테고리 기준 시술 필터
  // - 모달의 "시술 항목" 셀렉트 옵션을 현재 선택 카테고리에 맞게 제한한다.
  const categoryServices = useMemo(() => {
    return serviceItems.filter((service) => service.categoryCode === form.selectedCategory);
  }, [serviceItems, form.selectedCategory]);

  // 선택된 시술 객체
  const selectedService = useMemo(
    () => categoryServices.find((service) => String(service.id) === form.selectedServiceId) || null,
    [categoryServices, form.selectedServiceId],
  );

  // 폼 내 선택된 시술 총합 계산
  const formExpectedMinutes = useMemo(
    () => getExpectedMinutes(form.services),
    [form.services],
  );

  const formExpectedAmount = useMemo(
    () => getExpectedAmount(form.services),
    [form.services],
  );

  // 고객 전화 검색 입력값(숫자 비교용)
  const customerPhoneQueryDigits = useMemo(
    () => normalizePhoneDigits(customerPhoneQuery),
    [customerPhoneQuery],
  );

  // 고객 자동완성 후보 목록
  const filteredCustomerMembers = useMemo(() => {
    if (!customerPhoneQueryDigits) return members;
    return members.filter((member) => member.phoneDigits.includes(customerPhoneQueryDigits));
  }, [customerPhoneQueryDigits, members]);

  // 현재 선택된 회원 객체
  const selectedCustomerMember = useMemo(() => {
    const memberId = Number.parseInt(selectedCustomerMemberId, 10);
    if (!Number.isFinite(memberId) || memberId <= 0) return null;
    return members.find((member) => member.id === memberId) || null;
  }, [members, selectedCustomerMemberId]);

  // 자동완성 목록 노출용 회원 후보(최대 8개)
  const customerLookupMembers = useMemo(() => {
    if (!customerPhoneQueryDigits) return [];
    if (!selectedCustomerMember) return filteredCustomerMembers.slice(0, 8);
    if (filteredCustomerMembers.some((member) => member.id === selectedCustomerMember.id)) {
      return filteredCustomerMembers.slice(0, 8);
    }
    return [selectedCustomerMember, ...filteredCustomerMembers].slice(0, 8);
  }, [customerPhoneQueryDigits, filteredCustomerMembers, selectedCustomerMember]);

  // 모달 상단 고객 요약 텍스트
  // - 회원 선택 시 "이름(전화)" 우선
  // - 비회원 입력 시 이름/전화 조합을 자연스럽게 보여준다.
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

  // 비회원을 회원 등록으로 전환할 때 prompt 기본값으로 사용하는 문자열
  const guestMemberDefaultName = useMemo(() => {
    const customerName = (form.customerName || '').trim();
    if (customerName) return customerName;
    return (customerPhoneQuery || '').trim();
  }, [customerPhoneQuery, form.customerName]);

  // 저장/결제 시 사용할 회원 ID 결정
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

  // 모달 우측 상단의 현재 고객 타입 라벨(회원/비회원)
  const customerMembershipLabel = selectedMemberUserId ? pt('t149') : pt('t150');

  // member_user_id(숫자/전화/이름 혼합 가능)에서 실제 회원 ID를 해석
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

  // 회원 ID를 정산용 식별자(전화 우선, 없으면 이름)로 변환
  const resolveMemberIdentifierByUserId = useCallback((memberId?: number | null) => {
    if (!memberId || !Number.isFinite(memberId) || memberId <= 0) return null;
    const matchedMember = members.find((member) => member.id === memberId);
    if (!matchedMember) return null;
    const phone = matchedMember.phone.trim();
    if (phone) return phone;
    const name = matchedMember.name.trim();
    return name || null;
  }, [members]);

  // "시술 시작" 액션에서 우선 사용할 상태코드 결정
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

  // 수정 모달 기준 "원본 예약 레코드"
  // - 폼 값(form)은 사용자가 즉시 변경 가능하므로, 버튼 노출 판단은 원본값을 우선한다.
  const editingReservation = useMemo(
    () =>
      modalMode === 'edit' && editingId
        ? reservations.find((reservation) => reservation.id === editingId) || null
        : null,
    [editingId, modalMode, reservations],
  );

  // 버튼/입력 잠금 판단용 핵심 파생값
  // - 수정모드일 때는 원본 예약일/상태 + 정산 상태를 함께 보고 편집 허용 여부를 결정한다.
  const editTargetDate =
    modalMode === 'edit' ? (editingReservation?.reservationDate || form.reservationDate) : '';
  const todayDate = todayIso();
  // DB 값에 시간 문자열이 섞여 있어도 yyyy-mm-dd 기준으로만 비교한다.
  const normalizedEditTargetDate = editTargetDate.slice(0, 10);
  const isEditTargetToday = normalizedEditTargetDate === todayDate;
  const editTargetStatus = modalMode === 'edit' ? (editingReservation?.status || form.status) : '';
  const normalizedEditTargetStatus = editTargetStatus.trim().toUpperCase();
  const isEditTargetCompleted =
    normalizedEditTargetStatus.includes('COMPLETE')
    || normalizedEditTargetStatus.includes('완료');
  const isEditTargetCancelled =
    normalizedEditTargetStatus.includes('CANCEL')
    || normalizedEditTargetStatus.includes('취소');
  // 완료/취소를 구분해서 제어한다.
  // - 완료: 읽기전용 + 저장숨김
  // - 취소: 저장 가능(요청사항)
  const isEditTargetClosed = isEditTargetCompleted || isEditTargetCancelled;
  const normalizedFormStatus = (form.status || '').trim().toUpperCase();
  const isFormStatusClosed =
    normalizedFormStatus.includes('COMPLETE')
    || normalizedFormStatus.includes('완료');
  const isEditTargetProcessing =
    isReservationProcessingStatus(editTargetStatus) || linkedSettlementState === 'PROCESSING';
  // 수정 모드 저장 허용 조건(현재 운영 규칙)
  // 1) 완료 상태만 저장 불가
  // 2) 날짜 조건은 적용하지 않음(과거/오늘/미래 모두 동일)
  const canSaveEditReservation =
    modalMode === 'edit'
    && !isEditTargetCompleted;
  // 완료 상태 수정건은 읽기전용으로 잠근다.
  const isEditReadOnly = modalMode === 'edit' && isEditTargetCompleted;
  // 시술 시작 버튼: 수정 모드 + 저장 가능 + 오늘 + 아직 진행중 아님
  const shouldShowStartServiceButton =
    modalMode === 'edit'
    && canSaveEditReservation
    && !isEditTargetCancelled
    && isEditTargetToday
    && !isEditTargetProcessing;
  // 결제 처리 버튼: 수정 모드 + 저장 가능 + 오늘 + 진행중
  const shouldShowPaymentButton =
    modalMode === 'edit'
    && canSaveEditReservation
    && !isEditTargetCancelled
    && isEditTargetToday
    && isEditTargetProcessing;
  const isPaymentCompleted = linkedSettlementState === 'COMPLETED';
  // 정산 완료 + 예약 완료/취소 조합인 경우는 폼 자체를 잠가서 데이터 변경을 막는다.
  const isCompletedSettlementLocked =
    modalMode === 'edit' && isPaymentCompleted && isEditTargetCompleted;
  const isReservationFormLocked =
    isDbBusy || isSettlementStateLoading || isCompletedSettlementLocked || isEditReadOnly;
  const isSaveButtonDisabled = isReservationFormLocked || isFormStatusClosed;
  const isQuickPaymentReadOnly = isPaymentCompleted || isSettlementStateLoading;
  const isPaymentActionDisabled = isDbBusy || isSettlementStateLoading || isPaymentCompleted;

  // 빠른 결제 입력용 결제수단 목록 산출
  // - 쿠폰 수단은 제외하며, 회원 전용 수단(충전금 차감 등)은 회원이 선택된 경우에만 노출합니다.
  const manualPaymentMethodOptions = useMemo(
    () => {
      const filtered = paymentMethodOptions.filter((method) => {
        const methodCode = method.code.trim().toUpperCase();
        if (methodCode === 'COUPON') return false; // 쿠폰은 간편 계산기에서 제외
        if (!selectedMemberUserId && isBalancePaymentMethod(methodCode)) return false; // 비회원시 충전금 차감 제외
        return true;
      });
      if (filtered.length > 0) return filtered;
      return FALLBACK_PAYMENT_METHODS;
    },
    [paymentMethodOptions, selectedMemberUserId],
  );

  // 결제 계산기 요약값 계산 (합계, 받은금액, 미수금)
  const calculatorPayableAmount = useMemo(
    () => Math.max(formExpectedAmount - calculatorDiscountAmount, 0),
    [formExpectedAmount, calculatorDiscountAmount],
  );

  const calculatorPaidTotal = useMemo(
    () => quickPaymentLines.reduce((sum, line) => sum + line.amount, 0),
    [quickPaymentLines],
  );

  const calculatorRemainingAmount = calculatorPayableAmount - calculatorPaidTotal;

  /**
   * 서버에서 기준 데이터(공통코드, 시술목록, 회원정보, 직원목록)를 일괄 조회합니다.
   */
  const loadLookupData = async () => {
    const [commonResult, serviceResult, memberResult, employeeResult] = await Promise.all([
      invokeDbCommand<{
        success: boolean;
        message: string;
        details: Array<{ group: string; code: string; name: string; order: number; use_yn: 'Y' | 'N' }>;
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
        users: Array<{ user_id: number; name: string; phone: string | null }>;
      }>('get_user_management_data'),
      invokeDbCommand<{
        success: boolean;
        message: string;
        employees: Array<{ employee_id: number; employee_name: string }>;
      }>('get_employee_management_data'),
    ]);
    /* ...이하 데이터 정규화 로직 (카테고리, 결제수단, 회원 매핑 등 수행)... */
    const details = commonResult.details || [];
    const loadedStatuses = details
      .filter((detail) => detail.group === STATUS_GROUP_ID && detail.use_yn === 'Y')
      .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code))
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
      .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code))
      .map((detail) => ({
        code: detail.code,
        label: detail.name?.trim() || getCategoryLabelByCode(detail.code),
        order: detail.order,
      }));

    const loadedPaymentMethods = details
      .filter((detail) => detail.group === PAYMENT_METHOD_GROUP_ID && detail.use_yn === 'Y')
      .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code))
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

    const nextStatuses = loadedStatuses.length > 0 ? loadedStatuses : FALLBACK_STATUSES;
    const nextCategories = loadedCategories.length > 0 ? loadedCategories : (serviceDerivedCategories.length > 0 ? serviceDerivedCategories : FALLBACK_CATEGORIES);
    const nextPaymentMethods = loadedPaymentMethods.length > 0 ? loadedPaymentMethods : FALLBACK_PAYMENT_METHODS.map(m => ({ ...m, label: getPaymentMethodLabelByCode(m.code) }));

    const nextMembers = (memberResult.users || []).map(u => ({
      id: Number(u.user_id),
      name: (u.name || '').trim(),
      phone: (u.phone || '').trim(),
      phoneDigits: normalizePhoneDigits(u.phone || ''),
    })).filter(m => m.id > 0 && m.name).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    const nextMemberPhoneByName = (memberResult.users || []).reduce((map, u) => {
      const key = normalizeNameKey(u.name || '');
      if (key && u.phone) map.set(key, u.phone.trim());
      return map;
    }, new Map<string, string>());

    const nextMemberIdByName = (memberResult.users || []).reduce((map, u) => {
      const key = normalizeNameKey(u.name || '');
      const id = Number(u.user_id);
      if (key && id > 0) map.set(key, map.has(key) ? null : id); // 중복 이름은 null 마킹
      return map;
    }, new Map<string, number | null>());

    const nextDesignerNames = toUniqueSortedNames((employeeResult.employees || []).map(e => e.employee_name || ''));
    const nextDesignerIdByName = (employeeResult.employees || []).reduce((map, e) => {
      const key = normalizeNameKey(e.employee_name || '');
      if (key && e.employee_id) map.set(key, e.employee_id);
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

    return { phoneByName: nextMemberPhoneByName, members: nextMembers };
  };

  // 예약 목록 조회: 헤더 + 시술라인을 화면에서 쓰는 구조로 변환한다.
  // - API 응답 row를 화면 모델(ReservationRecord)로 변환 후 정렬해 저장한다.
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

  // 예약 ID와 연결된 정산 레코드 조회
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

  // 수정 모달 진입 시 연결 정산 상태/결제 스냅샷 로드
  // - requestId로 최신 요청만 반영해, 빠른 모달 전환 시 이전 응답이 덮어쓰지 않게 한다.
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

      // 완료 정산(COMPLETED)일 때만 결제 계산기 스냅샷을 복원한다.
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
      const lookupData = await loadLookupData();
      await loadReservations(lookupData.phoneByName);
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

  // 최초 진입 시 데이터 로드
  useEffect(() => {
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 공통코드/시술 변경 시 폼 선택값 유효성 보정
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

  // 할인금액 상한은 총 예상금액까지
  useEffect(() => {
    setCalculatorDiscountAmount((prev) => Math.min(prev, formExpectedAmount));
  }, [formExpectedAmount]);

  // 회원 해제 시 회원전용 결제수단 라인 제거
  useEffect(() => {
    if (selectedMemberUserId) return;
    setQuickPaymentLines((prev) =>
      prev.filter((line) => !isBalancePaymentMethod(line.methodCode)),
    );
  }, [selectedMemberUserId]);

  // 상태코드 실제 표시 라벨
  const getStatusLabel = (statusCode: string) => {
    const commonCodeLabel = statusMap.get(statusCode)?.label?.trim();
    if (commonCodeLabel) return commonCodeLabel;
    return getStatusLabelByCode(statusCode, statusCode);
  };

  // 빠른 결제 계산기 초기화
  const resetQuickCalculator = () => {
    setCalculatorDiscountAmount(0);
    setQuickPaymentLines([]);
    setNextQuickPaymentLineId(1);
  };

  // 남은 금액을 기준으로 결제 라인 추가
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

  // 결제 라인 삭제
  const removeQuickPaymentLine = (lineId: number) => {
    if (isQuickPaymentReadOnly) return;
    setQuickPaymentLines((prev) => prev.filter((line) => line.lineId !== lineId));
  };

  // 결제 라인 값 수정(결제수단/금액)
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

  // 신규 예약 모달 열기
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

  // 기존 예약 수정 모달 열기
  const openEditModal = (reservation: ReservationRecord) => {
    const preferredCategory =
      reservation.services[0]?.categoryCode
      || categories[0]?.code
      || serviceItems[0]?.categoryCode
      || FALLBACK_CATEGORIES[0].code;
    const defaultServiceId =
      serviceItems.find((service) => service.categoryCode === preferredCategory)?.id;
    const matchedMemberByCustomerId =
      typeof reservation.customerId === 'number' && reservation.customerId > 0
        ? members.find((member) => member.id === reservation.customerId) || null
        : null;
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
    const matchedMember = matchedMemberByCustomerId || matchedMemberByPhone || matchedMemberByName;
    const nextRequestId = linkedSettlementRequestIdRef.current + 1;
    linkedSettlementRequestIdRef.current = nextRequestId;

    setModalMode('edit');
    setEditingId(reservation.id);
    setLinkedSettlementState('NONE');
    setSelectedCustomerMemberId(matchedMember ? String(matchedMember.id) : '');
    setCustomerPhoneQuery(resolveMemberLookupInputValue(matchedMember, reservation.customerPhone));
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

  // 모달 내부 임시 상태를 정리하고 닫기
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

  // 고객 자동완성 목록에서 회원 선택
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
    setCustomerPhoneQuery(resolveMemberLookupInputValue(matchedMember));
  };

  // 고객 전화 입력 시 실시간 회원 후보/자동연결 처리
  const handleCustomerPhoneQueryChange = (value: string) => {
    if (isCompletedSettlementLocked) return;
    setCustomerPhoneQuery(value);
    setIsCustomerLookupOpen(true);
    const trimmedValue = value.trim();
    const digits = normalizePhoneDigits(value);
    if (!digits) {
      setIsCustomerLookupOpen(false);
      if (!value.trim()) {
        setSelectedCustomerMemberId('');
        setForm((prev) => ({ ...prev, customerName: '' }));
      } else {
        setSelectedCustomerMemberId('');
        setForm((prev) => ({ ...prev, customerName: trimmedValue }));
      }
      return;
    }
    if (selectedCustomerMember && !selectedCustomerMember.phoneDigits.includes(digits)) {
      setSelectedCustomerMemberId('');
      setForm((prev) => ({ ...prev, customerName: '' }));
    }
    const matchedMembers = members.filter((member) => member.phoneDigits.includes(digits));
    if (matchedMembers.length !== 1) {
      if (matchedMembers.length === 0) {
        setSelectedCustomerMemberId('');
        setForm((prev) => ({ ...prev, customerName: trimmedValue }));
      }
      return;
    }
    /*
      Auto-select disabled by request:
      When only one member matched by phone, the previous behavior selected that member automatically.
      Keep manual selection via dropdown click instead.
    */
    setSelectedCustomerMemberId('');
    setForm((prev) => ({ ...prev, customerName: trimmedValue }));
    return;
  };

  // 현재 선택된 시술을 예약 시술 목록에 추가
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

  // 예약 시술 목록에서 라인 삭제
  const removeService = (lineId: number) => {
    if (isCompletedSettlementLocked) return;
    setForm((prev) => ({
      ...prev,
      services: prev.services.filter((service) => service.lineId !== lineId),
    }));
  };

  // 저장용 customer_name 계산:
  // - 회원 선택 상태면 회원 전화번호 우선 저장
  // - 그 외에는 기존 규칙(이름 우선, 없으면 전화 입력값) 유지
  const resolveReservationCustomerSnapshot = useCallback((
    targetForm: ReservationForm,
    options?: ReservationCustomerSnapshotOptions,
  ): ReservationCustomerSnapshot => {
    const directName = targetForm.customerName.trim();
    const inputValue = directName || (customerPhoneQuery || '').trim();
    const forcedMember = options?.forcedMember;
    if (forcedMember && Number.isFinite(forcedMember.id) && forcedMember.id > 0) {
      const memberName = forcedMember.name.trim();
      const memberPhone = forcedMember.phone.trim();
      return {
        customerName: memberName || inputValue,
        customerId: forcedMember.id,
        customerPhone: memberPhone || inputValue,
      };
    }

    const memberId =
      typeof selectedMemberUserId === 'number' && Number.isFinite(selectedMemberUserId) && selectedMemberUserId > 0
        ? selectedMemberUserId
        : null;
    if (memberId) {
      const matchedMember =
        members.find((member) => member.id === memberId)
        || (selectedCustomerMember?.id === memberId ? selectedCustomerMember : null);
      if (matchedMember) {
        const memberName = matchedMember.name.trim();
        const memberPhone = matchedMember.phone.trim();
        return {
          customerName: memberName || inputValue,
          customerId: matchedMember.id,
          customerPhone: memberPhone,
        };
      }
    }
    return {
      customerName: inputValue,
      customerId: null as number | null,
      customerPhone: inputValue,
    };
  }, [customerPhoneQuery, members, selectedCustomerMember, selectedMemberUserId]);

  // 예약 저장 전 필수 입력 검증
  const validateReservationForm = (
    targetForm: ReservationForm,
    options?: ReservationCustomerSnapshotOptions,
  ) => {
    const customerSnapshot = resolveReservationCustomerSnapshot(targetForm, options);
    if (!targetForm.reservationDate || !targetForm.startTime) {
      alert(pt('t017'));
      return false;
    }
    if (!customerSnapshot.customerName || !targetForm.designerName.trim()) {
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

  // 예약 upsert API 호출
  const upsertReservationItem = async (
    targetForm: ReservationForm,
    options?: ReservationCustomerSnapshotOptions,
  ) => {
    const customerSnapshot = resolveReservationCustomerSnapshot(targetForm, options);
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
          customer_name: customerSnapshot.customerName,
          customer_id: customerSnapshot.customerId,
          customer_phone: customerSnapshot.customerPhone || null,
          gender: targetForm.gender || null,
          designer_name: targetForm.designerName.trim(),
          status: targetForm.status,
          note: targetForm.note.trim() || null,
          service_ids: targetForm.services.map((service) => service.serviceId),
        },
      },
    );
  };

  // 예약이 진행중 상태일 때 정산(PROCESSING) 스냅샷도 함께 동기화
  const syncProcessingSettlementForReservation = async (
    reservationId: number,
    targetForm: ReservationForm,
    options?: ReservationCustomerSnapshotOptions,
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

    const forcedMember = options?.forcedMember;
    const forcedMemberId =
      forcedMember && Number.isFinite(forcedMember.id) && forcedMember.id > 0
        ? forcedMember.id
        : null;
    const forcedMemberIdentifier = forcedMember
      ? (forcedMember.phone.trim() || forcedMember.name.trim() || null)
      : null;

    const linkedMemberUserId = resolveMemberUserIdFromIdentifier(linkedSettlement?.member_user_id);
    const memberUserId =
      forcedMemberId
      || selectedMemberUserId
      || linkedMemberUserId
      || null;
    const linkedMemberIdentifier = (linkedSettlement?.member_user_id || '').trim();
    const memberIdentifier =
      forcedMemberIdentifier
      || resolveMemberIdentifierByUserId(memberUserId)
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

  // 비회원 고객을 즉시 회원으로 등록하고, 모달 상태를 신규 회원 기준으로 동기화한다.
  const registerGuestAsMember = async (
    memberNameRaw: string,
    memberGenderRaw?: string,
  ): Promise<MemberLookup> => {
    const memberName = memberNameRaw.trim();
    if (!memberName) {
      throw new Error(pt('t141'));
    }

    const guestPhone = (customerPhoneQuery || '').trim();
    const guestPhoneDigits = normalizePhoneDigits(guestPhone);
    if (guestPhoneDigits.length < 7) {
      throw new Error(pt('t145'));
    }
    const normalizedGender = (memberGenderRaw || '').trim().toUpperCase();
    const memberGender =
      normalizedGender === 'M' || normalizedGender === 'F'
        ? normalizedGender
        : undefined;

    // 1) 회원 등록/업데이트 API 호출
    await invokeDbCommand<{ success: boolean; message: string }>('upsert_user_management', {
      user: {
        name: memberName,
        phone: guestPhone,
        gender: memberGender,
      },
    });

    // 2) 로컬 기준 데이터(회원 목록)를 즉시 새로고침해 방금 등록한 회원을 찾는다.
    const lookupData = await loadLookupData();
    const normalizedName = normalizeNameKey(memberName);
    const matchedMember =
      lookupData.members.find((member) =>
        normalizeNameKey(member.name) === normalizedName
        && member.phoneDigits === guestPhoneDigits,
      )
      || lookupData.members.find((member) => normalizeNameKey(member.name) === normalizedName);

    if (!matchedMember) {
      throw new Error(pt('t142'));
    }

    // 3) 모달 입력값을 "회원 선택 상태"로 맞춘다.
    setSelectedCustomerMemberId(String(matchedMember.id));
    setForm((prev) => ({ ...prev, customerName: matchedMember.name }));
    setCustomerPhoneQuery(resolveMemberLookupInputValue(matchedMember));
    return matchedMember;
  };

  /**
   * 예약 데이터를 실제로 DB에 저장(Upsert)하는 공통 코어 루틴입니다.
   * - 예약 정보 저장 직후, 상태가 '진행중'인 경우 정산 정보(PROCESSING)를 자동으로 동기화합니다.
   */
  const saveReservationRecord = async (
    targetForm: ReservationForm,
    successFallbackText: string,
    options?: {
      forceSyncProcessingSettlement?: boolean;
      forcedMember?: MemberLookup | null;
    },
  ) => {
    // 1. 유효성 검사 및 고객 정보 정규화
    if (!validateReservationForm(targetForm, { forcedMember: options?.forcedMember })) return false;
    let reservationSaved = false;
    try {
      setIsMutating(true);
      // 2. 예약 데이터 Upsert 호출
      const result = await upsertReservationItem(targetForm, {
        forcedMember: options?.forcedMember,
      });
      reservationSaved = true;

      // 3. 상태가 '진행중' 계열이면 정산 스냅샷을 생성/업데이트 (매출 관리 일관성 유지)
      const shouldSyncProcessingSettlement =
        options?.forceSyncProcessingSettlement || isReservationProcessingStatus(targetForm.status);

      if (shouldSyncProcessingSettlement) {
        const savedReservationId = Number(result.reservation_id);
        if (!Number.isFinite(savedReservationId) || savedReservationId <= 0) {
          throw new Error(pt('t144'));
        }
        await syncProcessingSettlementForReservation(savedReservationId, targetForm, {
          forcedMember: options?.forcedMember,
        });
      }

      // 4. 후속 처리: 목록 갱신 및 UI 상태 정리
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

  /**
   * 모달에서 [저장] 버튼 클릭 시 동작하는 전체 흐름입니다.
   * - 비회원 시 회원 가입 유도 로직을 포함합니다.
   */
  const saveReservation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isCompletedSettlementLocked) return;
    const successFallbackText = modalMode === 'edit' ? pt('t036') : pt('t037');

    // [특수 시나리오] 신규 등록 시 회원 자동 등록 처리
    if (modalMode === 'create' && !selectedMemberUserId) {
      const shouldRegisterMember = window.confirm(pt('t139')); // "회원으로 등록하시겠습니까?"
      if (shouldRegisterMember) {
        const memberNameInput = window.prompt(pt('t140'), guestMemberDefaultName);
        if (memberNameInput === null) return;

        const nextMemberName = memberNameInput.trim();
        if (!nextMemberName) {
          alert(pt('t141'));
          return;
        }

        try {
          setIsMutating(true);
          const registeredMember = await registerGuestAsMember(nextMemberName, form.gender);
          await saveReservationRecord(
            { ...form, customerName: registeredMember.name },
            successFallbackText,
            { forcedMember: registeredMember },
          );
        } catch (error) {
          alert(typeof error === 'string' ? error : (error as { message?: string })?.message || pt('t038'));
        } finally {
          setIsMutating(false);
        }
        return;
      }
    }

    // 일반 저장 진행
    await saveReservationRecord(form, successFallbackText);
  };

  // 시술 시작: 상태를 진행중 계열로 강제하여 저장
  const startReservationService = async () => {
    if (isCompletedSettlementLocked) return;
    // 사용자가 현재 폼의 상태를 바꿔두었더라도, 시술 시작 버튼에서는 상태를 강제로 진행중 코드로 저장한다.
    const nextForm: ReservationForm = {
      ...form,
      status: serviceStartStatusCode,
    };
    await saveReservationRecord(nextForm, pt('t128'), {
      forceSyncProcessingSettlement: true,
    });
  };

  // 완료 결제 취소(정산 취소 API 호출)
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

  /**
   * 결제 처리: 예약 정보를 [완료]로 최종 저장하고, 입력한 결제 라인들을 정산 테이블에 기록합니다.
   * - 이 단계에서 회원 충전금 차감, 쿠폰 사용 등이 서버 DB 레벨에서 처리됩니다.
   */
  const processReservationPayment = async () => {
    // 1. 기초 검증
    if (!validateReservationForm(form)) return;
    if (isPaymentCompleted) {
      alert(pt('t129')); // "이미 결제가 완료된 예약입니다."
      return;
    }

    // 2. 결제 입력값 정규화 및 필수 조건 확인
    const normalizedQuickPayments = quickPaymentLines
      .map((line) => ({
        methodCode: line.methodCode.trim().toUpperCase(),
        amount: toAmountNumber(line.amount),
      }))
      .filter((line) => line.methodCode.length > 0 && line.amount > 0);

    if (normalizedQuickPayments.length === 0) {
      alert(pt('t123')); // "결제 처리할 결제 라인을 1건 이상 입력해 주세요."
      return;
    }

    // 3. 비즈니스 규칙: 예약 완료 상태여야만 결제 가능
    if (form.status.trim().toUpperCase() !== 'COMPLETED') {
      alert(pt('t124')); // "결제 처리 전 예약 상태를 완료로 변경해 주세요."
      return;
    }

    const managerEmployeeIdForSettlement = designerIdByName.get(normalizeNameKey(form.designerName));
    if (!managerEmployeeIdForSettlement) {
      alert(pt('t147')); // "결제 저장을 위해 담당자를 직원 목록에서 다시 선택해 주세요."
      return;
    }

    let reservationSaved = false;
    try {
      setIsMutating(true);
      // 4. 예약 데이터 선제적 저장
      const result = await upsertReservationItem(form);
      reservationSaved = true;

      const savedReservationId = Number(result.reservation_id);
      if (!Number.isFinite(savedReservationId) || savedReservationId <= 0) {
        throw new Error(pt('t144'));
      }

      // 5. 시술 목록 및 (기존에 있을 수 있는) 쿠폰 결제 정보 구성
      const linkedSettlement = await findLinkedSettlementByReservationId(savedReservationId);
      const serviceIds = form.services.map((service) => service.serviceId);

      // ...쿠폰 보존 로직 (시술 항목이 일치할 경우 기존 쿠폰 사용 정보를 유지함)...
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

      // 6. 정산(Upsert Sales Settlement) API 호출
      const settlementResult = await invokeDbCommand<{ success: boolean; message: string }>('upsert_sales_settlement', {
        settlement: {
          settlement_id: linkedSettlement?.settlement_id || undefined,
          member_user_id: resolveMemberIdentifierByUserId(selectedMemberUserId) || (customerPhoneQuery || '').trim() || form.customerName.trim() || null,
          manager_employee_id: managerEmployeeIdForSettlement,
          service_ids: serviceIds,
          payments: [
            ...normalizedQuickPayments.map((p) => ({ payment_method_code: p.methodCode, amount: p.amount, coupon_service_id: null })),
            ...preservedCouponPayments,
          ],
          status: 'COMPLETED',
          reservation_ref: String(savedReservationId),
        },
      });

      // 7. 완료 후 마무리
      await loadReservations();
      setSelectedDate(form.reservationDate);
      closeModal();
      alert(settlementResult.message || pt('t125'));
    } catch (error) {
      alert(typeof error === 'string' ? error : (error as { message?: string })?.message || (reservationSaved ? pt('t148') : pt('t038')));
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

  // 달력 월 이동
  const moveMonth = (diff: number) => {
    setMonthCursor(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + diff, 1),
    );
  };

  // 선택 날짜와 month cursor를 함께 동기화
  const syncSelectedDate = (isoDate: string) => {
    setSelectedDate(isoDate);
    const parsed = parseIsoDate(isoDate);
    setMonthCursor(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
  };

  // 리스트 범위(day/month/year)에 따라 날짜 이동
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

      {/* 상단 헤더: 페이지 타이틀/뷰 전환/신규등록 */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t019')} {/* "예약 캘린더" */}</h1>
          <p className="text-slate-500 mt-1">
            {pt('t043')} {/* "매장 예약 현황을 달력과 리스트로 한눈에 관리하고 결제까지 처리할 수 있습니다." */}
          </p>
        </div>
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1">
          <button
            onClick={() => setViewMode('calendar')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${viewMode === 'calendar' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {pt('t044')} {/* "달력 보기" */}
          </button>
          <button
            onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${viewMode === 'list' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {pt('t045')} {/* "리스트 보기" */}
          </button>
        </div>
        <button
          onClick={() => openCreateModal(selectedDate)} disabled={isDbBusy}
          className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2.5 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-60"
        >
          <PlusCircle size={16} />
          {pt('t046')} {/* "신규 예약 등록" */}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* 캘린더 뷰 */}
        <section
          className={`${viewMode === 'calendar' ? 'xl:col-span-12' : 'hidden'} bg-white border border-slate-200 rounded-xl overflow-hidden grid-shadow`}
        >
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-primary" />
              <h2 className="text-sm font-bold text-slate-700">{pt('t022')} {/* "월간 예약 달력" */}</h2>
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
                {pt('t047')} {/* "오늘" */}
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
                        {pt('t048', { count: dayReservations.length })} {/* "예약 {{count}}건" */}
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
                        {pt('t049', { count: dayReservations.length - 3 })} {/* "그 외 {{count}}건" */}
                      </p>
                    )}</div>
                </button>
              );
            })}</div>
        </section>

        <section className="hidden xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <div>
              <h2 className="text-sm font-bold text-slate-700">{pt('t005')} {/* "예약 목록" */}</h2>
              <p className="text-xs text-slate-500 mt-1">{formatDateLabel(selectedDate, weekdayLabels)}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[760px]">
              <thead>
                <tr className="bg-slate-900 text-slate-200">
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t007')} {/* "시간" */}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t001')} {/* "상태" (여기서는 고객명 라벨로 사용됨) */}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t100')} {/* "성별" */}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t004')} {/* "담당자" */}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t008')} {/* "시술" */}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-right">{pt('t015')} {/* "금액" */}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-center">{pt('t051')} {/* "상태" */}</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-center">{pt('t052')} {/* "작업" */}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selectedDateReservations.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                      {pt('t053')} {/* "선택한 날짜의 예약이 없습니다." */}
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
                              title={pt('t054')} // "수정"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => deleteReservation(reservation.id)} disabled={isDbBusy}
                              className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              title={pt('t055')} // "삭제"
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

      {/* 리스트 뷰 */}
      {viewMode === 'list' && (
        <section className="mt-6 bg-white border border-slate-200 rounded-xl overflow-hidden grid-shadow">
          {/* 리스트 헤더: 기간 선택 및 검색 */}
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-slate-700">{pt('t005')}</h2>
                <p className="text-xs text-slate-500 mt-1">{listHeaderLabel}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* 기간 단위 스위처 (일/월/년) */}
                <div className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1">
                  <button
                    onClick={() => setListRangeMode('day')}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${listRangeMode === 'day' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {pt('t090')} {/* "일별" */}
                  </button>
                  <button
                    onClick={() => setListRangeMode('month')}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${listRangeMode === 'month' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {pt('t091')} {/* "월별" */}
                  </button>
                  <button
                    onClick={() => setListRangeMode('year')}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${listRangeMode === 'year' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {pt('t092')} {/* "연도별" */}
                  </button>
                </div>

                {/* 기간 이동 및 직접 선택 컨트롤 */}
                <div className="flex items-center gap-1.5">
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
                      onChange={(event) => event.target.value && syncSelectedDate(event.target.value)}
                      className="px-3 py-1.5 rounded-md text-sm border border-slate-200 text-slate-700 bg-white"
                    />
                  ) : listRangeMode === 'month' ? (
                    <input
                      type="month"
                      value={selectedDate.slice(0, 7)}
                      onChange={(event) => event.target.value && syncSelectedDate(`${event.target.value}-01`)}
                      className="px-3 py-1.5 rounded-md text-sm border border-slate-200 text-slate-700 bg-white"
                    />
                  ) : (
                    <select
                      value={selectedDate.slice(0, 4)}
                      onChange={(event) => event.target.value && syncSelectedDate(`${event.target.value}-01-01`)}
                      className="px-3 py-1.5 rounded-md text-sm border border-slate-200 text-slate-700 bg-white"
                    >
                      {listYearOptions.map((year) => (
                        <option key={year} value={year}>{year}</option>
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
                    {pt('t047')} {/* "오늘" */}
                  </button>
                </div>
              </div>
            </div>

            {/* 통합 검색 바 */}
            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <label className="text-xs font-bold text-slate-500">
                {pt('t093')} {/* "조회 범위" */}
              </label>
              {/* pt('t094'): "회원명 또는 전화번호 검색..." */}
              <input
                type="text"
                value={listSearchKeyword}
                onChange={(event) => setListSearchKeyword(event.target.value)}
                placeholder={pt('t094')}
                className="w-full md:max-w-sm px-3 py-2 rounded-md text-sm border border-slate-200 text-slate-700 bg-white focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>
          </div>

          {/* 리스트 테이블 본문 */}
          <div className="p-4 overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[1140px]">
              <thead>
                <tr className="bg-slate-900 text-slate-200">
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t021')} {/* "예약일" */}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t007')} {/* "시간" */}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t001')} {/* "상태" (여기서는 고객명 라벨로 사용됨) */}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t100')} {/* "성별" */}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t098')} {/* "전화번호" */}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t004')} {/* "담당자" */}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t016')} {/* "소요시간" */}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider text-right">{pt('t015')} {/* "금액" */}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider text-center">{pt('t051')} {/* "상태" */}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">{pt('t057')} {/* "비고" */}</th>
                  <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider text-center">{pt('t052')} {/* "작업" */}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {listReservations.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-sm text-slate-400">{pt('t099')} {/* "조회 조건에 맞는 예약이 없습니다." */}</td>
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
                        <td className="py-2.5 px-4 text-sm text-slate-600">{pt('t058', { count: getExpectedMinutes(reservation.services) })} {/* "{{count}}분" */}</td>
                        <td className="py-2.5 px-4 text-sm text-right font-semibold text-slate-700">{formatCurrency(getExpectedAmount(reservation.services))}</td>
                        <td className="py-2.5 px-4 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border ${tone.badge}`}>{statusLabel}</span>
                        </td>
                        <td className="py-2.5 px-4 text-sm text-slate-500">{reservation.note || '-'}</td>
                        <td className="py-2.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button onClick={() => openEditModal(reservation)} title={pt('t054')} className="p-1.5 rounded text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"><Edit2 size={14} /></button>
                            <button onClick={() => deleteReservation(reservation.id)} title={pt('t055')} className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {/* 예약 등록/수정 모달 */}
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
                  {modalMode === 'edit' ? pt('t059') : pt('t060')} {/* "예약 수정" : "예약 등록" */}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {pt('t061')} {/* "예약 정보, 상태, 시술 항목을 한 번에 수정할 수 있습니다." */}
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
              {/* 기본 예약 정보 입력 영역 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* 날짜 선택 */}
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

                {/* 시작 시간 선택 */}
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

                {/* 예약 상태 선택 (진행전/진행중/완료 등) */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">
                    {pt('t020')} {/* "상태" */}
                  </label>
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

                {/* 고객 검색 및 회원 정보 표시 */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700">
                    {pt('t001')}: {/* "예약고객" */}
                    <span className="font-black text-slate-900 ml-1">{selectedCustomerSummary || pt('t136') /* "고객명(전화번호)" */}</span>
                    <span className={`ml-2 inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border ${selectedMemberUserId ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                      {customerMembershipLabel}
                    </span>
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
                      placeholder={pt('t094')} // "검색어 입력..."
                      className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                    />
                    {/* 고객 검색 자동완성 레이어 */}
                    <CustomerLookupDropdown
                      open={isCustomerLookupOpen && !!customerPhoneQueryDigits && !isReservationFormLocked}
                      members={customerLookupMembers}
                      selectedMemberId={selectedCustomerMemberId}
                      emptyText={pt('t027')}
                      maxHeightClassName="max-h-36"
                      onSelect={(member) => handleCustomerMemberSelect(String(member.id))}
                    />
                  </div>
                </div>

                {/* 성별 선택 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t100')} {/* "성별" */}</label>
                  <select
                    value={form.gender}
                    disabled={isReservationFormLocked}
                    onChange={(event) => setForm((prev) => ({ ...prev, gender: event.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none bg-white"
                  >
                    <option value="">{pt('t101') /* "성별 선택" */}</option>
                    <option value="M">{pt('t102') /* "남성" */}</option>
                    <option value="F">{pt('t103') /* "여성" */}</option>
                  </select>
                </div>

                {/* 담당 디자이너 선택 */}
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
                      <option key={name} value={name}>{name}</option>
                    ))}
                    {/* 데이터 일관성: 현재 직원 목록에 없더라도 기존 저장값이 있으면 옵션으로 추가하여 유실 방지 */}
                    {form.designerName && !designerNames.includes(form.designerName) && (
                      <option value={form.designerName}>
                        {pt('t065', { name: form.designerName })}
                      </option>
                    )}</select>
                </div>

                {/* 예약 비고/노트 */}
                <div className="space-y-1 md:col-span-2 lg:col-span-3">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t066')} {/* "비고" */}</label>
                  <textarea
                    value={form.note}
                    rows={4}
                    disabled={isReservationFormLocked}
                    onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                    placeholder={pt('t025') /* "특이사항을 입력해 주세요..." */}
                    className="w-full min-h-[105px] px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none resize-none disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* 시술 선택/추가 + 선택된 시술 목록 */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <section className="lg:col-span-5 border border-slate-200 rounded-xl p-4 bg-slate-50/60">
                  <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-3">
                    <Scissors size={16} className="text-primary" />
                    {pt('t067')} {/* "시술 선택" */}
                  </h4>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">{pt('t068')} {/* "카테고리" */}</label>
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
                      <label className="text-xs font-bold text-slate-500 uppercase">{pt('t009') /* "담당 디자이너 값이 올바르지 않습니다." (여기서는 서비스 선택 라벨로 오용된 듯 하나 라벨링 유도함) */}</label>
                      <select
                        value={form.selectedServiceId}
                        disabled={isReservationFormLocked}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, selectedServiceId: event.target.value }))
                        }
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary/20 outline-none"
                      >
                        {categoryServices.length === 0 ? (
                          <option value="">{pt('t003') /* "결제 상태" */}</option>
                        ) : (
                          categoryServices.map((service) => (
                            <option key={service.id} value={String(service.id)}>
                              {service.serviceName} ({pt('t058', { count: service.durationMinutes }) /* "{{count}}분" */} / {formatCurrency(service.unitPrice)})
                            </option>
                          ))
                        )}</select>
                    </div>

                    {selectedService && (
                      <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 space-y-1">
                        <p className="font-semibold text-slate-700">{selectedService.serviceName}</p>
                        <p>{pt('t070', { count: selectedService.durationMinutes }) /* "예상시간: {{count}}분" */}</p>
                        <p>{pt('t071', { amount: formatCurrency(selectedService.unitPrice) }) /* "단가: {{amount}}" */}</p>
                      </div>
                    )}<button
                      type="button"
                      onClick={addSelectedService}
                      disabled={!selectedService || isReservationFormLocked}
                      className="w-full bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                    >
                      <PlusCircle size={16} />
                      {pt('t069')} {/* "선택 시술 추가" */}
                    </button>
                  </div>
                </section>

                <section className="lg:col-span-7 border border-slate-200 rounded-xl p-4">
                  <h4 className="text-sm font-bold text-slate-700 mb-3">{pt('t024') /* "이미 취소된 매출입니다." (여기서는 선택된 시술 목록 헤더로 쓰임) */}</h4>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left min-w-[620px]">
                      <thead>
                        <tr className="bg-slate-900 text-slate-200">
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider">{pt('t072')} {/* "카테고리" */}</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider">{pt('t012')} {/* "디자이너 선택" */}</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-right">{pt('t016')} {/* "소요시간" */}</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-right">{pt('t073')} {/* "단가" */}</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-center">{pt('t074')} {/* "삭제" */}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {form.services.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-sm text-slate-400">
                              {pt('t075')} {/* "아직 추가된 시술이 없습니다." */}
                            </td>
                          </tr>
                        ) : (
                          form.services.map((service) => (
                            <tr key={service.lineId} className="hover:bg-slate-50 transition-colors">
                              <td className="py-2.5 px-3 text-sm text-slate-700">{getCategoryLabelByCode(service.categoryCode, service.categoryName)}</td>
                              <td className="py-2.5 px-3 text-sm font-semibold text-slate-700">{service.serviceName}</td>
                              <td className="py-2.5 px-3 text-sm text-right text-slate-600">{pt('t058', { count: service.durationMinutes }) /* "{{count}}분" */}</td>
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

              {/* 빠른 결제 계산기 */}
              <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h4 className="text-sm font-bold text-slate-700">{pt('t104')} {/* "빠른 결제 정산" */}</h4>
                  <p className="text-[11px] text-slate-500">
                    {isPaymentCompleted ? pt('t129') /* "이미 결제가 완료된 예약입니다." */ : pt('t117') /* "결제 수단별 금액을 입력하면 미수금을 자동으로 계산합니다." */}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t105')} {/* "할인 금액" */}</label>
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
                    <p className="text-xs font-bold text-slate-500 uppercase">{pt('t106')} {/* "최종 결제 금액" */}</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{formatCurrency(calculatorPayableAmount)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-bold text-slate-500 uppercase">{pt('t109')} {/* "결제 총액" */}</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{formatCurrency(calculatorPaidTotal)}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500 uppercase">{pt('t107')} {/* "결제 수단" */}</p>
                    <button
                      type="button"
                      onClick={addQuickPaymentLine}
                      disabled={isQuickPaymentReadOnly || isReservationFormLocked || manualPaymentMethodOptions.length === 0 || calculatorRemainingAmount <= 0}
                      className="text-xs font-bold text-primary disabled:opacity-40 flex items-center gap-1"
                    >
                      <PlusCircle size={14} />
                      {pt('t108')} {/* "결제 수단 추가" */}
                    </button>
                  </div>

                  {manualPaymentMethodOptions.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-400">
                      {pt('t118')} {/* "사용 가능한 결제수단이 없습니다." */}
                    </div>
                  ) : quickPaymentLines.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-3 text-xs text-slate-400">
                      {pt('t119')} {/* "결제 라인을 추가하면 미수 금액을 바로 확인할 수 있습니다." */}
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
                  <span className="text-xs font-semibold text-slate-500">{pt('t109') /* "결제 총액" */}: {formatCurrency(calculatorPaidTotal)}</span>
                  <span
                    className={`text-xs font-black ${calculatorRemainingAmount === 0
                      ? 'text-emerald-600'
                      : calculatorRemainingAmount > 0
                        ? 'text-rose-600'
                        : 'text-amber-600'
                      }`}
                  >
                    {calculatorRemainingAmount === 0
                      ? pt('t120') /* "결제가 완료되었습니다." */
                      : calculatorRemainingAmount > 0
                        ? `${pt('t110') /* "미수 금액" */}: ${formatCurrency(calculatorRemainingAmount)}`
                        : `${pt('t111') /* "초과 결제" */}: ${formatCurrency(Math.abs(calculatorRemainingAmount))}`}
                  </span>
                </div>
              </section>

              {/* 하단 요약/액션 버튼 */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1">
                <div className="flex flex-wrap gap-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="text-xs font-bold text-slate-500 uppercase">{pt('t014')} {/* "총 소요시간" */}</p>
                    <p className="font-black text-slate-900 mt-1">{pt('t058', { count: formExpectedMinutes }) /* "{{count}}분" */}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="text-xs font-bold text-slate-500 uppercase">{pt('t013')} {/* "총 예상금액" */}</p>
                    <p className="font-black text-slate-900 mt-1">{formatCurrency(formExpectedAmount)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* 버튼 노출 규칙
                     - 닫기 버튼은 항상 노출
                     - 완료 상태(editTargetCompleted)에서는 저장 버튼 숨김
                     - 저장 버튼은 그 외 상태에서 노출(활성/비활성은 isSaveButtonDisabled로 제어)
                     - shouldShowStartServiceButton: 오늘 + 수정 + 진행전
                     - shouldShowPaymentButton: 오늘 + 수정 + 진행중
                  */}
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={isDbBusy}
                    className={`px-4 py-2.5 rounded-lg text-sm font-bold text-white flex items-center gap-2 ${isDbBusy ? 'bg-slate-400 cursor-not-allowed' : 'bg-slate-600 hover:bg-slate-700'
                      }`}
                  >
                    <X size={15} />
                    {pt('t151')} {/* "닫기" */}
                  </button>
                  {!isEditTargetCompleted && (
                    <button
                      type="submit"
                      disabled={isSaveButtonDisabled}
                      className="px-4 py-2.5 rounded-lg text-sm font-bold text-white bg-primary hover:bg-primary/90 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isMutating ? <Loader2 size={15} className="animate-spin" /> : <Clock3 size={15} />}
                      {pt('t121')} {/* "예약 저장" */}
                    </button>
                  )}
                  {shouldShowStartServiceButton && (
                    <button
                      type="button"
                      onClick={startReservationService}
                      disabled={isReservationFormLocked}
                      className={`px-4 py-2.5 rounded-lg text-sm font-bold text-white flex items-center gap-2 ${isReservationFormLocked ? 'bg-slate-400 cursor-not-allowed' : 'bg-sky-600 hover:bg-sky-700'
                        }`}
                    >
                      {isMutating ? <Loader2 size={15} className="animate-spin" /> : <Scissors size={15} />}
                      {pt('t127')} {/* "시술 시작" */}
                    </button>
                  )}
                  {shouldShowPaymentButton && (
                    <button
                      type="button"
                      onClick={processReservationPayment}
                      disabled={isPaymentActionDisabled}
                      className={`px-4 py-2.5 rounded-lg text-sm font-bold text-white flex items-center gap-2 ${isPaymentActionDisabled ? 'bg-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
                        }`}
                    >
                      {(isMutating || isSettlementStateLoading)
                        ? <Loader2 size={15} className="animate-spin" />
                        : <Clock3 size={15} />}
                      {pt('t122')} {/* "정산 완료" */}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      )}</motion.div>
  );
}


