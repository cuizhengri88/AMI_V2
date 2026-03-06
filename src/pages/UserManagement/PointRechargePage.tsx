import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import {
  Plus,
  Search,
  CreditCard,
  Filter,
  User,
  X,
  GripHorizontal,
  DollarSign,
  Ticket,
  History,
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

type ServiceOption = {
  id: number;
  name: string;
  useYn: 'Y' | 'N';
};

type PaymentMethodOption = {
  code: string;
  label: string;
  order: number;
};

type HistoryItem = {
  id: number;
  userId: number;
  userName: string;
  rechargeType: 'BALANCE' | 'COUPON';
  amount: number | null;
  serviceName: string | null;
  couponCount: number | null;
  paymentMethodName: string;
  createdAt: string;
};

type RechargeType = 'balance' | 'coupon';

const FALLBACK_PAYMENT_METHODS: PaymentMethodOption[] = [
  { code: 'WECHAT_PAY', label: '위챗페이', order: 1 },
  { code: 'ALIPAY', label: '알리페이', order: 2 },
  { code: 'CASH', label: '현금', order: 3 },
];

function formatCurrency(value: number) {
  return `₩${value.toLocaleString('ko-KR')}`;
}

export default function MemberRechargePage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [paymentMethodOptions, setPaymentMethodOptions] = useState<PaymentMethodOption[]>(
    FALLBACK_PAYMENT_METHODS,
  );

  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isRechargeModalOpen, setIsRechargeModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [rechargeType, setRechargeType] = useState<RechargeType>('balance');

  const [amount, setAmount] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState<number>(0);
  const [couponCount, setCouponCount] = useState('');
  const [paymentMethodCode, setPaymentMethodCode] = useState(FALLBACK_PAYMENT_METHODS[0].code);

  const isBusy = isLoading || isMutating;

  const loadPointData = async () => {
    const result = await invokeDbCommand<{
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
      histories: Array<{
        id: number;
        user_id: number;
        user_name: string;
        recharge_type: 'BALANCE' | 'COUPON';
        amount: number | null;
        service_name: string | null;
        coupon_count: number | null;
        payment_method_name: string;
        created_at: string;
      }>;
    }>('get_member_point_management_data');

    const mappedMembers: Member[] = (result.members || []).map((member) => ({
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

    const mappedHistories: HistoryItem[] = (result.histories || []).map((item) => ({
      id: item.id,
      userId: item.user_id,
      userName: item.user_name,
      rechargeType: item.recharge_type,
      amount: item.amount,
      serviceName: item.service_name,
      couponCount: item.coupon_count,
      paymentMethodName: item.payment_method_name,
      createdAt: item.created_at,
    }));

    setMembers(mappedMembers);
    setHistoryItems(mappedHistories);
  };

  const loadReferenceData = async () => {
    const [serviceResult, commonCodeResult] = await Promise.all([
      invokeDbCommand<{
        success: boolean;
        message: string;
        items: Array<{
          service_id: number;
          service_name: string;
          use_yn: 'Y' | 'N';
        }>;
      }>('get_service_catalog_data'),
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
    ]);

    const services = (serviceResult.items || [])
      .filter((item) => item.use_yn === 'Y')
      .map((item) => ({
        id: item.service_id,
        name: item.service_name,
        useYn: item.use_yn,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const paymentMethods = (commonCodeResult.details || [])
      .filter((detail) => detail.group === 'PAYMENT_METHOD' && detail.use_yn === 'Y')
      .map((detail) => ({
        code: detail.code,
        label: detail.name,
        order: detail.order,
      }))
      .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code));

    setServiceOptions(services);
    setPaymentMethodOptions(paymentMethods.length > 0 ? paymentMethods : FALLBACK_PAYMENT_METHODS);
  };

  const loadData = async () => {
    try {
      setIsLoading(true);
      await Promise.all([loadPointData(), loadReferenceData()]);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '회원 포인트 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paymentMethodOptions.length > 0 && !paymentMethodOptions.some((item) => item.code === paymentMethodCode)) {
      setPaymentMethodCode(paymentMethodOptions[0].code);
    }
  }, [paymentMethodCode, paymentMethodOptions]);

  useEffect(() => {
    if (serviceOptions.length > 0 && !serviceOptions.some((service) => service.id === selectedServiceId)) {
      setSelectedServiceId(serviceOptions[0].id);
    }
  }, [selectedServiceId, serviceOptions]);

  const resetRechargeForm = () => {
    setAmount('');
    setCouponCount('');
    setSelectedServiceId(serviceOptions[0]?.id || 0);
    setPaymentMethodCode(paymentMethodOptions[0]?.code || FALLBACK_PAYMENT_METHODS[0].code);
  };

  const openRechargeModal = (member: Member, type: RechargeType = 'balance') => {
    setSelectedMember(member);
    setRechargeType(type);
    resetRechargeForm();
    setIsRechargeModalOpen(true);
  };

  const closeRechargeModal = () => {
    setIsRechargeModalOpen(false);
    setSelectedMember(null);
  };

  const handleRecharge = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedMember) return;

    const parsedAmount = parseInt(amount, 10) || 0;
    const parsedCouponCount = parseInt(couponCount, 10) || 0;

    if (rechargeType === 'balance' && parsedAmount <= 0) {
      alert('충전 금액을 1원 이상 입력해주세요.');
      return;
    }
    if (rechargeType === 'coupon' && selectedServiceId <= 0) {
      alert('쿠폰 충전 시 시술을 선택해주세요.');
      return;
    }
    if (rechargeType === 'coupon' && parsedCouponCount <= 0) {
      alert('충전 횟수를 1회 이상 입력해주세요.');
      return;
    }

    try {
      setIsMutating(true);
      await invokeDbCommand<{ success: boolean; message: string }>('recharge_member_point', {
        recharge: {
          user_id: selectedMember.id,
          recharge_type: rechargeType === 'balance' ? 'BALANCE' : 'COUPON',
          amount: rechargeType === 'balance' ? parsedAmount : null,
          service_id: rechargeType === 'coupon' ? selectedServiceId : null,
          coupon_count: rechargeType === 'coupon' ? parsedCouponCount : null,
          payment_method_code: paymentMethodCode,
          memo: null,
        },
      });

      await loadPointData();
      alert('충전이 완료되었습니다.');
      closeRechargeModal();
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '충전에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const filteredMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          member.name.includes(searchTerm.trim()) || member.phone.includes(searchTerm.trim()),
      ),
    [members, searchTerm],
  );

  const totalBalance = useMemo(
    () => members.reduce((sum, member) => sum + member.balance, 0),
    [members],
  );
  const totalCoupons = useMemo(
    () =>
      members.reduce(
        (sum, member) => sum + member.coupons.reduce((couponSum, coupon) => couponSum + coupon.count, 0),
        0,
      ),
    [members],
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      {isBusy && (
        <div className="fixed inset-0 z-[70] bg-slate-900/20 backdrop-blur-[1px] flex items-center justify-center">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg flex items-center gap-2">
            <Loader2 size={18} className="animate-spin text-primary" />
            <span className="text-sm font-semibold text-slate-700">Loading...</span>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">회원 충전 및 쿠폰 관리</h1>
          <p className="text-slate-500 mt-1">회원의 예치금 충전 및 시술 횟수권(쿠폰)을 관리합니다.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <User size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">전체 회원</p>
            <p className="text-2xl font-black text-slate-900">{members.length}명</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <DollarSign size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">총 예치금 잔액</p>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(totalBalance)}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <Ticket size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">보유 쿠폰 총합</p>
            <p className="text-2xl font-black text-slate-900">{totalCoupons}회</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="회원명 또는 연락처 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>

          <button
            type="button"
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50"
          >
            <Filter size={16} />
            필터
          </button>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">회원정보</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">연락처</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">예치금 잔액</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">보유 쿠폰(횟수권)</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-slate-400">
                  회원 데이터가 없습니다.
                </td>
              </tr>
            ) : (
              filteredMembers.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                        <User size={20} />
                      </div>
                      <div>
                        <span className="text-sm font-bold text-slate-900">{member.name}</span>
                        <p className="text-[10px] text-slate-400 font-mono">{`U${member.id}`}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-slate-600 font-mono">{member.phone}</td>
                  <td className="py-4 px-6 text-sm text-right font-bold text-primary">{formatCurrency(member.balance)}</td>
                  <td className="py-4 px-6">
                    <div className="flex flex-wrap gap-1">
                      {member.coupons.length > 0 ? (
                        member.coupons.map((coupon) => (
                          <span
                            key={`${member.id}-${coupon.serviceId}`}
                            className="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-200"
                          >
                            {coupon.name}: {coupon.count}회
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-300 italic">보유 쿠폰 없음</span>
                      )}
                    </div>
                  </td>
                  <td className="py-4 px-6 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => openRechargeModal(member, 'balance')}
                        className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90 transition-all flex items-center gap-1.5"
                      >
                        <Plus size={14} />
                        충전
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const lastHistory = historyItems.find((item) => item.userId === member.id);
                          alert(lastHistory ? `${lastHistory.userName} 최근 이력: ${lastHistory.createdAt}` : '이력이 없습니다.');
                        }}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                      >
                        <History size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {isRechargeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={`${selectedMember?.name || ''} 회원 충전`}
              onClose={closeRechargeModal}
              icon={<CreditCard size={20} className="text-primary" />}
            >
              <div className="p-6">
                <div className="flex p-1 bg-slate-100 rounded-xl mb-6">
                  <button
                    type="button"
                    onClick={() => setRechargeType('balance')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
                      rechargeType === 'balance'
                        ? 'bg-white text-primary shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <DollarSign size={14} />
                    예치금 충전
                  </button>
                  <button
                    type="button"
                    onClick={() => setRechargeType('coupon')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
                      rechargeType === 'coupon'
                        ? 'bg-white text-primary shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Ticket size={14} />
                    쿠폰(횟수권) 충전
                  </button>
                </div>

                <form onSubmit={handleRecharge} className="space-y-4">
                  {rechargeType === 'balance' ? (
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">충전 금액 (₩)</label>
                        <div className="relative">
                          <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="number"
                            required
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                            placeholder="0"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[10000, 50000, 100000].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setAmount(String((parseInt(amount || '0', 10) || 0) + value))}
                            className="py-1.5 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                          >
                            +{value.toLocaleString()}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">시술 선택</label>
                        <select
                          value={selectedServiceId}
                          onChange={(e) => setSelectedServiceId(Number(e.target.value))}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        >
                          {serviceOptions.length === 0 ? (
                            <option value={0}>시술 항목 없음</option>
                          ) : (
                            serviceOptions.map((service) => (
                              <option key={service.id} value={service.id}>
                                {service.name}
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">충전 횟수</label>
                        <div className="relative">
                          <Ticket size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="number"
                            required
                            value={couponCount}
                            onChange={(e) => setCouponCount(e.target.value)}
                            className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">결제 수단</label>
                    <div className="grid grid-cols-3 gap-2">
                      {paymentMethodOptions.map((method) => (
                        <button
                          key={method.code}
                          type="button"
                          onClick={() => setPaymentMethodCode(method.code)}
                          className={`py-2 border rounded-lg text-[10px] font-bold transition-all ${
                            paymentMethodCode === method.code
                              ? 'border-primary text-primary bg-primary/5'
                              : 'border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
                          }`}
                        >
                          {method.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={closeRechargeModal}
                      className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      disabled={isMutating}
                      className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                    >
                      충전하기
                    </button>
                  </div>
                </form>
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
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  icon: React.ReactNode;
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
      className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative"
    >
      <div
        onPointerDown={(e) => dragControls.start(e)}
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
