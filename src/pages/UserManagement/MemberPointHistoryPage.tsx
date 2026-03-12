import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Filter, History, User, RotateCcw, X, Calendar } from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';
import { formatCurrency, formatDateTimeYmdHms, toDateOnly } from '../utils/pageCommon';

/**
 * 회원 선택 드롭다운에서 사용하는 회원 요약 정보
 */
type MemberOption = {
  id: number;   // 회원 고유 ID (DB user_id 대응)
  name: string; // 회원명
};

/**
 * 포인트/쿠폰 이력 테이블의 1행 데이터 모델
 */
type PointHistoryItem = {
  id: number;                // 이력 고유 ID
  actionType: 'RECHARGE' | 'USE'; // 작업 유형 (RECHARGE: 충전, USE: 사용)
  userId: number;            // 회원 고유 번호
  userName: string;          // 회원명
  userPhone: string;         // 회원 연락처
  rechargeType: string;      // 충전 유형 (BALANCE: 잔액, COUPON: 쿠폰 등)
  amount: number | null;     // 충전/사용 시 설정된 금액
  receivedAmount: number | null; // 실제 결제/수령 금액
  serviceName: string | null;    // 대상 시술명 (쿠폰의 경우)
  couponCount: number | null;    // 쿠폰 수량 변화량
  paymentMethodName: string;     // 결제 수단 명칭 (현금, 카드 등)
  memo: string;              // 관리자 비고 또는 메모
  createdAt: string;         // 생성 일시
  isCancelled: boolean;      // 취소 여부 (충전 취소 시 true)
  cancelReason: string | null;   // 취소 사유
  cancelledAt: string | null;    // 취소 일시
};

/**
 * 회원 포인트 내역 조회 페이지 컴포넌트
 */
