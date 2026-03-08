import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { invokeDbCommand } from '../../lib/dbClient';
import {
  DEFAULT_SYSTEM_TYPE_CODE,
  normalizeSystemTypeCode,
  SYSTEM_TYPE_GROUP_ID,
  SYSTEM_TYPE_STORAGE_KEY,
} from '../../constants/systemType';
import {
  Database,
  Plus,
  Edit2,
  Trash2,
  ChevronRight,
  ChevronDown,
  X,
  LayoutGrid,
  List as ListIcon,
  Loader2,
} from 'lucide-react';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';

type MenuType = 'MAIN' | 'SUB';
type LangKey = 'ko' | 'en' | 'zh';

type MenuNames = {
  ko: string;
  en: string;
  zh: string;
};

type MenuRow = {
  id: number;
  parent_id: number | null;
  menu_type: string;
  path: string;
  system_type_code: string;
  is_start_menu: boolean;
  order: number;
  status: string;
  names: MenuNames;
};

type MenuNode = {
  id: number;
  parent_id: number | null;
  menu_type: MenuType;
  path: string;
  system_type_code: string;
  is_start_menu: boolean;
  order: number;
  status: string;
  names: MenuNames;
  children: MenuNode[];
};

type MenuForm = {
  id: number;
  type: MenuType;
  parentId: string;
  names: MenuNames;
  path: string;
  systemTypeCode: string;
  isStartMenu: boolean;
  order: number;
  status: string;
};

type CodeDetailRow = {
  group: string;
  code: string;
  name: string;
  order: number;
  use_yn: 'Y' | 'N';
};

type SystemTypeOption = {
  code: string;
  name: string;
  order: number;
};

const EMPTY_FORM: MenuForm = {
  id: 0,
  type: 'MAIN',
  parentId: '',
  names: { ko: '', en: '', zh: '' },
  path: '',
  systemTypeCode: DEFAULT_SYSTEM_TYPE_CODE,
  isStartMenu: false,
  order: 1,
  status: '사용중',
};

function normalizeType(value: string): MenuType {
  return value?.toUpperCase() === 'SUB' ? 'SUB' : 'MAIN';
}

