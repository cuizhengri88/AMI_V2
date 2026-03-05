import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  TrendingUp, 
  Calendar, 
  ArrowUpRight, 
  ArrowDownRight, 
  DollarSign, 
  ShoppingCart, 
  Users, 
  Download,
  Filter,
  RotateCcw,
  AlertCircle
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  AreaChart,
  Area,
  ComposedChart
} from 'recharts';

const dailyData = [
  { name: '03-01', totalSales: 420000, totalQty: 12, refunds: 25000, refundQty: 1, netSales: 395000, netQty: 11 },
  { name: '03-02', totalSales: 380000, totalQty: 10, refunds: 0, refundQty: 0, netSales: 380000, netQty: 10 },
  { name: '03-03', totalSales: 510000, totalQty: 15, refunds: 45000, refundQty: 2, netSales: 465000, netQty: 13 },
  { name: '03-04', totalSales: 480000, totalQty: 14, refunds: 15000, refundQty: 1, netSales: 465000, netQty: 13 },
  { name: '03-05', totalSales: 620000, totalQty: 18, refunds: 30000, refundQty: 1, netSales: 590000, netQty: 17 },
  { name: '03-06', totalSales: 750000, totalQty: 22, refunds: 120000, refundQty: 4, netSales: 630000, netQty: 18 },
  { name: '03-07', totalSales: 810000, totalQty: 25, refunds: 20000, refundQty: 1, netSales: 790000, netQty: 24 },
];

const monthlyData = [
  { name: '10월', totalSales: 12500000, totalQty: 350, refunds: 850000, refundQty: 24, netSales: 11650000, netQty: 326 },
  { name: '11월', totalSales: 15800000, totalQty: 420, refunds: 1200000, refundQty: 32, netSales: 14600000, netQty: 388 },
  { name: '12월', totalSales: 21000000, totalQty: 580, refunds: 1800000, refundQty: 45, netSales: 19200000, netQty: 535 },
  { name: '1월', totalSales: 14200000, totalQty: 380, refunds: 950000, refundQty: 28, netSales: 13250000, netQty: 352 },
  { name: '2월', totalSales: 13500000, totalQty: 360, refunds: 1100000, refundQty: 30, netSales: 12400000, netQty: 330 },
  { name: '3월', totalSales: 18900000, totalQty: 510, refunds: 1450000, refundQty: 38, netSales: 17450000, netQty: 472 },
];

