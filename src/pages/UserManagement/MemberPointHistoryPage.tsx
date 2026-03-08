import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Filter, History, User, RotateCcw, X } from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';

type MemberOption = {
  id: number;
  name: string;
};

type PointHistoryItem = {
  id: number;
  actionType: 'RECHARGE' | 'USE';
  userId: number;
  userName: string;
  userPhone: string;
  rechargeType: string;
  amount: number | null;
  serviceName: string | null;
  couponCount: number | null;
  paymentMethodName: string;
  memo: string;
  createdAt: string;
  isCancelled: boolean;
  cancelReason: string | null;
  cancelledAt: string | null;
};

function formatCurrency(value: number) {
  return `₩${value.toLocaleString('ko-KR')}`;
}

function formatDateTime(raw: string) {
  if (!raw) return '-';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString('ko-KR');
}

export default function MemberPointHistoryPage() {
  const pt = usePageText('user_management_member_point_history');
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [histories, setHistories] = useState<PointHistoryItem[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState('all');
  const [actionFilter, setActionFilter] = useState<'all' | 'RECHARGE' | 'USE' | 'RECHARGE_CANCELLED'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PointHistoryItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const isBusy = isLoading || isMutating;

  const loadData = async () => {
    try {
      setIsLoading(true);
      const result = await invokeDbCommand<{
        success: boolean;
        message: string;
        members: Array<{
          user_id: number;
          user_name: string;
        }>;
        histories: Array<{
          id: number;
          action_type: 'RECHARGE' | 'USE';
          user_id: number;
          user_name: string;
          user_phone: string | null;
          recharge_type: string;
          amount: number | null;
          service_name: string | null;
          coupon_count: number | null;
          payment_method_name: string;
          memo: string;
          created_at: string;
          is_cancelled: boolean;
          cancel_reason: string | null;
          cancelled_at: string | null;
        }>;
      }>('get_member_point_management_data');

      setMembers(
        (result.members || [])
          .map((member) => ({
            id: member.user_id,
            name: member.user_name,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );

      setHistories(
        (result.histories || []).map((item) => ({
          id: item.id,
          actionType: item.action_type,
          userId: item.user_id,
          userName: item.user_name,
          userPhone: item.user_phone || '',
          rechargeType: item.recharge_type,
          amount: item.amount,
          serviceName: item.service_name,
          couponCount: item.coupon_count,
          paymentMethodName: item.payment_method_name,
          memo: item.memo || '',
          createdAt: item.created_at,
          isCancelled: item.is_cancelled,
          cancelReason: item.cancel_reason,
          cancelledAt: item.cancelled_at,
        })),
      );
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '회원 포인트 이력을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredHistories = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    return histories.filter((item) => {
      if (selectedMemberId !== 'all' && String(item.userId) !== selectedMemberId) return false;
      if (actionFilter === 'RECHARGE' && (item.actionType !== 'RECHARGE' || item.isCancelled)) return false;
      if (actionFilter === 'USE' && item.actionType !== 'USE') return false;
      if (
        actionFilter === 'RECHARGE_CANCELLED' &&
        (item.actionType !== 'RECHARGE' || !item.isCancelled)
      ) {
        return false;
      }
      if (!keyword) return true;

      return (
        item.userName.toLowerCase().includes(keyword) ||
        item.userPhone.toLowerCase().includes(keyword) ||
        (item.serviceName || '').toLowerCase().includes(keyword) ||
        item.paymentMethodName.toLowerCase().includes(keyword) ||
        item.memo.toLowerCase().includes(keyword) ||
        (item.cancelReason || '').toLowerCase().includes(keyword)
      );
    });
  }, [actionFilter, histories, searchTerm, selectedMemberId]);

  const summary = useMemo(() => {
    return filteredHistories.reduce(
      (acc, item) => {
        if (item.actionType === 'RECHARGE') acc.rechargeCount += 1;
        if (item.actionType === 'USE') acc.useCount += 1;
        if (item.isCancelled) acc.cancelledCount += 1;
        return acc;
      },
      { rechargeCount: 0, useCount: 0, cancelledCount: 0 },
    );
  }, [filteredHistories]);

  const openCancelModal = (item: PointHistoryItem) => {
    if (item.actionType !== 'RECHARGE' || item.isCancelled) return;
    setCancelTarget(item);
    setCancelReason('');
    setIsCancelModalOpen(true);
  };

  const closeCancelModal = () => {
    setIsCancelModalOpen(false);
    setCancelTarget(null);
    setCancelReason('');
  };

  const handleCancelRecharge = async () => {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (!reason) {
      alert(pt('t017'));
      return;
    }

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('cancel_member_point_recharge', {
        history_id: cancelTarget.id,
        cancel_reason: reason,
      });
      alert(result.message || '충전 취소가 완료되었습니다.');
      closeCancelModal();
      await loadData();
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '충전 취소에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <LoadingOverlay visible={isBusy} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t022')}</h1>
          <p className="text-slate-500 mt-1">{pt('t021')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <History size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pt('t011')}</p>
            <p className="text-2xl font-black text-slate-900">{filteredHistories.length}건</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <User size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pt('t013')}</p>
            <p className="text-2xl font-black text-slate-900">{summary.rechargeCount}건</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
            <RotateCcw size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pt('t018')}</p>
            <p className="text-2xl font-black text-slate-900">{summary.cancelledCount}건</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 grid grid-cols-1 lg:grid-cols-4 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder={pt('t020')} value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>

          <select
            value={selectedMemberId}
            onChange={(e) => setSelectedMemberId(e.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
          >
            <option value="all">{pt('t010')}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}</select>

          <select
            value={actionFilter}
            onChange={(e) =>
              setActionFilter(e.target.value as 'all' | 'RECHARGE' | 'USE' | 'RECHARGE_CANCELLED')
            }
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
          >
            <option value="all">{pt('t009')}</option>
            <option value="RECHARGE">{pt('t012')}</option>
            <option value="RECHARGE_CANCELLED">{pt('t014')}</option>
            <option value="USE">{pt('t005')}</option>
          </select>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t008')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t007')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t019')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">전화번호</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t006')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">{pt('t023')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">{pt('t003')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t001')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t004')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t002')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredHistories.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-10 text-center text-sm text-slate-400">
                  조회된 이력이 없습니다.
                </td>
              </tr>
            ) : (
              filteredHistories.map((item) => {
                const signedCoupon = item.couponCount
                  ? item.actionType === 'RECHARGE'
                    ? `+${item.couponCount}회`
                    : `-${item.couponCount}회`
                  : '-';
                const signedAmount =
                  item.amount == null
                    ? '-'
                    : item.actionType === 'RECHARGE'
                      ? `+${formatCurrency(item.amount)}`
                      : `-${formatCurrency(item.amount)}`;

                return (
                  <tr key={`${item.actionType}-${item.id}`} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6 text-xs text-slate-500">{formatDateTime(item.createdAt)}</td>
                    <td className="py-4 px-6">
                      {item.actionType === 'RECHARGE' ? (
                        item.isCancelled ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            충전(취소)
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            충전
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          사용
                        </span>
                      )}</td>
                    <td className="py-4 px-6 text-sm font-semibold text-slate-800">{item.userName}</td>
                    <td className="py-4 px-6 text-sm text-slate-600 font-mono">{item.userPhone || '-'}</td>
                    <td className="py-4 px-6 text-sm text-slate-600">{item.serviceName || '-'}</td>
                    <td className="py-4 px-6 text-sm text-right font-bold text-slate-700">{signedCoupon}</td>
                    <td
                      className={`py-4 px-6 text-sm text-right font-bold ${
                        item.actionType === 'RECHARGE' ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {signedAmount}
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-500">{item.paymentMethodName || '-'}</td>
                    <td className="py-4 px-6 text-xs text-slate-500">
                      <div>{item.memo || '-'}</div>
                      {item.isCancelled && (
                        <div className="text-rose-600 mt-1">
                          취소사유: {item.cancelReason || '-'} ({formatDateTime(item.cancelledAt || '')})
                        </div>
                      )}</td>
                    <td className="py-4 px-6 text-center">
                      {item.actionType === 'RECHARGE' && !item.isCancelled ? (
                        <button
                          type="button"
                          onClick={() => openCancelModal(item)} className="px-2.5 py-1 text-[11px] font-bold rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                        >
                          취소
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300">-</span>
                      )}</td>
                  </tr>
                );
              })
            )}</tbody>
        </table>
      </div>

      <AnimatePresence>
        {isCancelModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
            >
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900">{pt('t014')}</h3>
                <button onClick={closeCancelModal} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="text-sm text-slate-600">
                  선택 이력: <span className="font-semibold text-slate-900">{cancelTarget?.userName}</span> /{' '}
                  <span className="font-semibold text-slate-900">{cancelTarget?.serviceName || '-'}</span>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t015')}</label>
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)} rows={4}
                    placeholder={pt('t016')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none resize-none"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeCancelModal}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelRecharge}
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-rose-600 text-white text-sm font-bold rounded-lg hover:bg-rose-500 disabled:opacity-60"
                  >
                    취소 확정
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}</AnimatePresence>
    </motion.div>
  );
}
