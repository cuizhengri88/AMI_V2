import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import {
  Scissors,
  Clock,
  Search,
  Plus,
  Calendar,
  GripHorizontal,
  X,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';

type Coupon = {
  serviceId: number;
  name: string;
  count: number;
};

type Member = {
  id: number;
  name: string;
  phone: string;
  balance: number;
  coupons: Coupon[];
};

type Manager = {
  id: number;
  name: string;
  role: string;
};

type ServiceCategoryOption = {
  code: string;
  name: string;
  order: number;
};

type Procedure = {
  id: number;
  name: string;
  categoryCode: string;
  categoryName: string;
  price: number;
  time: number;
};

type Reservation = {
  id: string;
  date: string;
  time: string;
  customerName: string;
  designerName: string;
  memberId?: number;
  managerId?: number;
  procedureIds: number[];
  status: 'RESERVED' | 'PROCESSING' | 'CANCELLED' | 'COMPLETED';
};

type PaymentMethodCode = string;

type PaymentMethodOption = {
  code: PaymentMethodCode;
  name: string;
  order: number;
};

type PaymentDetail = {
  method: PaymentMethodCode;
  amount: number;
  couponServiceId?: number;
};

type SettlementStatus = 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
type SettlementCancelType = 'PAYMENT' | 'PROCEDURE';
type SettlementListTab = 'RESERVATION' | Extract<SettlementStatus, 'PROCESSING' | 'COMPLETED'>;

type Settlement = {
  id: number;
  date: string;
  memberId: number | 'GUEST';
  guestCustomerName?: string;
  guestCustomerPhone?: string;
  managerId: number;
  procedureIds: number[];
  totalAmount: number;
  totalTime: number;
  payments: PaymentDetail[];
  status: SettlementStatus;
  reservationId?: string;
  cancelType?: SettlementCancelType;
  cancelReason?: string;
  cancelledAt?: string;
};

type ModalProps = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  icon: React.ReactNode;
};

const FALLBACK_PAYMENT_METHODS: PaymentMethodOption[] = [
  { code: 'CASH', name: 'CASH', order: 1 },
  { code: 'CARD', name: 'CARD', order: 2 },
  { code: 'WECHAT', name: 'WECHAT', order: 3 },
  { code: 'ALIPAY', name: 'ALIPAY', order: 4 },
  { code: 'PREPAID', name: 'PREPAID', order: 5 },
  { code: 'COUPON', name: 'COUPON', order: 6 },
];

function todayIso() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 전화번호 검색은 하이픈/공백/괄호 입력이 섞여도 동일하게 매칭되도록
// 숫자만 남긴 비교용 문자열을 사용한다.
function normalizePhoneDigits(raw?: string | null) {
  return (raw || '').replace(/\D/g, '');
}

function normalizeNameKey(raw?: string | null) {
  return (raw || '').trim().toLowerCase();
}

function isSamePhoneDigits(lhs?: string | null, rhs?: string | null) {
  const left = normalizePhoneDigits(lhs);
  const right = normalizePhoneDigits(rhs);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

function findMatchedMemberByNameOrPhone(
  members: Member[],
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

const EMPTY_RESERVATIONS: Reservation[] = [];

function toReservationStatus(value: string): Reservation['status'] {
  const normalized = value.trim().toUpperCase();
  if (normalized.includes('CANCEL')) return 'CANCELLED';
  if (normalized.includes('PROCESS')) return 'PROCESSING';
  if (normalized.includes('COMPLETE')) return 'COMPLETED';
  if (normalized.includes('RESERV')) return 'RESERVED';
  return 'RESERVED';
}

function toSettlementStatus(value: string): SettlementStatus {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'CANCELLED') return 'CANCELLED';
  if (normalized === 'COMPLETED') return 'COMPLETED';
  return 'PROCESSING';
}

function isCouponPaymentMethod(method: string) {
  return method?.trim().toUpperCase() === 'COUPON';
}

function isBalancePaymentMethod(method: string) {
  const normalized = method?.trim().toUpperCase();
  return normalized === 'PREPAID' || normalized === 'MEMBERSHIP';
}

function DraggableModal({ title, children, onClose, icon }: ModalProps) {
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
      className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden relative"
    >
      <div
        onPointerDown={(event) => dragControls.start(event)} className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 cursor-move active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <GripHorizontal size={18} className="text-slate-300" />
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>
      </div>
      {children}
    </motion.div>
  );
}

