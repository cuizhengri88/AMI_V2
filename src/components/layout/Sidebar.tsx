import React, { useState } from 'react';
import { 
  Database, 
  ShoppingBag,
  Package,
  History as HistoryIcon,
  ShoppingCart,
  TrendingUp,
  Users,
  Briefcase,
  Settings,
  Shield,
  Monitor,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  Globe
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';

const menuItems = [
  { 
    id: 100, 
    icon: TrendingUp, 
    names: { ko: '매출 관리', en: 'Sales Management', zh: '销售管理' },
    path: '/sales', 
    children: [
      { id: 1, icon: TrendingUp, names: { ko: '매출 통계', en: 'Sales Stats', zh: '销售统计' }, path: '/sales-stats' },
      { id: 4, icon: ShoppingCart, names: { ko: '구매 관리', en: 'Purchase Management', zh: '购买管理' }, path: '/purchases' },
    ] 
  },
  { 
    id: 200, 
    icon: Package, 
    names: { ko: '상품/재고 관리', en: 'Product/Stock Management', zh: '产品/库存管理' },
    path: '/product-stock', 
    children: [
      { id: 2, icon: ShoppingBag, names: { ko: '상품 관리', en: 'Product Management', zh: '产品管理' }, path: '/products' },
      { id: 31, icon: Package, names: { ko: '재고 관리', en: 'Stock Management', zh: '库存管理' }, path: '/inventory' },
      { id: 32, icon: HistoryIcon, names: { ko: '재고 이력', en: 'Stock History', zh: '库存历史' }, path: '/inventory/history' },
    ] 
  },
  { 
    id: 300, 
    icon: Users, 
    names: { ko: '인사 관리', en: 'HR Management', zh: '人事管理' },
    path: '/hr', 
    children: [
      { id: 5, icon: Users, names: { ko: '사용자 관리', en: 'User Management', zh: '用户管理' }, path: '/users' },
      { id: 11, icon: Briefcase, names: { ko: '직원 관리', en: 'Employee Management', zh: '员工管理' }, path: '/employees' },
    ] 
  },
  { 
    id: 6, 
    icon: Settings, 
    names: { ko: '시스템 관리', en: 'System Management', zh: '系统管理' },
    path: '/system', 
    children: [
      { id: 7, icon: LayoutGrid, names: { ko: '메뉴 관리', en: 'Menu Management', zh: '菜单管理' }, path: '/system/menu' },
      { id: 8, icon: Database, names: { ko: '코드 관리', en: 'Code Management', zh: '代码管理' }, path: '/system/code' },
      { id: 9, icon: Shield, names: { ko: '권한 관리', en: 'Role Management', zh: '权限管理' }, path: '/system/role' },
      { id: 10, icon: Monitor, names: { ko: '시스템 설정', en: 'System Settings', zh: '系统设置' }, path: '/system/settings' },
    ] 
  },
];

export default function Sidebar() {
  const { t, i18n } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedIds, setExpandedIds] = useState<number[]>([100, 200, 300, 6]); // Default expanded categories
  const [showLangMenu, setShowLangMenu] = useState(false);
  const location = useLocation();
  
  const getMenuName = (item: any) => {
    const lang = i18n.language as 'ko' | 'en' | 'zh';
    return item.names[lang] || item.names['ko'] || 'Untitled';
  };
  
  const programName = localStorage.getItem('programName') || 'GovData';
  const logoUrl = localStorage.getItem('logoUrl') || '';

  const toggleExpand = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    setShowLangMenu(false);
  };

  return (
    <aside className={`${isCollapsed ? 'w-20' : 'w-64'} flex-shrink-0 border-r border-slate-200 bg-white hidden lg:flex flex-col h-screen sticky top-0 transition-all duration-300 ease-in-out`}>
      <div className={`p-6 flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} border-b border-slate-200 relative`}>
        <div className="bg-primary p-1.5 rounded-lg text-white size-9 flex-shrink-0 flex items-center justify-center overflow-hidden">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <Database size={24} />
          )}
        </div>
        {!isCollapsed && <h2 className="text-lg font-bold tracking-tight text-slate-900 truncate">{programName}</h2>}
        
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-1/2 -translate-y-1/2 size-6 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-400 hover:text-primary hover:border-primary transition-all shadow-sm z-10"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
      
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
        {menuItems.map((item) => {
          const hasChildren = item.children.length > 0;
          const isExpanded = expandedIds.includes(item.id);
          const isChildActive = item.children.some(child => location.pathname === child.path);

          return (
            <div key={item.id} className="space-y-1">
              <NavLink
                to={hasChildren ? '#' : item.path}
                onClick={(e) => hasChildren && toggleExpand(e, item.id)}
                end={!hasChildren}
                title={isCollapsed ? getMenuName(item) : ''}
                className={({ isActive }) => `flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} px-3 py-2 rounded-lg transition-colors group ${
                  (isActive && !hasChildren) || (hasChildren && isChildActive)
                    ? 'bg-primary/10 text-primary' 
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
                  <item.icon size={20} className="flex-shrink-0" />
                  {!isCollapsed && <span className="text-sm font-medium truncate">{getMenuName(item)}</span>}
                </div>
                {!isCollapsed && hasChildren && (
                  <ChevronDown 
                    size={16} 
                    className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
                  />
                )}
              </NavLink>

              <AnimatePresence>
                {!isCollapsed && hasChildren && isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden pl-9 space-y-1"
                  >
                    {item.children.map((child) => (
                      <NavLink
                        key={child.id}
                        to={child.path}
                        end
                        className={({ isActive }) => `flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors ${
                          isActive 
                            ? 'text-primary font-bold' 
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                        }`}
                      >
                        <child.icon size={16} className="flex-shrink-0" />
                        <span className="text-xs font-medium truncate">{getMenuName(child)}</span>
                      </NavLink>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 space-y-4">
        {/* Language Switcher */}
        <div className="relative">
          <button 
            onClick={() => setShowLangMenu(!showLangMenu)}
            className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-600`}
          >
            <Globe size={20} className="flex-shrink-0" />
            {!isCollapsed && (
              <span className="text-sm font-medium flex-1 text-left">
                {i18n.language === 'ko' ? '한국어' : i18n.language === 'en' ? 'English' : '中文'}
              </span>
            )}
            {!isCollapsed && <ChevronDown size={14} className={`transition-transform ${showLangMenu ? 'rotate-180' : ''}`} />}
          </button>

          <AnimatePresence>
            {showLangMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className={`absolute bottom-full left-0 mb-2 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50`}
              >
                <div className="p-1">
                  <button 
                    onClick={() => changeLanguage('ko')}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-colors ${i18n.language === 'ko' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    한국어 (KO)
                  </button>
                  <button 
                    onClick={() => changeLanguage('en')}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-colors ${i18n.language === 'en' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    English (EN)
                  </button>
                  <button 
                    onClick={() => changeLanguage('zh')}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-colors ${i18n.language === 'zh' ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    中文 (ZH)
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} p-2 rounded-xl bg-slate-50`}>
          <div className="size-10 rounded-full overflow-hidden bg-slate-200 flex-shrink-0">
            <img 
              alt="User Avatar" 
              className="w-full h-full object-cover" 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDjzueIL9meYblh9_pdoCenMeMQqDT_GEI9T1OFZEJKWpDNi6AB6UQoM2owFHepMqmuY1ReFh8PagSyN_8FCgNy2bA3QRPJmfnaoROBVa_wgioFsboZhluhEL-utQwGYAEf2_EVAp6IVM5HgY55gqVRQ75nrOTsuHRVQgGkqYhAFBnjggTLgf4jpG47j6VKTTMtLcXZvIri3QD3dqsgb83fMoT5-Oa-ZSoDvFk6T0G7SMgek05UL52-4RUZXlADm0tmKqs93VkjIpm5"
              referrerPolicy="no-referrer"
            />
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">Enterprise Admin</p>
              <p className="text-xs text-slate-500">v2.4.0</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
