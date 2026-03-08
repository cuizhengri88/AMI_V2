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
  JapaneseYen,
  Ticket,
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

type RechargeType = 'BALANCE' | 'COUPON';

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

const FALLBACK_PAYMENT_METHODS: PaymentMethodOption[] = [
  { code: 'WECHAT_PAY', label: 'WECHAT_PAY', order: 1 },
  { code: 'ALIPAY', label: 'ALIPAY', order: 2 },
  { code: 'CASH', label: 'CASH', order: 3 },
];

const PAYMENT_METHOD_TEXT_KEY_BY_CODE: Record<string, string> = {
  WECHAT_PAY: 't031', // 위챗페이
  WECHAT: 't031', // 위챗페이
  ALIPAY: 't032', // 알리페이
  CASH: 't033', // 현금
  CARD: 't034', // 카드
  PREPAID: 't035', // 충전금 차감
  MEMBERSHIP: 't035', // 충전금 차감
  COUPON: 't036', // 쿠폰 사용
};

export default function MemberRechargePage() {
  const pt = usePageText('user_management_point_recharge');
  const [members, setMembers] = useState<Member[]>([]);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [paymentMethodOptions, setPaymentMethodOptions] = useState<PaymentMethodOption[]>(
    FALLBACK_PAYMENT_METHODS,
  );

  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isRechargeModalOpen, setIsRechargeModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  const [amount, setAmount] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState<number>(0);
  const [couponCount, setCouponCount] = useState('');
  const [rechargeType, setRechargeType] = useState<RechargeType>('COUPON');
  const [paymentMethodCode, setPaymentMethodCode] = useState(FALLBACK_PAYMENT_METHODS[0].code);

  const isBusy = isLoading || isMutating;

  const getPaymentMethodLabelByCode = (code: string, fallback?: string) => {
    const key = PAYMENT_METHOD_TEXT_KEY_BY_CODE[code.toUpperCase()];
    if (key) return pt(key);
    return fallback || code;
  };

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

    setMembers(mappedMembers);
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
      alert(typeof error === 'string' ? error : error?.message || pt('t018'));
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

  const resetRechargeForm = (type: RechargeType) => {
    setAmount('');
    setCouponCount('');
    setRechargeType(type);
    setSelectedServiceId(serviceOptions[0]?.id || 0);
    setPaymentMethodCode(paymentMethodOptions[0]?.code || FALLBACK_PAYMENT_METHODS[0].code);
  };

  const openRechargeModal = (member: Member, type: RechargeType) => {
    setSelectedMember(member);
    resetRechargeForm(type);
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

    if (parsedAmount <= 0) {
      alert(pt('t003'));
      return;
    }
    if (rechargeType === 'COUPON') {
      if (selectedServiceId <= 0) {
        alert(pt('t009'));
        return;
      }
      if (parsedCouponCount <= 0) {
        alert(pt('t012'));
        return;
      }
    }

    try {
      setIsMutating(true);
      await invokeDbCommand<{ success: boolean; message: string }>('recharge_member_point', {
        recharge: {
          user_id: selectedMember.id,
          recharge_type: rechargeType,
          amount: parsedAmount,
          service_id: rechargeType === 'COUPON' ? selectedServiceId : null,
          coupon_count: rechargeType === 'COUPON' ? parsedCouponCount : null,
          payment_method_code: paymentMethodCode,
          memo: null,
        },
      });

      await loadPointData();
      alert(pt('t013'));
      closeRechargeModal();
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t019'));
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

  const totalCoupons = useMemo(
    () =>
      members.reduce(
        (sum, member) => sum + member.coupons.reduce((couponSum, coupon) => couponSum + coupon.count, 0),
        0,
      ),
    [members],
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <LoadingOverlay visible={isBusy} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t014')}</h1>
          <p className="text-slate-500 mt-1">{pt('t016')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <User size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pt('t010')}</p>
            <p className="text-2xl font-black text-slate-900">{pt('t020', { count: members.length })}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <Ticket size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pt('t005')}</p>
            <p className="text-2xl font-black text-slate-900">{pt('t021', { count: totalCoupons })}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder={pt('t015')} value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>

          <button
            type="button"
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50"
          >
            <Filter size={16} />
            {pt('t022')}
          </button>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t017')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t023')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t006')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t024')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-sm text-slate-400">
                  {pt('t025')}
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
                        <p className="text-[10px] text-emerald-600 font-bold">{pt('t041', { amount: member.balance.toLocaleString() })}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-slate-600 font-mono">{member.phone}</td>
                  <td className="py-4 px-6">
                    <div className="flex flex-wrap gap-1">
                      {member.coupons.length > 0 ? (
                        member.coupons.map((coupon) => (
                          <span
                            key={`${member.id}-${coupon.serviceId}`}
                            className="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-200"
                          >
                            {pt('t026', { name: coupon.name, count: coupon.count })}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-300 italic">{pt('t004')}</span>
                      )}</div>
                  </td>
                  <td className="py-4 px-6 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => openRechargeModal(member, 'BALANCE')} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-all flex items-center gap-1.5"
                      >
                        <JapaneseYen size={14} />
                        {pt('t037')}
                      </button>
                      <button
                        type="button"
                        onClick={() => openRechargeModal(member, 'COUPON')} className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90 transition-all flex items-center gap-1.5"
                      >
                        <Plus size={14} />
                        {pt('t027')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}</tbody>
        </table>
      </div>

      <AnimatePresence>
        {isRechargeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={
                rechargeType === 'COUPON'
                  ? pt('t028', { name: selectedMember?.name || '' })
                  : pt('t038', { name: selectedMember?.name || '' })
              }
              onClose={closeRechargeModal}
              icon={<CreditCard size={20} className="text-primary" />}
            >
              <div className="p-6">
                <form onSubmit={handleRecharge} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t040')}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRechargeType('BALANCE')} className={`py-2 border rounded-lg text-xs font-bold transition-all ${
                          rechargeType === 'BALANCE'
                            ? 'border-primary text-primary bg-primary/5'
                            : 'border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
                        }`}
                      >
                        {pt('t037')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRechargeType('COUPON')} className={`py-2 border rounded-lg text-xs font-bold transition-all ${
                          rechargeType === 'COUPON'
                            ? 'border-primary text-primary bg-primary/5'
                            : 'border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
                        }`}
                      >
                        {pt('t027')}
                      </button>
                    </div>
                  </div>

                  {selectedMember && (
                    <p className="text-xs text-slate-500">{pt('t039', { amount: selectedMember.balance.toLocaleString() })}</p>
                  )}

                  <div className="space-y-4">
                    {rechargeType === 'COUPON' && (
                      <>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-500 uppercase">{pt('t007')}</label>
                          <select
                            value={selectedServiceId}
                            onChange={(e) => setSelectedServiceId(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                          >
                            {serviceOptions.length === 0 ? (
                              <option value={0}>{pt('t008')}</option>
                            ) : (
                              serviceOptions.map((service) => (
                                <option key={service.id} value={service.id}>
                                  {service.name}
                                </option>
                              ))
                            )}</select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-500 uppercase">{pt('t011')}</label>
                          <div className="relative">
                            <Ticket size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              type="number"
                              required={rechargeType === 'COUPON'}
                              value={couponCount}
                              onChange={(e) => setCouponCount(e.target.value)} className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">{pt('t002')}</label>
                      <div className="relative">
                        <JapaneseYen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="number"
                          required
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)} className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[100, 500, 1000].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setAmount(String((parseInt(amount || '0', 10) || 0) + value))} className="py-1.5 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                        >
                          +{value.toLocaleString()}</button>
                      ))}</div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t001')}</label>
                    <div className="grid grid-cols-3 gap-2">
                      {paymentMethodOptions.map((method) => (
                        <button
                          key={method.code}
                          type="button"
                          onClick={() => setPaymentMethodCode(method.code)} className={`py-2 border rounded-lg text-[10px] font-bold transition-all ${
                            paymentMethodCode === method.code
                              ? 'border-primary text-primary bg-primary/5'
                              : 'border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
                          }`}
                        >
                          {getPaymentMethodLabelByCode(method.code, method.label)}
                        </button>
                      ))}</div>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={closeRechargeModal}
                      className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                    >
                      {pt('t029')}
                    </button>
                    <button
                      type="submit"
                      disabled={isMutating}
                      className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                    >
                      {pt('t030')}
                    </button>
                  </div>
                </form>
              </div>
            </DraggableModal>
          </div>
        )}</AnimatePresence>
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
        onPointerDown={(e) => dragControls.start(e)} className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 cursor-move active:cursor-grabbing"
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
