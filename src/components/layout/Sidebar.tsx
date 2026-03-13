/**
 * @file Sidebar.tsx
 * @description 애플리케이션의 좌측 네비게이션 바를 렌더링하는 컴포넌트입니다.
 * 데이터베이스에서 동적으로 메뉴를 로드하며, 다국어 지원 및 축소/확장 기능을 제공합니다.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database,
  ShoppingBag,
  Boxes,
  Package,
  History as HistoryIcon,
  ShoppingCart,
  TrendingUp,
  Users,
  UserCog,
  Briefcase,
  Settings,
  Shield,
  Monitor,
  Scissors,
  Wallet,
  CalendarDays,
  Receipt,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  Globe,
  type LucideIcon
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { invokeDbCommand } from '../../lib/dbClient';
import { normalizeSystemTypeCode, SYSTEM_TYPE_STORAGE_KEY } from '../../constants/systemType';

/**
 * @type LangKey
 * @description 지원되는 다국어 키 타입 (ko: 한국어, en: 영어, zh: 중국어)
 */
type LangKey = 'ko' | 'en' | 'zh';

/**
 * @type MenuNames
 * @description 메뉴의 다국어 명칭 정보를 담는 객체 구조
 */
type MenuNames = {
  ko: string;
  en: string;
  zh: string;
};

/**
 * @type MenuRow
 * @description 데이터베이스에서 조회된 메뉴 로우 데이터 구조
 */
type MenuRow = {
  id: number;               // 메뉴 고유 ID
  parent_id: number | null; // 부모 메뉴 ID (대메뉴인 경우 null)
  menu_type: string;        // 메뉴 타입 (MAIN/SUB)
  path: string;             // 메뉴 아이콘과 매칭될 경로 또는 실제 연결 경로
  system_type_code: string; // 시스템 타입 코드 (권한 필터용)
  order: number;            // 정렬 순서
  status: string;           // 사용 여부 상태
  names: MenuNames;         // 다국어 명칭 객체
};

/**
 * @type SidebarMenuItem
 * @description 사이드바 렌더링에 사용되는 트리 구조의 메뉴 아이템 타입
 */
type SidebarMenuItem = {
  id: number;
  path: string;
  order: number;
  status: string;
  names: MenuNames;
  icon: LucideIcon;         // 매칭된 Lucide 아이콘 컴포넌트
  children: SidebarMenuItem[]; // 서브 메뉴 배열
};

const STATUS_ACTIVE = '사용중';

/**
 * @function normalizeType
 * @description 메뉴 타입을 정규화합니다. (기본값 MAIN)
 */
function normalizeType(value: string): 'MAIN' | 'SUB' {
  return value?.toUpperCase() === 'SUB' ? 'SUB' : 'MAIN';
}

/**
 * @function getIconByPath
 * @description 경로(path) 문자열을 분석하여 가장 적절한 Lucide 아이콘을 반환합니다.
 */
function getIconByPath(path: string): LucideIcon {
  if (path === '/sales-stats' || path.startsWith('/sales')) return TrendingUp;
  if (path === '/hair_sales-stats' || path === '/Hair_sales-stats' || path === '/hair-sales-stats') return TrendingUp;
  if (path.startsWith('/product-stock')) return Boxes;
  if (path.startsWith('/hr')) return UserCog;
  if (path.startsWith('/purchases')) return ShoppingCart;
  if (path.startsWith('/products')) return ShoppingBag;
  if (path.startsWith('/products/service-catalog')) return Scissors;
  if (path.startsWith('/inventory/history')) return HistoryIcon;
  if (path.startsWith('/inventory')) return Package;
  if (path.startsWith('/users/points')) return Wallet;
  if (path.startsWith('/users/point-history')) return HistoryIcon;
  if (path.startsWith('/users/reservations')) return CalendarDays;
  if (path.startsWith('/users/sales')) return Receipt;
  if (path.startsWith('/users')) return Users;
  if (path.startsWith('/employees')) return Briefcase;
  if (path.startsWith('/system/menu')) return LayoutGrid;
  if (path.startsWith('/system/code')) return Database;
  if (path.startsWith('/system/role')) return Shield;
  if (path.startsWith('/system/settings')) return Monitor;
  if (path.startsWith('/system')) return Settings;
  return Database;
}

/**
 * @function toSidebarTree
 * @description 평면(Flat) 구조의 메뉴 데이터 배열을 트리(Tree) 구조로 변환합니다.
 * @param rows DB에서 로드된 MenuRow 배열
 */
function toSidebarTree(rows: MenuRow[]): SidebarMenuItem[] {
  // 사용 중인 메뉴만 필터링
  const activeRows = rows.filter((row) => (row.status || '').trim() === STATUS_ACTIVE);
  const map = new Map<number, SidebarMenuItem>();

  // 1단계: 모든 노드를 맵에 등록
  activeRows.forEach((row) => {
    map.set(row.id, {
      id: row.id,
      path: row.path,
      order: Number(row.order) || 1,
      status: row.status || STATUS_ACTIVE,
      names: {
        ko: row.names?.ko || '',
        en: row.names?.en || '',
        zh: row.names?.zh || '',
      },
      icon: getIconByPath(row.path || ''),
      children: [],
    });
  });

  const roots: SidebarMenuItem[] = [];
  // 2단계: 부모-자식 관계 연결
  activeRows.forEach((row) => {
    const node = map.get(row.id);
    if (!node) return;
    const isSub = normalizeType(row.menu_type) === 'SUB';
    const parent = row.parent_id ? map.get(row.parent_id) : null;

    // 서브 메뉴이고 부모가 존재하면 부모의 children 배열에 추가
    if (isSub && parent) {
      parent.children.push(node);
      return;
    }
    // 최상위 메뉴인 경우 roots 배열에 추가
    roots.push(node);
  });

  // 3단계: 정렬 수행 (설정된 order 순서 -> ID 순서)
  roots.sort((a, b) => (a.order - b.order) || (a.id - b.id));
  roots.forEach((root) => {
    root.children.sort((a, b) => (a.order - b.order) || (a.id - b.id));
  });
  return roots;
}