export default function MemberPointHistoryPage() {
  // 페이지 전용 다국어 훅 (user_management_member_point_history 영역)
  const pt = usePageText('user_management_member_point_history');

  /**
   * 상태 관리 (useState)
   * histories: 로드된 전체 포인트 이력 원본
   * members: 조회 필터용 회원 목록
   * isLoading, isMutating: 로딩 및 작업 중 상태 제어
   * filters: 회원 필터, 작업 유형 필터, 검색 키워드, 기간 필터(시작/종료)
   */
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const isBusy = isLoading || isMutating;

  const [members, setMembers] = useState<MemberOption[]>([]);
  const [histories, setHistories] = useState<PointHistoryItem[]>([]);

  const [selectedMemberId, setSelectedMemberId] = useState('all');
  const [actionFilter, setActionFilter] = useState<'all' | 'RECHARGE' | 'USE' | 'RECHARGE_CANCELLED'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 충전 취소 모달 관련 상태
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PointHistoryItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  /**
   * 서버로부터 회원 목록 및 전체 포인트 이력을 로드합니다.
   */
  const loadData = async () => {
    try {
      setIsLoading(true);
      const result = await invokeDbCommand<{
        success: boolean;
        message: string;
        members: Array<{ user_id: number; user_name: string }>;
        histories: Array<{
          id: number;
          action_type: 'RECHARGE' | 'USE';
          user_id: number;
          user_name: string;
          user_phone: string | null;
          recharge_type: string;
          amount: number | null;
          received_amount: number | null;
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

      // 회원 목록 가공 및 정렬
      setMembers(
        (result.members || [])
          .map((member) => ({
            id: member.user_id,
            name: member.user_name,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );

      // 포인트 이력 데이터를 프론트엔드 모델로 매핑
      setHistories(
        (result.histories || []).map((item) => ({
          id: item.id,
          actionType: item.action_type,
          userId: item.user_id,
          userName: item.user_name,
          userPhone: item.user_phone || '',
          rechargeType: item.recharge_type,
          amount: item.amount,
          receivedAmount: item.received_amount,
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
      alert(typeof error === 'string' ? error : error?.message || pt('t024')); // pt('t024') -> 회원 포인트 이력을 불러오지 못했습니다.
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 컴포넌트 마운트 시 최초 데이터 로드
   */
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 선택된 필터링 조건(회원, 유형, 검색어, 기간)에 따라 표시할 이력 목록을 계산합니다.
   */
  const filteredHistories = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    return histories.filter((item) => {
      // 1. 기간(날짜) 필터링
      const day = toDateOnly(item.createdAt);
      if (startDate && (!day || day < startDate)) return false;
      if (endDate && (!day || day > endDate)) return false;

      // 2. 특정 회원 선택 필터링
      if (selectedMemberId !== 'all' && String(item.userId) !== selectedMemberId) return false;

      // 3. 작업 유형(충전/사용/취소) 필터링
      if (actionFilter === 'RECHARGE' && (item.actionType !== 'RECHARGE' || item.isCancelled)) return false;
      if (actionFilter === 'USE' && item.actionType !== 'USE') return false;
      if (
        actionFilter === 'RECHARGE_CANCELLED' &&
        (item.actionType !== 'RECHARGE' || !item.isCancelled)
      ) {
        return false;
      }

      // 4. 통합 검색어 필터링 (회원명, 전화번호, 시술명, 결제수단, 메모, 취소사유)
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
  }, [actionFilter, endDate, histories, searchTerm, selectedMemberId, startDate]);

  /**
   * 현재 필터링된 결과에 대한 요약 통계(충전, 사용, 취소 건수)를 산출합니다.
   */
  const summary = useMemo(() => {
    // reduce를 사용하여 한 번의 순회로 모든 통계 카운트 계산
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

  /**
   * 충전 취소 모달 오픈 핸들러
   * @param item 취소할 충전 내역 객체
   */
  const openCancelModal = (item: PointHistoryItem) => {
    // 이미 취소되었거나 사용건은 취소 불가
    if (item.actionType !== 'RECHARGE' || item.isCancelled) return;
    setCancelTarget(item);
    setCancelReason('');
    setIsCancelModalOpen(true);
  };

  /**
   * 취소 모달 닫기
   */
  const closeCancelModal = () => {
    setIsCancelModalOpen(false);
    setCancelTarget(null);
    setCancelReason('');
  };

  /**
   * 충전 취소 확정 처리 (DB 업데이트)
   */
  const handleCancelRecharge = async () => {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();

    // 필수 사유 입력 확인
    if (!reason) {
      alert(pt('t017')); // pt('t017') -> 취소 사유를 입력해주세요.
      return;
    }

    try {
      setIsMutating(true);
      // DB에 충전 취소 커맨드 전송 (내부적으로 잔액/횟수 차감 등을 수행)
      const result = await invokeDbCommand<{ success: boolean; message: string }>('cancel_member_point_recharge', {
        history_id: cancelTarget.id,
        cancel_reason: reason,
      });
      alert(result.message || pt('t025')); // pt('t025') -> 충전 취소가 완료되었습니다.

      closeCancelModal();
      await loadData(); // 최신 데이터로 리로드
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t026')); // pt('t026') -> 충전 취소에 실패했습니다.
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <LoadingOverlay visible={isBusy} />

      {/* 페이지 타이틀 */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            {pt('t022')} {/* pt('t022') -> 회원포인트 내역 */}
          </h1>
          <p className="text-slate-500 mt-1">
            {pt('t021')} {/* pt('t021') -> 회원별 충전/사용 이력을 상세 조회하고 충전을 취소할 수 있습니다. */}
          </p>
        </div>
      </div>

      {/* 상단 요약 카드 섹션 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* 전체 조회 건수 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <History size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pt('t011')}</p> {/* pt('t011') -> 조회 건수 */}
            <p className="text-2xl font-black text-slate-900">{pt('t027', { count: filteredHistories.length })}</p> {/* pt('t027') -> {{count}}건 */}
          </div>
        </div>
        {/* 충전 건수 요약 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <User size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pt('t013')}</p> {/* pt('t013') -> 충전 내역 */}
            <p className="text-2xl font-black text-slate-900">{pt('t027', { count: summary.rechargeCount })}</p>
          </div>
        </div>
        {/* 취소 건수 요약 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
            <RotateCcw size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pt('t018')}</p> {/* pt('t018') -> 취소 처리 */}
            <p className="text-2xl font-black text-slate-900">{pt('t027', { count: summary.cancelledCount })}</p>
          </div>
        </div>
      </div>

      {/* 검색 및 필터 컨트롤 영역 */}
      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* 통합 키워드 검색 */}
          <div className="relative lg:col-span-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder={pt('t020')} // pt('t020') -> 회원명/전화번호/시술명/메모/취소사유 검색...
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>

          {/* 기간 선택 (시작일 ~ 종료일) */}
          <div className="lg:col-span-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate || undefined}
                aria-label={pt('t038')} // pt('t038') -> 시작일
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>
            <span className="text-slate-300 text-sm font-bold">~</span>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
                aria-label={pt('t039')} // pt('t039') -> 종료일
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>
          </div>

          {/* 특정 회원 필터링 */}
          <select
            value={selectedMemberId}
            onChange={(e) => setSelectedMemberId(e.target.value)}
            className="lg:col-span-2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
          >
            <option value="all">{pt('t010')}</option> {/* pt('t010') -> 전체 회원 */}
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>

          {/* 작업 유형 필터링 */}
          <select
            value={actionFilter}
            onChange={(e) =>
              setActionFilter(e.target.value as 'all' | 'RECHARGE' | 'USE' | 'RECHARGE_CANCELLED')
            }
            className="lg:col-span-2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
          >
            <option value="all">{pt('t009')}</option> {/* pt('t009') -> 전체 유형 */}
            <option value="RECHARGE">{pt('t012')}</option> {/* pt('t012') -> 충전 */}
            <option value="RECHARGE_CANCELLED">{pt('t014')}</option> {/* pt('t014') -> 충전 취소 */}
            <option value="USE">{pt('t005')}</option> {/* pt('t005') -> 사용 */}
          </select>
        </div>

        {/* 내역 목록 테이블 리스트 */}
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t008')}</th> {/* pt('t008') -> 일시 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t007')}</th> {/* pt('t007') -> 유형 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t019')}</th> {/* pt('t019') -> 회원 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t028')}</th> {/* pt('t028') -> 전화번호 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t006')}</th> {/* pt('t006') -> 시술 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">{pt('t023')}</th> {/* pt('t023') -> 횟수 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">{pt('t003')}</th> {/* pt('t003') -> 금액 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">{pt('t040')}</th> {/* pt('t040') -> 수납금액 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t001')}</th> {/* pt('t001') -> 결제수단 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t004')}</th> {/* pt('t004') -> 메모/취소사유 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t002')}</th> {/* pt('t002') -> 관리 */}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredHistories.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-10 text-center text-sm text-slate-400">
                  {pt('t029')} {/* pt('t029') -> 조회된 이력이 없습니다. */}
                </td>
              </tr>
            ) : (
              filteredHistories.map((item) => {
                // 횟수권 변화량 텍스트 생성 (+/-, 횟수)
                const signedCoupon = item.couponCount
                  ? item.actionType === 'RECHARGE'
                    ? pt('t030', { count: item.couponCount }) // pt('t030') -> +{{count}}회
                    : pt('t031', { count: item.couponCount }) // pt('t031') -> -{{count}}회
                  : '-';

                // 포인트 금액 변화량 텍스트 생성 (+/-, 금액)
                const signedAmount =
                  item.amount == null
                    ? '-'
                    : item.actionType === 'RECHARGE'
                      ? `+${formatCurrency(item.amount)}`
                      : `-${formatCurrency(item.amount)}`;

                // 실제 결제된 수납 금액 결정
                const receivedAmount =
                  item.actionType === 'RECHARGE' ? (item.receivedAmount ?? item.amount) : null;
                const receivedAmountText =
                  receivedAmount == null ? '-' : formatCurrency(receivedAmount);

                return (
                  <tr key={`${item.actionType}-${item.id}`} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6 text-xs text-slate-500">{formatDateTimeYmdHms(item.createdAt)}</td>
                    <td className="py-4 px-6">
                      {item.actionType === 'RECHARGE' ? (
                        item.isCancelled ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            {pt('t032')} {/* pt('t032') -> 충전(취소) */}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {pt('t012')} {/* pt('t012') -> 충전 */}
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          {pt('t005')} {/* pt('t005') -> 사용 */}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-sm font-semibold text-slate-800">{item.userName}</td>
                    <td className="py-4 px-6 text-sm text-slate-600 font-mono">{item.userPhone || '-'}</td>
                    <td className="py-4 px-6 text-sm text-slate-600">{item.serviceName || '-'}</td>
                    <td className="py-4 px-6 text-sm text-right font-bold text-slate-700">{signedCoupon}</td>
                    <td
                      className={`py-4 px-6 text-sm text-right font-bold ${item.actionType === 'RECHARGE' ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                    >
                      {signedAmount}
                    </td>
                    <td className="py-4 px-6 text-sm text-right font-bold text-slate-700">{receivedAmountText}</td>
                    <td className="py-4 px-6 text-xs text-slate-500">{item.paymentMethodName || '-'}</td>
                    <td className="py-4 px-6 text-xs text-slate-500">
                      <div>{item.memo || '-'}</div>
                      {/* 취소된 건인 경우 취소 사유와 일시를 추가 노출 */}
                      {item.isCancelled && (
                        <div className="text-rose-600 mt-1">
                          {pt('t033', {
                            reason: item.cancelReason || '-',
                            date: formatDateTimeYmdHms(item.cancelledAt || ''),
                          })} {/* pt('t033') -> 취소사유: {{reason}} ({{date}}) */}
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {/* 충전 완료 상태이고 아직 취소되지 않은 건만 취소 버튼 활성화 */}
                      {item.actionType === 'RECHARGE' && !item.isCancelled ? (
                        <button
                          type="button"
                          onClick={() => openCancelModal(item)}
                          className="px-2.5 py-1 text-[11px] font-bold rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                        >
                          {pt('t034')} {/* pt('t034') -> 취소 */}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 충전 취소 레이어 모달 */}
      <AnimatePresence>
        {isCancelModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
            >
              {/* 모달 헤더 */}
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-900">
                  {pt('t014')} {/* pt('t014') -> 충전 취소 */}
                </h3>
                <button onClick={closeCancelModal} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
                  <X size={18} />
                </button>
              </div>

              {/* 모달 본문 */}
              <div className="p-5 space-y-4">
                {/* 취소 대상 정보 요약 */}
                <div className="text-sm text-slate-600">
                  {pt('t035')}: <span className="font-semibold text-slate-900">{cancelTarget?.userName}</span> /{' '}
                  <span className="font-semibold text-slate-900">{cancelTarget?.serviceName || '-'}</span>
                  {/* pt('t035') -> 선택 이력 */}
                </div>
                {/* 취소 사유 입력 필드 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">
                    {pt('t015')} {/* pt('t015') -> 취소 사유 */}
                  </label>
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    rows={4}
                    placeholder={pt('t016')} // pt('t016') -> 취소 사유를 입력하세요.
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none resize-none"
                  />
                </div>
                {/* 하단 제어 버튼 */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeCancelModal}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200"
                  >
                    {pt('t036')} {/* pt('t036') -> 닫기 */}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelRecharge}
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-rose-600 text-white text-sm font-bold rounded-lg hover:bg-rose-500 disabled:opacity-60"
                  >
                    {pt('t037')} {/* pt('t037') -> 취소 확정 */}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
