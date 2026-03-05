import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  History as HistoryIcon, 
  Search, 
  Filter, 
  ArrowUpRight, 
  ArrowDownLeft,
  Calendar,
  Download
} from 'lucide-react';

const initialHistory = [
  { id: 1, date: '2024-03-04 14:20', productId: 'P001', productName: '베이직 코튼 티셔츠', type: 'IN', quantity: 50, user: '홍길동', note: '정기 입고' },
  { id: 2, date: '2024-03-04 13:15', productId: 'P002', productName: '슬림핏 데님 팬츠', type: 'OUT', quantity: 5, user: '김철수', note: '매장 판매' },
  { id: 3, date: '2024-03-04 11:00', productId: 'P005', productName: '와이드 슬랙스', type: 'IN', quantity: 20, user: '이영희', note: '반품 입고' },
  { id: 4, date: '2024-03-04 09:30', productId: 'P004', productName: '린넨 셔츠', type: 'OUT', quantity: 12, user: '홍길동', note: '온라인 주문' },
  { id: 5, date: '2024-03-03 18:45', productId: 'P003', productName: '오버사이즈 후드티', type: 'OUT', quantity: 2, user: '김철수', note: '샘플 발송' },
];

export default function StockHistoryPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'IN' | 'OUT'>('ALL');

  const filteredHistory = initialHistory.filter(item => {
    const matchesSearch = item.productName.includes(searchTerm) || item.productId.includes(searchTerm);
    const matchesType = filterType === 'ALL' || item.type === filterType;
    return matchesSearch && matchesType;
  });

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">재고 기록</h1>
          <p className="text-slate-500 mt-1">입고 및 출고 처리된 모든 내역을 시간순으로 확인합니다.</p>
        </div>
        
        <div className="flex gap-2">
          <button className="bg-white border border-slate-200 text-slate-700 text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-all active:scale-95">
            <Download size={18} />
            엑셀 다운로드
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                placeholder="상품명 또는 코드 검색..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>
            
            <div className="flex bg-white border border-slate-200 rounded-lg p-1 w-full md:w-auto">
              <button 
                onClick={() => setFilterType('ALL')}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${filterType === 'ALL' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                전체
              </button>
              <button 
                onClick={() => setFilterType('IN')}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${filterType === 'IN' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                입고
              </button>
              <button 
                onClick={() => setFilterType('OUT')}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${filterType === 'OUT' ? 'bg-rose-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                출고
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600">
              <Calendar size={14} />
              <span>2024-03-01 ~ 2024-03-04</span>
            </div>
          </div>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">일시</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">구분</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">상품 정보</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">수량</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">처리자</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">비고</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredHistory.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                <td className="py-4 px-6 text-xs text-slate-500 font-medium">
                  {item.date}
                </td>
                <td className="py-4 px-6">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    item.type === 'IN' 
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                  }`}>
                    {item.type === 'IN' ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />}
                    {item.type === 'IN' ? '입고' : '출고'}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{item.productName}</p>
                    <p className="text-xs font-mono text-slate-400">{item.productId}</p>
                  </div>
                </td>
                <td className="py-4 px-6 text-right">
                  <span className={`text-sm font-black ${item.type === 'IN' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {item.type === 'IN' ? '+' : '-'}{item.quantity.toLocaleString()}
                  </span>
                </td>
                <td className="py-4 px-6 text-center text-sm text-slate-600 font-medium">
                  {item.user}
                </td>
                <td className="py-4 px-6 text-xs text-slate-400 italic">
                  {item.note}
                </td>
              </tr>
            ))}
            {filteredHistory.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-400 text-sm">
                  조회된 기록이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
