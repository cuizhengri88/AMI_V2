import React, { useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  ShoppingBag, 
  Filter, 
  ChevronRight,
  Package,
  Layers,
  X,
  GripHorizontal,
  Tag,
  DollarSign
} from 'lucide-react';

const initialProducts = [
  { id: 'P001', name: '베이직 코튼 티셔츠', category: '상의', price: 29000, size: 'L', stock: 120, status: '판매중' },
  { id: 'P002', name: '슬림핏 데님 팬츠', category: '하의', price: 59000, size: 'M', stock: 45, status: '판매중' },
  { id: 'P003', name: '오버사이즈 후드티', category: '상의', price: 45000, size: 'XL', stock: 0, status: '품절' },
  { id: 'P004', name: '린넨 셔츠', category: '상의', price: 39000, size: 'S', stock: 88, status: '판매중' },
  { id: 'P005', name: '와이드 슬랙스', category: '하의', price: 49000, size: 'L', stock: 12, status: '재고부족' },
];

// 공통코드에서 가져온다고 가정하는 사이즈 목록
const sizes = ['XS', 'S', 'M', 'L', 'XL'];

export default function ProductManagementPage() {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<any>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    alert('신규 상품이 등록되었습니다.');
    setIsNewModalOpen(false);
  };

  const handleEditClick = (product: any) => {
    setEditProduct({ ...product });
    setIsEditModalOpen(true);
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    alert('상품 정보가 수정되었습니다.');
    setIsEditModalOpen(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t('menu.product_management')}</h1>
          <p className="text-slate-500 mt-1">{t('product.description')}</p>
        </div>
        
        <button 
          onClick={() => setIsNewModalOpen(true)}
          className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95"
        >
          <Plus size={18} />
          {t('common.add')}
        </button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Package size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('product.stats.total')}</p>
            <p className="text-2xl font-black text-slate-900">1,284</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <ShoppingBag size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('product.stats.selling')}</p>
            <p className="text-2xl font-black text-slate-900">1,150</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <Layers size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('product.stats.out_of_stock')}</p>
            <p className="text-2xl font-black text-slate-900">134</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder={t('product.search_placeholder')} 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <select className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20">
              <option value="all">{t('product.category_all')}</option>
              <option value="top">{t('product.category_top')}</option>
              <option value="bottom">{t('product.category_bottom')}</option>
              <option value="outer">{t('product.category_outer')}</option>
            </select>
            <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50">
              <Filter size={16} />
              {t('common.filter')}
            </button>
          </div>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('product.col_code')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('product.col_name')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('product.col_category')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('product.col_size')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">{t('product.col_price')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('product.col_stock')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('product.col_status')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('common.action')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {initialProducts.map((product) => (
              <tr key={product.id} className="hover:bg-slate-50 transition-colors">
                <td className="py-4 px-6 text-sm font-mono font-bold text-slate-500">{product.id}</td>
                <td className="py-4 px-6">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded bg-slate-100 flex items-center justify-center text-slate-400">
                      <ShoppingBag size={20} />
                    </div>
                    <span className="text-sm font-bold text-slate-900">{product.name}</span>
                  </div>
                </td>
                <td className="py-4 px-6 text-sm text-slate-600">{product.category}</td>
                <td className="py-4 px-6 text-center">
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200">
                    {product.size}
                  </span>
                </td>
                <td className="py-4 px-6 text-sm text-right font-bold text-slate-900">
                  ₩{product.price.toLocaleString()}
                </td>
                <td className="py-4 px-6 text-sm text-center font-medium text-slate-600">
                  {product.stock}
                </td>
                <td className="py-4 px-6 text-center">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    product.status === '판매중' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    product.status === '재고부족' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                    'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {product.status === '판매중' ? t('product.status_selling') : 
                     product.status === '재고부족' ? t('product.status_low_stock') : 
                     t('product.status_out_of_stock')}
                  </span>
                </td>
                <td className="py-4 px-6 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button 
                      onClick={() => handleEditClick(product)}
                      className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded transition-colors"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-400 font-medium italic">
            {t('product.size_info_tip')}
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1 text-xs font-bold text-slate-400 hover:text-slate-600 disabled:opacity-50" disabled>{t('common.previous')}</button>
            <div className="flex items-center gap-1">
              <button className="size-6 rounded bg-primary text-white text-xs font-bold">1</button>
              <button className="size-6 rounded hover:bg-slate-200 text-slate-600 text-xs font-bold">2</button>
              <button className="size-6 rounded hover:bg-slate-200 text-slate-600 text-xs font-bold">3</button>
            </div>
            <button className="px-3 py-1 text-xs font-bold text-slate-600 hover:text-slate-800">{t('common.next')}</button>
          </div>
        </div>
      </div>

      {/* New Product Modal */}
      <AnimatePresence>
        {isNewModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal 
              title={t('product.modal_add_title')} 
              onClose={() => setIsNewModalOpen(false)}
              icon={<Plus size={20} className="text-primary" />}
            >
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_name')}</label>
                    <input 
                      type="text" 
                      required
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      placeholder={t('product.placeholder_name')}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_category')}</label>
                    <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none">
                      <option value="top">{t('product.category_top')}</option>
                      <option value="bottom">{t('product.category_bottom')}</option>
                      <option value="outer">{t('product.category_outer')}</option>
                      <option value="acc">{t('product.category_acc')}</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_size')}</label>
                    <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none">
                      {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_price')}</label>
                    <div className="relative">
                      <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="number" 
                        required
                        className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_initial_stock')}</label>
                    <input 
                      type="number" 
                      required
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsNewModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Product Modal */}
      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal 
              title={t('product.modal_edit_title')} 
              onClose={() => setIsEditModalOpen(false)}
              icon={<Edit2 size={20} className="text-primary" />}
            >
              <form onSubmit={handleUpdate} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_name')}</label>
                    <input 
                      type="text" 
                      required
                      value={editProduct?.name}
                      onChange={(e) => setEditProduct({ ...editProduct, name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      placeholder={t('product.placeholder_name')}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_category')}</label>
                    <select 
                      value={editProduct?.category}
                      onChange={(e) => setEditProduct({ ...editProduct, category: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      <option value="top">{t('product.category_top')}</option>
                      <option value="bottom">{t('product.category_bottom')}</option>
                      <option value="outer">{t('product.category_outer')}</option>
                      <option value="acc">{t('product.category_acc')}</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_size')}</label>
                    <select 
                      value={editProduct?.size}
                      onChange={(e) => setEditProduct({ ...editProduct, size: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_price')}</label>
                    <div className="relative">
                      <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="number" 
                        required
                        value={editProduct?.price}
                        onChange={(e) => setEditProduct({ ...editProduct, price: parseInt(e.target.value) || 0 })}
                        className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_stock')}</label>
                    <input 
                      type="number" 
                      required
                      value={editProduct?.stock}
                      onChange={(e) => setEditProduct({ ...editProduct, stock: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_status')}</label>
                    <select 
                      value={editProduct?.status}
                      onChange={(e) => setEditProduct({ ...editProduct, status: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      <option value="판매중">{t('product.status_selling')}</option>
                      <option value="재고부족">{t('product.status_low_stock')}</option>
                      <option value="품절">{t('product.status_out_of_stock')}</option>
                      <option value="판매중지">{t('product.status_discontinued')}</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    {t('common.save')}
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
