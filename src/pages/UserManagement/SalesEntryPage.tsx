import React, { useEffect, useMemo, useState } from 'react';
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
  Loader2,
} from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';

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

type Settlement = {
  id: number;
  date: string;
  memberId: number | 'GUEST';
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
  { code: 'CASH', name: '현금', order: 1 },
  { code: 'CARD', name: '카드', order: 2 },
  { code: 'WECHAT', name: '위챗페이', order: 3 },
  { code: 'ALIPAY', name: '알리페이', order: 4 },
  { code: 'PREPAID', name: '충전금 차감', order: 5 },
  { code: 'COUPON', name: '쿠폰 사용', order: 6 },
];

function todayIso() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
        onPointerDown={(event) => dragControls.start(event)}
        className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 cursor-move active:cursor-grabbing"
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
  // [상태] 기준 데이터(회원/직원/시술/결제수단/정산) 조회 결과
  const [members, setMembers] = useState<Member[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>(FALLBACK_PAYMENT_METHODS);
  const [todayReservations, setTodayReservations] = useState<Reservation[]>(EMPTY_RESERVATIONS);
  const [settlements, setSettlements] = useState<Settlement[]>([]);

  // [상태] 로딩/저장 중 UI 제어
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSettlement, setEditingSettlement] = useState<Settlement | null>(null);

  // [상태] 목록 검색 조건
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState(todayIso());

  // [상태] 모달 입력값
  const [selectedMemberId, setSelectedMemberId] = useState<string | 'GUEST'>('GUEST');
  const [selectedManagerId, setSelectedManagerId] = useState<string>('');
  const [selectedProcs, setSelectedProcs] = useState<number[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('커트');
  const [payments, setPayments] = useState<PaymentDetail[]>([]);
  const [selectedReservationId, setSelectedReservationId] = useState<string>('');
  const [reservationImportDate, setReservationImportDate] = useState<string>(todayIso());
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Settlement | null>(null);
  const [cancelType, setCancelType] = useState<SettlementCancelType>('PROCEDURE');
  const [cancelReason, setCancelReason] = useState('');

  const isBusy = isLoading || isMutating;

  // [계산] 시술 데이터에서 카테고리 목록 생성
  const categories = useMemo(() => {
    const labels = Array.from(
      new Set(procedures.map((procedure) => procedure.categoryName).filter((label) => !!label)),
    );
    return labels.length > 0 ? labels : ['커트', '파마', '염색', '기타'];
  }, [procedures]);

  // [로직] 화면 진입 시 필요한 모든 기준 데이터/정산 데이터를 DB에서 조회
  const loadData = async () => {
    try {
      setIsLoading(true);
      const commonCodeResult = await invokeDbCommand<{
        success: boolean;
        message: string;
        details: Array<{
          group: string;
          code: string;
          name: string;
          order: number;
          use_yn: 'Y' | 'N';
        }>;
      }>('get_common_code_management_data');

      const managerResult = await invokeDbCommand<{
        success: boolean;
        message: string;
        employees: Array<{
          employee_id: number;
          employee_name: string;
          role_name: string | null;
          role_id: string | null;
        }>;
      }>('get_employee_management_data');

      const procedureResult = await invokeDbCommand<{
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
      }>('get_service_catalog_data');

      const memberResult = await invokeDbCommand<{
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
      }>('get_member_point_management_data');

      const settlementResult = await invokeDbCommand<{
        success: boolean;
        message: string;
        settlements: Array<{
          settlement_id: number;
          settlement_datetime: string;
          member_user_id: number | null;
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
      }>('get_sales_settlement_data');

      const reservationResult = await invokeDbCommand<{
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
      }>('get_reservation_calendar_data');

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

      // [매핑] 공통코드 PAYMENT_METHOD -> 결제수단 선택 모델
      const mappedPaymentMethods: PaymentMethodOption[] = (commonCodeResult.details || [])
        .filter((detail) => detail.group === 'PAYMENT_METHOD' && detail.use_yn === 'Y')
        .map((detail) => ({
          code: detail.code,
          name: detail.name,
          order: detail.order,
        }))
        .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code));

      // [매핑] 정산 조회 결과 -> 목록/수정 모델
      const mappedSettlements: Settlement[] = (settlementResult.settlements || []).map((settlement) => ({
        id: settlement.settlement_id,
        date: settlement.settlement_datetime,
        memberId: settlement.member_user_id ?? 'GUEST',
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
      }));

      // [매핑] 예약 조회 결과 -> 신규 정산의 "예약 불러오기" 모델
      const mappedReservations: Reservation[] = (reservationResult.reservations || []).map((reservation) => {
        const customerName = reservation.customer_name?.trim() || '';
        const designerName = reservation.designer_name?.trim() || '';
        const matchedMember = mappedMembers.find((member) => member.name.trim() === customerName);
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
      setPaymentMethods(mappedPaymentMethods.length > 0 ? mappedPaymentMethods : FALLBACK_PAYMENT_METHODS);
      setSettlements(mappedSettlements);
      setTodayReservations(mappedReservations);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '매출/정산 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(selectedCategory)) {
      setSelectedCategory(categories[0]);
    }
  }, [categories, selectedCategory]);

  // [계산] 선택된 회원 상세 정보(일반 방문객은 null)
  const selectedMember = useMemo(() => {
    if (selectedMemberId === 'GUEST') return null;
    const memberId = Number(selectedMemberId);
    return members.find((member) => member.id === memberId) || null;
  }, [selectedMemberId, members]);

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

  // [계산] 목록 검색(고객명/전화번호/담당자 + 날짜)
  const filteredSettlements = useMemo(() => {
    return settlements.filter((settlement) => {
      const member =
        settlement.memberId === 'GUEST'
          ? { name: '일반 방문객', phone: '' }
          : members.find((entry) => entry.id === settlement.memberId);
      const manager = managers.find((entry) => entry.id === settlement.managerId);

      const query = searchTerm.trim().toLowerCase();
      const matchesSearch =
        query.length === 0 ||
        !!member?.name.toLowerCase().includes(query) ||
        !!member?.phone.includes(searchTerm) ||
        !!manager?.name.toLowerCase().includes(query);

      const matchesDate = settlement.date.startsWith(filterDate);
      return matchesSearch && matchesDate;
    });
  }, [members, managers, settlements, searchTerm, filterDate]);

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

  // [계산] 결제 금액 합계/미수(또는 초과) 금액
  const paidTotal = useMemo(() => payments.reduce((sum, payment) => sum + payment.amount, 0), [payments]);
  const remainingAmount = totals.price - paidTotal;

  // [동작] 신규 작성 시 모달 입력값 초기화
  const resetModalForm = () => {
    setSelectedReservationId('');
    setSelectedMemberId('GUEST');
    setSelectedManagerId('');
    setSelectedProcs([]);
    setSelectedCategory(categories[0] || '커트');
    setPayments([]);
  };

  // [동작] 모달 열기(신규/수정 모드 분기)
  const handleOpenModal = (settlement?: Settlement) => {
    if (settlement) {
      setEditingSettlement(settlement);
      setSelectedReservationId(settlement.reservationId || '');
      setReservationImportDate(settlement.date.slice(0, 10));
      setSelectedMemberId(
        settlement.memberId === 'GUEST' ? 'GUEST' : String(settlement.memberId),
      );
      setSelectedManagerId(String(settlement.managerId));
      setSelectedProcs(settlement.procedureIds);
      setPayments(settlement.payments);
    } else {
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

    const validProcedureIds = reservation.procedureIds.filter(
      (procedureId) => procedures.some((procedure) => procedure.id === procedureId),
    );

    setSelectedReservationId(reservationId);
    setSelectedMemberId(
      reservation.memberId && reservation.memberId > 0
        ? String(reservation.memberId)
        : 'GUEST',
    );
    setSelectedManagerId(
      reservation.managerId && reservation.managerId > 0
        ? String(reservation.managerId)
        : '',
    );
    setSelectedProcs(validProcedureIds);

    const firstProcedure = procedures.find((procedure) => procedure.id === validProcedureIds[0]);
    if (firstProcedure) {
      setSelectedCategory(firstProcedure.categoryName);
    }

    if (validProcedureIds.length === 0) {
      alert('선택한 예약의 시술 항목이 현재 시술 목록에 없어 자동 반영되지 않았습니다.');
    }
  };

  // [동작] 예약 기준 날짜가 바뀌어 현재 선택 예약이 목록에서 사라지면 선택값만 정리한다.
  useEffect(() => {
    if (!selectedReservationId) return;
    if (!importableReservations.some((reservation) => reservation.id === selectedReservationId)) {
      setSelectedReservationId('');
    }
  }, [selectedReservationId, importableReservations]);

  // [동작] 잔액만큼 결제수단 라인 1건 자동 추가
  const handleAddPayment = () => {
    if (remainingAmount <= 0) return;
    setPayments((prev) => [
      ...prev,
      { method: paymentMethods[0]?.code || 'CARD', amount: remainingAmount },
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
    if (!selectedManagerId) {
      alert('담당 디자이너를 선택해주세요.');
      return;
    }
    if (selectedProcs.length === 0) {
      alert('시술 항목을 선택해주세요.');
      return;
    }

    if (status === 'COMPLETED' && remainingAmount < 0) {
      alert('결제 금액이 총액을 초과했습니다. 금액을 확인해주세요.');
      return;
    }

    const prepaidTotal = payments
      .filter((payment) => payment.method === 'PREPAID')
      .reduce((sum, payment) => sum + payment.amount, 0);

    if (selectedMember && prepaidTotal > selectedMember.balance) {
      alert(`충전 잔액이 부족합니다. (보유: ₩${selectedMember.balance.toLocaleString()})`);
      return;
    }

    const managerId = Number(selectedManagerId);
    if (!Number.isFinite(managerId) || managerId <= 0) {
      alert('담당 디자이너 값이 올바르지 않습니다.');
      return;
    }

    const serviceIds = selectedProcs.filter((value) => Number.isFinite(value) && value > 0);
    if (serviceIds.length === 0) {
      alert('시술 항목을 선택해주세요.');
      return;
    }

    if (payments.some((payment) => payment.method === 'COUPON' && !payment.couponServiceId)) {
      alert('쿠폰 결제는 쿠폰 시술을 선택해야 합니다.');
      return;
    }

    const parsedMemberUserId =
      selectedMemberId === 'GUEST'
        ? null
        : Number.isFinite(Number(selectedMemberId))
          ? Number(selectedMemberId)
          : null;

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>(
        'upsert_sales_settlement',
        {
          settlement: {
            settlement_id: editingSettlement?.id || undefined,
            member_user_id: parsedMemberUserId,
            manager_employee_id: managerId,
            service_ids: serviceIds,
            payments: payments.map((payment) => ({
              payment_method_code: payment.method,
              amount: payment.amount || 0,
              coupon_service_id:
                payment.method === 'COUPON'
                  ? payment.couponServiceId || null
                  : null,
            })),
            status,
            reservation_ref: selectedReservationId || null,
          },
        },
      );

      await loadData();
      alert(result.message || '정산 저장이 완료되었습니다.');
      setIsModalOpen(false);
      setEditingSettlement(null);
      resetModalForm();
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '정산 저장에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleOpenCancelModal = (settlement: Settlement, type: SettlementCancelType) => {
    if (settlement.status === 'CANCELLED') {
      alert('이미 취소된 매출입니다.');
      return;
    }
    if (type === 'PAYMENT' && settlement.status !== 'COMPLETED') {
      alert('결제취소는 결제완료 상태에서만 가능합니다.');
      return;
    }
    setCancelTarget(settlement);
    setCancelType(type);
    setCancelReason('');
    setIsCancelModalOpen(true);
  };

  const handleCancelSettlement = async () => {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (!reason) {
      alert('취소 사유를 입력해주세요.');
      return;
    }

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
      alert(result.message || '취소 처리 완료');
      setIsCancelModalOpen(false);
      setCancelTarget(null);
      setCancelReason('');
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '취소 처리에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="h-full flex flex-col space-y-6"
    >
      {isBusy && (
        <div className="fixed inset-0 z-[70] bg-slate-900/20 backdrop-blur-[1px] flex items-center justify-center">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg flex items-center gap-2">
            <Loader2 size={18} className="animate-spin text-primary" />
            <span className="text-sm font-semibold text-slate-700">Loading...</span>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">매출 등록</h1>
          <p className="text-slate-500 mt-1">시술 내역 조회 및 결제 정산을 관리합니다.</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
        >
          <Plus size={20} />
          신규 시술 등록
        </button>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="고객명, 전화번호, 담당자 검색..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <Calendar size={18} className="text-slate-400" />
          <input
            type="date"
            value={filterDate}
            onChange={(event) => setFilterDate(event.target.value)}
            className="bg-transparent text-sm font-bold outline-none"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col flex-1">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[980px]">
            <thead className="bg-slate-50 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
              <tr>
                <th className="py-4 px-6">일시</th>
                <th className="py-4 px-6">고객명</th>
                <th className="py-4 px-6">담당자</th>
                <th className="py-4 px-6">시술 항목</th>
                <th className="py-4 px-6">금액</th>
                <th className="py-4 px-6">할인</th>
                <th className="py-4 px-6">상태</th>
                <th className="py-4 px-6 text-center">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredSettlements.map((settlement) => {
                const member = settlement.memberId === 'GUEST' ? { name: '일반 방문객' } : members.find((entry) => entry.id === settlement.memberId);
                const manager = managers.find((entry) => entry.id === settlement.managerId);
                const procedureNames = settlement.procedureIds
                  .map((id) => procedures.find((entry) => entry.id === id)?.name)
                  .filter(Boolean)
                  .join(', ');

                const paidAmount = settlement.payments.reduce((sum, payment) => sum + payment.amount, 0);
                const discount = settlement.status === 'COMPLETED' ? settlement.totalAmount - paidAmount : 0;
                const discountPercent = settlement.totalAmount > 0 ? Math.round((discount / settlement.totalAmount) * 100) : 0;
                const statusClass =
                  settlement.status === 'COMPLETED'
                    ? 'bg-emerald-100 text-emerald-600'
                    : settlement.status === 'CANCELLED'
                      ? 'bg-rose-100 text-rose-600'
                      : 'bg-blue-100 text-blue-600';
                const statusLabel =
                  settlement.status === 'COMPLETED'
                    ? '결제완료'
                    : settlement.status === 'CANCELLED'
                      ? '취소'
                      : '작업중';

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
                          {member?.name?.[0] || '?'}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-slate-900">{member?.name}</span>
                          {settlement.reservationId && (
                            <span className="text-[9px] font-black text-primary flex items-center gap-0.5">
                              <Calendar size={8} /> 예약건
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm font-bold text-slate-700">{manager?.name || '-'}</td>
                    <td className="py-4 px-6 text-xs text-slate-500 max-w-[220px] truncate">{procedureNames || '-'}</td>
                    <td className="py-4 px-6">
                      <div className="text-sm font-black text-slate-900">₩{paidAmount.toLocaleString()}</div>
                      {discount > 0 && <div className="text-[10px] text-slate-400 line-through">₩{settlement.totalAmount.toLocaleString()}</div>}
                    </td>
                    <td className="py-4 px-6">
                      {discount > 0 ? (
                        <span className="px-2 py-0.5 bg-red-50 text-red-500 rounded text-[10px] font-black">
                          {discountPercent}% (₩{discount.toLocaleString()})
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
                          사유: {settlement.cancelReason}
                        </p>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenCancelModal(settlement, 'PAYMENT');
                          }}
                          disabled={settlement.status !== 'COMPLETED' || isBusy}
                          className="px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-700 text-[10px] font-black disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          결제취소
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenCancelModal(settlement, 'PROCEDURE');
                          }}
                          disabled={settlement.status === 'CANCELLED' || isBusy}
                          className="px-2 py-1 rounded border border-rose-200 bg-rose-50 text-rose-700 text-[10px] font-black disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          시술취소
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredSettlements.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-20 text-center text-slate-400 font-bold">
                    조회된 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={editingSettlement ? '시술 정보 수정' : '신규 시술 등록'}
              onClose={() => setIsModalOpen(false)}
              icon={<Scissors size={20} className="text-primary" />}
            >
              <div className="p-6 space-y-6 max-h-[85vh] overflow-y-auto custom-scrollbar">
                {!editingSettlement && (
                  <div className="p-4 bg-primary/5 border border-primary/10 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-1">
                        <Calendar size={12} /> 예약 불러오기
                      </label>
                      {selectedReservationId && (
                        <button
                          onClick={() => {
                            setSelectedReservationId('');
                            setSelectedMemberId('GUEST');
                            setSelectedManagerId('');
                            setSelectedProcs([]);
                          }}
                          className="text-[10px] font-bold text-slate-400 hover:text-red-500"
                        >
                          초기화
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="date"
                        value={reservationImportDate}
                        onChange={(event) => setReservationImportDate(event.target.value)}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      <span className="text-[10px] font-bold text-slate-500">
                        예약 {importableReservations.length}건
                      </span>
                    </div>
                    <select
                      value={selectedReservationId}
                      onChange={(event) => handleImportReservation(event.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">예약 건을 선택하세요 (선택 시 자동 입력)</option>
                      {importableReservations.map((reservation) => {
                        const member = reservation.memberId
                          ? members.find((entry) => entry.id === reservation.memberId)
                          : null;
                        const customerLabel = member?.name || reservation.customerName || '일반 방문객';
                        const procLabel = reservation.procedureIds
                          .map((id) => procedures.find((entry) => entry.id === id)?.name)
                          .filter(Boolean)
                          .join(', ');

                        return (
                          <option key={reservation.id} value={reservation.id}>
                            [{reservation.time}] {customerLabel} - {procLabel || '시술 미매핑'}
                          </option>
                        );
                      })}
                    </select>
                    {selectedReservationId && <p className="text-[10px] text-primary font-medium">* 예약 정보가 자동으로 입력되었습니다.</p>}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">고객 선택</label>
                    <select
                      value={selectedMemberId}
                      onChange={(event) => setSelectedMemberId(event.target.value as string | 'GUEST')}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="GUEST">일반 방문객</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name} ({member.phone})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">담당 디자이너</label>
                    <select
                      value={selectedManagerId}
                      onChange={(event) => setSelectedManagerId(event.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">디자이너 선택</option>
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.name} ({manager.role})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">시술 항목 추가</label>
                  <div className="flex gap-2">
                    <select
                      value={selectedCategory}
                      onChange={(event) => setSelectedCategory(event.target.value)}
                      className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none"
                    >
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
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
                      <option value="">시술 선택</option>
                      {procedures
                        .filter((procedure) => procedure.categoryName === selectedCategory)
                        .map((procedure) => (
                          <option key={procedure.id} value={procedure.id}>
                            {procedure.name} (₩{procedure.price.toLocaleString()})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {selectedProcs.map((id) => {
                      const procedure = procedures.find((entry) => entry.id === id);
                      return (
                        <div
                          key={id}
                          className="flex items-center gap-2 px-2 py-1 bg-primary/5 border border-primary/10 rounded-lg text-[10px] font-bold text-primary"
                        >
                          {procedure?.name}
                          <button onClick={() => setSelectedProcs((prev) => prev.filter((entry) => entry !== id))} className="hover:text-red-500">
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-4 bg-slate-900 rounded-2xl text-white space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1 text-slate-400">
                        <Clock size={14} />
                        <span className="text-xs font-bold">{totals.time}분</span>
                      </div>
                      <div className="text-lg font-black">₩{totals.price.toLocaleString()}</div>
                    </div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">총 시술 합계</div>
                  </div>

                  {remainingAmount > 0 && paidTotal > 0 && (
                    <div className="flex justify-between items-center pt-2 border-t border-white/10">
                      <div className="text-[10px] font-black text-red-400 uppercase tracking-widest">할인 적용액</div>
                      <div className="text-sm font-black text-red-400">
                        - ₩{remainingAmount.toLocaleString()} ({totals.price > 0 ? Math.round((remainingAmount / totals.price) * 100) : 0}%)
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">결제 수단 등록</label>
                    <button
                      onClick={handleAddPayment}
                      disabled={remainingAmount <= 0}
                      className="flex items-center gap-1 text-[10px] font-black text-primary disabled:opacity-30"
                    >
                      <Plus size={12} /> 추가
                    </button>
                  </div>

                  <div className="space-y-2">
                    {payments.map((payment, index) => (
                      <div key={`${payment.method}-${index}`} className="flex gap-2 items-start p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="flex-1 space-y-2">
                          <div className="flex gap-2">
                            <select
                              value={payment.method}
                              onChange={(event) => updatePayment(index, 'method', event.target.value as PaymentMethodCode)}
                              className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded text-xs font-bold outline-none"
                            >
                              {paymentMethods.map((method) => {
                                const isDisabled = (method.code === 'PREPAID' || method.code === 'COUPON') && selectedMemberId === 'GUEST';
                                return (
                                  <option key={method.code} value={method.code} disabled={isDisabled}>
                                    {method.name}
                                  </option>
                                );
                              })}
                            </select>
                            <input
                              type="number"
                              value={payment.amount}
                              onChange={(event) => updatePayment(index, 'amount', parseInt(event.target.value, 10) || 0)}
                              className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded text-xs font-black outline-none"
                            />
                            <button onClick={() => removePayment(index)} className="p-1.5 text-slate-300 hover:text-red-500">
                              <Trash2 size={14} />
                            </button>
                          </div>

                          {payment.method === 'PREPAID' && selectedMember && (
                            <div className="flex items-center justify-between px-2 py-1 bg-emerald-50 rounded text-[10px] font-bold text-emerald-700">
                              <span>현재 잔액: ₩{selectedMember.balance.toLocaleString()}</span>
                              {selectedMember.balance < payment.amount && (
                                <span className="text-red-500 flex items-center gap-0.5">
                                  <AlertCircle size={10} /> 잔액 부족
                                </span>
                              )}
                            </div>
                          )}

                          {payment.method === 'COUPON' && selectedMember && (
                            <select
                              value={payment.couponServiceId || ''}
                              onChange={(event) =>
                                updatePayment(
                                  index,
                                  'couponServiceId',
                                  parseInt(event.target.value, 10) || undefined,
                                )
                              }
                              className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-[10px] font-bold outline-none"
                            >
                              <option value="">쿠폰 선택</option>
                              {selectedMember.coupons.map((coupon) => (
                                <option
                                  key={`${selectedMember.id}-${coupon.serviceId}`}
                                  value={coupon.serviceId}
                                >
                                  {coupon.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl border border-dashed border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400">결제 상태</div>
                    <div className="flex items-center gap-3">
                      <div className="text-[10px] font-bold text-slate-500">수납: ₩{paidTotal.toLocaleString()}</div>
                      <div
                        className={`text-[10px] font-black ${
                          remainingAmount === 0 ? 'text-emerald-500' : remainingAmount > 0 ? 'text-red-500' : 'text-amber-500'
                        }`}
                      >
                        {remainingAmount === 0
                          ? '결제 완료'
                          : remainingAmount > 0
                            ? `미수: ₩${remainingAmount.toLocaleString()}`
                            : `초과: ₩${Math.abs(remainingAmount).toLocaleString()}`}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => handleSaveSettlement('PROCESSING')}
                    className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all"
                  >
                    작업중 저장
                  </button>
                  <button
                    onClick={() => handleSaveSettlement('COMPLETED')}
                    className="flex-1 py-3 bg-primary text-white rounded-xl text-sm font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
                  >
                    결제 완료 처리
                  </button>
                </div>
              </div>
            </DraggableModal>
          </div>
        )}

        {isCancelModalOpen && cancelTarget && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={cancelType === 'PAYMENT' ? '결제취소 처리' : '시술취소 처리'}
              onClose={() => {
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
                    대상 정산: #{cancelTarget.id} / {cancelTarget.date}
                  </p>
                  <p className="mt-1">
                    취소 유형: {cancelType === 'PAYMENT' ? '결제취소' : '시술취소'}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    취소 사유
                  </label>
                  <textarea
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                    placeholder="취소 사유를 입력하세요."
                    rows={4}
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
                    닫기
                  </button>
                  <button
                    onClick={handleCancelSettlement}
                    className="flex-1 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-rose-200 hover:bg-rose-700 transition-all disabled:opacity-60"
                    disabled={isMutating}
                  >
                    취소 확정
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
