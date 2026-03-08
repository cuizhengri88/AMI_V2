import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Scissors,
  Filter,
  Clock,
  Database,
  X,
  GripHorizontal,
  JapaneseYen,
  Loader2,
} from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';

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

type ModalProps = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  icon: React.ReactNode;
};

const CATEGORY_GROUP_ID = 'T_CATEGORY';

const EMPTY_FORM: ServiceForm = {
  category: '',
  serviceName: '',
  unitPrice: '',
  durationMinutes: '',
  useYn: 'Y',
  note: '',
};

function formatCurrency(value: number) {
  return value.toLocaleString('ko-KR');
}

function formatProcedureCode(id: number) {
  return `PROC${String(id).padStart(3, '0')}`;
}

function DraggableModal({ title, children, onClose, icon }: ModalProps) {
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
        onPointerDown={(event) => dragControls.start(event)} className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 cursor-move active:cursor-grabbing"
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
      {children}
    </motion.div>
  );
}

export default function ServiceCatalogPage() {
  const pt = usePageText('system_service_catalog');
  const fallbackServiceCategories = useMemo<ServiceCategory[]>(
    () => [
      { code: 'CUT', label: pt('t041') },
      { code: 'PERM', label: pt('t042') },
      { code: 'COLOR', label: pt('t043') },
      { code: 'ETC', label: pt('t044') },
    ],
    [pt],
  );
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | CategoryCode>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [newForm, setNewForm] = useState<ServiceForm>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<ServiceForm>(EMPTY_FORM);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);

  const isDbBusy = isLoading || isMutating;

  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.code, category.label])), [categories]);

  const categoryStats = useMemo(
    () =>
      categories.map((category) => ({
        ...category,
        count: items.filter((item) => item.category === category.code).length,
      })),
    [categories, items],
  );

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return items.filter((item) => {
      const categoryLabel = categoryMap.get(item.category) || item.categoryName || item.category;
      const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
      const matchesSearch =
        query.length === 0 ||
        item.serviceName.toLowerCase().includes(query) ||
        categoryLabel.toLowerCase().includes(query) ||
        formatProcedureCode(item.id).toLowerCase().includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [items, categoryMap, searchTerm, selectedCategory]);

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

      const nextCategories = loadedCategories.length > 0 ? loadedCategories : fallbackServiceCategories;
      setCategories(nextCategories);

      setNewForm((prev) => {
        if (nextCategories.some((category) => category.code === prev.category)) return prev;
        return { ...prev, category: nextCategories[0]?.code || '' };
      });
      setEditForm((prev) => {
        if (!prev.category || nextCategories.some((category) => category.code === prev.category)) return prev;
        return { ...prev, category: nextCategories[0]?.code || '' };
      });
    } catch (error) {
      setCategories(fallbackServiceCategories);
      setNewForm((prev) => ({
        ...prev,
        category: prev.category || fallbackServiceCategories[0].code,
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
      alert(typeof error === 'string' ? error : error?.message || pt('t014'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedCategory === 'all') return;
    if (!categories.some((category) => category.code === selectedCategory)) {
      setSelectedCategory('all');
    }
  }, [categories, selectedCategory]);

  const resetNewForm = () => {
    setNewForm({
      ...EMPTY_FORM,
      category: categories[0]?.code || '',
    });
  };

  const resetEditState = () => {
    setEditingItemId(null);
    setEditForm({
      ...EMPTY_FORM,
      category: categories[0]?.code || '',
    });
  };

  const validateForm = (form: ServiceForm) => {
    const unitPrice = Number(form.unitPrice);
    const durationMinutes = Number(form.durationMinutes);

    if (!form.category) return pt('t034', { group: CATEGORY_GROUP_ID });
    if (!form.serviceName.trim()) return pt('t035');
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return pt('t036');
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return pt('t037');

    return null;
  };

  const upsertItem = async (form: ServiceForm, serviceId?: number) => {
    return invokeDbCommand<{ success: boolean; message: string }>('upsert_service_catalog_item', {
      item: {
        service_id: serviceId,
        category_code: form.category,
        service_name: form.serviceName.trim(),
        unit_price: Number(form.unitPrice),
        duration_minutes: Number(form.durationMinutes),
        use_yn: form.useYn,
        note: form.note.trim() || null,
      },
    });
  };

  const handleSaveNew = async (event: React.FormEvent) => {
    event.preventDefault();

    const errorMessage = validateForm(newForm);
    if (errorMessage) {
      alert(errorMessage);
      return;
    }

    try {
      setIsMutating(true);
      const result = await upsertItem(newForm);
      await loadServiceItems();
      resetNewForm();
      setIsNewModalOpen(false);
      alert(result.message || pt('t015'));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t016'));
    } finally {
      setIsMutating(false);
    }
  };

  const handleEditClick = (item: ServiceItem) => {
    setEditingItemId(item.id);
    setEditForm({
      category: item.category,
      serviceName: item.serviceName,
      unitPrice: String(item.unitPrice),
      durationMinutes: String(item.durationMinutes),
      useYn: item.useYn,
      note: item.note,
    });
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (editingItemId == null) return;

    const errorMessage = validateForm(editForm);
    if (errorMessage) {
      alert(errorMessage);
      return;
    }

    try {
      setIsMutating(true);
      const result = await upsertItem(editForm, editingItemId);
      await loadServiceItems();
      resetEditState();
      setIsEditModalOpen(false);
      alert(result.message || pt('t017'));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t016'));
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(pt('t009'))) return;

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('delete_service_catalog_item', {
        service_id: id,
      });
      await loadServiceItems();
      if (editingItemId === id) {
        setIsEditModalOpen(false);
        resetEditState();
      }
      alert(result.message || pt('t018'));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t019'));
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <LoadingOverlay visible={isDbBusy} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t003')}</h1>
          <p className="text-slate-500 mt-1">{pt('t002')}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadInitialData}
            disabled={isDbBusy}
            className="bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold px-4 py-2 rounded-lg border border-slate-200 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
            {pt('t020')}
          </button>
          <button
            onClick={() => {
              resetNewForm();
              setIsNewModalOpen(true);
            }}
            disabled={isDbBusy}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-primary/20 disabled:opacity-60"
          >
            <Plus size={18} />
            {pt('t021')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
          <div className="size-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Scissors size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{pt('t012')}</p>
            <p className="text-2xl font-black text-slate-900">{items.length}</p>
          </div>
        </div>
        {categoryStats.map((category) => (
          <div key={category.code} className="bg-white p-4 rounded-xl border border-slate-200 grid-shadow flex items-center gap-4">
            <div className="size-12 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center font-bold">
              {category.label.slice(0, 1)}</div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{category.label}</p>
              <p className="text-2xl font-black text-slate-900">{category.count}</p>
            </div>
          </div>
        ))}</div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder={pt('t006')} value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)} className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value as 'all' | CategoryCode)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="all">{pt('t022')}</option>
              {categories.map((category) => (
                <option key={category.code} value={category.code}>
                  {category.label}
                </option>
              ))}</select>
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedCategory('all');
              }}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50"
            >
              <Filter size={16} />
              {pt('t023')}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-slate-900 text-slate-200">
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t013')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t005')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t024')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-right">{pt('t001')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t011')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t025')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t026')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-slate-400">
                    {pt('t027')}
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const categoryLabel = categoryMap.get(item.category) || item.categoryName || item.category;

                  return (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-4 px-6 text-sm font-mono font-bold text-slate-500">{formatProcedureCode(item.id)}</td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="size-10 rounded bg-primary/5 flex items-center justify-center text-primary">
                            <Scissors size={20} />
                          </div>
                          <span className="text-sm font-bold text-slate-900">{item.serviceName}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-sm text-slate-600">
                        <span className="px-2 py-1 bg-slate-100 rounded text-xs font-bold">{categoryLabel}</span>
                      </td>
                      <td className="py-4 px-6 text-sm text-right font-bold text-slate-900">{formatCurrency(item.unitPrice)}</td>
                      <td className="py-4 px-6 text-sm text-center font-medium text-slate-600">
                        <div className="flex items-center justify-center gap-1">
                          <Clock size={14} className="text-slate-400" />
                          {item.durationMinutes}{pt('t028')}
                        </div>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            item.useYn === 'Y'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}
                        >
                          {item.useYn === 'Y' ? pt('t029') : pt('t030')}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleEditClick(item)} disabled={isMutating}
                            className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)} disabled={isMutating}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}</tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isNewModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={pt('t007')} onClose={() => setIsNewModalOpen(false)} icon={<Plus size={20} className="text-primary" />}
            >
              <form onSubmit={handleSaveNew} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t005')}</label>
                    <input
                      type="text"
                      required
                      value={newForm.serviceName}
                      onChange={(event) => setNewForm((prev) => ({ ...prev, serviceName: event.target.value }))} disabled={isMutating}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      placeholder={pt('t008')} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t024')}</label>
                    <select
                      value={newForm.category}
                      onChange={(event) => setNewForm((prev) => ({ ...prev, category: event.target.value }))} disabled={isMutating}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      {categories.map((category) => (
                        <option key={category.code} value={category.code}>
                          {category.label}
                        </option>
                      ))}</select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t010')}</label>
                    <div className="relative">
                      <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="number"
                        required
                        value={newForm.durationMinutes}
                        onChange={(event) => setNewForm((prev) => ({ ...prev, durationMinutes: event.target.value }))} disabled={isMutating}
                        className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        placeholder="30"
                      />
                    </div>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t001')}</label>
                    <div className="relative">
                      <JapaneseYen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="number"
                        required
                        value={newForm.unitPrice}
                        onChange={(event) => setNewForm((prev) => ({ ...prev, unitPrice: event.target.value }))} disabled={isMutating}
                        className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsNewModalOpen(false)} disabled={isMutating}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-60"
                  >
                    {pt('t031')}
                  </button>
                  <button
                    type="submit"
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                  >
                    {pt('t032')}
                  </button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}</AnimatePresence>

      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={pt('t004')} onClose={() => {
                setIsEditModalOpen(false);
                resetEditState();
              }}
              icon={<Edit2 size={20} className="text-primary" />}
            >
              <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t005')}</label>
                    <input
                      type="text"
                      required
                      value={editForm.serviceName}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, serviceName: event.target.value }))} disabled={isMutating}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t024')}</label>
                    <select
                      value={editForm.category}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, category: event.target.value }))} disabled={isMutating}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      {categories.map((category) => (
                        <option key={category.code} value={category.code}>
                          {category.label}
                        </option>
                      ))}</select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t010')}</label>
                    <div className="relative">
                      <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="number"
                        required
                        value={editForm.durationMinutes}
                        onChange={(event) => setEditForm((prev) => ({ ...prev, durationMinutes: event.target.value }))} disabled={isMutating}
                        className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      />
                    </div>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">{pt('t001')}</label>
                    <div className="relative">
                      <JapaneseYen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="number"
                        required
                        value={editForm.unitPrice}
                        onChange={(event) => setEditForm((prev) => ({ ...prev, unitPrice: event.target.value }))} disabled={isMutating}
                        className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditModalOpen(false);
                      resetEditState();
                    }}
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-60"
                  >
                    {pt('t031')}
                  </button>
                  <button
                    type="submit"
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                  >
                    {pt('t033')}
                  </button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}</AnimatePresence>
    </motion.div>
  );
}
