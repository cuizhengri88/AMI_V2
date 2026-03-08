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

type Member = { id: number; name: string; phone: string; balance: number };
type Manager = { id: number; name: string; role: string };
type Procedure = { id: number; name: string; categoryName: string; price: number; time: number };
type PaymentMethod = { code: string; name: string; order: number };
type PaymentDetail = { method: string; amount: number; couponServiceId?: number };
type SettlementStatus = 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
type HistoryEntryType = 'SETTLEMENT' | 'POINT_RECHARGE';
type Settlement = {
  id: number;
  sourceId: number;
  entryType: HistoryEntryType;
  date: string;
  memberId: number | 'GUEST';
  managerId: number | null;
  procedureIds: number[];
  totalAmount: number;
  totalTime: number;
  payments: PaymentDetail[];
  status: SettlementStatus;
  rechargeType?: 'BALANCE' | 'COUPON';
  reservationId?: string;
  cancelReason?: string;
  cancelledAt?: string;
};

const FALLBACK_PAYMENT_METHODS: PaymentMethod[] = [
  { code: 'CASH', name: 'CASH', order: 1 },
  { code: 'CARD', name: 'CARD', order: 2 },
  { code: 'WECHAT', name: 'WECHAT', order: 3 },
  { code: 'ALIPAY', name: 'ALIPAY', order: 4 },
  { code: 'PREPAID', name: 'PREPAID', order: 5 },
  { code: 'COUPON', name: 'COUPON', order: 6 },
];

const DEFAULT_CATEGORY_TEXT_KEYS = [
  't053', // 커트
  't054', // 파마
  't055', // 염색
  't056', // 기타
] as const;

const STATUS_TEXT_KEY_BY_CODE: Record<SettlementStatus, string> = {
  PROCESSING: 't017', // 작업중
  COMPLETED: 't036', // 결제 완료
  CANCELLED: 't037', // 취소
};

const DETAIL_STATUS_TEXT_KEY_BY_CODE: Record<SettlementStatus, string> = {
  PROCESSING: 't017', // 작업중
  COMPLETED: 't036', // 결제 완료
  CANCELLED: 't057', // 취소됨
};

const ENTRY_TYPE_TEXT_KEY_BY_CODE: Record<HistoryEntryType, string> = {
  SETTLEMENT: 't038', // 정산
  POINT_RECHARGE: 't039', // 포인트충전
};

const RECHARGE_TYPE_TEXT_KEY_BY_CODE: Record<'BALANCE' | 'COUPON', string> = {
  BALANCE: 't040', // 포인트 충전
  COUPON: 't041', // 쿠폰 충전
};

const PAYMENT_METHOD_TEXT_KEY_BY_CODE: Record<string, string> = {
  CASH: 't073', // 현금
  CARD: 't074', // 카드
  WECHAT: 't075', // 위챗페이
  ALIPAY: 't076', // 알리페이
  PREPAID: 't077', // 충전금 차감
  MEMBERSHIP: 't077', // 충전금 차감
  COUPON: 't078', // 쿠폰 사용
};

const LEGACY_COUPON_PAYMENT_LABEL = '쿠폰결재건';

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function monthStartIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function toSettlementStatus(value: string): SettlementStatus {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'CANCELLED') return 'CANCELLED';
  if (normalized === 'COMPLETED') return 'COMPLETED';
  return 'PROCESSING';
}