function buildTree(rows: MenuRow[]): MenuNode[] {
  const map = new Map<number, MenuNode>();

  rows.forEach((row) => {
    map.set(row.id, {
      id: row.id,
      parent_id: row.parent_id,
      menu_type: normalizeType(row.menu_type),
      path: row.path,
      system_type_code: normalizeSystemTypeCode(row.system_type_code),
      is_start_menu: Boolean(row.is_start_menu),
      order: Number(row.order) || 1,
      status: row.status || '사용중',
      names: {
        ko: row.names?.ko || '',
        en: row.names?.en || '',
        zh: row.names?.zh || '',
      },
      children: [],
    });
  });

  const roots: MenuNode[] = [];
  map.forEach((node) => {
    if (node.menu_type === 'SUB' && node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  roots.sort((a, b) => (a.order - b.order) || (a.id - b.id));
  roots.forEach((root) => {
    root.children.sort((a, b) => (a.order - b.order) || (a.id - b.id));
  });
  return roots;
}

export default function MenuManagementPage() {
  const pt = usePageText('system_menu_management');
  const { i18n } = useTranslation();
  const [menuData, setMenuData] = useState<MenuNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const isDbBusy = isLoading || isMutating;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<MenuForm>(EMPTY_FORM);
  const [systemTypeOptions, setSystemTypeOptions] = useState<SystemTypeOption[]>([]);

  const mainMenus = useMemo(() => menuData.filter((m) => m.menu_type === 'MAIN'), [menuData]);
  const selectableMainMenus = useMemo(
    () =>
      mainMenus.filter((menu) => {
        const menuSystemType = normalizeSystemTypeCode(menu.system_type_code);
        const formSystemType = normalizeSystemTypeCode(formData.systemTypeCode);
        return menuSystemType === DEFAULT_SYSTEM_TYPE_CODE || menuSystemType === formSystemType;
      }),
    [formData.systemTypeCode, mainMenus],
  );
  const systemTypeNameMap = useMemo(
    () => new Map(systemTypeOptions.map((item) => [item.code, item.name] as const)),
    [systemTypeOptions],
  );
  const getSystemTypeName = (code: string) => {
    const normalized = normalizeSystemTypeCode(code);
    if (normalized === DEFAULT_SYSTEM_TYPE_CODE) return pt('t003');
    return systemTypeNameMap.get(normalized) || normalized;
  };

  const getMenuName = (menu: { names: MenuNames }) => {
    const lang = (i18n.language || 'ko') as LangKey;
    return menu.names[lang] || menu.names.ko || 'Untitled';
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };

  const loadSystemTypeOptions = async () => {
    try {
      const result = await invokeDbCommand<{
        success: boolean;
        message: string;
        details: CodeDetailRow[];
      }>('get_common_code_management_data');
      const options = (result.details || [])
        .filter((detail) => detail.group === SYSTEM_TYPE_GROUP_ID && detail.use_yn === 'Y')
        .map((detail) => ({
          code: detail.code,
          name: detail.name,
          order: detail.order,
        }))
        .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code));
      setSystemTypeOptions(options);
    } catch (error) {
      console.error('Failed to load SYSTEM_TYPE common codes:', error);
      setSystemTypeOptions([]);
    }
  };

  const loadMenus = async () => {
    try {
      setIsLoading(true);
      const result = await invokeDbCommand<{
        success: boolean;
        message: string;
        menus: MenuRow[];
      }>('get_menu_management_data');

      const tree = buildTree(result.menus || []);
      setMenuData(tree);
      setExpandedIds(tree.map((m) => m.id));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t025'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMenus();
    loadSystemTypeOptions();
  }, []);

  const openCreateModal = () => {
    const currentSystemType = normalizeSystemTypeCode(localStorage.getItem(SYSTEM_TYPE_STORAGE_KEY));
    const resolvedSystemType = systemTypeOptions.some((item) => item.code === currentSystemType)
      ? currentSystemType
      : (systemTypeOptions[0]?.code || DEFAULT_SYSTEM_TYPE_CODE);
    setFormData({
      ...EMPTY_FORM,
      systemTypeCode: resolvedSystemType,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (menu: MenuNode) => {
    setFormData({
      id: menu.id,
      type: menu.menu_type,
      parentId: menu.parent_id ? String(menu.parent_id) : '',
      names: { ...menu.names },
      path: menu.path,
      systemTypeCode: normalizeSystemTypeCode(menu.system_type_code),
      isStartMenu: Boolean(menu.is_start_menu),
      order: menu.order,
      status: menu.status || '사용중',
    });
    setIsModalOpen(true);
  };

  const handleSaveMenu = async () => {
    if (!formData.names.ko.trim() || !formData.names.en.trim() || !formData.names.zh.trim()) {
      alert(pt('t021'));
      return;
    }
    if (!formData.systemTypeCode.trim()) {
      alert(pt('t024'));
      return;
    }
    if (!formData.path.trim()) {
      alert(pt('t004'));
      return;
    }
    if (formData.type === 'SUB' && !formData.parentId) {
      alert(pt('t018'));
      return;
    }

    try {
      setIsMutating(true);
      const payload: MenuRow = {
        id: formData.id || 0,
        parent_id: formData.type === 'SUB' ? Number(formData.parentId) : null,
        menu_type: formData.type,
        path: formData.path.trim(),
        system_type_code: normalizeSystemTypeCode(formData.systemTypeCode),
        is_start_menu: formData.type === 'SUB' ? formData.isStartMenu : false,
        order: Number(formData.order) || 1,
        status: formData.status || '사용중',
        names: {
          ko: formData.names.ko.trim(),
          en: formData.names.en.trim(),
          zh: formData.names.zh.trim(),
        },
      };

      const result = await invokeDbCommand<{ success: boolean; message: string }>('upsert_menu_management', {
        menu: payload,
      });
      await loadMenus();
      if (payload.parent_id) {
        setExpandedIds((prev) => (prev.includes(payload.parent_id!) ? prev : [...prev, payload.parent_id!]));
      }
      setIsModalOpen(false);
      window.dispatchEvent(new Event('menu-management-updated'));
      alert(formData.id ? pt('t026') : pt('t027'));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t028'));
    } finally {
      setIsMutating(false);
    }
  };

  const handleDeleteMenu = async (menuId: number) => {
    if (!window.confirm(pt('t013'))) return;
    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('delete_menu_management', {
        menu_id: menuId,
      });
      await loadMenus();
      window.dispatchEvent(new Event('menu-management-updated'));
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t029'));
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <LoadingOverlay visible={isDbBusy} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t030')}</h1>
          <p className="text-slate-500 mt-1">{pt('t005')}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadMenus}
            disabled={isDbBusy}
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
            {isLoading ? pt('t031') : pt('t032')}
          </button>
          <button
            onClick={openCreateModal}
            disabled={isDbBusy}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-primary/20 disabled:opacity-60"
          >
            <Plus size={18} />
            {pt('t033')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider w-1/3">{pt('t006')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t014')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t001')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t015')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t034')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">시작메뉴</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t035')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {menuData.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400 text-sm">
                  {pt('t036')}
                </td>
              </tr>
            ) : (
              menuData.map((menu) => (
                <React.Fragment key={menu.id}>
                  <tr className="hover:bg-slate-50 transition-colors group">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        {menu.children.length > 0 ? (
                          <button onClick={() => toggleExpand(menu.id)} className="p-1 hover:bg-slate-200 rounded transition-colors">
                            {expandedIds.includes(menu.id) ? (
                              <ChevronDown size={16} className="text-slate-600" />
                            ) : (
                              <ChevronRight size={16} className="text-slate-400" />
                            )}</button>
                        ) : (
                          <div className="w-6" />
                        )}<div className="size-8 rounded bg-slate-100 flex items-center justify-center text-primary">
                          <LayoutGrid size={16} />
                        </div>
                        <span className="text-sm font-bold text-slate-900">{getMenuName(menu)}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {getSystemTypeName(menu.system_type_code)}</span>
                    </td>
                    <td className="py-4 px-6 text-sm font-mono text-slate-500">{menu.path}</td>
                    <td className="py-4 px-6 text-sm text-center font-medium text-slate-600">{menu.order}</td>
                    <td className="py-4 px-6 text-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {menu.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      {menu.is_start_menu ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          시작
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">-</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEditModal(menu)} className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded transition-colors"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteMenu(menu.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  <AnimatePresence>
                    {expandedIds.includes(menu.id) &&
                      menu.children.map((child) => (
                        <motion.tr
                          key={child.id}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="bg-slate-50/50 hover:bg-slate-100 transition-colors group"
                        >
                          <td className="py-3 px-6 pl-16">
                            <div className="flex items-center gap-3">
                              <div className="size-6 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                                <ListIcon size={12} />
                              </div>
                              <span className="text-sm font-medium text-slate-700">{getMenuName(child)}</span>
                            </div>
                          </td>
                          <td className="py-3 px-6 text-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {getSystemTypeName(child.system_type_code)}</span>
                          </td>
                          <td className="py-3 px-6 text-xs font-mono text-slate-400">{child.path}</td>
                          <td className="py-3 px-6 text-xs text-center font-medium text-slate-500">{child.order}</td>
                          <td className="py-3 px-6 text-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">
                              {child.status}
                            </span>
                          </td>
                          <td className="py-3 px-6 text-center">
                            {child.is_start_menu ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                시작
                              </span>
                            ) : (
                              <span className="text-xs text-slate-300">-</span>
                            )}
                          </td>
                          <td className="py-3 px-6 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => openEditModal(child)} className="p-1 text-slate-400 hover:text-primary transition-colors"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={() => handleDeleteMenu(child.id)} className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </motion.tr>
                      ))}</AnimatePresence>
                </React.Fragment>
              ))
            )}</tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">{formData.id ? pt('t037') : pt('t033')}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setFormData((prev) => ({ ...prev, type: 'MAIN', parentId: '', isStartMenu: false }))} className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${
                    formData.type === 'MAIN'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-slate-100 text-slate-400 hover:border-slate-200'
                  }`}
                >
                  <LayoutGrid size={18} />
                  <span className="font-bold text-sm">{pt('t010')}</span>
                </button>
                <button
                  onClick={() => setFormData((prev) => ({ ...prev, type: 'SUB' }))} className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${
                    formData.type === 'SUB'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-slate-100 text-slate-400 hover:border-slate-200'
                  }`}
                >
                  <ListIcon size={18} />
                  <span className="font-bold text-sm">{pt('t017')}</span>
                </button>
              </div>

              {formData.type === 'SUB' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t011')}</label>
                  <select
                    value={formData.parentId}
                    onChange={(e) => setFormData((prev) => ({ ...prev, parentId: e.target.value }))} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">{pt('t012')}</option>
                    {selectableMainMenus.map((m) => (
                      <option key={m.id} value={m.id}>
                        {getMenuName(m)}</option>
                    ))}</select>
                </div>
              )}<div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <label className="block text-xs font-bold text-slate-500 uppercase">{pt('t007')}</label>
                <div>
                  <label className="text-xs text-slate-500">{pt('t019')}</label>
                  <input
                    type="text"
                    value={formData.names.ko}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, names: { ...prev.names, ko: e.target.value } }))
                    }
                    placeholder={pt('t020')} className="w-full mt-1 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">{pt('t022')}</label>
                  <input
                    type="text"
                    value={formData.names.en}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, names: { ...prev.names, en: e.target.value } }))
                    }
                    placeholder={pt('t023')} className="w-full mt-1 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">{pt('t038')}</label>
                  <input
                    type="text"
                    value={formData.names.zh}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, names: { ...prev.names, zh: e.target.value } }))
                    }
                    placeholder={pt('t039')}
                    className="w-full mt-1 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t040')}</label>
                <select
                  value={formData.systemTypeCode}
                  onChange={(e) =>
                    setFormData((prev) => {
                      const nextSystemTypeCode = normalizeSystemTypeCode(e.target.value);
                      const selectedParent = mainMenus.find((menu) => String(menu.id) === prev.parentId);
                      const selectedParentSystemType = selectedParent
                        ? normalizeSystemTypeCode(selectedParent.system_type_code)
                        : '';
                      const isParentCompatible =
                        !selectedParent ||
                        selectedParentSystemType === DEFAULT_SYSTEM_TYPE_CODE ||
                        selectedParentSystemType === nextSystemTypeCode;

                      return {
                        ...prev,
                        systemTypeCode: nextSystemTypeCode,
                        parentId: prev.type === 'SUB' && !isParentCompatible ? '' : prev.parentId,
                      };
                    })
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value={DEFAULT_SYSTEM_TYPE_CODE}>{pt('t003')}</option>
                  {systemTypeOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name} ({option.code})
                    </option>
                  ))}</select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t002')}</label>
                <input
                  type="text"
                  value={formData.path}
                  onChange={(e) => setFormData((prev) => ({ ...prev, path: e.target.value }))} placeholder="/system/menu"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t016')}</label>
                  <input
                    type="number"
                    value={formData.order}
                    onChange={(e) => setFormData((prev) => ({ ...prev, order: parseInt(e.target.value, 10) || 1 }))} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t034')}</label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        status: e.target.value,
                        isStartMenu: e.target.value === '사용중' ? prev.isStartMenu : false,
                      }))
                    } className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="사용중">{pt('t009')}</option>
                    <option value="미사용">{pt('t008')}</option>
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={formData.isStartMenu}
                    disabled={formData.type !== 'SUB' || formData.status !== '사용중'}
                    onChange={(e) => setFormData((prev) => ({ ...prev, isStartMenu: e.target.checked }))}
                    className="size-4 rounded border-slate-300"
                  />
                  프로그램 시작 시 첫 화면으로 사용
                </label>
                <p className="text-xs text-slate-500 mt-1">
                  점포/시스템타입별로 1개의 하위 메뉴만 시작메뉴로 지정됩니다.
                </p>
              </div>
            </div>

            <div className="p-6 bg-slate-50 flex gap-3">
              <button
                onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-100 transition-colors"
              >
                {pt('t041')}
              </button>
              <button
                onClick={handleSaveMenu}
                disabled={isMutating}
                className="flex-1 px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {formData.id ? pt('t042') : pt('t043')}
              </button>
            </div>
          </motion.div>
        </div>
      )}</motion.div>
  );
}
