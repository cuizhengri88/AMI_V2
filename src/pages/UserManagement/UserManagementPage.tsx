import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Users, UserPlus, Mail, MapPin, Phone, FileText, Search, Edit2, X, GripHorizontal, Trash2, Loader2, Database, Calendar, CreditCard, Clock3 } from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';

type User = {
  user_id: number;
  name: string;
  email?: string;
  gender?: string;
  phone?: string;
  address?: string;
  remarks?: string;
};

type FormData = {
  user_id?: number;
  name: string;
  email?: string;
  gender?: string;
  phone?: string;
  address?: string;
  remarks?: string;
};

type MemberPointCoupon = {
  service_id: number;
  service_name: string;
  count: number;
};

type MemberPointMember = {
  user_id: number;
  user_name: string;
  phone: string | null;
  point_balance: number;
  coupons: MemberPointCoupon[];
};

type SalesSettlementPayment = {
  payment_method_code: string;
  amount: number;
  coupon_service_id: number | null;
};

type SalesSettlement = {
  settlement_id: number;
  settlement_datetime: string;
  member_user_id: string | null;
  guest_customer_name?: string | null;
  guest_customer_phone?: string | null;
  manager_employee_id: number;
  service_ids: number[];
  total_amount: number;
  payments: SalesSettlementPayment[];
  status: string;
  reservation_ref: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
};

type ReservationService = {
  service_name: string;
};

type Reservation = {
  reservation_id: number;
  reservation_date: string;
  start_time: string;
  customer_name: string;
  designer_name: string;
  status: string;
  note: string | null;
  services: ReservationService[];
};

type Employee = {
  employee_id: number;
  employee_name: string;
};

type ServiceCatalogItem = {
  service_id: number;
  service_name: string;
};

type CommonCodeDetail = {
  group: string;
  code: string;
  name: string;
  use_yn: 'Y' | 'N';
};

type MemberTreatmentHistoryRow = {
  history_key: string;
  datetime: string;
  manager_name: string;
  service_names: string[];
  payment_labels: string[];
  total_amount: number | null;
  status: string;
  cancel_reason: string | null;
  cancelled_at: string | null;
  source: 'SETTLEMENT' | 'RESERVATION';
};

type MemberReservationHistoryRow = {
  reservation_id: number;
  datetime: string;
  status: string;
  designer_name: string;
  service_names: string[];
  note: string | null;
  is_linked: boolean;
};

function formatCurrency(value: number | null | undefined) {
  return `¥${Number(value || 0).toLocaleString()}`;
}

function toTimestamp(raw: string | null | undefined) {
  if (!raw) return Number.MIN_SAFE_INTEGER;
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return Number.MIN_SAFE_INTEGER;
  return parsed.getTime();
}

function formatDateTime(raw: string | null | undefined) {
  if (!raw) return '-';
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString(undefined, { hour12: false });
}

function formatReservationDateTime(date: string | null | undefined, time: string | null | undefined) {
  const dateValue = (date || '').trim();
  const timeValue = (time || '').trim();
  if (!dateValue && !timeValue) return '-';
  if (!dateValue) return timeValue || '-';
  if (!timeValue) return dateValue;
  return `${dateValue} ${timeValue}`;
}

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

function isCompletedReservationStatus(status?: string | null) {
  const normalized = (status || '').trim().toUpperCase();
  return normalized === 'COMPLETED' || normalized === '완료';
}

function isCompletedSettlementStatus(status?: string | null) {
  const normalized = (status || '').trim().toUpperCase();
  return normalized === 'COMPLETED';
}

