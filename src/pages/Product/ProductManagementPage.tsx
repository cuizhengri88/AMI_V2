import React, { useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { usePageText } from '../../i18n/usePageText';
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
  JapaneseYen
} from 'lucide-react';

/**
 * 샘플 상품 데이터
 */
const initialProducts = [
  { id: 'P001', name: '베이직 코튼 티셔츠', category: '상의', price: 29000, size: 'L', stock: 120, status: '판매중' },
  { id: 'P002', name: '슬림핏 데님 팬츠', category: '하의', price: 59000, size: 'M', stock: 45, status: '판매중' },
  { id: 'P003', name: '오버사이즈 후드티', category: '상의', price: 45000, size: 'XL', stock: 0, status: '품절' },
  { id: 'P004', name: '린넨 셔츠', category: '상의', price: 39000, size: 'S', stock: 88, status: '판매중' },
  { id: 'P005', name: '와이드 슬랙스', category: '하의', price: 49000, size: 'L', stock: 12, status: '재고부족' },
];

/**
 * 상품 사이즈 목록 (공통 코드 등에서 가져오는 기본값)
 */
const sizes = ['XS', 'S', 'M', 'L', 'XL'];

/**
 * 상품 관리 페이지 컴포넌트
 */
export default function ProductManagementPage() {
  // 페이지 전용 텍스트 (pt) 및 공통 다국어 (t) 훅
  const pt = usePageText('product_product_management');
  const { t } = useTranslation();

  /**
   * 상태 관리 (useState): 컴포넌트 내에서 변경되는 데이터를 관리합니다.
   * searchTerm: 검색어 입력값
   * isNewModalOpen: 등록 모달 표시 여부
   * isEditModalOpen: 수정 모달 표시 여부
   * editProduct: 현재 수정 중인 상품 정보
   */
  const [searchTerm, setSearchTerm] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<any>(null);

  /**
   * 신규 상품 저장 핸들러
   * @param e 폼 이벤트 객체
   */
  const handleSave = (e: React.FormEvent) => {
    // e.preventDefault(): 폼 제출 시 페이지가 새로고침되는 브라우저의 기본 동작을 막습니다.
    e.preventDefault();
    alert(pt('t002')); // pt('t002') -> 신규 상품이 등록되었습니다.
    setIsNewModalOpen(false); // 모달을 닫습니다.
  };

  /**
   * 수정 버튼 클릭 핸들러
   * @param product 수정할 상품 객체
   */
  const handleEditClick = (product: any) => {
    setEditProduct({ ...product }); // 선택한 상품 정보를 상태에 복사하여 저장합니다.
    setIsEditModalOpen(true); // 수정 모달을 엽니다.
  };

  /**
   * 상품 정보 수정 핸들러
   * @param e 폼 이벤트 객체
   */
  const handleUpdate = (e: React.FormEvent) => {
    // e.preventDefault(): 전송(submit) 버튼 클릭 시의 페이지 리로드 동작을 방지합니다.
    e.preventDefault();
    alert(pt('t001')); // pt('t001') -> 상품 정보가 수정되었습니다.
    setIsEditModalOpen(false); // 수정을 마치고 모달을 닫습니다.
  };

  return (
    /**
     * motion.div: Framer Motion을 이용한 애니메이션 컨테이너
     * initial: 컴포넌트가 처음 나타날 때의 시작 상태 (불투명도 0, 아래로 10px 이동된 상태)
     * animate: 컴포넌트가 최종적으로 보여질 상태 (불투명도 1, 제자리로 이동)
     * transition: 애니메이션이 일어나는 시간(0.4초)과 방식 정의
     */
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* 상단 헤더 영역: 제목 및 등록 버튼 */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            {t('menu.product_management')} {/* menu.product_management -> 상품 관리 */}
          </h1>
          <p className="text-slate-500 mt-1">
            {t('product.description')} {/* product.description -> 의류 상품 등록 및 재고 현황을 관리합니다. */}
          </p>
        </div>

        <button
          onClick={() => setIsNewModalOpen(true)} className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95"
        >
          <Plus size={18} />
          {t('common.add')} {/* common.add -> 등록 */}
        </button>
      </div>

      {/* 요약 통계 카드 섹션 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Package size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {t('product.stats.total')} {/* product.stats.total -> 전체 상품 */}
            </p>
            <p className="text-2xl font-black text-slate-900">1,284</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <ShoppingBag size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {t('product.stats.selling')} {/* product.stats.selling -> 판매 중 */}
            </p>
            <p className="text-2xl font-black text-slate-900">1,150</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <Layers size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {t('product.stats.out_of_stock')} {/* product.stats.out_of_stock -> 품절/부족 */}
            </p>
            <p className="text-2xl font-black text-slate-900">134</p>
          </div>
        </div>
      </div>

      {/* 상품 목록 그리드/테이블 영역 */}
      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        {/* 필터 및 검색 바 */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder={t('product.search_placeholder')} // product.search_placeholder -> 상품명 또는 상품코드 검색...
              value={searchTerm}
              // e.target.value: 입력란에 사용자가 타이핑한 현재 텍스트 값을 가져옵니다.
              onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20">
              <option value="all">{t('product.category_all')}</option> {/* product.category_all -> 전체 카테고리 */}
              <option value="top">{t('product.category_top')}</option> {/* product.category_top -> 상의 */}
              <option value="bottom">{t('product.category_bottom')}</option> {/* product.category_bottom -> 하의 */}
              <option value="outer">{t('product.category_outer')}</option> {/* product.category_outer -> 아우터 */}
            </select>
            <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50">
              <Filter size={16} />
              {t('common.filter')} {/* common.filter -> 필터 */}
            </button>
          </div>
        </div>

        {/* 상품 테이블 */}
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('product.col_code')}</th>{/* product.col_code -> 상품코드 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('product.col_name')}</th>{/* product.col_name -> 상품명 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('product.col_category')}</th>{/* product.col_category -> 카테고리 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('product.col_size')}</th>{/* product.col_size -> 사이즈 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">{t('product.col_price')}</th>{/* product.col_price -> 판매가 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('product.col_stock')}</th>{/* product.col_stock -> 재고 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('product.col_status')}</th>{/* product.col_status -> 상태 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('common.action')}</th>{/* common.action -> 작업 */}
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
                  ¥{product.price.toLocaleString()}
                </td>
                <td className="py-4 px-6 text-sm text-center font-medium text-slate-600">
                  {product.stock}
                </td>
                <td className="py-4 px-6 text-center">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${product.status === '판매중' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    product.status === '재고부족' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                    {product.status === '판매중' ? t('product.status_selling') :  // product.status_selling -> 판매중
                      product.status === '재고부족' ? t('product.status_low_stock') : // product.status_low_stock -> 재고부족
                        t('product.status_out_of_stock')} {/* product.status_out_of_stock -> 품절 */}
                  </span>
                </td>
                <td className="py-4 px-6 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => handleEditClick(product)} className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded transition-colors"
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

        {/* 하단 페이지네이션 및 도움말 */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-400 font-medium italic">
            {t('product.size_info_tip')} {/* product.size_info_tip -> * 사이즈 정보는 ...에서 관리됩니다. */}
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1 text-xs font-bold text-slate-400 hover:text-slate-600 disabled:opacity-50" disabled>
              {t('common.previous')} {/* common.previous -> 이전 */}
            </button>
            <div className="flex items-center gap-1">
              <button className="size-6 rounded bg-primary text-white text-xs font-bold">1</button>
              <button className="size-6 rounded hover:bg-slate-200 text-slate-600 text-xs font-bold">2</button>
              <button className="size-6 rounded hover:bg-slate-200 text-slate-600 text-xs font-bold">3</button>
            </div>
            <button className="px-3 py-1 text-xs font-bold text-slate-600 hover:text-slate-800">
              {t('common.next')} {/* common.next -> 다음 */}
            </button>
          </div>
        </div>
      </div>

      {/* AnimatePresence: 컴포넌트가 DOM에서 제거될 때 exit 애니메이션을 실행할 수 있게 해주는 래퍼 */}
      <AnimatePresence>
        {isNewModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={t('product.modal_add_title')} // product.modal_add_title -> 신규 상품 등록
              onClose={() => setIsNewModalOpen(false)}
              icon={<Plus size={20} className="text-primary" />}
            >
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_name')}</label> {/* product.form_name -> 상품명 */}
                    <input
                      type="text"
                      required
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      placeholder={t('product.placeholder_name')} // product.placeholder_name -> 상품명을 입력하세요
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_category')}</label> {/* product.form_category -> 카테고리 */}
                    <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none">
                      <option value="top">{t('product.category_top')}</option> {/* product.category_top -> 상의 */}
                      <option value="bottom">{t('product.category_bottom')}</option> {/* product.category_bottom -> 하의 */}
                      <option value="outer">{t('product.category_outer')}</option> {/* product.category_outer -> 아우터 */}
                      <option value="acc">{t('product.category_acc')}</option> {/* product.category_acc -> 액세서리 */}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_size')}</label> {/* product.form_size -> 사이즈 */}
                    <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none">
                      {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_price')}</label> {/* product.form_price -> 판매가 (¥) */}
                    <div className="relative">
                      <JapaneseYen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="number"
                        required
                        className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_initial_stock')}</label> {/* product.form_initial_stock -> 초기 재고 */}
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
                    onClick={() => setIsNewModalOpen(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    {t('common.cancel')} {/* common.cancel -> 취소 */}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    {t('common.save')} {/* common.save -> 저장 */}
                  </button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}
      </AnimatePresence>

      {/* 상품 정보 수정 모달 */}
      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={t('product.modal_edit_title')} // product.modal_edit_title -> 상품 정보 수정
              onClose={() => setIsEditModalOpen(false)}
              icon={<Edit2 size={20} className="text-primary" />}
            >
              <form onSubmit={handleUpdate} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_name')}</label> {/* product.form_name -> 상품명 */}
                    <input
                      type="text"
                      required
                      value={editProduct?.name}
                      // e.target.value: 현재 입력된 상품명을 가져와서 상태를 업데이트합니다.
                      onChange={(e) => setEditProduct({ ...editProduct, name: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      placeholder={t('product.placeholder_name')} // product.placeholder_name -> 상품명을 입력하세요
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_category')}</label> {/* product.form_category -> 카테고리 */}
                    <select
                      value={editProduct?.category}
                      onChange={(e) => setEditProduct({ ...editProduct, category: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      <option value="top">{t('product.category_top')}</option> {/* product.category_top -> 상의 */}
                      <option value="bottom">{t('product.category_bottom')}</option> {/* product.category_bottom -> 하의 */}
                      <option value="outer">{t('product.category_outer')}</option> {/* product.category_outer -> 아우터 */}
                      <option value="acc">{t('product.category_acc')}</option> {/* product.category_acc -> 액세서리 */}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_size')}</label> {/* product.form_size -> 사이즈 */}
                    <select
                      value={editProduct?.size}
                      onChange={(e) => setEditProduct({ ...editProduct, size: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_price')}</label> {/* product.form_price -> 판매가 (¥) */}
                    <div className="relative">
                      <JapaneseYen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="number"
                        required
                        value={editProduct?.price}
                        // parseInt: 문자열로 들어오는 가격 값을 정수형 숫자로 변환합니다.
                        onChange={(e) => setEditProduct({ ...editProduct, price: parseInt(e.target.value) || 0 })} className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_stock')}</label> {/* product.form_stock -> 재고 수량 */}
                    <input
                      type="number"
                      required
                      value={editProduct?.stock}
                      onChange={(e) => setEditProduct({ ...editProduct, stock: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('product.form_status')}</label> {/* product.form_status -> 상태 */}
                    <select
                      value={editProduct?.status}
                      onChange={(e) => setEditProduct({ ...editProduct, status: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      <option value="판매중">{t('product.status_selling')}</option> {/* product.status_selling -> 판매중 */}
                      <option value="재고부족">{t('product.status_low_stock')}</option> {/* product.status_low_stock -> 재고부족 */}
                      <option value="품절">{t('product.status_out_of_stock')}</option> {/* product.status_out_of_stock -> 품절 */}
                      <option value="판매중지">{t('product.status_discontinued')}</option> {/* product.status_discontinued -> 판매중지 */}
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    {t('common.cancel')} {/* common.cancel -> 취소 */}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    {t('common.save')} {/* common.save -> 저장 */}
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

/**
 * 드래그 가능한 모달 컴포넌트
 */
function DraggableModal({ title, children, onClose, icon }: { title: string; children: React.ReactNode; onClose: () => void; icon: React.ReactNode }) {
  /**
   * useDragControls: Framer Motion에서 드래그 동작을 수동으로 제어하기 위해 사용합니다.
   * 특정 영역(헤더)을 클릭했을 때만 드래그가 시작되도록 설정할 때 필요합니다.
   */
  const dragControls = useDragControls();

  return (
    /**
     * motion.div (모달 컨테이너)
     * initial, animate, exit: 모달이 나타나고 사라질 때의 부드러운 스케일 및 투명도 전환 정의
     * drag: 컴포넌트 전체가 드래그 가능하게 설정
     * dragControls: 수동 제어용 컨트롤러 연결
     * dragListener: false로 설정하여 컨테이너 자체에서의 클릭 드래그는 막고 헤더를 통해서만 조작하도록 함
     */
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
      {/* 모달 헤더 (드래그 핸들 포함) */}
      <div
        // onPointerDown: 마우스 왼쪽 버튼이나 터치가 시작될 때 드래그 이벤트를 수동으로 시작시킵니다.
        onPointerDown={(e) => dragControls.start(e)} className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 cursor-move active:cursor-grabbing"
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
      {/* 모달 본문 */}
      {children}
    </motion.div>
  );
}
