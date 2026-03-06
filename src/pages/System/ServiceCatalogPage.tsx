import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Database, Loader2, Pencil, PlusCircle, Save, Scissors, Trash2 } from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';

type CategoryCode = string;

type ServiceCategory = {
  code: CategoryCode;
  label: string;
};

type ServiceItem = {
  id: number;
  category: CategoryCode;
  categoryName: string;
  serviceName: string;
  unitPrice: number;
  durationMinutes: number;
  useYn: 'Y' | 'N';
  note: string;
};

type ServiceForm = {
  category: CategoryCode;
  serviceName: string;
  unitPrice: string;
  durationMinutes: string;
  useYn: 'Y' | 'N';
  note: string;
};

const CATEGORY_GROUP_ID = 'T_CATEGORY';

const FALLBACK_SERVICE_CATEGORIES: ServiceCategory[] = [
  { code: 'CUT', label: '커트' },
  { code: 'PERM', label: '파마' },
  { code: 'COLOR', label: '염색' },
];

const EMPTY_FORM: ServiceForm = {
  category: '',
  serviceName: '',
  unitPrice: '',
  durationMinutes: '',
  useYn: 'Y',
  note: '',
};

function formatCurrency(value: number) {
  return `${value.toLocaleString('ko-KR')}원`;
}

