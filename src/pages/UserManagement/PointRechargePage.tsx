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

/**
 * 회원이 보유한 시술 쿠폰(횟수권) 정보 모델
 */
type Coupon = {
  serviceId: number;   // 시술 ID (식별자)
  name: string;        // 시술 명칭 (예: 디자인 컷)
  count: number;       // 보유 중인 남은 횟수
};

/**
 * 화면에서 관리하는 회원 전체 정보 모델 (포인트 및 쿠폰 포함)
 */
type Member = {
  id: number;          // 회원 고유 ID
  name: string;        // 회원 성함
  phone: string;       // 회원 연락처
  balance: number;     // 현재 보유 중인 충전금 잔액
  coupons: Coupon[];   // 보유 중인 쿠폰(횟수권) 목록
};

/**
 * 충전 구분 유형
 * BALANCE: 현금/카드 등으로 머니(금액)를 충전
 * COUPON: 특정 시술 횟수권(쿠폰)을 충전
 */
type RechargeType = 'BALANCE' | 'COUPON';

/**
 * 쿠폰 충전 시 선택할 수 있는 시술 항목 옵션
 */
type ServiceOption = {
  id: number;          // 시술 ID
  name: string;        // 시술 명칭
  useYn: 'Y' | 'N';    // 사용 여부
};

/**
 * 결제수단 선택 드롭다운용 옵션 모델 (공통코드 대응)
 */
type PaymentMethodOption = {
  code: string;        // 결제수단 코드 (예: CASH, ALIPAY)
  label: string;       // 표시 라벨
  order: number;       // 표시 순서
};

/**
 * 서버 통신 실패 시 사용할 기본 결제수단 목록
 */
const FALLBACK_PAYMENT_METHODS: PaymentMethodOption[] = [
  { code: 'WECHAT_PAY', label: 'WECHAT_PAY', order: 1 },
  { code: 'ALIPAY', label: 'ALIPAY', order: 2 },
  { code: 'CASH', label: 'CASH', order: 3 },
];

/**
 * 결제수단 코드를 다국어 번역 키로 매핑하는 객체
 */
const PAYMENT_METHOD_TEXT_KEY_BY_CODE: Record<string, string> = {
  WECHAT_PAY: 't031', // 위챗페이
  WECHAT: 't031',     // 위챗페이
  ALIPAY: 't032',     // 알리페이
  CASH: 't033',       // 현금
  CARD: 't034',       // 카드
  PREPAID: 't035',    // 충전금 차감
  MEMBERSHIP: 't035', // 충전금 차감
  COUPON: 't036',      // 쿠폰 사용
};

/**
 * 회원 포인트/쿠폰 충전 관리 페이지 컴포넌트
 */
