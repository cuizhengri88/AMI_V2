import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { 
  TrendingUp, ShoppingBag, Package, ShoppingCart, Users, Settings, 
  Database, Plus, Edit2, Trash2, ChevronRight, ChevronDown, 
  Monitor, Shield, Briefcase, X, LayoutGrid, List as ListIcon, History as HistoryIcon
} from 'lucide-react';

const initialMenuData = [
  { 
    id: 100, 
    names: { ko: '매출 관리', en: 'Sales Management', zh: '销售管理' },
    path: '/sales', 
    icon: TrendingUp, 
    status: '사용중', 
    order: 1, 
    type: 'MAIN', 
    children: [
      { id: 1, names: { ko: '매출 통계', en: 'Sales Stats', zh: '销售统计' }, path: '/sales-stats', icon: TrendingUp, status: '사용중', order: 1, type: 'SUB' },
      { id: 4, names: { ko: '구매 관리', en: 'Purchase Management', zh: '购买管理' }, path: '/purchases', icon: ShoppingCart, status: '사용중', order: 2, type: 'SUB' },
    ] 
  },
  { 
    id: 200, 
    names: { ko: '상품/재고 관리', en: 'Product/Stock Management', zh: '产品/库存管理' },
    path: '/product-stock', 
    icon: Package, 
    status: '사용중', 
    order: 2, 
    type: 'MAIN', 
    children: [
      { id: 2, names: { ko: '상품 관리', en: 'Product Management', zh: '产品管理' }, path: '/products', icon: ShoppingBag, status: '사용중', order: 1, type: 'SUB' },
      { id: 31, names: { ko: '재고 관리', en: 'Stock Management', zh: '库存管理' }, path: '/inventory', icon: Package, status: '사용중', order: 2, type: 'SUB' },
      { id: 32, names: { ko: '재고 이력', en: 'Stock History', zh: '库存历史' }, path: '/inventory/history', icon: HistoryIcon, status: '사용중', order: 3, type: 'SUB' },
    ] 
  },
  { 
    id: 300, 
    names: { ko: '인사 관리', en: 'HR Management', zh: '人事管理' },
    path: '/hr', 
    icon: Users, 
    status: '사용중', 
    order: 3, 
    type: 'MAIN', 
    children: [
      { id: 5, names: { ko: '사용자 관리', en: 'User Management', zh: '用户管理' }, path: '/users', icon: Users, status: '사용중', order: 1, type: 'SUB' },
      { id: 11, names: { ko: '직원 관리', en: 'Employee Management', zh: '员工管理' }, path: '/employees', icon: Briefcase, status: '사용중', order: 2, type: 'SUB' },
    ] 
  },
  { 
    id: 6, 
    names: { ko: '시스템 관리', en: 'System Management', zh: '系统管理' },
    path: '/system', 
    icon: Settings, 
    status: '사용중', 
    order: 4, 
    type: 'MAIN',
    children: [
      { id: 7, names: { ko: '메뉴 관리', en: 'Menu Management', zh: '菜单管理' }, path: '/system/menu', icon: LayoutGrid, status: '사용중', order: 1, type: 'SUB' },
      { id: 8, names: { ko: '코드 관리', en: 'Code Management', zh: '代码管理' }, path: '/system/code', icon: Database, status: '사용중', order: 2, type: 'SUB' },
      { id: 9, names: { ko: '권한 관리', en: 'Role Management', zh: '权限管理' }, path: '/system/role', icon: Shield, status: '사용중', order: 3, type: 'SUB' },
      { id: 10, names: { ko: '시스템 설정', en: 'System Settings', zh: '系统设置' }, path: '/system/settings', icon: Monitor, status: '사용중', order: 4, type: 'SUB' },
    ] 
  },
];

