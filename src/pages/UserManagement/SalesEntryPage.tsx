import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { BadgeDollarSign, PlusCircle, Receipt, Scissors, Trash2, UserRound } from 'lucide-react';

type PaymentMethod = 'WECHAT' | 'ALIPAY' | 'CASH';

type SalesRecord = {
  id: number;
  visitDate: string;
  customerName: string;
  designerName: string;
  serviceName: string;
  originalAmount: number;
  actualAmount: number;
  paymentMethod: PaymentMethod;
  note: string;
};

type SalesForm = {
  visitDate: string;
  customerName: string;
  designerName: string;
  serviceName: string;
  originalAmount: string;
  actualAmount: string;
  paymentMethod: PaymentMethod;
  note: string;
};

const DESIGNER_OPTIONS = ['지나 디자이너', '리안 디자이너', '민아 디자이너', '수아 디자이너'];
const SERVICE_OPTIONS = ['커트', '파마', '염색', '클리닉'];

function todayIso() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const INITIAL_FORM: SalesForm = {
  visitDate: todayIso(),
  customerName: '',
  designerName: DESIGNER_OPTIONS[0],
  serviceName: SERVICE_OPTIONS[0],
  originalAmount: '',
  actualAmount: '',
  paymentMethod: 'WECHAT',
  note: '',
};

const INITIAL_RECORDS: SalesRecord[] = [
  {
    id: 1,
    visitDate: todayIso(),
    customerName: '김서연',
    designerName: '지나 디자이너',
    serviceName: '커트',
    originalAmount: 30000,
    actualAmount: 27000,
    paymentMethod: 'WECHAT',
    note: '회원 10% 할인',
  },
  {
    id: 2,
    visitDate: todayIso(),
    customerName: '박민지',
    designerName: '민아 디자이너',
    serviceName: '염색',
    originalAmount: 90000,
    actualAmount: 90000,
    paymentMethod: 'ALIPAY',
    note: '',
  },
];

function paymentMethodLabel(method: PaymentMethod) {
  if (method === 'WECHAT') return '위챗';
  if (method === 'ALIPAY') return '알리페이';
  return '현금';
}

function formatCurrency(value: number) {
  return `${value.toLocaleString('ko-KR')}원`;
}