export default function ServiceCatalogPage() {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [filterCategory, setFilterCategory] = useState<'ALL' | CategoryCode>('ALL');
  const [form, setForm] = useState<ServiceForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const isDbBusy = isLoading || isMutating;

  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.code, category.label])), [categories]);

  const filteredItems = useMemo(() => {
    if (filterCategory === 'ALL') return items;
    return items.filter((item) => item.category === filterCategory);
  }, [items, filterCategory]);

  const activeCount = filteredItems.filter((item) => item.useYn === 'Y').length;

  const loadCategories = async () => {
    try {
      const result = await invokeDbCommand<{
        success: boolean;
        message: string;
        details: { group: string; code: string; name: string; order: number; use_yn: 'Y' | 'N' }[];
      }>('get_common_code_management_data');

      const loadedCategories = (result.details || [])
        .filter((detail) => detail.group === CATEGORY_GROUP_ID && detail.use_yn === 'Y')
        .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code))
        .map((detail) => ({ code: detail.code, label: detail.name }));

      const nextCategories = loadedCategories.length > 0 ? loadedCategories : FALLBACK_SERVICE_CATEGORIES;
      setCategories(nextCategories);

      setForm((prev) => {
        if (nextCategories.some((category) => category.code === prev.category)) return prev;
        return { ...prev, category: nextCategories[0]?.code || '' };
      });
    } catch (error: any) {
      setCategories(FALLBACK_SERVICE_CATEGORIES);
      setForm((prev) => ({
        ...prev,
        category: prev.category || FALLBACK_SERVICE_CATEGORIES[0].code,
      }));
      console.error('Failed to load T_CATEGORY common codes:', error);
    }
  };

  const loadServiceItems = async () => {
    const result = await invokeDbCommand<{
      success: boolean;
      message: string;
      items: Array<{
        service_id: number;
        category_code: string;
        category_name: string;
        service_name: string;
        unit_price: number;
        duration_minutes: number;
        use_yn: 'Y' | 'N';
        note: string | null;
      }>;
    }>('get_service_catalog_data');

    setItems(
      (result.items || []).map((item) => ({
        id: item.service_id,
        category: item.category_code,
        categoryName: item.category_name,
        serviceName: item.service_name,
        unitPrice: item.unit_price,
        durationMinutes: item.duration_minutes,
        useYn: item.use_yn,
        note: item.note || '',
      })),
    );
  };

  const loadInitialData = async () => {
    try {
      setIsLoading(true);
      await Promise.all([loadCategories(), loadServiceItems()]);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '시술 항목 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (filterCategory === 'ALL') return;
    const exists = categories.some((category) => category.code === filterCategory);
    if (!exists) setFilterCategory('ALL');
  }, [categories, filterCategory]);

  const resetForm = () => {
    setForm({
      ...EMPTY_FORM,
      category: categories[0]?.code || '',
    });
    setEditingId(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const unitPrice = Number(form.unitPrice);
    const durationMinutes = Number(form.durationMinutes);

    if (!form.category) {
      alert(`공통코드 그룹 ${CATEGORY_GROUP_ID}에 카테고리를 먼저 등록해 주세요.`);
      return;
    }
    if (!form.serviceName.trim()) {
      alert('시술명을 입력해 주세요.');
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      alert('단가는 0보다 큰 숫자로 입력해 주세요.');
      return;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      alert('소요시간은 0보다 큰 숫자로 입력해 주세요.');
      return;
    }

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('upsert_service_catalog_item', {
        item: {
          service_id: editingId || undefined,
          category_code: form.category,
          service_name: form.serviceName.trim(),
          unit_price: unitPrice,
          duration_minutes: durationMinutes,
          use_yn: form.useYn,
          note: form.note.trim() || null,
        },
      });

      await loadServiceItems();
      resetForm();
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '시술 항목 저장에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleEdit = (item: ServiceItem) => {
    setEditingId(item.id);
    setForm({
      category: item.category,
      serviceName: item.serviceName,
      unitPrice: String(item.unitPrice),
      durationMinutes: String(item.durationMinutes),
      useYn: item.useYn,
      note: item.note,
    });
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('선택한 시술 항목을 삭제하시겠습니까?')) return;
    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('delete_service_catalog_item', {
        service_id: id,
      });
      await loadServiceItems();
      if (editingId === id) resetForm();
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '시술 항목 삭제에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      {isDbBusy && (
        <div className="fixed inset-0 z-[70] bg-slate-900/20 backdrop-blur-[1px] flex items-center justify-center">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg flex items-center gap-2">
            <Loader2 size={18} className="animate-spin text-primary" />
            <span className="text-sm font-semibold text-slate-700">Loading...</span>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">시술 항목 관리</h1>
          <p className="text-slate-500 mt-1">DB 테이블 기반으로 카테고리별 시술명, 단가, 소요시간을 관리합니다.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadInitialData}
            disabled={isDbBusy}
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
            {isLoading ? '불러오는 중...' : 'DB 새로고침'}
          </button>
          <div className="text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg px-4 py-2">
            전체 {filteredItems.length}개 / 사용중 {activeCount}개
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 grid-shadow">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4">
            <Scissors size={16} className="text-primary" />
            시술 항목 등록
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">카테고리</label>
              <select
                value={form.category}
                onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                disabled={categories.length === 0 || isMutating}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              >
                {categories.map((category) => (
                  <option key={category.code} value={category.code}>
                    {category.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">공통코드 그룹 `{CATEGORY_GROUP_ID}` 기준으로 표시됩니다.</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">시술명</label>
              <input
                value={form.serviceName}
                onChange={(event) => setForm((prev) => ({ ...prev, serviceName: event.target.value }))}
                placeholder="예) 남성 커트 + 다운펌"
                disabled={isMutating}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">단가(원)</label>
                <input
                  type="number"
                  value={form.unitPrice}
                  onChange={(event) => setForm((prev) => ({ ...prev, unitPrice: event.target.value }))}
                  placeholder="50000"
                  disabled={isMutating}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">소요(분)</label>
                <input
                  type="number"
                  value={form.durationMinutes}
                  onChange={(event) => setForm((prev) => ({ ...prev, durationMinutes: event.target.value }))}
                  placeholder="60"
                  disabled={isMutating}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">사용 여부</label>
              <select
                value={form.useYn}
                onChange={(event) => setForm((prev) => ({ ...prev, useYn: event.target.value as 'Y' | 'N' }))}
                disabled={isMutating}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              >
                <option value="Y">사용</option>
                <option value="N">미사용</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">비고</label>
              <textarea
                value={form.note}
                onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                rows={3}
                placeholder="추가 금액 조건, 유의사항 등"
                disabled={isMutating}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none resize-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isMutating}
                className="flex-1 bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                {editingId ? <Save size={16} /> : <PlusCircle size={16} />}
                {editingId ? '수정 저장' : '시술 추가'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                disabled={isMutating}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-60"
              >
                초기화
              </button>
            </div>
          </form>
        </section>

        <section className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-700">시술 항목 목록</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setFilterCategory('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  filterCategory === 'ALL'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                전체
              </button>
              {categories.map((category) => (
                <button
                  key={category.code}
                  onClick={() => setFilterCategory(category.code)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    filterCategory === category.code
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[880px]">
              <thead>
                <tr className="bg-slate-900 text-slate-200">
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">카테고리</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">시술명</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-right">단가</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-right">소요(분)</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-center">상태</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">비고</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-center">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-sm text-slate-400">
                      등록된 시술 항목이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 text-sm font-semibold text-slate-700">
                        {categoryMap.get(item.category) || item.categoryName || item.category}
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-700">{item.serviceName}</td>
                      <td className="py-3 px-4 text-sm text-right font-semibold text-slate-700">{formatCurrency(item.unitPrice)}</td>
                      <td className="py-3 px-4 text-sm text-right text-slate-600">{item.durationMinutes}</td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.useYn === 'Y'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-500 border border-slate-200'
                          }`}
                        >
                          {item.useYn === 'Y' ? '사용' : '미사용'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-500">{item.note || '-'}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleEdit(item)}
                            disabled={isMutating}
                            className="p-1.5 rounded text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            disabled={isMutating}
                            className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </motion.div>
  );
}
