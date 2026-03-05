import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { 
  ShoppingCart, 
  Search, 
  Filter, 
  RotateCcw, 
  User, 
  Calendar, 
  CreditCard,
  CheckCircle2,
  XCircle,
  MoreVertical,
  Plus,
  X,
  GripHorizontal,
  Phone,
  Package,
  Hash,
  Edit2
} from 'lucide-react';

const initialPurchases = [
  { id: 'ORD-2024-001', customer: '홍길동', product: '베이직 코튼 티셔츠', quantity: 2, price: 29000, total: 58000, date: '2024-03-04 15:30', status: '결제완료' },
  { id: 'ORD-2024-002', customer: '이순신', product: '슬림핏 데님 팬츠', quantity: 1, price: 59000, total: 59000, date: '2024-03-04 14:20', status: '결제완료' },
  { id: 'ORD-2024-003', customer: '강감찬', product: '오버사이즈 후드티', quantity: 1, price: 45000, total: 45000, date: '2024-03-04 11:10', status: '환불완료' },
  { id: 'ORD-2024-004', customer: '유관순', product: '린넨 셔츠', quantity: 3, price: 39000, total: 117000, date: '2024-03-03 17:45', status: '결제완료' },
  { id: 'ORD-2024-005', customer: '안중근', product: '와이드 슬랙스', quantity: 1, price: 49000, total: 49000, date: '2024-03-03 16:20', status: '환불진행중' },
];

const mockMembers = ['김철수', '이영희', '박민준', '최지우'];
const mockProducts = [
  { name: '베이직 코튼 티셔츠', price: 29000 },
  { name: '슬림핏 데님 팬츠', price: 59000 },
  { name: '오버사이즈 후드티', price: 45000 },
  { name: '린넨 셔츠', price: 39000 },
  { name: '와이드 슬랙스', price: 49000 },
];