function toDateOnly(raw: string) {
  if (!raw) return '';
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function formatDateTime(raw: string) {
  if (!raw) return '-';
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString(undefined, { hour12: false });
}

function formatCurrency(value: number) {
  return `¥${value.toLocaleString()}`;
}

function toDateTime(raw: string) {
  if (!raw) return null;
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toTimestamp(raw: string) {
  return toDateTime(raw)?.getTime() ?? Number.MIN_SAFE_INTEGER;
}

function isCouponPaymentMethod(method: string) {
  return method?.trim().toUpperCase() === 'COUPON';
}

function isBalancePaymentMethod(method: string) {
  const normalized = method?.trim().toUpperCase();
  return normalized === 'PREPAID' || normalized === 'MEMBERSHIP';
}

function getTotalPaidAmount(entry: Settlement) {
  return entry.payments.reduce((sum, payment) => sum + payment.amount, 0);
}

function getActualSalesAmount(entry: Settlement) {
  if (entry.entryType === 'POINT_RECHARGE') return getTotalPaidAmount(entry);
  return entry.payments
    .filter((payment) => !isCouponPaymentMethod(payment.method) && !isBalancePaymentMethod(payment.method))
    .reduce((sum, payment) => sum + payment.amount, 0);
}

function getCouponCoveredAmount(entry: Settlement, procedurePriceById: Map<number, number>) {
  if (entry.entryType !== 'SETTLEMENT') return 0;
  return entry.payments
    .filter((payment) => isCouponPaymentMethod(payment.method) && typeof payment.couponServiceId === 'number')
    .reduce((sum, payment) => sum + (procedurePriceById.get(payment.couponServiceId as number) || 0), 0);
}

function getDiscountAmount(entry: Settlement, procedurePriceById: Map<number, number>) {
  if (entry.entryType !== 'SETTLEMENT' || entry.status !== 'COMPLETED') return 0;
  const nonCouponPaidAmount = entry.payments
    .filter((payment) => !isCouponPaymentMethod(payment.method))
    .reduce((sum, payment) => sum + payment.amount, 0);
  const couponPaidAmount = entry.payments
    .filter((payment) => isCouponPaymentMethod(payment.method))
    .reduce((sum, payment) => sum + payment.amount, 0);
  const couponCoveredAmount = Math.min(getCouponCoveredAmount(entry, procedurePriceById), entry.totalAmount);
  const effectiveCouponPaid = couponCoveredAmount > 0 ? couponCoveredAmount : couponPaidAmount;
  return Math.max(0, entry.totalAmount - (nonCouponPaidAmount + effectiveCouponPaid));
}

function normalizeRechargeType(value?: string) {
  const raw = value?.trim() || '';
  const normalized = raw.toUpperCase();
  if (normalized === 'COUPON' || raw.includes('쿠폰')) return 'COUPON';
  return 'BALANCE';
}

function normalizePaymentMethodCode(value: string) {
  const raw = value?.trim() || '';
  const normalized = raw.toUpperCase();
  if (normalized === 'COUPON' || raw === LEGACY_COUPON_PAYMENT_LABEL || raw.includes('쿠폰')) return 'COUPON';
  return normalized;
}

function isActualSalesExcludedPaymentCode(code: string) {
  const normalized = code?.trim().toUpperCase();
  return normalized === 'PREPAID' || normalized === 'MEMBERSHIP';
}

export default function SalesHistoryPage() {
  const pt = usePageText('user_management_sales_history');
  const [members, setMembers] = useState<Member[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(FALLBACK_PAYMENT_METHODS);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [searchMember, setSearchMember] = useState('');
  const [selectedManager, setSelectedManager] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedProcedure, setSelectedProcedure] = useState('');
  const [selectedPayment, setSelectedPayment] = useState('');
  const [selectedHistory, setSelectedHistory] = useState<Settlement | null>(null);
  const detailDragControls = useDragControls();
  const initialLoadDoneRef = useRef(false);

  const getStatusLabelByCode = (status: SettlementStatus, detail = false) => {
    const key = detail ? DETAIL_STATUS_TEXT_KEY_BY_CODE[status] : STATUS_TEXT_KEY_BY_CODE[status];
    return pt(key);
  };

  const getEntryTypeLabel = (entryType: HistoryEntryType) => pt(ENTRY_TYPE_TEXT_KEY_BY_CODE[entryType]);

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

  const categories = useMemo(() => {
    const labels = Array.from(new Set(procedures.map((entry) => entry.categoryName).filter(Boolean)));
    return labels.length > 0 ? labels : DEFAULT_CATEGORY_TEXT_KEYS.map((key) => pt(key));
  }, [procedures, pt]);

  const getMemberInfo = (memberId: number | 'GUEST') => {
    if (memberId === 'GUEST') return { name: pt('t015'), phone: '-' };
    const member = members.find((entry) => entry.id === memberId);
    return { name: member?.name || '-', phone: member?.phone || '-' };
  };

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [codeResult, managerResult, procedureResult, memberResult, settlementResult] = await Promise.all([
        invokeDbCommand<{
          details: Array<{ group: string; code: string; name: string; order: number; use_yn: 'Y' | 'N' }>;
        }>('get_common_code_management_data'),
        invokeDbCommand<{
          employees: Array<{ employee_id: number; employee_name: string; role_name: string | null; role_id: string | null }>;
        }>('get_employee_management_data'),
        invokeDbCommand<{
          items: Array<{
            service_id: number;
            category_name: string;
            service_name: string;
            unit_price: number;
            duration_minutes: number;
            use_yn: 'Y' | 'N';
          }>;
        }>('get_service_catalog_data'),
        invokeDbCommand<{
          members: Array<{ user_id: number; user_name: string; phone: string | null; point_balance: number }>;
          histories: Array<{
            id: number;
            action_type: 'RECHARGE' | 'USE';
            user_id: number;
            created_at: string;
            recharge_type: string;
            amount: number | null;
            payment_method_code: string;
            is_cancelled: boolean;
          }>;
        }>('get_member_point_management_data'),
        invokeDbCommand<{
          settlements: Array<{
            settlement_id: number;
            settlement_datetime: string;
            member_user_id: number | null;
            manager_employee_id: number;
            service_ids: number[];
            total_amount: number;
            total_time_minutes: number;
            payments: Array<{ payment_method_code: string; amount: number; coupon_service_id: number | null }>;
            status: string;
            reservation_ref: string | null;
            cancel_reason: string | null;
            cancelled_at: string | null;
          }>;
        }>('get_sales_settlement_data'),
      ]);

      setMembers((memberResult.members || []).map((entry) => ({
        id: entry.user_id,
        name: entry.user_name,
        phone: entry.phone || '',
        balance: entry.point_balance || 0,
      })));

      setManagers((managerResult.employees || []).map((entry) => ({
        id: entry.employee_id,
        name: entry.employee_name,
        role: entry.role_name || entry.role_id || '-',
      })));

      setProcedures((procedureResult.items || [])
        .filter((entry) => entry.use_yn === 'Y')
        .map((entry) => ({
          id: entry.service_id,
          name: entry.service_name,
          categoryName: entry.category_name,
          price: entry.unit_price,
          time: entry.duration_minutes,
        })));

      const methods = (codeResult.details || [])
        .filter((entry) => entry.group === 'PAYMENT_METHOD' && entry.use_yn === 'Y')
        .map((entry) => ({ code: entry.code, name: entry.name, order: entry.order }))
        .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code));
      setPaymentMethods(methods.length > 0 ? methods : FALLBACK_PAYMENT_METHODS);

      const settlementRows: Settlement[] = (settlementResult.settlements || []).map((entry) => ({
        id: entry.settlement_id,
        sourceId: entry.settlement_id,
        entryType: 'SETTLEMENT',
        date: entry.settlement_datetime,
        memberId: entry.member_user_id ?? 'GUEST',
        managerId: entry.manager_employee_id,
        procedureIds: entry.service_ids || [],
        totalAmount: entry.total_amount,
        totalTime: entry.total_time_minutes,
        payments: (entry.payments || []).map((payment) => ({
          method: payment.payment_method_code,
          amount: payment.amount,
          couponServiceId: payment.coupon_service_id ?? undefined,
        })),
        status: toSettlementStatus(entry.status),
        reservationId: entry.reservation_ref || undefined,
        cancelReason: entry.cancel_reason || undefined,
        cancelledAt: entry.cancelled_at || undefined,
      }));

      const pointRechargeRows: Settlement[] = (memberResult.histories || [])
        .filter((entry) =>
          entry.action_type === 'RECHARGE'
          && !entry.is_cancelled
          && Number(entry.amount || 0) > 0)
        .map((entry) => ({
          id: -entry.id,
          sourceId: entry.id,
          entryType: 'POINT_RECHARGE',
          date: entry.created_at,
          memberId: entry.user_id,
          managerId: null,
          procedureIds: [],
          totalAmount: Number(entry.amount || 0),
          totalTime: 0,
          payments: [{ method: entry.payment_method_code, amount: Number(entry.amount || 0) }],
          status: 'COMPLETED',
          rechargeType: normalizeRechargeType(entry.recharge_type),
        }));

      setSettlements(
        [...settlementRows, ...pointRechargeRows]
          .sort((a, b) => {
            const timeDiff = toTimestamp(b.date) - toTimestamp(a.date);
            if (timeDiff !== 0) return timeDiff;
            return b.id - a.id;
          }),
      );
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t042'));
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

  const getPaymentMethodName = (code: string) => {
    const normalizedCode = normalizePaymentMethodCode(code);
    const commonCodeName = paymentMethodNameMap.get(normalizedCode)?.trim();
    if (commonCodeName) return commonCodeName === LEGACY_COUPON_PAYMENT_LABEL ? pt('t071') : commonCodeName;
    return getPaymentMethodLabelByCode(normalizedCode, code);
  };

  const filteredHistory = useMemo(() => {
    const keyword = searchMember.trim().toLowerCase();
    const searchPhone = searchMember.replace(/-/g, '').trim();
    return settlements.filter((entry) => {
      const member = entry.memberId === 'GUEST'
        ? { name: pt('t015'), phone: '' }
        : members.find((memberItem) => memberItem.id === entry.memberId) || { name: '-', phone: '' };
      const procedureRows = entry.procedureIds.map((id) => procedures.find((procedure) => procedure.id === id)).filter(Boolean) as Procedure[];
      const day = toDateOnly(entry.date);

      const matchesDate = (!!day || (!startDate && !endDate))
        && (!startDate || day >= startDate)
        && (!endDate || day <= endDate);
      const matchesMember = keyword.length === 0
        || member.name.toLowerCase().includes(keyword)
        || member.phone.replace(/-/g, '').includes(searchPhone);
      const matchesManager = selectedManager === ''
        || (entry.managerId != null && String(entry.managerId) === selectedManager);
      const matchesCategory = selectedCategory === ''
        || (entry.entryType === 'SETTLEMENT'
          && procedureRows.some((procedure) => procedure.categoryName === selectedCategory));
      const matchesProcedure = selectedProcedure === ''
        || (entry.entryType === 'SETTLEMENT' && entry.procedureIds.includes(Number(selectedProcedure)));
      const matchesPayment = selectedPayment === '' || entry.payments.some((payment) => payment.method === selectedPayment);

      return matchesDate && matchesMember && matchesManager && matchesCategory && matchesProcedure && matchesPayment;
    });
  }, [settlements, searchMember, members, procedures, startDate, endDate, selectedManager, selectedCategory, selectedProcedure, selectedPayment, pt]);

  const stats = useMemo(() => {
    return filteredHistory.reduce((acc, entry) => {
      if (entry.status === 'CANCELLED') return acc;
      acc.totalSales += getActualSalesAmount(entry);
      if (entry.entryType === 'SETTLEMENT') {
        acc.totalDiscount += getDiscountAmount(entry, procedurePriceById);
        acc.count += 1;
      }
      return acc;
    }, { totalSales: 0, totalDiscount: 0, count: 0 });
  }, [filteredHistory, procedurePriceById]);

  const paymentStats = useMemo(() => {
    const totals = new Map<string, number>();
    const counts = new Map<string, number>();

    filteredHistory.forEach((entry) => {
      if (entry.status === 'CANCELLED') return;

      entry.payments.forEach((payment) => {
        const normalizedCode = normalizePaymentMethodCode(payment.method);
        if (normalizedCode === 'COUPON') {
          counts.set('COUPON', (counts.get('COUPON') || 0) + 1);
          return;
        }
        totals.set(normalizedCode, (totals.get(normalizedCode) || 0) + payment.amount);
      });
    });

    const orderedCodes = paymentMethods
      .map((entry) => normalizePaymentMethodCode(entry.code))
      .filter((code, index, source) => source.indexOf(code) === index);

    totals.forEach((_, code) => {
      if (!orderedCodes.includes(code)) {
        orderedCodes.push(code);
      }
    });

    return orderedCodes.map((code) => {
      const commonCodeName = paymentMethodNameMap.get(code)?.trim();
      let name = code;
      if (commonCodeName) {
        name = commonCodeName === LEGACY_COUPON_PAYMENT_LABEL ? pt('t071') : commonCodeName;
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

  const resetFilters = () => {
    setStartDate(monthStartIso());
    setEndDate(todayIso());
    setSearchMember('');
    setSelectedManager('');
    setSelectedCategory('');
    setSelectedProcedure('');
    setSelectedPayment('');
  };

  const exportCsv = async () => {
    const csvHeader = [
      pt('t063'),
      pt('t064'),
      pt('t016'),
      pt('t065'),
      pt('t066'),
      pt('t007'),
      pt('t010'),
      pt('t067'),
      pt('t068'),
      pt('t069'),
      pt('t014'),
      pt('t070'),
    ];

    const rows = filteredHistory.map((entry) => {
      const member = getMemberInfo(entry.memberId);
      const managerName = entry.entryType === 'POINT_RECHARGE'
        ? '-'
        : managers.find((manager) => manager.id === entry.managerId)?.name || '-';
      const procedureNames = entry.entryType === 'POINT_RECHARGE'
        ? getPointRechargeLabel(entry)
        : entry.procedureIds.map((id) => procedures.find((procedure) => procedure.id === id)?.name).filter(Boolean).join(', ') || '-';
      const paymentNames = entry.payments.map((payment) => getPaymentMethodName(payment.method)).join(', ');
      const statusLabel = entry.entryType === 'POINT_RECHARGE'
        ? pt('t058', { type: getPointRechargeLabel(entry) })
        : getStatusLabelByCode(entry.status);
      return [
        getEntryTypeLabel(entry.entryType),
        entry.sourceId,
        formatDateTime(entry.date),
        member.name,
        member.phone || '-',
        managerName,
        procedureNames,
        paymentNames,
        statusLabel,
        entry.totalAmount,
        getActualSalesAmount(entry),
        getDiscountAmount(entry, procedurePriceById),
      ];
    });
    const result = await downloadCsvFile({
      filename: `sales-history-${todayIso()}.csv`,
      headers: csvHeader,
      rows,
    });

    if (!result.success && !result.cancelled) {
      alert('파일 다운로드에 실패했습니다.');
      return;
    }

    if (result.method === 'tauri' && result.outputPath) {
      alert(`파일 저장 완료\n${result.outputPath}`);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="max-w-7xl mx-auto space-y-6 pb-20">
      <LoadingOverlay visible={isLoading} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t008')}</h1>
          <p className="text-slate-500 mt-1">{pt('t004')}</p>
        </div>
        <button onClick={() => { void exportCsv(); }} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all">
          <Download size={18} />
          {pt('t043')}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-800 font-bold"><Filter size={18} className="text-primary" />{pt('t044')}</div>
          <button onClick={resetFilters} className="text-xs font-bold text-slate-400 hover:text-primary flex items-center gap-1"><RefreshCw size={12} />{pt('t033')}</button>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="space-y-2 lg:col-span-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Calendar size={12} />{pt('t021')}</label>
            <div className="flex items-center gap-2">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20" />
              <span className="text-slate-300 font-bold">~</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><User size={12} />{pt('t035')}</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input type="text" placeholder={pt('t002')} value={searchMember} onChange={(e) => setSearchMember(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><TrendingUp size={12} />{pt('t006')}</label>
            <select value={selectedManager} onChange={(e) => setSelectedManager(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">{pt('t018')}</option>
              {managers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.role})</option>)}</select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Tag size={12} /> {pt('t045')}</label>
            <select value={selectedCategory} onChange={(e) => { setSelectedCategory(e.target.value); setSelectedProcedure(''); }} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">{pt('t046')}</option>
              {categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Scissors size={12} />{pt('t011')}</label>
            <select value={selectedProcedure} onChange={(e) => setSelectedProcedure(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">{pt('t019')}</option>
              {procedures.filter((entry) => selectedCategory === '' || entry.categoryName === selectedCategory).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><CreditCard size={12} />{pt('t023')}</label>
            <select value={selectedPayment} onChange={(e) => setSelectedPayment(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">{pt('t020')}</option>
              {paymentMethods.map((entry) => <option key={entry.code} value={entry.code}>{getPaymentMethodName(entry.code)}</option>)}</select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4"><div className="size-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center"><TrendingUp size={24} /></div><div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t027')}</p><h3 className="text-xl font-black text-slate-900">{formatCurrency(stats.totalSales)}</h3></div></div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4"><div className="size-12 bg-red-50 text-red-500 rounded-xl flex items-center justify-center"><Tag size={24} /></div><div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t029')}</p><h3 className="text-xl font-black text-slate-900">{formatCurrency(stats.totalDiscount)}</h3></div></div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4"><div className="size-12 bg-blue-50 text-blue-500 rounded-xl flex items-center justify-center"><Scissors size={24} /></div><div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t025')}</p><h3 className="text-xl font-black text-slate-900">{stats.count}{pt('t047')}</h3></div></div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
            <CreditCard size={20} />
          </div>
          <div>
            <p className="text-sm font-black text-slate-900">{pt('t080')}</p>
            <p className="text-xs text-slate-500">{pt('t081')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {paymentStats.map((entry) => (
            <div key={entry.code} className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center gap-3">
              <div className="size-10 bg-white text-emerald-500 rounded-lg border border-slate-200 flex items-center justify-center">
                <CreditCard size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t023')}</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-black text-slate-600 truncate">{entry.name}</p>
                  {entry.isActualSalesExcluded && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-black whitespace-nowrap">
                      {pt('t079')}
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-black text-slate-900">
                  {entry.isCouponStat
                    ? `${entry.count.toLocaleString()}${pt('t082')}`
                    : formatCurrency(entry.amount)}
                </h3>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-2 text-[11px] text-slate-400 border-b border-slate-100 bg-slate-50/60">
          {pt('t048')}
        </div>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[1120px]">
            <thead className="bg-slate-50 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
              <tr>
                <th className="py-4 px-6">{pt('t016')}</th>
                <th className="py-4 px-6">{pt('t049')}</th>
                <th className="py-4 px-6">{pt('t050')}</th>
                <th className="py-4 px-6">{pt('t007')}</th>
                <th className="py-4 px-6">{pt('t010')}</th>
                <th className="py-4 px-6">{pt('t023')}</th>
                <th className="py-4 px-6">{pt('t009')}</th>
                <th className="py-4 px-6">{pt('t014')}</th>
                <th className="py-4 px-6">{pt('t034')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredHistory.map((entry) => {
                const member = getMemberInfo(entry.memberId);
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
                          {member.name[0]}
                        </div>
                        <span className="text-sm font-bold text-slate-900">{member.name}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-600 font-mono">{member.phone || '-'}</td>
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
                  <td colSpan={9} className="py-20 text-center text-slate-400 font-bold">{pt('t022')}</td>
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
                    <h2 className="text-xl font-black text-slate-900">{selectedHistory.entryType === 'POINT_RECHARGE' ? pt('t051') : pt('t052')}</h2>
                    <p className="text-xs text-slate-500 font-bold">{selectedHistory.entryType === 'POINT_RECHARGE' ? pt('t053') : pt('t054')}: {selectedHistory.sourceId}</p>
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
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t001')}</p>
                    <div className="flex items-center gap-2 text-slate-900 font-bold"><Clock size={14} className="text-slate-400" />{formatDateTime(selectedHistory.date)}</div>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t024')}</p>
                    <div className={`flex items-center gap-2 font-bold ${selectedHistory.status === 'COMPLETED' ? 'text-emerald-500' : selectedHistory.status === 'CANCELLED' ? 'text-rose-500' : 'text-blue-500'}`}>
                      {selectedHistory.status === 'COMPLETED' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                      {selectedHistory.entryType === 'POINT_RECHARGE'
                        ? pt('t072')
                        : getStatusLabelByCode(selectedHistory.status, true)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6 bg-slate-50 rounded-2xl">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{pt('t003')}</p>
                    {selectedHistory.memberId === 'GUEST' ? (
                      <p className="text-sm font-bold text-slate-900">{pt('t015')}</p>
                    ) : (
                      <div>
                        <p className="text-sm font-black text-slate-900">{getMemberInfo(selectedHistory.memberId).name}</p>
                        <p className="text-xs text-slate-500 font-bold">{getMemberInfo(selectedHistory.memberId).phone}</p>
                      </div>
                    )}</div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{pt('t006')}</p>
                    {selectedHistory.entryType === 'POINT_RECHARGE' ? (
                      <div>
                        <p className="text-sm font-black text-slate-900">-</p>
                        <p className="text-xs text-slate-500 font-bold">{pt('t058', { type: getPointRechargeLabel(selectedHistory) })}</p>
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
                    {selectedHistory.entryType === 'POINT_RECHARGE' ? pt('t057') : pt('t010')}
                  </p>
                  {selectedHistory.entryType === 'POINT_RECHARGE' ? (
                    <div className="p-3 border border-slate-100 rounded-xl bg-emerald-50/40">
                      <p className="text-sm font-bold text-slate-900">{getPointRechargeLabel(selectedHistory)} ({getRechargeTypeDisplayLabel(selectedHistory.rechargeType)})</p>
                      <p className="text-[10px] text-slate-500 font-bold">{pt('t013')}</p>
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
                                <p className="text-sm font-bold text-slate-900">{procedure?.name || pt('t059')}</p>
                                {isCouponProcedure && (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-700">{pt('t032')}</span>
                                )}</div>
                              <p className="text-[10px] text-slate-400 font-bold">{procedure?.categoryName || '-'} | {procedure?.time || 0}{pt('t060')}</p>
                            </div>
                            <p className="text-sm font-black text-slate-900">{formatCurrency(procedure?.price || 0)}</p>
                          </div>
                        );
                      })}</div>
                  )}</div>

                <div className="bg-slate-900 text-white rounded-2xl p-6 space-y-3">
                  {selectedHistory.entryType === 'POINT_RECHARGE' ? (
                    <>
                      <div className="flex justify-between text-sm font-bold text-slate-400"><span>{pt('t031')}</span><span>{formatCurrency(selectedHistory.totalAmount)}</span></div>
                      <div className="h-px bg-white/10" />
                      <div className="flex justify-between items-end"><span className="text-sm font-bold text-slate-400">{pt('t012')}</span><span className="text-2xl font-black text-primary">{formatCurrency(getActualSalesAmount(selectedHistory))}</span></div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between text-sm font-bold text-slate-400"><span>{pt('t026')}</span><span>{formatCurrency(selectedHistory.totalAmount)}</span></div>
                      <div className="flex justify-between text-sm font-bold text-red-400"><span>{pt('t028')}</span><span>- {formatCurrency(getDiscountAmount(selectedHistory, procedurePriceById))}</span></div>
                      <div className="h-px bg-white/10" />
                      <div className="flex justify-between text-sm font-bold text-slate-400"><span>{pt('t030')}</span><span>{formatCurrency(getTotalPaidAmount(selectedHistory))}</span></div>
                      <div className="flex justify-between items-end"><span className="text-sm font-bold text-slate-400">{pt('t012')}</span><span className="text-2xl font-black text-primary">{formatCurrency(getActualSalesAmount(selectedHistory))}</span></div>
                    </>
                  )}</div>

                {selectedHistory.entryType === 'SETTLEMENT' && selectedHistory.cancelReason && (
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-sm text-rose-900 font-medium">
                    {pt('t061', { reason: selectedHistory.cancelReason })}
                    {selectedHistory.cancelledAt && <p className="text-xs text-rose-700 mt-2">{pt('t062', { date: formatDateTime(selectedHistory.cancelledAt) })}</p>}
                  </div>
                )}</div>

              <div className="p-6 border-t border-slate-100 bg-slate-50">
                <button onClick={() => setSelectedHistory(null)} className="w-full py-3 bg-white border border-slate-200 rounded-xl text-sm font-black text-slate-600 hover:bg-slate-100 transition-all">{pt('t005')}</button>
              </div>
            </motion.div>
          </div>
        )}</AnimatePresence>
    </motion.div>
  );
}