export default function UserManagementPage() {
  const pt = usePageText('user_management_user_management');
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchText, setSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<FormData>({ name: '', email: '', gender: '' });
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [selectedHistoryUser, setSelectedHistoryUser] = useState<User | null>(null);
  const [memberPointBalance, setMemberPointBalance] = useState(0);
  const [memberCoupons, setMemberCoupons] = useState<MemberPointCoupon[]>([]);
  const [memberTreatmentHistories, setMemberTreatmentHistories] = useState<MemberTreatmentHistoryRow[]>([]);
  const [memberReservationHistories, setMemberReservationHistories] = useState<MemberReservationHistoryRow[]>([]);
  const [hasNameMatchedReservation, setHasNameMatchedReservation] = useState(false);
  const [expandedServiceHistoryKey, setExpandedServiceHistoryKey] = useState<string | null>(null);

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const result = await invokeDbCommand<{ success: boolean; users: User[] }>('get_user_management_data');
      setUsers(result.users || []);
      setFilteredUsers(result.users || []);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '회원 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    const normalizedSearchText = searchText.trim().toLowerCase();
    const normalizedSearchPhone = searchText.replace(/\D/g, '');
    const filtered = users.filter((user) => {
      const nameMatched = user.name.toLowerCase().includes(normalizedSearchText);
      const phoneMatched =
        normalizedSearchPhone.length > 0 &&
        (user.phone || '').replace(/\D/g, '').includes(normalizedSearchPhone);
      return nameMatched || phoneMatched;
    });
    setFilteredUsers(filtered);
  }, [searchText, users]);

  const normalizeGenderForForm = (gender?: string) => {
    const normalized = (gender || '').trim().toUpperCase();
    if (normalized === 'M' || normalized === 'MALE' || normalized === '남' || normalized === '남성') return 'M';
    if (normalized === 'F' || normalized === 'FEMALE' || normalized === '여' || normalized === '여성') return 'F';
    return '';
  };

  const handleAddClick = () => {
    setModalMode('add');
    setFormData({ name: '', email: '', gender: '' });
    setIsModalOpen(true);
  };

  const handleEditClick = (user: User) => {
    setModalMode('edit');
    setFormData({ ...user, email: user.email || '', gender: normalizeGenderForForm(user.gender) });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      alert(pt('t001'));
      return;
    }

    try {
      setIsMutating(true);
      await invokeDbCommand('upsert_user_management', {
        user: formData,
      });
      await loadUsers();
      setIsModalOpen(false);
      alert(modalMode === 'add' ? '회원이 추가되었습니다.' : '회원이 수정되었습니다.');
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '저장에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async (userId: number) => {
    if (!window.confirm(pt('t003'))) return;
    try {
      setIsMutating(true);
      await invokeDbCommand('delete_user_management', { user_id: userId });
      await loadUsers();
      alert(pt('t006'));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const getGenderLabel = (gender?: string) => {
    const normalized = (gender || '').trim().toUpperCase();
    if (normalized === 'M') return pt('t009');
    if (normalized === 'F') return pt('t010');
    return gender?.trim() || '-';
  };

  const getSettlementStatusLabel = (status: string) => {
    const normalized = status?.trim().toUpperCase();
    if (normalized === 'COMPLETED') return pt('t053');
    if (normalized === 'PROCESSING') return pt('t054');
    if (normalized === 'CANCELLED') return pt('t046');
    return pt('t047');
  };

  const getReservationStatusLabel = (status: string) => {
    const normalized = status?.trim().toUpperCase();
    if (normalized === 'RESERVED') return pt('t044');
    if (normalized === 'COMPLETED') return pt('t045');
    if (normalized === 'CANCELLED') return pt('t046');
    return status?.trim() || pt('t047');
  };

  const resetHistoryState = () => {
    setHistoryError('');
    setMemberPointBalance(0);
    setMemberCoupons([]);
    setMemberTreatmentHistories([]);
    setMemberReservationHistories([]);
    setHasNameMatchedReservation(false);
    setExpandedServiceHistoryKey(null);
  };

  const toggleServiceList = (historyKey: string) => {
    setExpandedServiceHistoryKey((prev) => (prev === historyKey ? null : historyKey));
  };

  const loadMemberHistory = async (user: User) => {
    const targetUserId = user.user_id;
    setIsHistoryLoading(true);
    resetHistoryState();

    try {
      const [
        pointResult,
        settlementResult,
        reservationResult,
        employeeResult,
        serviceResult,
        commonCodeResult,
      ] = await Promise.all([
        invokeDbCommand<{
          members: MemberPointMember[];
        }>('get_member_point_management_data'),
        invokeDbCommand<{
          settlements: SalesSettlement[];
        }>('get_sales_settlement_data'),
        invokeDbCommand<{
          reservations: Reservation[];
        }>('get_reservation_calendar_data'),
        invokeDbCommand<{
          employees: Employee[];
        }>('get_employee_management_data'),
        invokeDbCommand<{
          items: ServiceCatalogItem[];
        }>('get_service_catalog_data'),
        invokeDbCommand<{
          details: CommonCodeDetail[];
        }>('get_common_code_management_data'),
      ]);

      const memberSnapshot = (pointResult.members || []).find((entry) => entry.user_id === targetUserId);
      setMemberPointBalance(Number(memberSnapshot?.point_balance || 0));
      setMemberCoupons(memberSnapshot?.coupons || []);

      const managerNameById = new Map((employeeResult.employees || []).map((entry) => [entry.employee_id, entry.employee_name]));
      const serviceNameById = new Map((serviceResult.items || []).map((entry) => [entry.service_id, entry.service_name]));
      const paymentMethodNameByCode = new Map(
        (commonCodeResult.details || [])
          .filter((entry) => entry.group === 'PAYMENT_METHOD' && entry.use_yn === 'Y')
          .map((entry) => [entry.code.trim().toUpperCase(), entry.name]),
      );

      const nameMatchedReservationIdSet = new Set<number>();
      (reservationResult.reservations || []).forEach((entry) => {
        if (
          isMatchedByNameOrPhone(
            entry.customer_name,
            null,
            user.name,
            user.phone,
          )
        ) {
          nameMatchedReservationIdSet.add(entry.reservation_id);
        }
      });

      const matchedSettlements = (settlementResult.settlements || [])
        .filter((entry) => {
          const reservationId = Number(entry.reservation_ref || 0);
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
            if (/^\d+$/.test(memberIdentifier) && Number(memberIdentifier) === targetUserId) {
              return true;
            }
            if (isMatchedByNameOrPhone(memberIdentifier, memberIdentifier, user.name, user.phone)) {
              return true;
            }
          }
          return isMatchedByNameOrPhone(
            entry.guest_customer_name,
            entry.guest_customer_phone,
            user.name,
            user.phone,
          );
        });

      const settlementTreatments = matchedSettlements
        .sort((a, b) => (toTimestamp(b.settlement_datetime) - toTimestamp(a.settlement_datetime)) || (b.settlement_id - a.settlement_id))
        .map((entry): MemberTreatmentHistoryRow => {
          const serviceNames = (entry.service_ids || []).map((serviceId) => serviceNameById.get(serviceId) || `${pt('t055')}#${serviceId}`);
          const paymentLabels = (entry.payments || []).map((payment) => {
            const code = payment.payment_method_code?.trim().toUpperCase() || '';
            const methodName = paymentMethodNameByCode.get(code) || payment.payment_method_code || pt('t056');
            const amountText = formatCurrency(payment.amount);
            if (code === 'COUPON' && payment.coupon_service_id) {
              const couponServiceName = serviceNameById.get(payment.coupon_service_id) || `${pt('t055')}#${payment.coupon_service_id}`;
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

      const linkedReservationIdSet = new Set<number>();
      matchedSettlements.forEach((entry) => {
        const reservationId = Number(entry.reservation_ref || 0);
        if (Number.isFinite(reservationId) && reservationId > 0) {
          linkedReservationIdSet.add(reservationId);
        }
      });

      let nameMatchFlag = false;

      const reservationMap = new Map<number, MemberReservationHistoryRow>();
      (reservationResult.reservations || []).forEach((entry) => {
        const isLinked = linkedReservationIdSet.has(entry.reservation_id);
        const isNameOrPhoneMatched = nameMatchedReservationIdSet.has(entry.reservation_id);
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

      const sortedReservations = Array.from(reservationMap.values())
        .sort((a, b) => (toTimestamp(b.datetime) - toTimestamp(a.datetime)) || (b.reservation_id - a.reservation_id));

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

      const mergedTreatments = [...settlementTreatments, ...completedReservationTreatments]
        .sort((a, b) => (toTimestamp(b.datetime) - toTimestamp(a.datetime)) || b.history_key.localeCompare(a.history_key));

      setMemberTreatmentHistories(mergedTreatments);
      setMemberReservationHistories(sortedReservations.filter((entry) => !isCompletedReservationStatus(entry.status)));
      setHasNameMatchedReservation(nameMatchFlag);
    } catch (error: any) {
      setHistoryError(typeof error === 'string' ? error : error?.message || pt('t023'));
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
              placeholder={t('user.search_placeholder')} value={searchText}
              onChange={(e) => setSearchText(e.target.value)} className="w-full pl-10 pr-4 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
          <div className="text-xs text-slate-400 font-medium">{t('user.total_count', { count: filteredUsers.length })}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead>
              <tr className="bg-slate-900 text-slate-200">
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">ID</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_name')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_email')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t007')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_address')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_phone')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_remarks')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('common.action')}</th>
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
                          {pt('t011')}</button>
                        <button 
                          onClick={() => handleEditClick(user)} disabled={isMutating}
                          className="text-primary hover:text-primary/80 font-bold text-xs flex items-center justify-center gap-1 bg-primary/5 px-2 py-1 rounded transition-colors disabled:opacity-50"
                        >
                          <Edit2 size={14} />
                          {t('common.edit')}</button>
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
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t007')}</label>
                  <select
                    value={formData.gender || ''}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="">{pt('t008')}</option>
                    <option value="M">{pt('t009')}</option>
                    <option value="F">{pt('t010')}</option>
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
                  <div className="py-16 text-center text-sm font-bold text-slate-500">{pt('t022')}</div>
                ) : historyError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 font-semibold">{historyError || pt('t023')}</div>
                ) : (
                  <>
                    <section className="space-y-4">
                      <h4 className="text-sm font-black text-slate-800 tracking-wide uppercase">{pt('t013')}</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t014')}</p>
                          <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(memberPointBalance)}</p>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t016')}</p>
                          <p className="mt-1 text-lg font-black text-slate-900">{memberTreatmentHistories.length}{pt('t049')}</p>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t018')}</p>
                          <p className="mt-1 text-lg font-black text-slate-900">{memberReservationHistories.length}{pt('t049')}</p>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl p-4">
                        <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">{pt('t052')}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                          <div className="text-slate-700"><span className="font-bold text-slate-900">{t('user.col_name')}:</span> {selectedHistoryUser.name}</div>
                          <div className="text-slate-700"><span className="font-bold text-slate-900">{pt('t060')}:</span> {selectedHistoryUser.phone || '-'}</div>
                          <div className="text-slate-700"><span className="font-bold text-slate-900">{t('common.email')}:</span> {selectedHistoryUser.email || '-'}</div>
                          <div className="text-slate-700"><span className="font-bold text-slate-900">{t('common.address')}:</span> {selectedHistoryUser.address || '-'}</div>
                        </div>
                        <div className="mt-3">
                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">{pt('t015')}</p>
                          <div className="flex flex-wrap gap-2">
                            {memberCoupons.length === 0 ? (
                              <span className="text-xs text-slate-400">-</span>
                            ) : (
                              memberCoupons.map((coupon) => (
                                <span key={`${coupon.service_id}-${coupon.count}`} className="px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">
                                  {coupon.service_name} {coupon.count}{pt('t050')}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-3">
                      <h4 className="text-sm font-black text-slate-800 tracking-wide uppercase flex items-center gap-2">
                        <CreditCard size={16} className="text-primary" />
                        {pt('t019')}
                      </h4>
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full min-w-[900px] text-left">
                          <thead className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500 uppercase tracking-wide">
                            <tr>
                              <th className="py-3 px-4">{pt('t024')}</th>
                              <th className="py-3 px-4">{pt('t025')}</th>
                              <th className="py-3 px-4">{pt('t026')}</th>
                              <th className="py-3 px-4">{pt('t027')}</th>
                              <th className="py-3 px-4">{pt('t028')}</th>
                              <th className="py-3 px-4">{pt('t029')}</th>
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
                                            {expandedServiceHistoryKey === entry.history_key ? pt('t062') : pt('t061')}
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

                    <section className="space-y-3">
                      <h4 className="text-sm font-black text-slate-800 tracking-wide uppercase flex items-center gap-2">
                        <Calendar size={16} className="text-primary" />
                        {pt('t021')}
                      </h4>
                      {hasNameMatchedReservation && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{pt('t048')}</p>
                      )}
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full min-w-[820px] text-left">
                          <thead className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500 uppercase tracking-wide">
                            <tr>
                              <th className="py-3 px-4">{pt('t038')}</th>
                              <th className="py-3 px-4">{pt('t025')}</th>
                              <th className="py-3 px-4">{pt('t039')}</th>
                              <th className="py-3 px-4">{pt('t027')}</th>
                              <th className="py-3 px-4">{pt('t040')}</th>
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
                    {pt('t051')}
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