export default function SalesEntryPage() {
  const [records, setRecords] = useState<SalesRecord[]>(INITIAL_RECORDS);
  const [form, setForm] = useState<SalesForm>(INITIAL_FORM);

  const summary = useMemo(() => {
    const totalOriginal = records.reduce((sum, record) => sum + record.originalAmount, 0);
    const totalActual = records.reduce((sum, record) => sum + record.actualAmount, 0);

    const byMethod: Record<PaymentMethod, number> = { WECHAT: 0, ALIPAY: 0, CASH: 0 };
    records.forEach((record) => {
      byMethod[record.paymentMethod] += record.actualAmount;
    });

    return {
      totalOriginal,
      totalActual,
      discountAmount: totalOriginal - totalActual,
      byMethod,
    };
  }, [records]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const originalAmount = Number(form.originalAmount);
    const actualAmount = Number(form.actualAmount);

    if (!form.visitDate || !form.customerName.trim() || !form.designerName || !form.serviceName) {
      alert('매출 등록 필수값(방문일자, 고객, 디자이너, 시술)을 입력해 주세요.');
      return;
    }

    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      alert('원가를 0보다 큰 숫자로 입력해 주세요.');
      return;
    }

    if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
      alert('실결제 금액을 0보다 큰 숫자로 입력해 주세요.');
      return;
    }

    const nextId = records.length > 0 ? Math.max(...records.map((record) => record.id)) + 1 : 1;
    const nextRecord: SalesRecord = {
      id: nextId,
      visitDate: form.visitDate,
      customerName: form.customerName.trim(),
      designerName: form.designerName,
      serviceName: form.serviceName,
      originalAmount,
      actualAmount,
      paymentMethod: form.paymentMethod,
      note: form.note.trim(),
    };

    setRecords((prev) => [nextRecord, ...prev]);
    setForm((prev) => ({
      ...prev,
      customerName: '',
      originalAmount: '',
      actualAmount: '',
      note: '',
    }));
  };

  const deleteRecord = (id: number) => {
    if (!window.confirm('선택한 매출 내역을 삭제하시겠습니까?')) return;
    setRecords((prev) => prev.filter((record) => record.id !== id));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">매출 등록</h1>
          <p className="text-slate-500 mt-1">방문 고객 시술 매출과 결제수단(위챗/알리페이/현금)을 등록합니다.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid-shadow">
          <p className="text-xs font-bold text-slate-500 uppercase mb-2">원가 합계</p>
          <p className="text-2xl font-black text-slate-900">{formatCurrency(summary.totalOriginal)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid-shadow">
          <p className="text-xs font-bold text-slate-500 uppercase mb-2">실매출 합계</p>
          <p className="text-2xl font-black text-slate-900">{formatCurrency(summary.totalActual)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid-shadow">
          <p className="text-xs font-bold text-slate-500 uppercase mb-2">할인 금액 합계</p>
          <p className="text-2xl font-black text-slate-900">{formatCurrency(summary.discountAmount)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 grid-shadow">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4">
            <PlusCircle size={16} className="text-primary" />
            매출 입력
          </h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">방문일자</label>
              <input
                type="date"
                value={form.visitDate}
                onChange={(event) => setForm((prev) => ({ ...prev, visitDate: event.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">고객명</label>
              <input
                value={form.customerName}
                onChange={(event) => setForm((prev) => ({ ...prev, customerName: event.target.value }))}
                placeholder="예) 이지은"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">디자이너</label>
              <select
                value={form.designerName}
                onChange={(event) => setForm((prev) => ({ ...prev, designerName: event.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              >
                {DESIGNER_OPTIONS.map((designer) => (
                  <option key={designer} value={designer}>
                    {designer}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">시술 항목</label>
              <select
                value={form.serviceName}
                onChange={(event) => setForm((prev) => ({ ...prev, serviceName: event.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              >
                {SERVICE_OPTIONS.map((service) => (
                  <option key={service} value={service}>
                    {service}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">원가(원)</label>
                <input
                  type="number"
                  value={form.originalAmount}
                  onChange={(event) => setForm((prev) => ({ ...prev, originalAmount: event.target.value }))}
                  placeholder="90000"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">실금액(원)</label>
                <input
                  type="number"
                  value={form.actualAmount}
                  onChange={(event) => setForm((prev) => ({ ...prev, actualAmount: event.target.value }))}
                  placeholder="80000"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">결제수단</label>
              <select
                value={form.paymentMethod}
                onChange={(event) => setForm((prev) => ({ ...prev, paymentMethod: event.target.value as PaymentMethod }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              >
                <option value="WECHAT">위챗</option>
                <option value="ALIPAY">알리페이</option>
                <option value="CASH">현금</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">비고</label>
              <textarea
                rows={3}
                value={form.note}
                onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                placeholder="할인 사유, 특이사항 등"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none resize-none"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <PlusCircle size={16} />
              매출 등록
            </button>
          </form>
        </section>

        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <Receipt size={16} className="text-primary" />
              매출 내역
            </h2>
            <div className="text-xs font-semibold text-slate-500">
              위챗 {formatCurrency(summary.byMethod.WECHAT)} / 알리페이 {formatCurrency(summary.byMethod.ALIPAY)} / 현금{' '}
              {formatCurrency(summary.byMethod.CASH)}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[1020px]">
              <thead>
                <tr className="bg-slate-900 text-slate-200">
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">방문일자</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">고객</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">디자이너</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">시술</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-right">원가</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-right">실금액</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-right">할인</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">결제수단</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">비고</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-center">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-sm text-slate-400">
                      등록된 매출이 없습니다.
                    </td>
                  </tr>
                ) : (
                  records.map((record) => (
                    <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 text-sm text-slate-700">{record.visitDate}</td>
                      <td className="py-3 px-4 text-sm text-slate-700">
                        <div className="flex items-center gap-2">
                          <UserRound size={14} className="text-slate-400" />
                          <span className="font-semibold">{record.customerName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-600">{record.designerName}</td>
                      <td className="py-3 px-4 text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                          <Scissors size={14} className="text-slate-400" />
                          {record.serviceName}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm text-right text-slate-600">{formatCurrency(record.originalAmount)}</td>
                      <td className="py-3 px-4 text-sm text-right font-semibold text-slate-800">
                        {formatCurrency(record.actualAmount)}
                      </td>
                      <td className="py-3 px-4 text-sm text-right text-rose-600 font-semibold">
                        {formatCurrency(record.originalAmount - record.actualAmount)}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-600">{paymentMethodLabel(record.paymentMethod)}</td>
                      <td className="py-3 px-4 text-sm text-slate-500">{record.note || '-'}</td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => deleteRecord(record.id)}
                          className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="mt-6 bg-white border border-slate-200 rounded-xl p-4 grid-shadow">
        <p className="text-sm text-slate-700 flex items-center gap-2">
          <BadgeDollarSign size={16} className="text-primary" />
          원가와 실금액은 건별로 유동적으로 입력 가능하며, 할인은 자동으로 계산됩니다.
        </p>
      </div>
    </motion.div>
  );
}
