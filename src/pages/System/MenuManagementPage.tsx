import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { invokeDbCommand } from '../../lib/dbClient';
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
  order: number;
  status: string;
  names: MenuNames;
};

type MenuNode = {
  id: number;
  parent_id: number | null;
  menu_type: MenuType;
  path: string;
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
  order: number;
  status: string;
};

const EMPTY_FORM: MenuForm = {
  id: 0,
  type: 'MAIN',
  parentId: '',
  names: { ko: '', en: '', zh: '' },
  path: '',
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
  const { i18n } = useTranslation();
  const [menuData, setMenuData] = useState<MenuNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const isDbBusy = isLoading || isMutating;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<MenuForm>(EMPTY_FORM);

  const mainMenus = useMemo(() => menuData.filter((m) => m.menu_type === 'MAIN'), [menuData]);

  const getMenuName = (menu: { names: MenuNames }) => {
    const lang = (i18n.language || 'ko') as LangKey;
    return menu.names[lang] || menu.names.ko || 'Untitled';
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
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
      alert(typeof error === 'string' ? error : error?.message || '메뉴 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMenus();
  }, []);

  const openCreateModal = () => {
    setFormData(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (menu: MenuNode) => {
    setFormData({
      id: menu.id,
      type: menu.menu_type,
      parentId: menu.parent_id ? String(menu.parent_id) : '',
      names: { ...menu.names },
      path: menu.path,
      order: menu.order,
      status: menu.status || '사용중',
    });
    setIsModalOpen(true);
  };

  const handleSaveMenu = async () => {
    if (!formData.names.ko.trim() || !formData.names.en.trim() || !formData.names.zh.trim()) {
      alert('한국어/영어/중국어 메뉴명을 모두 입력해주세요.');
      return;
    }
    if (!formData.path.trim()) {
      alert('메뉴 경로(path)를 입력해주세요.');
      return;
    }
    if (formData.type === 'SUB' && !formData.parentId) {
      alert('하위 메뉴는 상위 메뉴를 선택해야 합니다.');
      return;
    }

    try {
      setIsMutating(true);
      const payload: MenuRow = {
        id: formData.id || 0,
        parent_id: formData.type === 'SUB' ? Number(formData.parentId) : null,
        menu_type: formData.type,
        path: formData.path.trim(),
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
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '메뉴 저장에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleDeleteMenu = async (menuId: number) => {
    if (!window.confirm('선택한 메뉴를 삭제하시겠습니까? 하위 메뉴도 함께 삭제됩니다.')) return;
    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('delete_menu_management', {
        menu_id: menuId,
      });
      await loadMenus();
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '메뉴 삭제에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
      {isDbBusy && (
        <div className="fixed inset-0 z-[70] bg-slate-900/20 backdrop-blur-[1px] flex items-center justify-center">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg flex items-center gap-2">
            <Loader2 size={18} className="animate-spin text-primary" />
            <span className="text-sm font-semibold text-slate-700">DB 처리 중...</span>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">메뉴 관리</h1>
          <p className="text-slate-500 mt-1">메뉴를 DB에서 조회하고 추가/수정/삭제합니다.</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadMenus}
            disabled={isDbBusy}
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
            {isLoading ? '불러오는 중...' : 'DB 새로고침'}
          </button>
          <button
            onClick={openCreateModal}
            disabled={isDbBusy}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-primary/20 disabled:opacity-60"
          >
            <Plus size={18} />
            메뉴 추가
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider w-1/3">메뉴명</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">경로</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">정렬</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">상태</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {menuData.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-slate-400 text-sm">
                  등록된 메뉴가 없습니다.
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
                            )}
                          </button>
                        ) : (
                          <div className="w-6" />
                        )}
                        <div className="size-8 rounded bg-slate-100 flex items-center justify-center text-primary">
                          <LayoutGrid size={16} />
                        </div>
                        <span className="text-sm font-bold text-slate-900">{getMenuName(menu)}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm font-mono text-slate-500">{menu.path}</td>
                    <td className="py-4 px-6 text-sm text-center font-medium text-slate-600">{menu.order}</td>
                    <td className="py-4 px-6 text-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {menu.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEditModal(menu)}
                          className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded transition-colors"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteMenu(menu.id)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
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
                          <td className="py-3 px-6 text-xs font-mono text-slate-400">{child.path}</td>
                          <td className="py-3 px-6 text-xs text-center font-medium text-slate-500">{child.order}</td>
                          <td className="py-3 px-6 text-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">
                              {child.status}
                            </span>
                          </td>
                          <td className="py-3 px-6 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => openEditModal(child)}
                                className="p-1 text-slate-400 hover:text-primary transition-colors"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={() => handleDeleteMenu(child.id)}
                                className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </motion.tr>
                      ))}
                  </AnimatePresence>
                </React.Fragment>
              ))
            )}
          </tbody>
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
              <h3 className="text-lg font-bold text-slate-900">{formData.id ? '메뉴 수정' : '메뉴 추가'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setFormData((prev) => ({ ...prev, type: 'MAIN', parentId: '' }))}
                  className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${
                    formData.type === 'MAIN'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-slate-100 text-slate-400 hover:border-slate-200'
                  }`}
                >
                  <LayoutGrid size={18} />
                  <span className="font-bold text-sm">상위 메뉴</span>
                </button>
                <button
                  onClick={() => setFormData((prev) => ({ ...prev, type: 'SUB' }))}
                  className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${
                    formData.type === 'SUB'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-slate-100 text-slate-400 hover:border-slate-200'
                  }`}
                >
                  <ListIcon size={18} />
                  <span className="font-bold text-sm">하위 메뉴</span>
                </button>
              </div>

              {formData.type === 'SUB' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">상위 메뉴 선택</label>
                  <select
                    value={formData.parentId}
                    onChange={(e) => setFormData((prev) => ({ ...prev, parentId: e.target.value }))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">상위 메뉴를 선택하세요</option>
                    {mainMenus.map((m) => (
                      <option key={m.id} value={m.id}>
                        {getMenuName(m)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <label className="block text-xs font-bold text-slate-500 uppercase">메뉴명 (다국어)</label>
                <div>
                  <label className="text-xs text-slate-500">한국어</label>
                  <input
                    type="text"
                    value={formData.names.ko}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, names: { ...prev.names, ko: e.target.value } }))
                    }
                    placeholder="한국어 메뉴명"
                    className="w-full mt-1 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">English</label>
                  <input
                    type="text"
                    value={formData.names.en}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, names: { ...prev.names, en: e.target.value } }))
                    }
                    placeholder="English menu name"
                    className="w-full mt-1 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">中文(简体)</label>
                  <input
                    type="text"
                    value={formData.names.zh}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, names: { ...prev.names, zh: e.target.value } }))
                    }
                    placeholder="中文菜单名称"
                    className="w-full mt-1 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">경로(Path)</label>
                <input
                  type="text"
                  value={formData.path}
                  onChange={(e) => setFormData((prev) => ({ ...prev, path: e.target.value }))}
                  placeholder="/system/menu"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">정렬 순서</label>
                  <input
                    type="number"
                    value={formData.order}
                    onChange={(e) => setFormData((prev) => ({ ...prev, order: parseInt(e.target.value, 10) || 1 }))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">상태</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value }))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="사용중">사용중</option>
                    <option value="미사용">미사용</option>
                  </select>
                </div>
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
                onClick={handleSaveMenu}
                disabled={isMutating}
                className="flex-1 px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {formData.id ? '수정' : '추가'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