export default function SalesEntryPage() {
  const pt = usePageText('user_management_sales_entry');
  // [상태] 기준 데이터(회원/직원/시술/카테고리/결제수단/정산) 조회 결과
  const [members, setMembers] = useState<Member[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [procedureCategories, setProcedureCategories] = useState<ServiceCategoryOption[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>(FALLBACK_PAYMENT_METHODS);
  const [todayReservations, setTodayReservations] = useState<Reservation[]>(EMPTY_RESERVATIONS);
  const [settlements, setSettlements] = useState<Settlement[]>([]);

  // [상태] 로딩/저장 중 UI 제어
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSettlement, setEditingSettlement] = useState<Settlement | null>(null);
  const [modalReservationTarget, setModalReservationTarget] = useState<Reservation | null>(null);
  const [isReservationActionModalOpen, setIsReservationActionModalOpen] = useState(false);
  const [reservationActionTarget, setReservationActionTarget] = useState<Reservation | null>(null);

  // [상태] 목록 검색 조건
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState(todayIso());
  const [activeSettlementTab, setActiveSettlementTab] = useState<SettlementListTab>('PROCESSING');

  // [상태] 모달 입력값
  const [selectedMemberId, setSelectedMemberId] = useState<string | 'GUEST'>('GUEST');
  // 고객 검색 입력값(이름/전화번호 공용).
  // 이 값은 "회원 자동완성 목록 필터"와 "비회원 fallback 고객명/전화 추론"에 동시에 사용된다.
  const [customerLookupQuery, setCustomerLookupQuery] = useState('');
  // 비회원 저장용 이름/전화. 회원이 선택되면 selectedMember 기준으로 동기화된다.
  const [guestCustomerName, setGuestCustomerName] = useState('');
  const [guestCustomerPhone, setGuestCustomerPhone] = useState('');
  // 자동완성 드롭다운 표시 제어(onFocus/onBlur + 입력값 조건 기반)
  const [isCustomerLookupOpen, setIsCustomerLookupOpen] = useState(false);
  const [selectedManagerId, setSelectedManagerId] = useState<string>('');
  const [selectedProcs, setSelectedProcs] = useState<number[]>([]);
  const [couponAppliedServiceIds, setCouponAppliedServiceIds] = useState<number[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [payments, setPayments] = useState<PaymentDetail[]>([]);
  const [selectedReservationId, setSelectedReservationId] = useState<string>('');
  const [reservationImportDate, setReservationImportDate] = useState<string>(todayIso());
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Settlement | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const initialLoadDoneRef = useRef(false);
  const loadDataInFlightRef = useRef<Promise<void> | null>(null);

  const isBusy = isLoading || isMutating;
  const isReservationEntryMode = !!modalReservationTarget && !editingSettlement;
  const isCompletedSettlementReadOnly = editingSettlement?.status === 'COMPLETED';

  // [유틸] 결제수단 코드를 다국어 표시명으로 변환
  const getPaymentMethodLabel = (code: string, fallback?: string) => {
    switch (code.toUpperCase()) {
      case 'CASH':
        return pt('t078');
      case 'CARD':
        return pt('t079');
      case 'WECHAT':
        return pt('t080');
      case 'ALIPAY':
        return pt('t081');
      case 'PREPAID':
      case 'MEMBERSHIP':
        return pt('t082');
      case 'COUPON':
        return pt('t083');
      default:
        return fallback || code;
    }
  };

  // [유틸] 정산 상태 코드를 배지 텍스트로 변환
  const getSettlementStatusLabel = (status: SettlementStatus) => {
    if (status === 'COMPLETED') return pt('t045');
    if (status === 'CANCELLED') return pt('t046');
    return pt('t047');
  };

  const getReservationStatusLabel = (status: Reservation['status']) => {
    if (status === 'COMPLETED') return pt('t045');
    if (status === 'CANCELLED') return pt('t046');
    if (status === 'PROCESSING') return pt('t047');
    return pt('t088');
  };

  // [계산] 카테고리 드롭다운 목록(공통코드 우선, 필요 시 시술 데이터로 보정)
  const categories = useMemo<ServiceCategoryOption[]>(() => {
    if (procedureCategories.length > 0) return procedureCategories;

    const fallbackMap = new Map<string, ServiceCategoryOption>();
    procedures.forEach((procedure, index) => {
      if (!procedure.categoryCode) return;
      if (fallbackMap.has(procedure.categoryCode)) return;
      fallbackMap.set(procedure.categoryCode, {
        code: procedure.categoryCode,
        name: procedure.categoryName || procedure.categoryCode,
        order: index + 1,
      });
    });
    return Array.from(fallbackMap.values());
  }, [procedureCategories, procedures]);
  const procedurePriceById = useMemo(
    () => new Map(procedures.map((procedure) => [procedure.id, procedure.price])),
    [procedures],
  );

  // [로직] 화면 진입 시 필요한 모든 기준 데이터/정산 데이터를 DB에서 조회
  const loadData = useCallback(async () => {
    // 중복 호출 시 동일 Promise를 재사용해 API 동시 호출 폭주를 방지
    if (loadDataInFlightRef.current) {
      return loadDataInFlightRef.current;
    }

    const task = (async () => {
      try {
        setIsLoading(true);
        const [
          commonCodeResult,
          managerResult,
          procedureResult,
          memberResult,
          settlementResult,
          reservationResult,
        ] = await Promise.all([
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
            employees: Array<{
              employee_id: number;
              employee_name: string;
              role_name: string | null;
              role_id: string | null;
            }>;
          }>('get_employee_management_data'),
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
            }>;
          }>('get_service_catalog_data'),
          invokeDbCommand<{
            success: boolean;
            message: string;
            members: Array<{
              user_id: number;
              user_name: string;
              phone: string | null;
              point_balance: number;
              coupons: Array<{
                service_id: number;
                service_name: string;
                count: number;
              }>;
            }>;
          }>('get_member_point_management_data', {
            include_histories: false,
          }),
          invokeDbCommand<{
            success: boolean;
            message: string;
            settlements: Array<{
              settlement_id: number;
              settlement_datetime: string;
              member_user_id: number | null;
              guest_customer_name?: string | null;
              guest_customer_phone?: string | null;
              manager_employee_id: number;
              service_ids: number[];
              total_amount: number;
              total_time_minutes: number;
              payments: Array<{
                payment_method_code: string;
                amount: number;
                coupon_service_id: number | null;
              }>;
              status: string;
              reservation_ref: string | null;
              cancel_type: string | null;
              cancel_reason: string | null;
              cancelled_at: string | null;
            }>;
          }>('get_sales_settlement_data'),
          invokeDbCommand<{
            success: boolean;
            message: string;
            reservations: Array<{
              reservation_id: number;
              reservation_date: string;
              start_time: string;
              customer_name: string;
              designer_name: string;
              status: string;
              services: Array<{
                service_id: number;
              }>;
            }>;
          }>('get_reservation_calendar_data'),
        ]);

        // [매핑] 회원 포인트 조회 결과 -> 화면 모델
        const mappedMembers: Member[] = (memberResult.members || []).map((member) => ({
          id: member.user_id,
          name: member.user_name,
          phone: member.phone || '-',
          balance: member.point_balance || 0,
          coupons: (member.coupons || []).map((coupon) => ({
            serviceId: coupon.service_id,
            name: coupon.service_name,
            count: coupon.count,
          })),
        }));

        // [매핑] 직원 조회 결과 -> 담당자 모델
        const mappedManagers: Manager[] = (managerResult.employees || []).map((manager) => ({
          id: manager.employee_id,
          name: manager.employee_name,
          role: manager.role_name || manager.role_id || '-',
        }));

        // [매핑] 시술 조회 결과 -> 시술 선택 모델(사용중만 노출)
        const mappedProcedures: Procedure[] = (procedureResult.items || [])
          .filter((procedure) => procedure.use_yn === 'Y')
          .map((procedure) => ({
            id: procedure.service_id,
            name: procedure.service_name,
            categoryCode: procedure.category_code,
            categoryName: procedure.category_name || procedure.category_code,
            price: procedure.unit_price,
            time: procedure.duration_minutes,
          }));

        // [매핑] 공통코드 T_CATEGORY -> 카테고리 선택 모델
        const mappedProcedureCategories: ServiceCategoryOption[] = (commonCodeResult.details || [])
          .filter((detail) => detail.group === 'T_CATEGORY' && detail.use_yn === 'Y')
          .map((detail) => ({
            code: detail.code,
            name: detail.name || detail.code,
            order: detail.order,
          }))
          .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code));

        // [보정] 공통코드에 누락된 코드라도 실제 시술에 존재하면 목록에 포함
        const mergedCategoryMap = new Map<string, ServiceCategoryOption>(
          mappedProcedureCategories.map((category) => [category.code, category]),
        );
        mappedProcedures.forEach((procedure) => {
          if (!mergedCategoryMap.has(procedure.categoryCode)) {
            mergedCategoryMap.set(procedure.categoryCode, {
              code: procedure.categoryCode,
              name: procedure.categoryName || procedure.categoryCode,
              order: Number.MAX_SAFE_INTEGER,
            });
          }
        });
        const mergedProcedureCategories = Array.from(mergedCategoryMap.values()).sort(
          (a, b) => (a.order - b.order) || a.name.localeCompare(b.name),
        );

        // [매핑] 공통코드 PAYMENT_METHOD -> 결제수단 선택 모델
        const mappedPaymentMethods: PaymentMethodOption[] = (commonCodeResult.details || [])
          .filter((detail) => detail.group === 'PAYMENT_METHOD' && detail.use_yn === 'Y')
          .map((detail) => ({
            code: detail.code,
            name: detail.name,
            order: detail.order,
          }))
          .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code));

        const reservationCustomerNameByRef = new Map(
          (reservationResult.reservations || []).map((reservation) => [
            String(reservation.reservation_id),
            reservation.customer_name?.trim() || '',
          ]),
        );

        // [매핑] 정산 조회 결과 -> 목록/수정 모델
        const mappedSettlements: Settlement[] = (settlementResult.settlements || []).map((settlement) => {
          const guestCustomerName = settlement.guest_customer_name?.trim() || '';
          const guestCustomerPhone = settlement.guest_customer_phone?.trim() || '';
          const reservationCustomerName =
            (settlement.reservation_ref && reservationCustomerNameByRef.get(String(settlement.reservation_ref)))
            || '';
          const explicitMemberId =
            Number.isFinite(settlement.member_user_id) && Number(settlement.member_user_id) > 0
              ? Number(settlement.member_user_id)
              : null;
          const inferredMember = explicitMemberId
            ? mappedMembers.find((member) => member.id === explicitMemberId) || null
            : findMatchedMemberByNameOrPhone(
              mappedMembers,
              guestCustomerName || reservationCustomerName,
              guestCustomerPhone || reservationCustomerName,
            );

          return {
            id: settlement.settlement_id,
            date: settlement.settlement_datetime,
            memberId: inferredMember?.id || explicitMemberId || 'GUEST',
            guestCustomerName: guestCustomerName || undefined,
            guestCustomerPhone: guestCustomerPhone || undefined,
            managerId: settlement.manager_employee_id,
            procedureIds: settlement.service_ids || [],
            totalAmount: settlement.total_amount,
            totalTime: settlement.total_time_minutes,
            payments: (settlement.payments || []).map((payment) => ({
              method: payment.payment_method_code,
              amount: payment.amount,
              couponServiceId: payment.coupon_service_id ?? undefined,
            })),
            status: toSettlementStatus(settlement.status),
            reservationId: settlement.reservation_ref || undefined,
            cancelType:
              settlement.cancel_type === 'PAYMENT' || settlement.cancel_type === 'PROCEDURE'
                ? settlement.cancel_type
                : undefined,
            cancelReason: settlement.cancel_reason || undefined,
            cancelledAt: settlement.cancelled_at || undefined,
          };
        });

        // [매핑] 예약 조회 결과 -> 신규 정산의 "예약 불러오기" 모델
        const mappedReservations: Reservation[] = (reservationResult.reservations || []).map((reservation) => {
          const customerName = reservation.customer_name?.trim() || '';
          const designerName = reservation.designer_name?.trim() || '';
          const matchedMember = findMatchedMemberByNameOrPhone(mappedMembers, customerName);
          const matchedManager = mappedManagers.find((manager) => manager.name.trim() === designerName);

          return {
            id: String(reservation.reservation_id),
            date: reservation.reservation_date,
            time: reservation.start_time,
            customerName,
            designerName,
            memberId: matchedMember?.id,
            managerId: matchedManager?.id,
            procedureIds: (reservation.services || [])
              .map((service) => service.service_id)
              .filter((serviceId) => Number.isFinite(serviceId) && serviceId > 0),
            status: toReservationStatus(reservation.status),
          };
        });

        setMembers(mappedMembers);
        setManagers(mappedManagers);
        setProcedures(mappedProcedures);
        setProcedureCategories(mergedProcedureCategories);
        setPaymentMethods(mappedPaymentMethods.length > 0 ? mappedPaymentMethods : FALLBACK_PAYMENT_METHODS);
        setSettlements(mappedSettlements);
        setTodayReservations(mappedReservations);
      } catch (error: any) {
        alert(typeof error === 'string' ? error : error?.message || pt('t076'));
      } finally {
        setIsLoading(false);
        loadDataInFlightRef.current = null;
      }
    })();

    loadDataInFlightRef.current = task;
    return task;
  }, []);

  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (categories.length === 0) {
      if (selectedCategory !== '') {
        setSelectedCategory('');
      }
      return;
    }

    if (!categories.some((category) => category.code === selectedCategory)) {
      setSelectedCategory(categories[0].code);
    }
  }, [categories, selectedCategory]);

  // [계산] 선택된 회원 상세 정보(일반 방문객은 null)
  const selectedMember = useMemo(() => {
    if (selectedMemberId === 'GUEST') return null;
    const memberId = Number(selectedMemberId);
    return members.find((member) => member.id === memberId) || null;
  }, [selectedMemberId, members]);

  const customerLookupQueryDigits = useMemo(
    () => normalizePhoneDigits(customerLookupQuery),
    [customerLookupQuery],
  );

  // 고객 입력창 자동완성 후보:
  // - 이름 부분일치
  // - 전화 원문 부분일치
  // - 전화 숫자-only 부분일치
  // 를 모두 허용해서 입력 방식에 상관없이 후보를 찾을 수 있게 한다.
  // UI 과밀 방지를 위해 최대 8건만 노출한다.
  const customerLookupMembers = useMemo(() => {
    const query = customerLookupQuery.trim().toLowerCase();
    const queryDigits = customerLookupQueryDigits;
    if (!query && !queryDigits) return [];

    return members
      .filter((member) => {
        const memberName = member.name.toLowerCase();
        const memberPhone = member.phone || '';
        const memberPhoneLower = memberPhone.toLowerCase();
        const memberPhoneDigits = normalizePhoneDigits(memberPhone);

        if (query && (memberName.includes(query) || memberPhoneLower.includes(query))) return true;
        if (queryDigits && memberPhoneDigits.includes(queryDigits)) return true;
        return false;
      })
      .slice(0, 8);
  }, [customerLookupQuery, customerLookupQueryDigits, members]);

  // [계산] 선택 회원의 쿠폰 보유 수량 맵(serviceId -> count)
  const selectedMemberCouponMap = useMemo(() => {
    const map = new Map<number, number>();
    if (!selectedMember) return map;

    selectedMember.coupons.forEach((coupon) => {
      map.set(coupon.serviceId, coupon.count);
    });
    return map;
  }, [selectedMember]);

  // [계산] 이미 정산에 연결된 예약 ID 집합
  const settledReservationIdSet = useMemo(
    () => new Set(settlements.map((settlement) => settlement.reservationId).filter(Boolean) as string[]),
    [settlements],
  );

  // [계산] 예약 불러오기: 선택한 날짜 + 미완료 예약 + 미연동 예약만 노출
  const importableReservations = useMemo(() => {
    return todayReservations.filter(
      (reservation) =>
        reservation.date === reservationImportDate
        && reservation.status !== 'CANCELLED'
        && reservation.status !== 'COMPLETED'
        && !settledReservationIdSet.has(reservation.id),
    );
  }, [todayReservations, reservationImportDate, settledReservationIdSet]);

  // [계산] 예약 연동 정산은 예약 등록 당시 고객명을 우선 표기한다.
  const reservationCustomerNameById = useMemo(
    () =>
      new Map(
        todayReservations.map((reservation) => [reservation.id, reservation.customerName.trim()]),
      ),
    [todayReservations],
  );

  const selectedReservationGuestLabel = useMemo(() => {
    if (!selectedReservationId) return '';
    const reservationName = reservationCustomerNameById.get(selectedReservationId)?.trim();
    if (!reservationName) return '';
    return reservationName;
  }, [reservationCustomerNameById, selectedReservationId]);

  // 현재 "비회원 표시 텍스트" 우선순위:
  // 1) 비회원 이름+전화
  // 2) 비회원 이름
  // 3) 비회원 전화
  // 4) 현재 입력창 원문
  // 5) 예약에서 가져온 고객명
  // 6) 기본 라벨(일반 방문객)
  // 화면 라벨/옵션 표기와 저장 fallback 기준을 맞추기 위해 한 곳에서 계산한다.
  const guestDisplayLabel = useMemo(() => {
    const guestName = guestCustomerName.trim();
    const guestPhone = guestCustomerPhone.trim();
    const lookupValue = customerLookupQuery.trim();
    if (guestName && guestPhone) return `${guestName} (${guestPhone})`;
    if (guestName) return guestName;
    if (guestPhone) return guestPhone;
    if (lookupValue) return lookupValue;
    if (selectedReservationGuestLabel) return selectedReservationGuestLabel;
    return pt('t025');
  }, [customerLookupQuery, guestCustomerName, guestCustomerPhone, pt, selectedReservationGuestLabel]);

  // 상단 요약 라벨("고객명: ...") 표시값:
  // - 회원 선택 시: 회원명(전화번호)
  // - 비회원/직접입력 시: guestDisplayLabel
  // 한 줄 요약 표기를 안정적으로 유지하기 위한 전용 계산값.
  const selectedCustomerSummary = useMemo(() => {
    if (selectedMember) {
      const memberPhone = (selectedMember.phone || '').trim();
      return memberPhone ? `${selectedMember.name} (${memberPhone})` : selectedMember.name;
    }
    return guestDisplayLabel;
  }, [guestDisplayLabel, selectedMember]);

  const getSettlementCustomerName = useCallback(
    (settlement: Settlement, fallbackMemberName?: string) => {
      if (settlement.reservationId) {
        const reservationCustomerName = reservationCustomerNameById.get(settlement.reservationId)?.trim();
        if (reservationCustomerName) return reservationCustomerName;
      }

      const memberName = fallbackMemberName?.trim();
      if (memberName) return memberName;
      const guestName = settlement.guestCustomerName?.trim();
      if (guestName) return guestName;
      const guestPhone = settlement.guestCustomerPhone?.trim();
      if (guestPhone) return guestPhone;
      return settlement.memberId === 'GUEST' ? pt('t025') : '';
    },
    [reservationCustomerNameById, pt],
  );

  const getReservationCustomerName = useCallback(
    (reservation: Reservation) => {
      const reservationName = reservation.customerName?.trim();
      if (reservationName) return reservationName;

      const matchedMember = reservation.memberId
        ? members.find((member) => member.id === reservation.memberId)
        : null;
      const memberName = matchedMember?.name?.trim();
      if (memberName) return memberName;
      return pt('t025');
    },
    [members, pt],
  );

  const getReservationManagerName = useCallback(
    (reservation: Reservation) => {
      const designerName = reservation.designerName?.trim();
      if (designerName) return designerName;

      const matchedManager = reservation.managerId
        ? managers.find((manager) => manager.id === reservation.managerId)
        : null;
      return matchedManager?.name?.trim() || '';
    },
    [managers],
  );

  // [계산] 목록 검색(고객명/전화번호/담당자 + 날짜)
  const searchedSettlements = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const queryDigits = normalizePhoneDigits(searchTerm);

    return settlements.filter((settlement) => {
      const member =
        settlement.memberId === 'GUEST'
          ? { name: '', phone: '' }
          : members.find((entry) => entry.id === settlement.memberId);
      const manager = managers.find((entry) => entry.id === settlement.managerId);
      const customerName = getSettlementCustomerName(settlement, member?.name);
      const guestName = (settlement.guestCustomerName || '').toLowerCase();
      const guestPhone = settlement.guestCustomerPhone || '';
      const guestPhoneDigits = normalizePhoneDigits(guestPhone);
      const memberPhoneDigits = normalizePhoneDigits(member?.phone || '');

      const matchesSearch =
        query.length === 0 ||
        customerName.toLowerCase().includes(query) ||
        !!member?.name.toLowerCase().includes(query) ||
        !!member?.phone.toLowerCase().includes(query) ||
        !!guestName.includes(query) ||
        !!guestPhone.toLowerCase().includes(query) ||
        (queryDigits.length > 0 && (memberPhoneDigits.includes(queryDigits) || guestPhoneDigits.includes(queryDigits))) ||
        !!manager?.name.toLowerCase().includes(query);

      const matchesDate = settlement.date.startsWith(filterDate);
      return matchesSearch && matchesDate;
    });
  }, [members, managers, settlements, searchTerm, filterDate, getSettlementCustomerName]);

  const searchedReservationOnly = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return todayReservations.filter((reservation) => {
      if (reservation.date !== filterDate) return false;
      if (reservation.status === 'CANCELLED' || reservation.status === 'COMPLETED') return false;
      if (settledReservationIdSet.has(reservation.id)) return false;

      const member = reservation.memberId
        ? members.find((entry) => entry.id === reservation.memberId)
        : null;
      const customerName = getReservationCustomerName(reservation);
      const managerName = getReservationManagerName(reservation);
      const matchesSearch =
        query.length === 0 ||
        customerName.toLowerCase().includes(query) ||
        !!member?.name.toLowerCase().includes(query) ||
        !!member?.phone.includes(searchTerm) ||
        managerName.toLowerCase().includes(query);
      return matchesSearch;
    });
  }, [
    filterDate,
    getReservationCustomerName,
    getReservationManagerName,
    members,
    searchTerm,
    settledReservationIdSet,
    todayReservations,
  ]);

  const settlementTabCounts = useMemo(
    () => {
      const next: Record<SettlementListTab, number> = {
        RESERVATION: searchedReservationOnly.length,
        PROCESSING: 0,
        COMPLETED: 0,
      };
      searchedSettlements.forEach((settlement) => {
        if (settlement.status === 'PROCESSING' || settlement.status === 'COMPLETED') {
          next[settlement.status] += 1;
        }
      });
      return next;
    },
    [searchedReservationOnly.length, searchedSettlements],
  );

  const filteredSettlements = useMemo(
    () =>
      searchedSettlements.filter(
        (settlement) =>
          (activeSettlementTab === 'PROCESSING' || activeSettlementTab === 'COMPLETED')
          && settlement.status === activeSettlementTab,
      ),
    [searchedSettlements, activeSettlementTab],
  );

  // [계산] 선택한 시술의 총 금액/총 시간
  const totals = useMemo(() => {
    return selectedProcs.reduce(
      (acc, id) => {
        const procedure = procedures.find((entry) => entry.id === id);
        if (procedure) {
          acc.price += procedure.price;
          acc.time += procedure.time;
        }
        return acc;
      },
      { price: 0, time: 0 },
    );
  }, [selectedProcs]);

  // [계산] 쿠폰 적용 여부/적용 횟수 계산을 위한 보조 자료구조
  const couponAppliedSet = useMemo(() => new Set(couponAppliedServiceIds), [couponAppliedServiceIds]);
  const couponAppliedCountMap = useMemo(() => {
    const map = new Map<number, number>();
    couponAppliedServiceIds.forEach((serviceId) => {
      map.set(serviceId, (map.get(serviceId) || 0) + 1);
    });
    return map;
  }, [couponAppliedServiceIds]);

  // [계산] 쿠폰 적용된 시술의 정가 합계를 할인액으로 계산
  const couponDiscountAmount = useMemo(() => {
    return selectedProcs.reduce((sum, serviceId) => {
      if (!couponAppliedSet.has(serviceId)) return sum;
      const procedure = procedures.find((entry) => entry.id === serviceId);
      return sum + (procedure?.price || 0);
    }, 0);
  }, [couponAppliedSet, procedures, selectedProcs]);

  // [계산] 실결제 대상 금액(음수 방지), 쿠폰 결제수단 제외 목록
  const payableAmount = Math.max(totals.price - couponDiscountAmount, 0);

  const manualPaymentMethods = useMemo(
    () => paymentMethods.filter((method) => method.code !== 'COUPON'),
    [paymentMethods],
  );

  // [계산] 결제 금액 합계/미수(또는 초과) 금액
  const paidTotal = useMemo(() => payments.reduce((sum, payment) => sum + payment.amount, 0), [payments]);
  const remainingAmount = payableAmount - paidTotal;

  // [동작] 신규 작성 시 모달 입력값 초기화
  const resetModalForm = () => {
    setSelectedReservationId('');
    setSelectedMemberId('GUEST');
    setCustomerLookupQuery('');
    setGuestCustomerName('');
    setGuestCustomerPhone('');
    setIsCustomerLookupOpen(false);
    setSelectedManagerId('');
    setSelectedProcs([]);
    setCouponAppliedServiceIds([]);
    setSelectedCategory(categories[0]?.code || '');
    setPayments([]);
  };

  const closeSettlementModal = () => {
    if (isMutating) return;
    setIsModalOpen(false);
    setEditingSettlement(null);
    setModalReservationTarget(null);
  };

  const applyReservationToForm = useCallback(
    (reservation: Reservation) => {
      const validProcedureIds = reservation.procedureIds.filter(
        (procedureId) => procedures.some((procedure) => procedure.id === procedureId),
      );
      const reservationCustomerName = reservation.customerName.trim();
      const resolvedMemberId =
        (reservation.memberId && reservation.memberId > 0 ? reservation.memberId : null)
        || findMatchedMemberByNameOrPhone(members, reservationCustomerName)?.id
        || null;

      const resolvedManagerId =
        (reservation.managerId && reservation.managerId > 0
          ? reservation.managerId
          : managers.find((manager) => manager.name.trim() === reservation.designerName.trim())?.id)
        || 0;

      setSelectedReservationId(reservation.id);
      setSelectedMemberId(resolvedMemberId ? String(resolvedMemberId) : 'GUEST');
      setGuestCustomerName(resolvedMemberId ? '' : reservationCustomerName);
      setGuestCustomerPhone('');
      setCustomerLookupQuery(reservationCustomerName);
      setIsCustomerLookupOpen(false);
      setSelectedManagerId(
        resolvedManagerId > 0 ? String(resolvedManagerId) : '',
      );
      setSelectedProcs(validProcedureIds);
      setCouponAppliedServiceIds([]);
      setPayments([]);

      const firstProcedure = procedures.find((procedure) => procedure.id === validProcedureIds[0]);
      if (firstProcedure) {
        setSelectedCategory(firstProcedure.categoryCode);
      } else if (categories.length > 0) {
        setSelectedCategory(categories[0].code);
      }

      if (validProcedureIds.length === 0) {
        alert(pt('t014'));
      }
    },
    [categories, managers, members, procedures, pt],
  );

  // [동작] 모달 열기(신규/수정 모드 분기)
  const handleOpenModal = (settlement?: Settlement) => {
    if (settlement) {
      setModalReservationTarget(null);
      setEditingSettlement(settlement);
      setSelectedReservationId(settlement.reservationId || '');
      setReservationImportDate(settlement.date.slice(0, 10));
      const fallbackGuestLabel = getSettlementCustomerName(settlement);
      const normalizedFallbackGuestLabel =
        fallbackGuestLabel && fallbackGuestLabel !== pt('t025')
          ? fallbackGuestLabel
          : '';
      const inferredMember =
        settlement.memberId !== 'GUEST'
          ? members.find((member) => member.id === settlement.memberId) || null
          : findMatchedMemberByNameOrPhone(
            members,
            settlement.guestCustomerName || normalizedFallbackGuestLabel,
            settlement.guestCustomerPhone || normalizedFallbackGuestLabel,
          );
      setSelectedMemberId(inferredMember ? String(inferredMember.id) : 'GUEST');
      const initialGuestName = settlement.guestCustomerName || normalizedFallbackGuestLabel;
      const initialGuestPhone = settlement.guestCustomerPhone || '';
      setGuestCustomerName(initialGuestName);
      setGuestCustomerPhone(initialGuestPhone);
      setCustomerLookupQuery(
        inferredMember
          ? (
            inferredMember.phone && inferredMember.phone !== '-'
              ? `${inferredMember.name} (${inferredMember.phone})`
              : inferredMember.name
          )
          : (initialGuestName || initialGuestPhone),
      );
      setIsCustomerLookupOpen(false);
      setSelectedManagerId(String(settlement.managerId));
      setSelectedProcs(settlement.procedureIds);
      const couponIds = settlement.payments
        .filter((payment) => payment.method === 'COUPON' && typeof payment.couponServiceId === 'number')
        .map((payment) => payment.couponServiceId as number);
      setCouponAppliedServiceIds(Array.from(new Set(couponIds)));
      setPayments(settlement.payments.filter((payment) => payment.method !== 'COUPON'));
    } else {
      setModalReservationTarget(null);
      setEditingSettlement(null);
      resetModalForm();
      setReservationImportDate(filterDate || todayIso());
    }
    setIsModalOpen(true);
  };

  // [동작] 예약 데이터 불러오기(선택한 예약값으로 모달 입력 자동 채움)
  const handleImportReservation = (reservationId: string) => {
    const reservation = importableReservations.find((entry) => entry.id === reservationId);
    if (!reservation) return;
    applyReservationToForm(reservation);
  };

  const handleCustomerLookupQueryChange = (value: string) => {
    setCustomerLookupQuery(value);
    // 회원이 선택된 상태에서 다시 직접 입력을 시작하면
    // "수동 입력 우선"으로 전환하기 위해 회원 선택을 해제한다.
    if (selectedMemberId !== 'GUEST') {
      setSelectedMemberId('GUEST');
    }
    // 이전 입력에서 남아있던 비회원 이름/전화를 비워
    // 현재 입력값이 요약 라벨/저장 fallback에 정확히 반영되도록 한다.
    setGuestCustomerName('');
    setGuestCustomerPhone('');
    if (!value.trim()) {
      setIsCustomerLookupOpen(false);
      return;
    }
    setIsCustomerLookupOpen(true);
  };

  const handleSelectLookupMember = (member: Member) => {
    const memberPhone = member.phone === '-' ? '' : member.phone;
    // 자동완성에서 회원을 선택하면 회원 모드로 전환하고,
    // 요약 라벨/저장값이 즉시 일치하도록 member 데이터를 guest 상태에도 동기화한다.
    setSelectedMemberId(String(member.id));
    setGuestCustomerName(member.name);
    setGuestCustomerPhone(memberPhone);
    setCustomerLookupQuery(memberPhone ? `${member.name} (${memberPhone})` : member.name);
    setIsCustomerLookupOpen(false);
  };

  const handleOpenReservationActionModal = (reservation: Reservation) => {
    if (isBusy) return;
    setReservationActionTarget(reservation);
    setIsReservationActionModalOpen(true);
  };

  const handleCloseReservationActionModal = () => {
    if (isBusy) return;
    setIsReservationActionModalOpen(false);
    setReservationActionTarget(null);
  };

  const handleOpenSettlementModalFromReservation = (reservation: Reservation) => {
    if (isBusy) return;
    setEditingSettlement(null);
    setModalReservationTarget(reservation);
    resetModalForm();
    setReservationImportDate(reservation.date || filterDate || todayIso());
    applyReservationToForm(reservation);
    setIsModalOpen(true);
    setIsReservationActionModalOpen(false);
    setReservationActionTarget(null);
  };

  const startWorkFromReservation = async (
    reservation: Reservation,
    options?: {
      closeReservationActionModal?: boolean;
      closeEntryModal?: boolean;
    },
  ) => {
    const validServiceIds = reservation.procedureIds.filter(
      (procedureId) => procedures.some((procedure) => procedure.id === procedureId),
    );
    if (validServiceIds.length === 0) {
      alert(pt('t014'));
      return;
    }

    const resolvedManagerId =
      (reservation.managerId && reservation.managerId > 0
        ? reservation.managerId
        : managers.find((manager) => manager.name.trim() === reservation.designerName.trim())?.id)
      || 0;
    if (resolvedManagerId <= 0) {
      alert(pt('t010'));
      return;
    }

    const linkedSettlement = settlements.find((settlement) => settlement.reservationId === reservation.id);
    if (linkedSettlement?.status === 'COMPLETED') {
      alert(pt('t092'));
      return;
    }

    const resolvedMemberId =
      (reservation.memberId && reservation.memberId > 0
        ? reservation.memberId
        : findMatchedMemberByNameOrPhone(members, reservation.customerName)?.id)
      || null;

    const preservedPayments =
      linkedSettlement && linkedSettlement.status !== 'CANCELLED'
        ? linkedSettlement.payments.map((payment) => ({
          payment_method_code: payment.method,
          amount: payment.amount || 0,
          coupon_service_id: typeof payment.couponServiceId === 'number' ? payment.couponServiceId : null,
        }))
        : [];

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>(
        'upsert_sales_settlement',
        {
          settlement: {
            settlement_id:
              linkedSettlement && linkedSettlement.status !== 'CANCELLED'
                ? linkedSettlement.id
                : undefined,
            member_user_id: resolvedMemberId,
            guest_customer_name: resolvedMemberId ? null : (reservation.customerName.trim() || null),
            guest_customer_phone: null,
            manager_employee_id: resolvedManagerId,
            service_ids: validServiceIds,
            payments: preservedPayments,
            status: 'PROCESSING',
            reservation_ref: reservation.id,
          },
        },
      );

      await loadData();
      setActiveSettlementTab('PROCESSING');
      if (options?.closeReservationActionModal) {
        setIsReservationActionModalOpen(false);
        setReservationActionTarget(null);
      }
      if (options?.closeEntryModal) {
        setIsModalOpen(false);
        setEditingSettlement(null);
        setModalReservationTarget(null);
        resetModalForm();
      }
      alert(result.message || pt('t093'));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t094'));
    } finally {
      setIsMutating(false);
    }
  };

  const handleStartWorkFromReservation = async () => {
    if (!reservationActionTarget) return;
    await startWorkFromReservation(reservationActionTarget, {
      closeReservationActionModal: true,
    });
  };

  const handleStartWorkFromEntryReservation = async () => {
    if (!modalReservationTarget) return;
    await startWorkFromReservation(modalReservationTarget, {
      closeEntryModal: true,
    });
  };

  const handleCancelReservationFromEntry = async () => {
    if (!modalReservationTarget) return;
    const reservation = modalReservationTarget;
    const reservationId = Number(reservation.id);
    if (!Number.isFinite(reservationId) || reservationId <= 0) {
      alert(pt('t099'));
      return;
    }

    const serviceIds = reservation.procedureIds
      .map((procedureId) => Number(procedureId))
      .filter((procedureId) => Number.isFinite(procedureId) && procedureId > 0);
    if (serviceIds.length === 0) {
      alert(pt('t021'));
      return;
    }

    const designerName = getReservationManagerName(reservation).trim();
    if (!designerName) {
      alert(pt('t010'));
      return;
    }

    const customerName = getReservationCustomerName(reservation).trim()
      || selectedReservationGuestLabel
      || pt('t025');

    const linkedSettlement = settlements.find((settlement) => settlement.reservationId === reservation.id);

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>(
        'upsert_reservation_calendar_item',
        {
          item: {
            reservation_id: reservationId,
            reservation_date: reservation.date,
            start_time: reservation.time,
            customer_name: customerName,
            gender: null,
            designer_name: designerName,
            status: 'CANCELLED',
            note: null,
            service_ids: serviceIds,
          },
        },
      );

      if (linkedSettlement && linkedSettlement.status !== 'CANCELLED') {
        await invokeDbCommand<{ success: boolean; message: string }>('cancel_sales_settlement', {
          settlement_id: linkedSettlement.id,
          cancel_type: linkedSettlement.status === 'COMPLETED' ? 'PAYMENT' : 'PROCEDURE',
          cancel_reason: pt('t100'),
        });
      }

      await loadData();
      setIsModalOpen(false);
      setEditingSettlement(null);
      setModalReservationTarget(null);
      resetModalForm();
      alert(result.message || pt('t097'));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t098'));
    } finally {
      setIsMutating(false);
    }
  };

  // [동작] 신규 등록(예약 불러오기) 모드에서만 import 대상 유효성 동기화.
  // 수정 모드는 이미 저장된 예약을 바라보므로 importable 목록 기준으로 선택값을 지우면 안 된다.
  useEffect(() => {
    if (editingSettlement || modalReservationTarget) return;
    if (!selectedReservationId) return;
    if (!importableReservations.some((reservation) => reservation.id === selectedReservationId)) {
      setSelectedReservationId('');
    }
  }, [editingSettlement, importableReservations, modalReservationTarget, selectedReservationId]);

  useEffect(() => {
    if (!selectedMember) return;
    const memberPhone = selectedMember.phone === '-' ? '' : selectedMember.phone;
    // 회원 선택/변경 시 고객 표시/저장 상태를 회원 기준으로 재정렬한다.
    // (입력창, 요약 라벨, 저장 payload 일관성 유지)
    setGuestCustomerName(selectedMember.name);
    setGuestCustomerPhone(memberPhone);
    setCustomerLookupQuery(memberPhone ? `${selectedMember.name} (${memberPhone})` : selectedMember.name);
    setIsCustomerLookupOpen(false);
  }, [selectedMember]);

  // [동작] 선택 시술이 바뀌면 삭제된 시술에 연결된 쿠폰 적용 상태도 함께 정리
  useEffect(() => {
    setCouponAppliedServiceIds((prev) => prev.filter((serviceId) => selectedProcs.includes(serviceId)));
  }, [selectedProcs]);

  // [동작] 회원 선택 해제(일반 방문객 전환) 시 쿠폰 적용 정보 초기화
  useEffect(() => {
    if (selectedMember) return;
    setCouponAppliedServiceIds([]);
  }, [selectedMember]);

  // [동작] 일반 방문객은 선불권 사용 불가이므로 PREPAID/COUPON 결제라인 제거
  useEffect(() => {
    if (selectedMemberId !== 'GUEST') return;
    setPayments((prev) => prev.filter((payment) => !isBalancePaymentMethod(payment.method) && payment.method !== 'COUPON'));
  }, [selectedMemberId]);

  // [동작] 잔액만큼 결제수단 라인 1건 자동 추가
  const handleAddPayment = () => {
    if (remainingAmount <= 0) return;
    const defaultMethod =
      manualPaymentMethods.find((method) => !(selectedMemberId === 'GUEST' && isBalancePaymentMethod(method.code)))?.code
      || 'CARD';
    setPayments((prev) => [
      ...prev,
      { method: defaultMethod, amount: remainingAmount },
    ]);
  };

  // [동작] 결제 라인 삭제
  const removePayment = (index: number) => {
    setPayments((prev) => prev.filter((_, idx) => idx !== index));
  };

  // [동작] 결제 라인 필드 변경(method/amount/couponServiceId)
  const updatePayment = (
    index: number,
    field: keyof PaymentDetail,
    value: string | number | undefined,
  ) => {
    setPayments((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  // [동작] 정산 저장(작업중/결제완료)
  const handleSaveSettlement = async (status: 'PROCESSING' | 'COMPLETED') => {
    if (isCompletedSettlementReadOnly) return;
    if (!selectedManagerId) {
      alert(pt('t010'));
      return;
    }
    if (selectedProcs.length === 0) {
      alert(pt('t021'));
      return;
    }

    if (status === 'COMPLETED' && remainingAmount < 0) {
      alert(pt('t002'));
      return;
    }

    // 저장 payload에는 coupon 토글 상태에서 별도 생성한 couponPayments만 유지한다.
    const normalizedPayments = payments.filter((payment) => payment.method !== 'COUPON');

    const prepaidTotal = normalizedPayments
      .filter((payment) => isBalancePaymentMethod(payment.method))
      .reduce((sum, payment) => sum + payment.amount, 0);

    if (selectedMember && prepaidTotal > selectedMember.balance) {
      alert(pt('t036', { balance: selectedMember.balance.toLocaleString() }));
      return;
    }

    const managerId = Number(selectedManagerId);
    if (!Number.isFinite(managerId) || managerId <= 0) {
      alert(pt('t009'));
      return;
    }

    const serviceIds = selectedProcs.filter((value) => Number.isFinite(value) && value > 0);
    if (serviceIds.length === 0) {
      alert(pt('t021'));
      return;
    }

    if (couponAppliedServiceIds.length > 0 && !selectedMember) {
      alert(pt('t031'));
      return;
    }

    const parsedMemberUserId =
      selectedMemberId === 'GUEST'
        ? null
        : Number.isFinite(Number(selectedMemberId))
          ? Number(selectedMemberId)
          : null;
    const lookupValue = customerLookupQuery.trim();
    const lookupCompactValue = lookupValue.replace(/[\s()-]/g, '');
    const isLookupPhoneLike = lookupCompactValue.length >= 7 && /^\+?\d+$/.test(lookupCompactValue);

    // 비회원 저장값 정규화:
    // - 회원 선택 상태면 guest 필드는 항상 null
    // - 비회원 상태면 explicit guest 상태 우선
    // - 입력창 값만 있는 경우(매칭 실패 포함) 입력 원문을 name 또는 phone으로 추론해 저장
    //   => "조회된 고객이 없어도 입력값 그대로 저장/표시" 요구사항 대응
    const normalizedGuestCustomerName =
      parsedMemberUserId === null
        ? (
          guestCustomerName.trim()
          || (!isLookupPhoneLike ? lookupValue : '')
          || selectedReservationGuestLabel.trim()
          || null
        )
        : null;
    const normalizedGuestCustomerPhone =
      parsedMemberUserId === null
        ? (
          guestCustomerPhone.trim()
          || (isLookupPhoneLike ? lookupValue : '')
          || null
        )
        : null;

    // 쿠폰 사용은 "결제수단 COUPON + coupon_service_id" 라인으로 백엔드에 전달
    const couponPayments = couponAppliedServiceIds.map((serviceId) => ({
      payment_method_code: 'COUPON',
      amount: 0,
      coupon_service_id: serviceId,
    }));

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>(
        'upsert_sales_settlement',
        {
          settlement: {
            settlement_id: editingSettlement?.id || undefined,
            member_user_id: parsedMemberUserId,
            guest_customer_name: normalizedGuestCustomerName,
            guest_customer_phone: normalizedGuestCustomerPhone,
            manager_employee_id: managerId,
            service_ids: serviceIds,
            payments: [
              ...normalizedPayments.map((payment) => ({
                payment_method_code: payment.method,
                amount: payment.amount || 0,
                coupon_service_id: null,
              })),
              ...couponPayments,
            ],
            status,
            reservation_ref: selectedReservationId || null,
          },
        },
      );

      await loadData();
      alert(result.message || pt('t037'));
      setIsModalOpen(false);
      setEditingSettlement(null);
      setModalReservationTarget(null);
      resetModalForm();
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t038'));
    } finally {
      setIsMutating(false);
    }
  };

  // [동작] 취소 모달 열기(이미 취소된 정산은 재취소 방지)
  const handleOpenCancelModal = (settlement: Settlement) => {
    if (settlement.status === 'CANCELLED') {
      alert(pt('t024'));
      return;
    }
    setCancelTarget(settlement);
    setCancelReason('');
    setIsCancelModalOpen(true);
  };

  // [동작] 정산 취소 실행(완료 건은 결제 취소, 진행중 건은 시술 취소로 기록)
  const handleCancelSettlement = async () => {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (!reason) {
      alert(pt('t029'));
      return;
    }
    const cancelType: SettlementCancelType =
      cancelTarget.status === 'COMPLETED' ? 'PAYMENT' : 'PROCEDURE';

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>(
        'cancel_sales_settlement',
        {
          settlement_id: cancelTarget.id,
          cancel_type: cancelType,
          cancel_reason: reason,
        },
      );

      await loadData();
      alert(result.message || pt('t039'));
      setIsCancelModalOpen(false);
      setCancelTarget(null);
      setCancelReason('');
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t040'));
    } finally {
      setIsMutating(false);
    }
  };

  const settlementTabs: Array<{ key: SettlementListTab; label: string }> = [
    { key: 'RESERVATION', label: pt('t048') },
    { key: 'PROCESSING', label: pt('t047') },
    { key: 'COMPLETED', label: pt('t045') },
  ];

  const reservationActionServices = useMemo(() => {
    if (!reservationActionTarget) return [];
    return reservationActionTarget.procedureIds
      .map((procedureId) => procedures.find((procedure) => procedure.id === procedureId))
      .filter(Boolean) as Procedure[];
  }, [reservationActionTarget, procedures]);

  const reservationActionTotal = useMemo(
    () =>
      reservationActionServices.reduce(
        (acc, procedure) => ({
          price: acc.price + procedure.price,
          time: acc.time + procedure.time,
        }),
        { price: 0, time: 0 },
      ),
    [reservationActionServices],
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="h-full flex flex-col space-y-6"
    >
      <LoadingOverlay visible={isBusy} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t013')}</h1>
          <p className="text-slate-500 mt-1">{pt('t016')}</p>
        </div>
        <button
          onClick={() => handleOpenModal()} className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
        >
          <Plus size={20} />
          {pt('t041')}
        </button>
      </div>

      {/* 검색어 + 날짜로 정산 목록을 빠르게 좁히는 상단 필터 영역 */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder={pt('t006')} value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)} className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <Calendar size={18} className="text-slate-400" />
          <input
            type="date"
            value={filterDate}
            onChange={(event) => setFilterDate(event.target.value)} className="bg-transparent text-sm font-bold outline-none"
          />
        </div>
      </div>

      {/* 정산 목록 테이블: 클릭 시 수정 모달 오픈, 우측 버튼으로 취소 모달 오픈 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col flex-1">
        <div className="px-4 pt-4 border-b border-slate-100 bg-slate-50/60">
          <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1 gap-1">
            {settlementTabs.map((tab) => {
              const isActive = activeSettlementTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveSettlementTab(tab.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors ${
                    isActive
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                  <span className={`ml-1.5 ${isActive ? 'text-white/90' : 'text-slate-400'}`}>
                    {settlementTabCounts[tab.key]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[980px]">
            <thead className="bg-slate-50 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
              <tr>
                <th className="py-4 px-6">{pt('t026')}</th>
                <th className="py-4 px-6">{pt('t042')}</th>
                <th className="py-4 px-6">{pt('t011')}</th>
                <th className="py-4 px-6">{pt('t019')}</th>
                <th className="py-4 px-6">{pt('t007')}</th>
                <th className="py-4 px-6">{pt('t034')}</th>
                <th className="py-4 px-6">{pt('t043')}</th>
                <th className="py-4 px-6 text-center">{pt('t044')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {activeSettlementTab === 'RESERVATION' ? (
                searchedReservationOnly.map((reservation) => {
                  const customerName = getReservationCustomerName(reservation);
                  const managerName = getReservationManagerName(reservation) || '-';
                  const reservationServices = reservation.procedureIds
                    .map((id) => procedures.find((entry) => entry.id === id))
                    .filter(Boolean) as Procedure[];
                  const procedureNames = reservationServices.map((service) => service.name).join(', ');
                  const expectedAmount = reservationServices.reduce((sum, service) => sum + service.price, 0);
                  const expectedTime = reservationServices.reduce((sum, service) => sum + service.time, 0);
                  const statusLabel = getReservationStatusLabel(reservation.status);
                  const statusClass =
                    reservation.status === 'PROCESSING'
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-amber-100 text-amber-700';

                  return (
                    <tr
                      key={`reservation-${reservation.id}`}
                      onClick={() => handleOpenReservationActionModal(reservation)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <td className="py-4 px-6 text-xs font-bold text-slate-500">
                        {reservation.date} {reservation.time}
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <div className="size-8 rounded-full flex items-center justify-center text-[10px] font-black bg-primary/10 text-primary">
                            {customerName?.[0] || '?'}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-900">{customerName}</span>
                            <span className="text-[9px] font-black text-primary flex items-center gap-0.5">
                              <Calendar size={8} /> {pt('t048')}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-sm font-bold text-slate-700">{managerName}</td>
                      <td className="py-4 px-6 text-xs text-slate-500 max-w-[220px] truncate">{procedureNames || '-'}</td>
                      <td className="py-4 px-6">
                        <div className="text-sm font-black text-slate-900">¥{expectedAmount.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-400">{pt('t062', { count: expectedTime })}</div>
                      </td>
                      <td className="py-4 px-6">
                        <span className="text-slate-300 text-[10px]">-</span>
                      </td>
                      <td className="py-4 px-6">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${statusClass}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenReservationActionModal(reservation);
                          }}
                          disabled={isBusy}
                          className="px-2 py-1 rounded border border-primary/20 bg-primary/5 text-primary text-[10px] font-black disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {pt('t089')}
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                filteredSettlements.map((settlement) => {
                  const member =
                    settlement.memberId === 'GUEST'
                      ? null
                      : members.find((entry) => entry.id === settlement.memberId);
                  const customerName = getSettlementCustomerName(settlement, member?.name);
                  const manager = managers.find((entry) => entry.id === settlement.managerId);
                  const procedureNames = settlement.procedureIds
                    .map((id) => procedures.find((entry) => entry.id === id)?.name)
                    .filter(Boolean)
                    .join(', ');

                  const paidAmount = settlement.payments.reduce((sum, payment) => sum + payment.amount, 0);
                  const nonCouponPaidAmount = settlement.payments
                    .filter((payment) => !isCouponPaymentMethod(payment.method))
                    .reduce((sum, payment) => sum + payment.amount, 0);
                  const couponPaidAmount = settlement.payments
                    .filter((payment) => isCouponPaymentMethod(payment.method))
                    .reduce((sum, payment) => sum + payment.amount, 0);
                  // coupon 금액이 0으로 저장되는 경우가 있어 coupon_service_id 기준으로 실제 할인액을 환산
                  const couponCoveredAmount = settlement.payments
                    .filter((payment) => isCouponPaymentMethod(payment.method) && typeof payment.couponServiceId === 'number')
                    .reduce((sum, payment) => sum + (procedurePriceById.get(payment.couponServiceId as number) || 0), 0);
                  const effectiveCouponPaid = couponCoveredAmount > 0 ? couponCoveredAmount : couponPaidAmount;
                  const discount = settlement.status === 'COMPLETED'
                    ? Math.max(0, settlement.totalAmount - (nonCouponPaidAmount + effectiveCouponPaid))
                    : 0;
                  const discountPercent = settlement.totalAmount > 0 ? Math.round((discount / settlement.totalAmount) * 100) : 0;
                  const statusClass =
                    settlement.status === 'COMPLETED'
                      ? 'bg-emerald-100 text-emerald-600'
                      : settlement.status === 'CANCELLED'
                        ? 'bg-rose-100 text-rose-600'
                        : 'bg-blue-100 text-blue-600';
                  const statusLabel = getSettlementStatusLabel(settlement.status);

                  return (
                    <tr
                      key={settlement.id}
                      onClick={() => {
                        if (settlement.status !== 'CANCELLED') {
                          handleOpenModal(settlement);
                        }
                      }}
                      className={`hover:bg-slate-50 transition-colors group ${
                        settlement.status === 'CANCELLED' ? 'cursor-default' : 'cursor-pointer'
                      }`}
                    >
                      <td className="py-4 px-6 text-xs font-bold text-slate-500">{settlement.date}</td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <div
                            className={`size-8 rounded-full flex items-center justify-center text-[10px] font-black ${
                              settlement.memberId === 'GUEST' ? 'bg-slate-100 text-slate-400' : 'bg-primary/10 text-primary'
                            }`}
                          >
                            {customerName?.[0] || '?'}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-900">{customerName || '-'}</span>
                            {settlement.reservationId && (
                              <span className="text-[9px] font-black text-primary flex items-center gap-0.5">
                                <Calendar size={8} /> {pt('t048')}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-sm font-bold text-slate-700">{manager?.name || '-'}</td>
                      <td className="py-4 px-6 text-xs text-slate-500 max-w-[220px] truncate">{procedureNames || '-'}</td>
                      <td className="py-4 px-6">
                        <div className="text-sm font-black text-slate-900">¥{paidAmount.toLocaleString()}</div>
                        {discount > 0 && <div className="text-[10px] text-slate-400 line-through">¥{settlement.totalAmount.toLocaleString()}</div>}
                      </td>
                      <td className="py-4 px-6">
                        {discount > 0 ? (
                          <span className="px-2 py-0.5 bg-red-50 text-red-500 rounded text-[10px] font-black">
                            {discountPercent}% (¥{discount.toLocaleString()})
                          </span>
                        ) : (
                          <span className="text-slate-300 text-[10px]">-</span>
                        )}
                      </td>
                      <td className="py-4 px-6">
                        <span
                          className={`px-2 py-1 rounded-lg text-[10px] font-black ${statusClass}`}
                        >
                          {statusLabel}
                        </span>
                        {settlement.cancelReason && (
                          <p
                            className="mt-1 text-[10px] text-rose-600 max-w-[180px] truncate"
                            title={settlement.cancelReason}
                          >
                            {pt('t049', { reason: settlement.cancelReason })}
                          </p>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              handleOpenCancelModal(settlement);
                            }}
                            disabled={settlement.status === 'CANCELLED' || isBusy}
                            className="px-2 py-1 rounded border border-rose-200 bg-rose-50 text-rose-700 text-[10px] font-black disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {pt('t046')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
              {((activeSettlementTab === 'RESERVATION' && searchedReservationOnly.length === 0)
                || (activeSettlementTab !== 'RESERVATION' && filteredSettlements.length === 0)) && (
                <tr>
                  <td colSpan={8} className="py-20 text-center text-slate-400 font-bold">
                    {pt('t051')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isReservationActionModalOpen && reservationActionTarget && (
          <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={pt('t089')}
              onClose={handleCloseReservationActionModal}
              icon={<Calendar size={20} className="text-primary" />}
            >
              <div className="p-6 space-y-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">{pt('t026')}</p>
                    <p className="text-sm font-bold text-slate-800">
                      {reservationActionTarget.date} {reservationActionTarget.time}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">{pt('t042')}</p>
                    <p className="text-sm font-bold text-slate-800">{getReservationCustomerName(reservationActionTarget)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">{pt('t011')}</p>
                    <p className="text-sm font-bold text-slate-800">{getReservationManagerName(reservationActionTarget) || '-'}</p>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">{pt('t043')}</p>
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black ${
                      reservationActionTarget.status === 'PROCESSING'
                        ? 'bg-blue-100 text-blue-600'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                    >
                      {getReservationStatusLabel(reservationActionTarget.status)}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {pt('t019')}
                  </label>
                  {reservationActionServices.length === 0 ? (
                    <div className="text-[10px] text-slate-400 px-2 py-2 bg-slate-50 border border-dashed border-slate-200 rounded-lg">
                      {pt('t091')}
                    </div>
                  ) : (
                    reservationActionServices.map((procedure) => (
                      <div
                        key={`reservation-action-procedure-${procedure.id}`}
                        className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        <span className="text-xs font-bold text-slate-800">{procedure.name}</span>
                        <span className="text-[10px] font-bold text-slate-500">
                          {pt('t062', { count: procedure.time })} / ¥{procedure.price.toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-3 rounded-xl border border-slate-200 bg-white flex items-center justify-between">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t027')}</div>
                  <div className="text-sm font-black text-slate-900">
                    ¥{reservationActionTotal.price.toLocaleString()} / {pt('t062', { count: reservationActionTotal.time })}
                  </div>
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleCloseReservationActionModal}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all"
                    disabled={isBusy}
                  >
                    {pt('t074')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenSettlementModalFromReservation(reservationActionTarget)}
                    className="flex-1 py-2.5 bg-primary/10 text-primary rounded-xl text-sm font-bold hover:bg-primary/20 transition-all"
                    disabled={isBusy}
                  >
                    {pt('t095')}
                  </button>
                  <button
                    type="button"
                    onClick={handleStartWorkFromReservation}
                    className="flex-1 py-2.5 bg-primary text-white rounded-xl text-sm font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all disabled:opacity-60"
                    disabled={isBusy}
                  >
                    {pt('t090')}
                  </button>
                </div>
              </div>
            </DraggableModal>
          </div>
        )}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={editingSettlement ? pt('t052') : pt('t041')}
              onClose={closeSettlementModal} icon={<Scissors size={20} className="text-primary" />}
            >
              <div className="p-6 space-y-6 max-h-[85vh] overflow-y-auto custom-scrollbar">
                <fieldset
                  disabled={isBusy || isCompletedSettlementReadOnly}
                  className="space-y-6 border-0 m-0 p-0 min-w-0"
                >
                {/* 신규 등록 시 예약 정보를 선반영해 입력을 빠르게 채운다. */}
                {!editingSettlement && (
                  <div className="p-4 bg-primary/5 border border-primary/10 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-1">
                        <Calendar size={12} /> {pt('t053')}
                      </label>
                      {selectedReservationId && (
                        <button
                          onClick={() => {
                            setSelectedReservationId('');
                            setSelectedMemberId('GUEST');
                            setCustomerLookupQuery('');
                            setGuestCustomerName('');
                            setGuestCustomerPhone('');
                            setIsCustomerLookupOpen(false);
                            setSelectedManagerId('');
                            setSelectedProcs([]);
                            setModalReservationTarget(null);
                          }}
                          className="text-[10px] font-bold text-slate-400 hover:text-red-500"
                        >
                          {pt('t054')}
                        </button>
                      )}</div>
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="date"
                        value={reservationImportDate}
                        onChange={(event) => setReservationImportDate(event.target.value)} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <span className="text-[10px] font-bold text-slate-500">
                        {pt('t055', { count: importableReservations.length })}
                      </span>
                    </div>
                    <select
                      value={selectedReservationId}
                      onChange={(event) => handleImportReservation(event.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">{pt('t023')}</option>
                      {importableReservations.map((reservation) => {
                        const member = reservation.memberId
                          ? members.find((entry) => entry.id === reservation.memberId)
                          : null;
                        const customerLabel = reservation.customerName || member?.name || pt('t025');
                        const procLabel = reservation.procedureIds
                          .map((id) => procedures.find((entry) => entry.id === id)?.name)
                          .filter(Boolean)
                          .join(', ');

                        return (
                          <option key={reservation.id} value={reservation.id}>
                            [{reservation.time}] {customerLabel} - {procLabel || pt('t056')}
                          </option>
                        );
                      })}</select>
                    {selectedReservationId && <p className="text-[10px] text-primary font-medium">{pt('t001')}</p>}
                  </div>
                )}
                {/* 기본 입력: 회원/담당자 선택 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    {/* 고객 요약 라벨:
                        요청사항에 맞춰 "고객 선택" 보조 라벨 없이
                        한 줄로 고객명(전화번호)만 표시한다. */}
                    <div className="h-5 flex items-center">
                      <p className="text-sm font-semibold text-slate-700 truncate">
                        {pt('t042')}: <span className="font-black text-slate-900">{selectedCustomerSummary || pt('t025')}</span>
                      </p>
                    </div>
                    {/* 고객 검색 입력:
                        이름/전화번호 모두 입력 가능하고,
                        매칭 결과가 없어도 입력 원문은 요약 라벨 + 저장 fallback으로 사용된다. */}
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={customerLookupQuery}
                        disabled={isBusy}
                        onChange={(event) => handleCustomerLookupQueryChange(event.target.value)}
                        onFocus={() => {
                          if (!customerLookupQuery.trim()) return;
                          setIsCustomerLookupOpen(true);
                        }}
                        onBlur={() => {
                          window.setTimeout(() => setIsCustomerLookupOpen(false), 120);
                        }}
                        placeholder={pt('t101')}
                        className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-100 disabled:text-slate-500"
                      />
                      {/* 자동완성 드롭다운:
                          blur 시 바로 닫히면 클릭 선택이 끊기기 때문에
                          onBlur 지연 + onMouseDown preventDefault 조합을 사용한다. */}
                      {isCustomerLookupOpen && customerLookupQuery.trim() && (
                        <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 max-h-40 overflow-y-auto shadow-lg">
                          {customerLookupMembers.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-slate-400">{pt('t105')}</p>
                          ) : (
                            customerLookupMembers.map((member) => (
                              <button
                                key={member.id}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  handleSelectLookupMember(member);
                                }}
                                className={`w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors ${
                                  selectedMemberId === String(member.id) ? 'bg-primary/5' : ''
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
                    <p className="text-[10px] text-slate-500">{pt('t104')}</p>
                  </div>
                  <div className="space-y-1">
                    <div className="h-5 flex items-center">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t008')}</label>
                    </div>
                    <select
                      value={selectedManagerId}
                      onChange={(event) => setSelectedManagerId(event.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">{pt('t012')}</option>
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.name} ({manager.role})
                        </option>
                      ))}</select>
                  </div>
                </div>

                {/* 시술 선택: 카테고리 선택 후 해당 카테고리 시술만 추가 */}
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t020')}</label>
                  <div className="flex gap-2">
                    <select
                      value={selectedCategory}
                      onChange={(event) => setSelectedCategory(event.target.value)} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none"
                    >
                      {categories.map((category) => (
                        <option key={category.code} value={category.code}>
                          {category.name}
                        </option>
                      ))}</select>
                    <select
                      onChange={(event) => {
                        if (!event.target.value) return;
                        const id = parseInt(event.target.value, 10);
                        if (!Number.isFinite(id) || id <= 0) return;
                        if (!selectedProcs.includes(id)) {
                          setSelectedProcs((prev) => [...prev, id]);
                        }
                        event.target.value = '';
                      }}
                      className="flex-[2] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none"
                    >
                      <option value="">{pt('t018')}</option>
                      {procedures
                        .filter((procedure) => procedure.categoryCode === selectedCategory)
                        .map((procedure) => (
                          <option key={procedure.id} value={procedure.id}>
                            {procedure.name} (¥{procedure.price.toLocaleString()})
                          </option>
                        ))}</select>
                  </div>

                  {/* 선택된 시술 목록: 쿠폰 적용 가능 여부와 잔여수량을 동시에 표시 */}
                  <div className="space-y-2">
                    {selectedProcs.length === 0 && (
                      <div className="text-[10px] text-slate-400 px-2 py-2 bg-slate-50 border border-dashed border-slate-200 rounded-lg">
                        {pt('t057')}
                      </div>
                    )} {selectedProcs.map((id) => {
                      const procedure = procedures.find((entry) => entry.id === id);
                      if (!procedure) return null;

                      const couponRemaining = selectedMemberCouponMap.get(id) || 0;
                      const appliedCouponCount = couponAppliedCountMap.get(id) || 0;
                      const visibleCouponRemaining = Math.max(couponRemaining - appliedCouponCount, 0);
                      const isCouponApplied = couponAppliedSet.has(id);
                      const canUseCoupon = !!selectedMember && (visibleCouponRemaining > 0 || isCouponApplied);

                      return (
                        <div
                          key={id}
                          className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-800">{procedure.name}</span>
                            <span className={`text-[10px] font-bold ${isCouponApplied ? 'text-emerald-600' : 'text-slate-500'}`}>
                              {isCouponApplied ? pt('t058') : `¥${procedure.price.toLocaleString()}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {selectedMember ? (
                              canUseCoupon ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCouponAppliedServiceIds((prev) =>
                                      prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id],
                                    )
                                  }
                                  className={`px-2 py-1 rounded text-[10px] font-black border transition-colors ${
                                    isCouponApplied
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : 'bg-white text-slate-600 border-slate-200 hover:border-primary hover:text-primary'
                                  }`}
                                >
                                  {isCouponApplied ? pt('t059') : pt('t060')} ({pt('t061', { count: visibleCouponRemaining })})
                                </button>
                              ) : (
                                <span className="text-[10px] font-bold text-slate-400">{pt('t032')}</span>
                              )
                            ) : (
                              <span className="text-[10px] font-bold text-slate-400">{pt('t035')}</span>
                            )}<button
                              type="button"
                              onClick={() => setSelectedProcs((prev) => prev.filter((entry) => entry !== id))} className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-500"
                              aria-label={pt('t017')} >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}</div>
                </div>

                {/* 요약 영역: 총액, 쿠폰 할인, 최종 결제대상 금액 */}
                <div className="p-4 bg-slate-900 rounded-2xl text-white space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1 text-slate-400">
                        <Clock size={14} />
                        <span className="text-xs font-bold">{pt('t062', { count: totals.time })}</span>
                      </div>
                      <div className="text-lg font-black">¥{totals.price.toLocaleString()}</div>
                    </div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t027')}</div>
                  </div>

                  {couponDiscountAmount > 0 && (
                    <div className="flex justify-between items-center pt-2 border-t border-white/10">
                      <div className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">{pt('t033')}</div>
                      <div className="text-sm font-black text-emerald-300">- ¥{couponDiscountAmount.toLocaleString()}</div>
                    </div>
                  )}<div className="flex justify-between items-center pt-2 border-t border-white/10">
                    <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{pt('t022')}</div>
                    <div className="text-sm font-black text-white">¥{payableAmount.toLocaleString()}</div>
                  </div>

                  {paidTotal > 0 && (
                    <div className="flex justify-between items-center pt-1">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t015')}</div>
                      <div className="text-xs font-bold text-slate-200">¥{paidTotal.toLocaleString()}</div>
                    </div>
                  )}</div>

                {/* 결제 입력: 라인 추가/삭제, 수단별 제약(PREPAID) 검증 UI */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t004')}</label>
                    <button
                      onClick={handleAddPayment}
                      disabled={remainingAmount <= 0}
                      className="flex items-center gap-1 text-[10px] font-black text-primary disabled:opacity-30"
                    >
                      <Plus size={12} /> {pt('t063')}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {payments.map((payment, index) => (
                      <div key={`${payment.method}-${index}`} className="flex gap-2 items-start p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="flex-1 space-y-2">
                          <div className="flex gap-2">
                            <select
                              value={payment.method}
                              onChange={(event) => updatePayment(index, 'method', event.target.value as PaymentMethodCode)} className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded text-xs font-bold outline-none"
                            >
                              {manualPaymentMethods.map((method) => {
                                const isDisabled = isBalancePaymentMethod(method.code) && selectedMemberId === 'GUEST';
                                return (
                                  <option key={method.code} value={method.code} disabled={isDisabled}>
                                    {getPaymentMethodLabel(method.code, method.name)}
                                  </option>
                                );
                              })}</select>
                            <input
                              type="number"
                              value={payment.amount}
                              onChange={(event) => updatePayment(index, 'amount', parseInt(event.target.value, 10) || 0)} className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded text-xs font-black outline-none"
                            />
                            <button onClick={() => removePayment(index)} className="p-1.5 text-slate-300 hover:text-red-500">
                              <Trash2 size={14} />
                            </button>
                          </div>

                          {isBalancePaymentMethod(payment.method) && selectedMember && (
                            <div className="flex items-center justify-between px-2 py-1 bg-emerald-50 rounded text-[10px] font-bold text-emerald-700">
                              <span>{pt('t064', { balance: selectedMember.balance.toLocaleString() })}</span>
                              {selectedMember.balance < payment.amount && (
                                <span className="text-red-500 flex items-center gap-0.5">
                                  <AlertCircle size={10} /> {pt('t065')}
                                </span>
                              )}</div>
                          )}</div>
                      </div>
                    ))}</div>

                  <div className="flex items-center justify-between p-3 rounded-xl border border-dashed border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400">{pt('t003')}</div>
                    <div className="flex items-center gap-3">
                      <div className="text-[10px] font-bold text-slate-500">{pt('t066', { amount: paidTotal.toLocaleString() })}</div>
                      <div
                        className={`text-[10px] font-black ${
                          remainingAmount === 0 ? 'text-emerald-500' : remainingAmount > 0 ? 'text-red-500' : 'text-amber-500'
                        }`}
                      >
                        {remainingAmount === 0
                          ? pt('t067')
                          : remainingAmount > 0
                            ? pt('t068', { amount: remainingAmount.toLocaleString() })
                            : pt('t069', { amount: Math.abs(remainingAmount).toLocaleString() })}
                      </div>
                    </div>
                  </div>
                </div>
                </fieldset>

                {/* 저장 동작: 일반 모드는 작업/결제 저장, 예약 상세입력 모드는 예약취소/작업시작 */}
                <div className="flex gap-3 pt-4">
                  {isCompletedSettlementReadOnly ? (
                    <button
                      type="button"
                      onClick={closeSettlementModal}
                      className="w-full py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all"
                      disabled={isBusy}
                    >
                      {pt('t074')}
                    </button>
                  ) : isReservationEntryMode ? (
                    <>
                      <button
                        type="button"
                        onClick={handleCancelReservationFromEntry}
                        className="flex-1 py-3 bg-rose-50 text-rose-700 rounded-xl text-sm font-bold border border-rose-200 hover:bg-rose-100 transition-all disabled:opacity-50"
                        disabled={isBusy}
                      >
                        {pt('t096')}
                      </button>
                      <button
                        type="button"
                        onClick={handleStartWorkFromEntryReservation}
                        className="flex-1 py-3 bg-primary text-white rounded-xl text-sm font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all disabled:opacity-50"
                        disabled={isBusy}
                      >
                        {pt('t090')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleSaveSettlement('PROCESSING')} className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all"
                      >
                        {pt('t070')}
                      </button>
                      <button
                        onClick={() => handleSaveSettlement('COMPLETED')} className="flex-1 py-3 bg-primary text-white rounded-xl text-sm font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
                      >
                        {pt('t071')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </DraggableModal>
          </div>
        )}
        {/* 취소 모달: 취소 사유를 받아 cancel_sales_settlement 호출 */}
        {isCancelModalOpen && cancelTarget && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={pt('t030')} onClose={() => {
                if (isMutating) return;
                setIsCancelModalOpen(false);
                setCancelTarget(null);
                setCancelReason('');
              }}
              icon={<AlertCircle size={20} className="text-rose-500" />}
            >
              <div className="p-6 space-y-4">
                <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">
                    {pt('t072', { id: cancelTarget.id, date: cancelTarget.date })}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {pt('t073')}
                  </label>
                  <textarea
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)} placeholder={pt('t028')} rows={4}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-rose-200 resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => {
                      if (isMutating) return;
                      setIsCancelModalOpen(false);
                      setCancelTarget(null);
                      setCancelReason('');
                    }}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all"
                    disabled={isMutating}
                  >
                    {pt('t074')}
                  </button>
                  <button
                    onClick={handleCancelSettlement}
                    className="flex-1 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-rose-200 hover:bg-rose-700 transition-all disabled:opacity-60"
                    disabled={isMutating}
                  >
                    {pt('t075')}
                  </button>
                </div>
              </div>
            </DraggableModal>
          </div>
        )}</AnimatePresence>
    </motion.div>
  );
}