export default function MemberRechargePage() {
  // 페이지별 다국어 도구 (user_management_point_recharge 영역)
  const pt = usePageText('user_management_point_recharge');

  /**
   * 상태 관리 (States)
   * members: 전체 회원 및 보유 자산 데이터
   * serviceOptions: 쿠폰 충전 시 선택할 시술 목록
   * paymentMethodOptions: 결제 수단 목록 (공통코드 연동)
   * searchTerm: 검색어 (이름, 전화번호)
   * isLoading: 조회 중 상태
   * isMutating: 충전 처리(저장) 중 상태
   * isRechargeModalOpen: 충전 팝업 오픈 여부
   * selectedMember: 현재 충전을 위해 선택된 회원 정보
   */
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

  /**
   * 충전 모달 폼 전용 상태
   * amount: 충전할 포인트 금액 또는 쿠폰 결제액
   * receivedAmount: 실제 고객에게 받은 현금/카드 금액 (할인 전 금액)
   * selectedServiceId: 충전할 쿠폰의 대상 시술 ID
   * couponCount: 충전할 쿠폰 횟수
   * rechargeType: 현재 선택된 충전 유형 (BALANCE / COUPON)
   * paymentMethodCode: 선택된 결제수단 코드
   */
  const [amount, setAmount] = useState('');
  const [receivedAmount, setReceivedAmount] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState<number>(0);
  const [couponCount, setCouponCount] = useState('');
  const [rechargeType, setRechargeType] = useState<RechargeType>('COUPON');
  const [paymentMethodCode, setPaymentMethodCode] = useState(FALLBACK_PAYMENT_METHODS[0].code);

  const isBusy = isLoading || isMutating;

  /**
   * 결제수단 코드를 기반으로 현재 언어에 맞는 라벨을 반환합니다.
   */
  const getPaymentMethodLabelByCode = (code: string, fallback?: string) => {
    const key = PAYMENT_METHOD_TEXT_KEY_BY_CODE[code.toUpperCase()];
    if (key) return pt(key);
    return fallback || code;
  };

  /**
   * DB에서 회원별 포인트 및 쿠폰 잔액 데이터를 조회합니다.
   */
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

  /**
   * 시술 카탈로그와 결제 수단 공통코드를 로드합니다.
   */
  const loadReferenceData = async () => {
    const [serviceResult, commonCodeResult] = await Promise.all([
      invokeDbCommand<{
        success: boolean;
        message: string;
        items: Array<{ service_id: number; service_name: string; use_yn: 'Y' | 'N' }>;
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

    // 사용 중인 시술 목록 필터링 및 정렬
    const services = (serviceResult.items || [])
      .filter((item) => item.use_yn === 'Y')
      .map((item) => ({
        id: item.service_id,
        name: item.service_name,
        useYn: item.use_yn,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // 결제수단 공통코드 가공
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

  /**
   * 전체 초기 데이터 로딩
   */
  const loadData = async () => {
    try {
      setIsLoading(true);
      await Promise.all([loadPointData(), loadReferenceData()]);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t018')); // pt('t018') -> 회원 포인트 데이터를 불러오지 못했습니다.
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 결제수단 옵션 변경 시 현재 선택된 값이 없다면 보정합니다.
   */
  useEffect(() => {
    if (paymentMethodOptions.length > 0 && !paymentMethodOptions.some((item) => item.code === paymentMethodCode)) {
      setPaymentMethodCode(paymentMethodOptions[0].code);
    }
  }, [paymentMethodCode, paymentMethodOptions]);

  /**
   * 시술 옵션 변경 시 현재 선택된 항목이 유효하지 않으면 보정합니다.
   */
  useEffect(() => {
    if (serviceOptions.length > 0 && !serviceOptions.some((service) => service.id === selectedServiceId)) {
      setSelectedServiceId(serviceOptions[0].id);
    }
  }, [selectedServiceId, serviceOptions]);

  /**
   * 충전 모달 폼의 입력값들을 초기화합니다.
   */
  const resetRechargeForm = (type: RechargeType) => {
    setAmount('');
    setReceivedAmount(type === 'BALANCE' ? '0' : ''); // 금액 충전 시 기본 받은 금액은 0으로 세팅
    setCouponCount('');
    setRechargeType(type);
    setSelectedServiceId(serviceOptions[0]?.id || 0);
    setPaymentMethodCode(paymentMethodOptions[0]?.code || FALLBACK_PAYMENT_METHODS[0].code);
  };

  /**
   * 충전 모달창 열기
   */
  const openRechargeModal = (member: Member, type: RechargeType) => {
    setSelectedMember(member);
    resetRechargeForm(type);
    setIsRechargeModalOpen(true);
  };

  /**
   * 충전 모달창 닫기
   */
  const closeRechargeModal = () => {
    setIsRechargeModalOpen(false);
    setSelectedMember(null);
  };

  /**
   * 충전 실행 버튼 클릭 시 호출 (등록 처리)
   */
  const handleRecharge = async (event: React.FormEvent) => {
    // e.preventDefault(): 폼 제출 시 페이지 새로고침 방지
    event.preventDefault();
    if (!selectedMember) return;

    const parsedAmount = parseInt(amount, 10) || 0;
    const parsedReceivedAmount = parseInt(receivedAmount, 10) || 0;
    const parsedCouponCount = parseInt(couponCount, 10) || 0;

    /**
     * 충전 유형별 유효성 검사 로직
     */
    if (rechargeType === 'BALANCE') {
      if (parsedAmount <= 0) {
        alert(pt('t003')); // pt('t003') -> 충전 금액을 1원 이상 입력해주세요.
        return;
      }
      if (parsedReceivedAmount < 0) {
        alert(pt('t044')); // pt('t044') -> 받은 금액을 0원 이상 입력해주세요.
        return;
      }
    } else {
      // 쿠폰 충전의 경우
      if (parsedAmount < 0) {
        alert(pt('t044'));
        return;
      }
      if (selectedServiceId <= 0) {
        alert(pt('t009')); // pt('t009') -> 시술을 선택해주세요.
        return;
      }
      if (parsedCouponCount <= 0) {
        alert(pt('t012')); // pt('t012') -> 충전 횟수를 1회 이상 입력해주세요.
        return;
      }
    }

    try {
      setIsMutating(true);
      // DB에 충전 커맨드 전송
      await invokeDbCommand<{ success: boolean; message: string }>('recharge_member_point', {
        recharge: {
          user_id: selectedMember.id,
          recharge_type: rechargeType,
          amount: parsedAmount,
          received_amount: rechargeType === 'BALANCE' ? parsedReceivedAmount : null,
          service_id: rechargeType === 'COUPON' ? selectedServiceId : null,
          coupon_count: rechargeType === 'COUPON' ? parsedCouponCount : null,
          payment_method_code: paymentMethodCode,
          memo: null,
        },
      });

      await loadPointData(); // 잔액 업데이트를 위한 재조회
      alert(pt('t013'));     // pt('t013') -> 충전이 완료되었습니다.
      closeRechargeModal();
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t019')); // pt('t019') -> 충전에 실패했습니다.
    } finally {
      setIsMutating(false);
    }
  };

  /**
   * 검색어 기반의 필터링된 회원 목록 산출
   */
  const filteredMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          member.name.includes(searchTerm.trim()) || member.phone.includes(searchTerm.trim()),
      ),
    [members, searchTerm],
  );

  /**
   * 전 회원의 보유 쿠폰 총합 계산 (헤더 요약용)
   */
  const totalCoupons = useMemo(
    () =>
      members.reduce(
        (sum, member) => sum + member.coupons.reduce((couponSum, coupon) => couponSum + coupon.count, 0),
        0,
      ),
    [members],
  );

  /**
   * 특정 한 명의 회원이 가진 모든 쿠폰의 합계를 구합니다.
   */
  const getMemberCouponTotal = (member: Member) =>
    member.coupons.reduce((sum, coupon) => sum + coupon.count, 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <LoadingOverlay visible={isBusy} />

      {/* 상단 헤더 섹션 */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            {pt('t014')} {/* pt('t014') -> 회원 포인트 관리 */}
          </h1>
          <p className="text-slate-500 mt-1">
            {pt('t016')} {/* pt('t016') -> 회원의 충전금 잔액과 시술 쿠폰 보유 현황을 확인하고 금액/횟수권을 충전합니다. */}
          </p>
        </div>
      </div>

      {/* 요약 카운트 카드 섹션 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <User size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pt('t010')}</p> {/* pt('t010') -> 전체 회원 */}
            <p className="text-2xl font-black text-slate-900">{pt('t020', { count: members.length })}</p> {/* pt('t020') -> {{count}}명 */}
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <Ticket size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pt('t005')}</p> {/* pt('t005') -> 보유 쿠폰 총합 */}
            <p className="text-2xl font-black text-slate-900">{pt('t021', { count: totalCoupons })}</p> {/* pt('t021') -> {{count}}회 */}
          </div>
        </div>
      </div>

      {/* 회원 리스트 카드 영역 */}
      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        {/* 필터 및 검색 바 */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder={pt('t015')} // pt('t015') -> 회원명 또는 연락처 검색...
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
            {pt('t022')} {/* pt('t022') -> 필터 */}
          </button>
        </div>

        {/* 회원 정보 테이블 */}
        <table className="w-full text-left border-collapse min-w-[980px]">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t017')}</th> {/* pt('t017') -> 회원정보 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t023')}</th> {/* pt('t023') -> 연락처 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t042')}</th> {/* pt('t042') -> 충전금 잔액 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t006')}</th> {/* pt('t006') -> 보유 쿠폰(횟수권) */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t024')}</th> {/* pt('t024') -> 작업 */}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-slate-400">
                  {pt('t025')} {/* pt('t025') -> 회원 데이터가 없습니다. */}
                </td>
              </tr>
            ) : (
              filteredMembers.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                  {/* 이름 및 ID */}
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
                  {/* 연락처 */}
                  <td className="py-4 px-6 text-sm text-slate-600 font-mono">{member.phone}</td>
                  {/* 충전금 잔액 뱃지 */}
                  <td className="py-4 px-6">
                    <div className="inline-flex flex-col px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50/70">
                      <p className="text-[10px] font-black uppercase tracking-wide text-emerald-700">{pt('t042')}</p>
                      <p className="text-base font-black text-emerald-800">¥{member.balance.toLocaleString()}</p>
                    </div>
                  </td>
                  {/* 보유 쿠폰 목록 히스토리 */}
                  <td className="py-4 px-6">
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50">
                        <span className="text-[10px] font-black uppercase tracking-wide text-amber-700">{pt('t043')}</span> {/* pt('t043') -> 보유 쿠폰 총 횟수 */}
                        <span className="text-sm font-black text-amber-800">{pt('t021', { count: getMemberCouponTotal(member) })}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {member.coupons.length > 0 ? (
                          member.coupons.map((coupon) => (
                            <span
                              key={`${member.id}-${coupon.serviceId}`}
                              className="inline-flex items-center px-2.5 py-1 rounded bg-white text-amber-800 text-[11px] font-bold border border-amber-200"
                            >
                              {pt('t026', { name: coupon.name, count: coupon.count })} {/* pt('t026') -> {{name}}: {{count}}회 */}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-300 italic">{pt('t004')} {/* pt('t004') -> 보유 쿠폰 없음 */}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  {/* 충전 액션 버튼 묶음 */}
                  <td className="py-4 px-6 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => openRechargeModal(member, 'BALANCE')}
                        className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-all flex items-center gap-1.5"
                      >
                        <JapaneseYen size={14} />
                        {pt('t037')} {/* pt('t037') -> 금액 충전 */}
                      </button>
                      <button
                        type="button"
                        onClick={() => openRechargeModal(member, 'COUPON')}
                        className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90 transition-all flex items-center gap-1.5"
                      >
                        <Plus size={14} />
                        {pt('t027')} {/* pt('t027') -> 횟수권 충전 */}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 충전 전용 드래그 지원 모달 */}
      <AnimatePresence>
        {isRechargeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={
                rechargeType === 'COUPON'
                  ? pt('t028', { name: selectedMember?.name || '' }) // pt('t028') -> {{name}} 회원 횟수권 충전
                  : pt('t038', { name: selectedMember?.name || '' }) // pt('t038') -> {{name}} 회원 금액 충전
              }
              onClose={closeRechargeModal}
              icon={<CreditCard size={20} className="text-primary" />}
            >
              <div className="p-6">
                <form onSubmit={handleRecharge} className="space-y-4">
                  {/* 유형 선택 (스위치 탭 형태) */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t040')}</label> {/* pt('t040') -> 충전 유형 */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRechargeType('BALANCE');
                          if (receivedAmount === '') setReceivedAmount('0');
                        }}
                        className={`py-2 border rounded-lg text-xs font-bold transition-all ${rechargeType === 'BALANCE'
                          ? 'border-primary text-primary bg-primary/5'
                          : 'border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
                          }`}
                      >
                        {pt('t037')} {/* 금액 충전 */}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRechargeType('COUPON');
                          setReceivedAmount('');
                        }}
                        className={`py-2 border rounded-lg text-xs font-bold transition-all ${rechargeType === 'COUPON'
                          ? 'border-primary text-primary bg-primary/5'
                          : 'border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
                          }`}
                      >
                        {pt('t027')} {/* 횟수권 충전 */}
                      </button>
                    </div>
                  </div>

                  {/* 선택 회원 현재 잔액 정보 노출 */}
                  {selectedMember && (
                    <p className="text-xs text-slate-500">{pt('t039', { amount: selectedMember.balance.toLocaleString() })}</p>
                    // pt('t039') -> 현재 충전금 잔액: ¥{{amount}}
                  )}

                  {/* 유형별 동적 폼 영역 */}
                  <div className="space-y-4">
                    {rechargeType === 'COUPON' ? (
                      /** 1. 횟수권 충전 폼 */
                      <>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-500 uppercase">{pt('t007')}</label> {/* pt('t007') -> 시술 선택 */}
                          <select
                            value={selectedServiceId}
                            onChange={(e) => setSelectedServiceId(Number(e.target.value))}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                          >
                            {serviceOptions.length === 0 ? (
                              <option value={0}>{pt('t008')}</option> // pt('t008') -> 시술 항목 없음
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
                          <label className="text-xs font-bold text-slate-500 uppercase">{pt('t011')}</label> {/* pt('t011') -> 충전 횟수 */}
                          <div className="relative">
                            <Ticket size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              type="number"
                              required={rechargeType === 'COUPON'}
                              value={couponCount}
                              onChange={(e) => setCouponCount(e.target.value)}
                              className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                              placeholder="0"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-500 uppercase">{pt('t002')}</label> {/* pt('t002') -> 받은 금액 (¥) */}
                          <div className="relative">
                            <JapaneseYen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              type="number"
                              required
                              min={0}
                              value={amount}
                              onChange={(e) => setAmount(e.target.value)}
                              className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                              placeholder="0"
                            />
                          </div>
                        </div>
                        {/* 빠른 금액 추가 버튼 */}
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
                      </>
                    ) : (
                      /** 2. 금액 충전 폼 */
                      <>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-500 uppercase">{pt('t045')}</label> {/* pt('t045') -> 충전 금액 (¥) */}
                          <div className="relative">
                            <JapaneseYen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              type="number"
                              required
                              min={1}
                              value={amount}
                              onChange={(e) => setAmount(e.target.value)}
                              className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                              placeholder="0"
                            />
                          </div>
                        </div>
                        {/* 빠른 금액 추가 버튼 */}
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
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-500 uppercase">{pt('t002')}</label> {/* 받은 금액 */}
                          <div className="relative">
                            <JapaneseYen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              type="number"
                              required={rechargeType === 'BALANCE'}
                              min={0}
                              value={receivedAmount}
                              onChange={(e) => setReceivedAmount(e.target.value)}
                              className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* 결제 수단 선택 (공통코드 버튼 형태) */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t001')}</label> {/* pt('t001') -> 결제 수단 */}
                    <div className="grid grid-cols-3 gap-2">
                      {paymentMethodOptions.map((method) => (
                        <button
                          key={method.code}
                          type="button"
                          onClick={() => setPaymentMethodCode(method.code)}
                          className={`py-2 border rounded-lg text-[10px] font-bold transition-all ${paymentMethodCode === method.code
                            ? 'border-primary text-primary bg-primary/5'
                            : 'border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
                            }`}
                        >
                          {getPaymentMethodLabelByCode(method.code, method.label)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 하단 제어 버튼 */}
                  <div className="flex gap-3 pt-4">
                    <button
                      type="button"
                      onClick={closeRechargeModal}
                      className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                    >
                      {pt('t029')} {/* pt('t029') -> 취소 */}
                    </button>
                    <button
                      type="submit"
                      disabled={isMutating}
                      className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                    >
                      {pt('t030')} {/* pt('t030') -> 충전하기 */}
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

/**
 * 드래그 핸들을 지원하는 공통 팝업 레이아웃 컴포넌트
 */
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
  // 모달 헤더의 드래그 핸들을 명시적으로 제어하기 위한 훅
  const dragControls = useDragControls();

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false} // 헤더 부분만 드래그 가능하도록 설정
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative"
    >
      {/* 헤더 부분: 실제 드래그 핸들이 위치함 */}
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
      {/* 본문 콘텐츠가 렌더링되는 영역 */}
      {children}
    </motion.div>
  );
}