const categoryData = [
  { name: '상의', value: 45 },
  { name: '하의', value: 30 },
  { name: '아우터', value: 15 },
  { name: '액세서리', value: 10 },
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

export default function SalesStatisticsPage() {
  const [period, setPeriod] = useState<'daily' | 'monthly' | 'custom'>('daily');
  const [startDate, setStartDate] = useState('2024-03-01');
  const [endDate, setEndDate] = useState('2024-03-07');

  const activeData = period === 'monthly' ? monthlyData : dailyData;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">매출 통계</h1>
          <p className="text-slate-500 mt-1">판매액, 수량, 환불 현황을 종합 분석합니다.</p>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <div className="flex bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
            <button 
              onClick={() => setPeriod('daily')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${period === 'daily' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              일간
            </button>
            <button 
              onClick={() => setPeriod('monthly')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${period === 'monthly' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              월간
            </button>
            <button 
              onClick={() => setPeriod('custom')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${period === 'custom' ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              기간 선택
            </button>
          </div>
          
          {period === 'custom' && (
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1 shadow-sm">
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="text-xs font-bold text-slate-600 outline-none bg-transparent"
              />
              <span className="text-slate-300">~</span>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="text-xs font-bold text-slate-600 outline-none bg-transparent"
              />
            </div>
          )}

          <button className="bg-white border border-slate-200 text-slate-700 text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-all active:scale-95">
            <Download size={18} />
            엑셀 다운로드
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Total Sales */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 grid-shadow relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <DollarSign size={80} />
          </div>
          <div className="relative z-10">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">총 판매 현황</p>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-slate-500 mb-1">총 판매금액</p>
                <p className="text-3xl font-black text-slate-900">₩18,900,000</p>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <span className="text-sm text-slate-500">총 판매수량</span>
                <span className="text-lg font-black text-primary">510 <span className="text-xs font-medium text-slate-400">pcs</span></span>
              </div>
            </div>
          </div>
        </div>

        {/* Refunds */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 grid-shadow relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <RotateCcw size={80} className="text-rose-500" />
          </div>
          <div className="relative z-10">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">환불 현황</p>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-slate-500 mb-1">환불 금액</p>
                <p className="text-3xl font-black text-rose-600">₩1,450,000</p>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <span className="text-sm text-slate-500">환불 수량</span>
                <span className="text-lg font-black text-rose-600">38 <span className="text-xs font-medium text-slate-400">pcs</span></span>
              </div>
            </div>
          </div>
        </div>

        {/* Net Sales */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 grid-shadow relative overflow-hidden group bg-gradient-to-br from-white to-emerald-50/30">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <TrendingUp size={80} className="text-emerald-500" />
          </div>
          <div className="relative z-10">
            <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-4">순 판매 현황 (Net)</p>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-slate-500 mb-1">순 판매금액</p>
                <p className="text-3xl font-black text-emerald-600">₩17,450,000</p>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-emerald-100">
                <span className="text-sm text-slate-500">순 판매수량</span>
                <span className="text-lg font-black text-emerald-600">472 <span className="text-xs font-medium text-slate-400">pcs</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        {/* Main Sales & Refund Chart */}
        <div className="lg:col-span-12 bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <TrendingUp size={16} className="text-primary" />
              {period === 'monthly' ? '월간 매출 및 수량 종합 추이' : '일간 매출 및 수량 종합 추이'}
            </h3>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-1.5">
                <div className="size-2.5 rounded bg-blue-500" />
                <span className="text-[11px] font-bold text-slate-500 uppercase">총 판매금액</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="size-2.5 rounded bg-emerald-500" />
                <span className="text-[11px] font-bold text-slate-500 uppercase">순 판매금액</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="size-2.5 rounded bg-rose-500" />
                <span className="text-[11px] font-bold text-slate-500 uppercase">환불금액</span>
              </div>
            </div>
          </div>
          <div className="p-6 h-[450px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={activeData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} 
                />
                <YAxis 
                  yAxisId="left"
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 11, fill: '#64748b' }} 
                  tickFormatter={(value) => period === 'monthly' ? `₩${value/1000000}M` : `₩${value/10000}W`}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 11, fill: '#94a3b8' }} 
                  tickFormatter={(value) => `${value}pcs`}
                />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: '1px solid #e2e8f0', 
                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                    padding: '12px'
                  }}
                  itemStyle={{ fontSize: '12px', fontWeight: 600, padding: '2px 0' }}
                />
                <Legend verticalAlign="top" height={36} iconType="rect" wrapperStyle={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }} />
                
                <Bar yAxisId="left" name="총 판매금액" dataKey="totalSales" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} />
                <Bar yAxisId="left" name="순 판매금액" dataKey="netSales" fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} />
                <Bar yAxisId="left" name="환불금액" dataKey="refunds" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={30} />
                
                <Line yAxisId="right" type="monotone" name="총 판매수량" dataKey="totalQty" stroke="#6366f1" strokeWidth={3} dot={{ r: 4, fill: '#6366f1' }} />
                <Line yAxisId="right" type="monotone" name="순 판매수량" dataKey="netQty" stroke="#059669" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: '#059669' }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        {/* Refund Quantity Distribution */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h3 className="text-sm font-bold text-slate-700">환불 사유 및 수량 통계</h3>
          </div>
          <div className="p-6 h-[350px] flex flex-col">
            <div className="flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: '단순변심', value: 40 },
                      { name: '사이즈부적합', value: 35 },
                      { name: '배송지연', value: 15 },
                      { name: '상품불량', value: 10 },
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2">
              {[
                { name: '단순변심', value: 40, color: COLORS[0] },
                { name: '사이즈부적합', value: 35, color: COLORS[1] },
                { name: '배송지연', value: 15, color: COLORS[2] },
                { name: '상품불량', value: 10, color: COLORS[3] },
              ].map((item) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-[11px] font-medium text-slate-600">{item.name}</span>
                  </div>
                  <span className="text-[11px] font-bold text-slate-900">{item.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Refund Details Table */}
      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <RotateCcw size={16} className="text-rose-500" />
            최근 환불 발생 내역
          </h3>
          <button className="text-xs text-primary font-bold hover:underline">전체보기</button>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider">주문번호</th>
              <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider">상품명</th>
              <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider text-center">환불수량</th>
              <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider text-right">환불금액</th>
              <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider text-center">사유</th>
              <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider text-center">처리일시</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              { id: 'ORD-2024-003', name: '오버사이즈 후드티', qty: 1, amount: 45000, reason: '사이즈부적합', date: '2024-03-04 11:10' },
              { id: 'ORD-2024-005', name: '와이드 슬랙스', qty: 1, amount: 49000, reason: '단순변심', date: '2024-03-03 16:20' },
              { id: 'ORD-2024-012', name: '베이직 코튼 티셔츠', qty: 2, amount: 58000, reason: '상품불량', date: '2024-03-02 14:45' },
              { id: 'ORD-2024-015', name: '린넨 셔츠', qty: 1, amount: 39000, reason: '배송지연', date: '2024-03-01 09:30' },
            ].map((item) => (
              <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                <td className="py-3 px-6 text-sm font-mono font-bold text-slate-500">{item.id}</td>
                <td className="py-3 px-6 text-sm font-bold text-slate-900">{item.name}</td>
                <td className="py-3 px-6 text-sm text-center text-slate-600 font-bold">{item.qty}</td>
                <td className="py-3 px-6 text-sm text-right font-bold text-rose-600">₩{item.amount.toLocaleString()}</td>
                <td className="py-3 px-6 text-center">
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 rounded text-slate-600 border border-slate-200">
                    {item.reason}
                  </span>
                </td>
                <td className="py-3 px-6 text-center text-xs text-slate-400">{item.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