export default function PurchaseManagementPage() {
  const [purchases, setPurchases] = useState(initialPurchases);
  const [searchTerm, setSearchTerm] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<any>(null);

  // Date Filter State
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // New Purchase Form State
  const [customerType, setCustomerType] = useState<'member' | 'phone'>('member');
  const [selectedMember, setSelectedMember] = useState(mockMembers[0]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(mockProducts[0]);
  const [quantity, setQuantity] = useState(1);
  const [orderStatus, setOrderStatus] = useState('결제완료');
  const [orderId, setOrderId] = useState('');

  useEffect(() => {
    if (isNewModalOpen) {
      const now = new Date();
      const id = `ORD-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      setOrderId(id);
    }
  }, [isNewModalOpen]);

  const totalPrice = selectedProduct.price * quantity;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const newPurchase = {
      id: orderId,
      customer: customerType === 'member' ? selectedMember : phoneNumber,
      product: selectedProduct.name,
      quantity,
      price: selectedProduct.price,
      total: totalPrice,
      date: new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().split(' ')[0],
      status: orderStatus
    };
    setPurchases([newPurchase, ...purchases]);
    alert('신규 주문이 등록되었습니다.');
    setIsNewModalOpen(false);
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    setPurchases(prev => prev.map(p => p.id === editOrder.id ? { ...editOrder, total: editOrder.price * editOrder.quantity } : p));
    alert('주문 정보가 수정되었습니다.');
    setIsEditModalOpen(false);
  };

  const handleEditClick = (order: any) => {
    setEditOrder(order);
    setIsEditModalOpen(true);
  };

  const handleRefund = (id: string) => {
    if (window.confirm('해당 주문을 환불 처리하시겠습니까?')) {
      setPurchases(prev => prev.map(p => 
        p.id === id ? { ...p, status: '환불완료' } : p
      ));
    }
  };

  const filteredPurchases = purchases.filter(order => {
    const matchesSearch = order.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         order.customer.toLowerCase().includes(searchTerm.toLowerCase());
    
    let matchesDate = true;
    if (startDate || endDate) {
      const orderDateStr = order.date.split(' ')[0]; // YYYY-MM-DD
      if (startDate && orderDateStr < startDate) matchesDate = false;
      if (endDate && orderDateStr > endDate) matchesDate = false;
    }
    
    return matchesSearch && matchesDate;
  });

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">구매 관리</h1>
          <p className="text-slate-500 mt-1">고객의 주문 내역을 확인하고 환불 및 결제 상태를 관리합니다.</p>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={() => setIsNewModalOpen(true)}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-primary/20"
          >
            <Plus size={18} />
            신규 주문 등록
          </button>
          <button 
            onClick={() => setShowDatePicker(!showDatePicker)}
            className={`bg-white border text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 ${showDatePicker ? 'border-primary text-primary ring-2 ring-primary/10' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
          >
            <Calendar size={18} />
            기간 설정
          </button>
        </div>
      </div>

      {/* Date Picker UI */}
      <AnimatePresence>
        {showDatePicker && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-6"
          >
            <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-500 uppercase">시작일</label>
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="text-slate-300">~</div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-500 uppercase">종료일</label>
                <input 
                  type="date" 
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <button 
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="ml-auto text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1"
              >
                <RotateCcw size={12} />
                초기화
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sales Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 grid-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="size-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <ShoppingCart size={20} />
            </div>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">+12%</span>
          </div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">오늘의 주문</p>
          <p className="text-2xl font-black text-slate-900 mt-1">42 건</p>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 grid-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="size-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CreditCard size={20} />
            </div>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">+8.5%</span>
          </div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">오늘의 매출</p>
          <p className="text-2xl font-black text-slate-900 mt-1">₩2,450,000</p>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 grid-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="size-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
              <RotateCcw size={20} />
            </div>
            <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded">-2.4%</span>
          </div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">환불 요청</p>
          <p className="text-2xl font-black text-slate-900 mt-1">3 건</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="주문번호 또는 고객명 검색..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <select className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20">
              <option>전체 상태</option>
              <option>결제완료</option>
              <option>환불완료</option>
              <option>환불진행중</option>
            </select>
            <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50">
              <Filter size={16} />
              상세 필터
            </button>
          </div>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">주문번호</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">고객명</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">상품명</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">수량</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">총 결제금액</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">주문일시</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">상태</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredPurchases.map((order) => (
              <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                <td className="py-4 px-6 text-sm font-mono font-bold text-slate-500">{order.id}</td>
                <td className="py-4 px-6">
                  <div className="flex items-center gap-2">
                    <div className="size-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                      <User size={14} />
                    </div>
                    <span className="text-sm font-bold text-slate-900">{order.customer}</span>
                  </div>
                </td>
                <td className="py-4 px-6 text-sm text-slate-600">{order.product}</td>
                <td className="py-4 px-6 text-sm text-center font-medium text-slate-600">
                  {order.quantity}
                </td>
                <td className="py-4 px-6 text-sm text-right font-bold text-slate-900">
                  ₩{order.total.toLocaleString()}
                </td>
                <td className="py-4 px-6 text-center text-xs text-slate-400">
                  {order.date}
                </td>
                <td className="py-4 px-6 text-center">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    order.status === '결제완료' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    order.status === '환불완료' ? 'bg-slate-100 text-slate-500 border border-slate-200' :
                    'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>
                    {order.status === '결제완료' ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                    {order.status}
                  </span>
                </td>
                <td className="py-4 px-6 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button 
                      onClick={() => handleEditClick(order)}
                      className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded transition-colors"
                    >
                      <Edit2 size={14} />
                    </button>
                    {order.status === '결제완료' && (
                      <button 
                        onClick={() => handleRefund(order.id)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-50 border border-rose-100 rounded transition-colors"
                      >
                        <RotateCcw size={10} />
                        환불
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-400 font-medium">
            최근 24시간 동안 12건의 새로운 주문이 발생했습니다.
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1 text-xs font-bold text-slate-600 hover:text-slate-800">더보기</button>
          </div>
        </div>
      </div>

      {/* New Purchase Modal */}
      <AnimatePresence>
        {isNewModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal 
              title="신규 주문 등록" 
              onClose={() => setIsNewModalOpen(false)}
              icon={<Plus size={20} className="text-primary" />}
            >
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                      <Hash size={12} /> 주문번호 (자동생성)
                    </label>
                    <input 
                      type="text" 
                      value={orderId}
                      readOnly
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500 outline-none"
                    />
                  </div>

                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">구매자 선택</label>
                    <div className="flex gap-2 p-1 bg-slate-100 rounded-lg mb-2">
                      <button 
                        type="button"
                        onClick={() => setCustomerType('member')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${customerType === 'member' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        기존 회원
                      </button>
                      <button 
                        type="button"
                        onClick={() => setCustomerType('phone')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${customerType === 'phone' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        전화번호 입력
                      </button>
                    </div>
                    {customerType === 'member' ? (
                      <select 
                        value={selectedMember}
                        onChange={(e) => setSelectedMember(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      >
                        {mockMembers.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : (
                      <div className="relative">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input 
                          type="text" 
                          placeholder="010-0000-0000"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          className="w-full pl-10 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                      <Package size={12} /> 상품 선택
                    </label>
                    <select 
                      value={selectedProduct.name}
                      onChange={(e) => setSelectedProduct(mockProducts.find(p => p.name === e.target.value) || mockProducts[0])}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      {mockProducts.map(p => <option key={p.name} value={p.name}>{p.name} (₩{p.price.toLocaleString()})</option>)}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">수량</label>
                    <input 
                      type="number" 
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">상태</label>
                    <select 
                      value={orderStatus}
                      onChange={(e) => setOrderStatus(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      <option value="결제완료">결제완료</option>
                      <option value="결제대기">결제대기</option>
                      <option value="환불진행중">환불진행중</option>
                    </select>
                  </div>

                  <div className="col-span-2 p-4 bg-primary/5 border border-primary/10 rounded-xl mt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-600">총 결제 금액</span>
                      <span className="text-xl font-black text-primary">₩{totalPrice.toLocaleString()}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 text-right">단가 ₩{selectedProduct.price.toLocaleString()} × {quantity}개</p>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsNewModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    취소
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    주문 등록
                  </button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Purchase Modal */}
      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal 
              title="주문 정보 수정" 
              onClose={() => setIsEditModalOpen(false)}
              icon={<Edit2 size={20} className="text-primary" />}
            >
              <form onSubmit={handleUpdate} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                      <Hash size={12} /> 주문번호
                    </label>
                    <input 
                      type="text" 
                      value={editOrder?.id}
                      readOnly
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500 outline-none"
                    />
                  </div>

                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">구매자 선택</label>
                    <div className="flex gap-2 p-1 bg-slate-100 rounded-lg mb-2">
                      <button 
                        type="button"
                        onClick={() => {
                          // Try to find if current customer is in mockMembers
                          const isMember = mockMembers.includes(editOrder?.customer);
                          setEditOrder({ ...editOrder, customerType: 'member' });
                        }}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${(!editOrder?.customerType || editOrder?.customerType === 'member') ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        기존 회원
                      </button>
                      <button 
                        type="button"
                        onClick={() => setEditOrder({ ...editOrder, customerType: 'phone' })}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${editOrder?.customerType === 'phone' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        전화번호 입력
                      </button>
                    </div>
                    {(!editOrder?.customerType || editOrder?.customerType === 'member') ? (
                      <select 
                        value={mockMembers.includes(editOrder?.customer) ? editOrder?.customer : mockMembers[0]}
                        onChange={(e) => setEditOrder({ ...editOrder, customer: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      >
                        {mockMembers.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : (
                      <div className="relative">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input 
                          type="text" 
                          placeholder="010-0000-0000"
                          value={editOrder?.customer}
                          onChange={(e) => setEditOrder({ ...editOrder, customer: e.target.value })}
                          className="w-full pl-10 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                      <Package size={12} /> 상품 선택
                    </label>
                    <select 
                      value={editOrder?.product}
                      onChange={(e) => {
                        const prod = mockProducts.find(p => p.name === e.target.value);
                        setEditOrder({ ...editOrder, product: e.target.value, price: prod?.price });
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      {mockProducts.map(p => <option key={p.name} value={p.name}>{p.name} (₩{p.price.toLocaleString()})</option>)}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">수량</label>
                    <input 
                      type="number" 
                      min="1"
                      value={editOrder?.quantity}
                      onChange={(e) => setEditOrder({ ...editOrder, quantity: parseInt(e.target.value) || 1 })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">상태</label>
                    <select 
                      value={editOrder?.status}
                      onChange={(e) => setEditOrder({ ...editOrder, status: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      <option value="결제완료">결제완료</option>
                      <option value="결제대기">결제대기</option>
                      <option value="환불완료">환불완료</option>
                      <option value="환불진행중">환불진행중</option>
                    </select>
                  </div>

                  {(editOrder?.status === '환불완료' || editOrder?.status === '환불진행중') && (
                    <div className="space-y-1 col-span-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">환불 사유</label>
                      <textarea 
                        value={editOrder?.refundReason || ''}
                        onChange={(e) => setEditOrder({ ...editOrder, refundReason: e.target.value })}
                        placeholder="환불 사유를 입력하세요"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none min-h-[80px] resize-none"
                      />
                    </div>
                  )}

                  <div className="col-span-2 p-4 bg-primary/5 border border-primary/10 rounded-xl mt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-600">총 결제 금액</span>
                      <span className="text-xl font-black text-primary">₩{(editOrder?.price * editOrder?.quantity || 0).toLocaleString()}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 text-right">단가 ₩{(editOrder?.price || 0).toLocaleString()} × {editOrder?.quantity || 0}개</p>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    취소
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    수정 완료
                  </button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DraggableModal({ title, children, onClose, icon }: { title: string; children: React.ReactNode; onClose: () => void; icon: React.ReactNode }) {
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
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X size={20} className="text-slate-500" />
          </button>
        </div>
      </div>
      {children}
    </motion.div>
  );
}