export default function Sidebar() {
  const { i18n } = useTranslation();

  // [상태] 사이드바 축소 상태 여부 (true: 아이콘만 표시)
  const [isCollapsed, setIsCollapsed] = useState(false);

  // [상태] 동적으로 로드된 메뉴 목록 데이터
  const [menuItems, setMenuItems] = useState<SidebarMenuItem[]>([]);

  // [상태] 현재 확장된 대메뉴 이력 (ID 배열)
  const [expandedIds, setExpandedIds] = useState<number[]>([]);

  // [상태] 다국어 선택 메뉴 표시 여부
  const [showLangMenu, setShowLangMenu] = useState(false);

  const location = useLocation();

  // [Memo] 자식이 있는 모든 대메뉴를 기본적으로 확장 상태로 유지하기 위한 ID 배열 산출
  const defaultExpandedIds = useMemo(
    () => menuItems.filter((item) => item.children.length > 0).map((item) => item.id),
    [menuItems],
  );

  /**
   * @function loadSidebarMenus
   * @description 현재 시스템 타입 설정에 맞춰 DB에서 메뉴 정보를 로드하고 트리 구조로 가공합니다.
   */
  const loadSidebarMenus = useCallback(async () => {
    try {
      // 로컬 스토리지에서 현재 선택된 시스템 타입(권한) 획득
      const selectedSystemType = normalizeSystemTypeCode(localStorage.getItem(SYSTEM_TYPE_STORAGE_KEY));

      // DB 명령을 통해 메뉴 데이터 조회 전송
      const result = await invokeDbCommand<{
        success: boolean;
        message: string;
        menus: MenuRow[];
      }>('get_menu_management_data', {
        system_type_code: selectedSystemType,
      });

      // 평면 구조를 트리 구조로 변환하여 상태에 저장
      const dbMenus = toSidebarTree(result.menus || []);
      setMenuItems(dbMenus);
    } catch (error) {
      console.error('Failed to load sidebar menus from DB:', error);
      // 로드 실패 시 빈 배열로 초기화 (하드코딩 폴백 제거됨)
      setMenuItems([]);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const safeLoad = async () => {
      if (!isMounted) return;
      await loadSidebarMenus();
    };
    safeLoad();

    return () => {
      isMounted = false;
    };
  }, [loadSidebarMenus]);

  useEffect(() => {
    const handleMenuUpdated = () => {
      loadSidebarMenus();
    };
    const handleSystemTypeUpdated = () => {
      loadSidebarMenus();
    };
    const handleStoreCodeUpdated = () => {
      loadSidebarMenus();
    };
    window.addEventListener('menu-management-updated', handleMenuUpdated);
    window.addEventListener('system-type-updated', handleSystemTypeUpdated);
    window.addEventListener('store-code-updated', handleStoreCodeUpdated);
    return () => {
      window.removeEventListener('menu-management-updated', handleMenuUpdated);
      window.removeEventListener('system-type-updated', handleSystemTypeUpdated);
      window.removeEventListener('store-code-updated', handleStoreCodeUpdated);
    };
  }, [loadSidebarMenus]);

  useEffect(() => {
    setExpandedIds(defaultExpandedIds);
  }, [defaultExpandedIds]);

  /**
   * @function getMenuName
   * @description 현재 앱 언어 설정에 맞춰 메뉴 명칭을 반환합니다.
   */
  const getMenuName = (item: { names: MenuNames }) => {
    const lang = i18n.language as LangKey;
    // 해당 언어값이 없으면 한국어를 기본값으로 사용
    return item.names[lang] || item.names['ko'] || 'Untitled';
  };

  const programName = localStorage.getItem('programName') || 'GovData';
  const logoUrl = localStorage.getItem('logoUrl') || '';

  /**
   * @function toggleExpand
   * @description 아코디언 메뉴의 확장/축소 상태를 토글합니다.
   */
  const toggleExpand = (e: React.MouseEvent, id: number) => {
    // NavLink의 기본 이동 동작을 방지 (서브메뉴가 있는 대메뉴는 페이지 이동 대신 확장 처리)
    e.preventDefault();
    e.stopPropagation();

    setExpandedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  /**
   * @function changeLanguage
   * @description 애플리케이션의 언어를 변경하고 언어 선택 메뉴를 닫습니다.
   */
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
                className={({ isActive }) => `flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} px-3 py-2 rounded-lg transition-colors group ${(isActive && !hasChildren) || (hasChildren && isChildActive)
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
                        className={({ isActive }) => `flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors ${isActive
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
              <p className="text-sm font-semibold truncate">CZR System</p>
              <p className="text-xs text-slate-500">v0.1.20</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