export default function MenuManagementPage() {
  const { t, i18n } = useTranslation();
  const [menuData, setMenuData] = useState(initialMenuData);
  const [expandedIds, setExpandedIds] = useState<number[]>([100, 200, 300, 6]); // Default expanded categories
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<any>(null);
  
  // New Menu Form State
  const [formData, setFormData] = useState({
    names: { ko: '', en: '', zh: '' },
    path: '',
    type: 'MAIN' as 'MAIN' | 'SUB',
    parentId: '',
    order: 1,
    status: '사용중'
  });

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleOpenAddModal = () => {
    setEditingMenu(null);
    setFormData({
      names: { ko: '', en: '', zh: '' },
      path: '',
      type: 'MAIN',
      parentId: '',
      order: 1,
      status: '사용중'
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (menu: any) => {
    setEditingMenu(menu);
    setFormData({
      names: { ...menu.names },
      path: menu.path,
      type: menu.type,
      parentId: menu.parentId || '',
      order: menu.order,
      status: menu.status
    });
    setIsModalOpen(true);
  };

  const handleSaveMenu = () => {
    if (editingMenu) {
      // Update existing menu
      const updatedData = menuData.map(m => {
        if (m.id === editingMenu.id) {
          return { ...m, ...formData };
        }
        if (m.children) {
          return {
            ...m,
            children: m.children.map((c: any) => c.id === editingMenu.id ? { ...c, ...formData } : c)
          };
        }
        return m;
      });
      setMenuData(updatedData);
    } else {
      // Add new menu
      const id = Math.max(0, ...menuData.map(m => m.id), ...menuData.flatMap(m => m.children?.map((c: any) => c.id) || [])) + 1;
      const menuToAdd = {
        id,
        names: formData.names,
        path: formData.path,
        icon: ListIcon, // Default icon
        status: formData.status,
        order: Number(formData.order),
        type: formData.type,
        children: []
      };

      if (formData.type === 'MAIN') {
        setMenuData([...menuData, menuToAdd]);
      } else {
        setMenuData(menuData.map(m => {
          if (m.id === Number(formData.parentId)) {
            return { ...m, children: [...(m.children || []), menuToAdd] };
          }
          return m;
        }));
        // Auto expand parent
        if (!expandedIds.includes(Number(formData.parentId))) {
          setExpandedIds([...expandedIds, Number(formData.parentId)]);
        }
      }
    }

    setIsModalOpen(false);
  };

  const getMenuName = (menu: any) => {
    const lang = i18n.language as 'ko' | 'en' | 'zh';
    return menu.names[lang] || menu.names['ko'] || 'Untitled';
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t('menu.menu_management')}</h1>
          <p className="text-slate-500 mt-1">시스템의 메뉴 구조 및 권한을 설정합니다.</p>
        </div>
        
        <button 
          onClick={handleOpenAddModal}
          className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-primary/20"
        >
          <Plus size={18} />
          {t('common.add')}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider w-1/3">{t('common.name')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('common.path')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('common.order')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('common.status')}</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('common.action')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {menuData.map((menu) => (
              <React.Fragment key={menu.id}>
                <tr className="hover:bg-slate-50 transition-colors group">
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      {menu.children.length > 0 ? (
                        <button 
                          onClick={() => toggleExpand(menu.id)}
                          className="p-1 hover:bg-slate-200 rounded transition-colors"
                        >
                          {expandedIds.includes(menu.id) ? <ChevronDown size={16} className="text-slate-600" /> : <ChevronRight size={16} className="text-slate-400" />}
                        </button>
                      ) : (
                        <div className="w-6" />
                      )}
                      <div className="size-8 rounded bg-slate-100 flex items-center justify-center text-primary">
                        <menu.icon size={16} />
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
                        onClick={() => handleOpenEditModal(menu)}
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
                
                {/* Tree Children */}
                <AnimatePresence>
                  {expandedIds.includes(menu.id) && menu.children.map((child: any) => (
                    <motion.tr 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      key={child.id} 
                      className="bg-slate-50/50 hover:bg-slate-100 transition-colors group"
                    >
                      <td className="py-3 px-6 pl-16">
                        <div className="flex items-center gap-3">
                          <div className="size-6 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                            <child.icon size={12} />
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
                            onClick={() => handleOpenEditModal(child)}
                            className="p-1 text-slate-400 hover:text-primary transition-colors"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button className="p-1 text-slate-400 hover:text-red-500 transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Menu Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">
                {editingMenu ? '메뉴 수정' : '새 메뉴 추가'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={() => setFormData({ ...formData, type: 'MAIN' })}
                  className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${formData.type === 'MAIN' ? 'border-primary bg-primary/5 text-primary' : 'border-slate-100 text-slate-400 hover:border-slate-200'}`}
                >
                  <LayoutGrid size={18} />
                  <span className="font-bold text-sm">대메뉴</span>
                </button>
                <button 
                  onClick={() => setFormData({ ...formData, type: 'SUB' })}
                  className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${formData.type === 'SUB' ? 'border-primary bg-primary/5 text-primary' : 'border-slate-100 text-slate-400 hover:border-slate-200'}`}
                >
                  <ListIcon size={18} />
                  <span className="font-bold text-sm">일반메뉴</span>
                </button>
              </div>

              {formData.type === 'SUB' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">상위 메뉴 선택</label>
                  <select 
                    value={formData.parentId}
                    onChange={(e) => setFormData({ ...formData, parentId: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">상위 메뉴를 선택하세요</option>
                    {menuData.filter(m => m.type === 'MAIN').map(m => (
                      <option key={m.id} value={m.id}>{getMenuName(m)}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <label className="block text-xs font-bold text-slate-500 uppercase">{t('common.name')} (다국어)</label>
                
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 uppercase">KO</span>
                    <span className="text-xs text-slate-400 italic">한국어</span>
                  </div>
                  <input 
                    type="text" 
                    value={formData.names.ko}
                    onChange={(e) => setFormData({ ...formData, names: { ...formData.names, ko: e.target.value } })}
                    placeholder="한국어 메뉴명"
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 uppercase">EN</span>
                    <span className="text-xs text-slate-400 italic">English</span>
                  </div>
                  <input 
                    type="text" 
                    value={formData.names.en}
                    onChange={(e) => setFormData({ ...formData, names: { ...formData.names, en: e.target.value } })}
                    placeholder="English Menu Name"
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 uppercase">ZH</span>
                    <span className="text-xs text-slate-400 italic">中文</span>
                  </div>
                  <input 
                    type="text" 
                    value={formData.names.zh}
                    onChange={(e) => setFormData({ ...formData, names: { ...formData.names, zh: e.target.value } })}
                    placeholder="中文菜单名称"
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('common.path')}</label>
                <input 
                  type="text" 
                  value={formData.path}
                  onChange={(e) => setFormData({ ...formData, path: e.target.value })}
                  placeholder="/example/path"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('common.order')}</label>
                  <input 
                    type="number" 
                    value={formData.order}
                    onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 1 })}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{t('common.status')}</label>
                  <select 
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
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
                {t('common.cancel')}
              </button>
              <button 
                onClick={handleSaveMenu}
                disabled={!formData.names.ko || !formData.path || (formData.type === 'SUB' && !formData.parentId)}
                className="flex-1 px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingMenu ? t('common.save') : t('common.add')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
