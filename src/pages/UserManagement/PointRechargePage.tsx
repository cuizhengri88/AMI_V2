import React, { useMemo, useState } from 'react';
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
} from 'lucide-react';

type Coupon = {
  name: string;
  count: number;
};

type Member = {
  id: string;
  name: string;
  phone: string;
  balance: number;
  coupons: Coupon[];
};

const initialMembers: Member[] = [
  {
    id: 'M001',
    name: '김철수',
    phone: '010-1234-5678',
    balance: 150000,
    coupons: [
      { name: '남성 컷', count: 3 },
      { name: '두피 스케일링', count: 1 },
    ],
  },
  {
    id: 'M002',
    name: '이영희',
    phone: '010-9876-5432',
    balance: 50000,
    coupons: [{ name: '디지털 펌', count: 1 }],
  },
  { id: 'M003', name: '박지민', phone: '010-5555-4444', balance: 0, coupons: [] },
  {
    id: 'M004',
    name: '최유리',
    phone: '010-1111-2222',
    balance: 300000,
    coupons: [{ name: '전체 염색', count: 2 }],
  },
];

const procedures = ['남성 컷', '여성 컷', '디지털 펌', '전체 염색', '두피 스케일링'];
const paymentMethods = ['위챗페이', '알리페이', '현금', '쿠폰', '기타'] as const;

type RechargeType = 'balance' | 'coupon';
type PaymentMethod = (typeof paymentMethods)[number];

export default function MemberRechargePage() {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [searchTerm, setSearchTerm] = useState('');
  const [isRechargeModalOpen, setIsRechargeModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [rechargeType, setRechargeType] = useState<RechargeType>('balance');

  const [amount, setAmount] = useState('');
  const [couponName, setCouponName] = useState(procedures[0]);
  const [couponCount, setCouponCount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(paymentMethods[0]);

  const resetRechargeForm = () => {
    setAmount('');
    setCouponName(procedures[0]);
    setCouponCount('');
    setPaymentMethod(paymentMethods[0]);
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

  const handleRecharge = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedMember) return;

    const parsedAmount = parseInt(amount, 10) || 0;
    const parsedCouponCount = parseInt(couponCount, 10) || 0;

    if (rechargeType === 'balance' && parsedAmount <= 0) {
      alert('충전 금액을 1원 이상 입력해주세요.');
      return;
    }
    if (rechargeType === 'coupon' && parsedCouponCount <= 0) {
      alert('충전 횟수를 1회 이상 입력해주세요.');
      return;
    }

    setMembers((prev) =>
      prev.map((member) => {
        if (member.id !== selectedMember.id) return member;

        if (rechargeType === 'balance') {
          return { ...member, balance: member.balance + parsedAmount };
        }

        const existingCoupon = member.coupons.find((coupon) => coupon.name === couponName);
        if (existingCoupon) {
          return {
            ...member,
            coupons: member.coupons.map((coupon) =>
              coupon.name === couponName
                ? { ...coupon, count: coupon.count + parsedCouponCount }
                : coupon,
            ),
          };
        }

        return {
          ...member,
          coupons: [...member.coupons, { name: couponName, count: parsedCouponCount }],
        };
      }),
    );

    alert(`충전이 완료되었습니다. (${paymentMethod})`);
    closeRechargeModal();
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
            <p className="text-2xl font-black text-slate-900">₩{totalBalance.toLocaleString()}</p>
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
            {filteredMembers.map((member) => (
              <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                <td className="py-4 px-6">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                      <User size={20} />
                    </div>
                    <div>
                      <span className="text-sm font-bold text-slate-900">{member.name}</span>
                      <p className="text-[10px] text-slate-400 font-mono">{member.id}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-6 text-sm text-slate-600 font-mono">{member.phone}</td>
                <td className="py-4 px-6 text-sm text-right font-bold text-primary">₩{member.balance.toLocaleString()}</td>
                <td className="py-4 px-6">
                  <div className="flex flex-wrap gap-1">
                    {member.coupons.length > 0 ? (
                      member.coupons.map((coupon) => (
                        <span
                          key={`${member.id}-${coupon.name}`}
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
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                    >
                      <History size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
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
                            name="amount"
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
                        {[100, 500, 1000].map((value) => (
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
                          name="couponName"
                          value={couponName}
                          onChange={(e) => setCouponName(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        >
                          {procedures.map((procedure) => (
                            <option key={procedure} value={procedure}>
                              {procedure}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase">충전 횟수</label>
                        <div className="relative">
                          <Ticket size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            name="couponCount"
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
                      {paymentMethods.map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setPaymentMethod(method)}
                          className={`py-2 border rounded-lg text-[10px] font-bold transition-all ${
                            paymentMethod === method
                              ? 'border-primary text-primary bg-primary/5'
                              : 'border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
                          }`}
                        >
                          {method}
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
                      className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
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
