import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Package, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Search, 
  Filter, 
  AlertCircle, 
  History as HistoryIcon,
  Plus,
  Minus,
  RefreshCw,
  X
} from 'lucide-react';

const initialInventory = [
  { id: 'P001', name: '베이직 코튼 티셔츠', size: 'L', currentStock: 120, safetyStock: 50, lastUpdated: '2024-03-04 14:20', status: '정상' },
  { id: 'P002', name: '슬림핏 데님 팬츠', size: 'M', currentStock: 45, safetyStock: 40, lastUpdated: '2024-03-04 10:15', status: '주의' },
  { id: 'P003', name: '오버사이즈 후드티', size: 'XL', currentStock: 0, safetyStock: 30, lastUpdated: '2024-03-03 18:45', status: '품절' },
  { id: 'P004', name: '린넨 셔츠', size: 'S', currentStock: 88, safetyStock: 30, lastUpdated: '2024-03-04 09:30', status: '정상' },
  { id: 'P005', name: '와이드 슬랙스', size: 'L', currentStock: 12, safetyStock: 20, lastUpdated: '2024-03-04 11:00', status: '부족' },
];

export default function StockManagementPage() {
  const [inventory, setInventory] = useState(initialInventory);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'IN' | 'OUT'>('IN');
  const [batchItems, setBatchItems] = useState<{ id: string, name: string, size: string, currentStock: number, quantity: number }[]>([]);
  const [note, setNote] = useState('');

  const handleOpenModal = (type: 'IN' | 'OUT', product?: any) => {
    setModalType(type);
    setNote('');
    
    if (product) {
      setBatchItems([{ 
        id: product.id, 
        name: product.name, 
        size: product.size, 
        currentStock: product.currentStock, 
        quantity: 0 
      }]);
    } else if (selectedIds.length > 0) {
      const selectedItems = inventory
        .filter(item => selectedIds.includes(item.id))
        .map(item => ({ 
          id: item.id, 
          name: item.name, 
          size: item.size, 
          currentStock: item.currentStock, 
          quantity: 0 
        }));
      setBatchItems(selectedItems);
    } else {
      alert('처리할 상품을 선택해주세요.');
      return;
    }
    
    setIsModalOpen(true);
  };

  const handleBatchQuantityChange = (id: string, qty: number) => {
    setBatchItems(prev => prev.map(item => item.id === id ? { ...item, quantity: qty } : item));
  };

  const handleProcess = () => {
    if (batchItems.length === 0) {
      alert('상품을 선택해주세요.');
      return;
    }

    const hasInvalidQty = batchItems.some(item => item.quantity <= 0);
    if (hasInvalidQty) {
      alert('모든 상품의 수량을 1 이상으로 입력해주세요.');
      return;
    }

    if (modalType === 'OUT') {
      const insufficientStock = batchItems.find(item => item.currentStock < item.quantity);
      if (insufficientStock) {
        alert(`${insufficientStock.name}의 재고가 부족합니다.`);
        return;
      }
    }

    const updatedInventory = inventory.map(item => {
      const batchItem = batchItems.find(bi => bi.id === item.id);
      if (batchItem) {
        const newStock = modalType === 'IN' 
          ? item.currentStock + batchItem.quantity 
          : item.currentStock - batchItem.quantity;
        
        let newStatus = '정상';
        if (newStock === 0) newStatus = '품절';
        else if (newStock <= item.safetyStock) newStatus = '부족';
        
        return {
          ...item,
          currentStock: newStock,
          status: newStatus,
          lastUpdated: new Date().toLocaleString()
        };
      }
      return item;
    });

    setInventory(updatedInventory);
    setIsModalOpen(false);
    setSelectedIds([]);
    alert(`${modalType === 'IN' ? '입고' : '출고'} 처리가 완료되었습니다.`);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredInventory.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredInventory.map(item => item.id));
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const filteredInventory = inventory.filter(item => 
    item.name.includes(searchTerm) || item.id.includes(searchTerm)
  );

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">재고 관리</h1>
          <p className="text-slate-500 mt-1">상품별 실시간 재고 현황 및 입출고 내역을 관리합니다.</p>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={() => handleOpenModal('IN')}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 shadow-sm"
          >
            <ArrowDownLeft size={18} />
            입고 처리
          </button>
          <button 
            onClick={() => handleOpenModal('OUT')}
            className="bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 shadow-sm"
          >
            <ArrowUpRight size={18} />
            출고 처리
          </button>
        </div>
      </div>

      {/* Inventory Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">총 재고 수량</p>
          <div className="flex items-end justify-between">
            <p className="text-2xl font-black text-slate-900">265 <span className="text-sm font-medium text-slate-400">pcs</span></p>
            <Package className="text-slate-200" size={24} />
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow border-l-4 border-l-emerald-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">오늘 입고</p>
          <div className="flex items-end justify-between">
            <p className="text-2xl font-black text-emerald-600">+42</p>
            <ArrowDownLeft className="text-emerald-100" size={24} />
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow border-l-4 border-l-rose-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">오늘 출고</p>
          <div className="flex items-end justify-between">
            <p className="text-2xl font-black text-rose-600">-18</p>
            <ArrowUpRight className="text-rose-100" size={24} />
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow border-l-4 border-l-amber-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">재고 부족 알림</p>
          <div className="flex items-end justify-between">
            <p className="text-2xl font-black text-amber-600">3 <span className="text-sm font-medium text-slate-400">건</span></p>
            <AlertCircle className="text-amber-100" size={24} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="상품명 또는 코드 검색..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={() => window.location.href = '/inventory/history'}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              <HistoryIcon size={14} />
              입출고 이력
            </button>
            <button className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50">
              <RefreshCw size={14} />
              재고 실사
            </button>
          </div>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 w-10">
                <input 
                  type="checkbox" 
                  checked={selectedIds.length > 0 && selectedIds.length === filteredInventory.length}
                  onChange={toggleSelectAll}
                  className="accent-primary"
                />
              </th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">상품 정보</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">사이즈</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">현재 재고</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">안전 재고</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">상태</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">최종 업데이트</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredInventory.map((item) => (
              <tr 
                key={item.id} 
                className={`hover:bg-slate-50 transition-colors cursor-pointer ${selectedIds.includes(item.id) ? 'bg-primary/5' : ''}`}
                onDoubleClick={() => handleOpenModal('IN', item)}
              >
                <td className="py-4 px-6" onClick={e => e.stopPropagation()}>
                  <input 
                    type="checkbox" 
                    checked={selectedIds.includes(item.id)}
                    onChange={(e) => toggleSelect(item.id, e as any)}
                    className="accent-primary"
                  />
                </td>
                <td className="py-4 px-6">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{item.name}</p>
                    <p className="text-xs font-mono text-slate-400">{item.id}</p>
                  </div>
                </td>
                <td className="py-4 px-6 text-center">
                  <span className="text-xs font-bold px-2 py-0.5 bg-slate-100 rounded border border-slate-200">{item.size}</span>
                </td>
                <td className="py-4 px-6 text-right">
                  <span className={`text-sm font-black ${
                    item.currentStock === 0 ? 'text-rose-600' : 
                    item.currentStock <= item.safetyStock ? 'text-amber-600' : 
                    'text-slate-900'
                  }`}>
                    {item.currentStock.toLocaleString()}
                  </span>
                </td>
                <td className="py-4 px-6 text-right text-sm text-slate-400 font-medium">
                  {item.safetyStock.toLocaleString()}
                </td>
                <td className="py-4 px-6 text-center">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    item.status === '정상' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    item.status === '주의' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                    item.status === '부족' ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                    'bg-rose-50 text-rose-700 border border-rose-200'
                  }`}>
                    {item.status}
                  </span>
                </td>
                <td className="py-4 px-6 text-center text-xs text-slate-400">
                  {item.lastUpdated}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="p-6 bg-slate-50 border-t border-slate-100">
          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-lg">
            <AlertCircle size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-blue-800">재고 관리 팁</p>
              <p className="text-[11px] text-blue-700 mt-1 leading-relaxed">
                안전 재고(Safety Stock)보다 현재 재고가 적을 경우 시스템에서 자동으로 '부족' 알림을 표시합니다. 
                정기적인 재고 실사를 통해 전산 재고와 실재고를 일치시켜 주세요.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Inbound/Outbound Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className={`p-6 border-b border-slate-100 flex items-center justify-between ${modalType === 'IN' ? 'bg-emerald-50' : 'bg-rose-50'}`}>
              <h3 className={`text-lg font-bold ${modalType === 'IN' ? 'text-emerald-900' : 'text-rose-900'}`}>
                {modalType === 'IN' ? '입고 처리' : '출고 처리'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              {batchItems.map((item) => (
                <div key={item.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{item.id} | {item.size}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">현재 재고</p>
                      <p className="text-sm font-black text-slate-900">{item.currentStock} pcs</p>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      {modalType === 'IN' ? '입고 수량' : '출고 수량'}
                    </label>
                    <input 
                      type="number" 
                      min="0"
                      value={item.quantity}
                      onChange={e => handleBatchQuantityChange(item.id, parseInt(e.target.value) || 0)}
                      className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                </div>
              ))}
              
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">비고</label>
                <textarea 
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="사유를 입력하세요 (예: 정기 입고, 매장 판매 등)"
                  rows={2}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                />
              </div>
            </div>
            <div className="p-6 bg-slate-50 flex gap-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-100 transition-colors"
              >
                취소
              </button>
              <button 
                onClick={handleProcess}
                className={`flex-1 px-4 py-2 text-white text-sm font-bold rounded-lg transition-colors ${modalType === 'IN' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}
              >
                {modalType === 'IN' ? '입고 완료' : '출고 완료'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
