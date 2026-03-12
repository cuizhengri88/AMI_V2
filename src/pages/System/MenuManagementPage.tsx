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

/**
 * 메뉴 타입 정의 (상위 메뉴 또는 하위 메뉴)
 */
type MenuType = 'MAIN' | 'SUB';

/**
 * 다국어 키 정의
 */
type LangKey = 'ko' | 'en' | 'zh';

/**
 * 다국어 메뉴 이름 구조체 (한국어, 영어, 중국어)
 */
type MenuNames = {
  ko: string; // 한국어 이름
  en: string; // 영어 이름
  zh: string; // 중국어 이름
};

/**
 * DB에서 로드되는 메뉴 로우 데이터 (DB menu_management 테이블 대응)
 */
type MenuRow = {
  id: number;              // 메뉴 고유 ID
  parent_id: number | null; // 상위 메뉴 ID (최상위일 경우 null)
  menu_type: string;        // 메뉴 유형 (MAIN, SUB)
  path: string;             // 대시보드 URL 경로
  system_type_code: string; // 적용 시스템 타입 (예: SALON, GOV 등)
  is_start_menu: boolean;   // 프로그램 시작 시 초기 진입 메뉴 여유
  order: number;            // 메뉴 표시 순서
  status: string;           // 메뉴 사용 상태 (사용중, 미사용)
  names: MenuNames;         // 다국어 이름 객체
};

/**
 * 계층 구조(Tree)로 가공된 메뉴 노드 타입
 */
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
  children: MenuNode[]; // 하위 메뉴 목록
};

/**
 * 메뉴 등록/수정 폼 데이터 타입
 */
type MenuForm = {
  id: number;          // 메뉴 ID (신규 시 0)
  type: MenuType;      // 메뉴 유형
  parentId: string;    // 상위 메뉴 ID (SUB일 때 필수)
  names: MenuNames;    // 입력된 다국어명
  path: string;        // 입력된 경로
  systemTypeCode: string; // 선택된 시스템 타입
  isStartMenu: boolean;   // 시작 메뉴 설정 여부
  order: number;          // 정렬 순서
  status: string;         // 상태
};

/**
 * 공통 코드 조회용 로우 데이터 타입
 */
type CodeDetailRow = {
  group: string;
  code: string;
  name: string;
  order: number;
  use_yn: 'Y' | 'N';
};

/**
 * 시스템 타입 선택 옵션 타입
 */
type SystemTypeOption = {
  code: string;
  name: string;
  order: number;
};

/**
 * 폼 초기값 정의
 */
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

/**
 * 데이터베이스의 문자열 타입을 MenuType으로 정규화
 */
function normalizeType(value: string): MenuType {
  return value?.toUpperCase() === 'SUB' ? 'SUB' : 'MAIN';
}

/**
 * 평면(Flat) 구조의 메뉴 로우들을 계층(Tree) 구조로 재구성합니다.
 */
function buildTree(rows: MenuRow[]): MenuNode[] {
  const map = new Map<number, MenuNode>();

  // 1단계: 모든 로우를 Map에 등록하여 빠른 조회가 가능하게 함
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

  // 2단계: parent_id 관계에 따라 부모-자식 연결
  const roots: MenuNode[] = [];
  map.forEach((node) => {
    if (node.menu_type === 'SUB' && node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // 3단계: 정렬 수행 (정렬 순서 우선, 동일 시 ID 순)
  roots.sort((a, b) => (a.order - b.order) || (a.id - b.id));
  roots.forEach((root) => {
    root.children.sort((a, b) => (a.order - b.order) || (a.id - b.id));
  });
  return roots;
}

/**
 * 메뉴 관리 페이지 메인 컴포넌트
 */
export default function MenuManagementPage() {
  // 다국어 훅 (system_menu_management 영역)
  const pt = usePageText('system_menu_management');
  const { i18n } = useTranslation();

  /**
   * 상태 관리 (useState)
   */
  const [menuData, setMenuData] = useState<MenuNode[]>([]); // 트리 구조의 메뉴 데이터
  const [expandedIds, setExpandedIds] = useState<number[]>([]); // 현재 열려있는(내려온) 상위 메뉴 ID 목록
  const [isLoading, setIsLoading] = useState(false); // 초기 로딩 오버레이 제어
  const [isMutating, setIsMutating] = useState(false); // 저장/삭제 등 작업 중 상태
  const isDbBusy = isLoading || isMutating;

  const [isModalOpen, setIsModalOpen] = useState(false); // 등록/수정 모달 상태
  const [formData, setFormData] = useState<MenuForm>(EMPTY_FORM); // 모달 폼 데이터
  const [systemTypeOptions, setSystemTypeOptions] = useState<SystemTypeOption[]>([]); // 시스템 타입(공통코드) 옵션

  /**
   * 계산된 데이터 (useMemo)
   */
  // 상위 메뉴만 필터링
  const mainMenus = useMemo(() => menuData.filter((m) => m.menu_type === 'MAIN'), [menuData]);

  // 현재 설정된 시스템 타입과 호환되는 상위 메뉴 목록 (SUB 메뉴 생성 시 선택용)
  const selectableMainMenus = useMemo(
    () =>
      mainMenus.filter((menu) => {
        const menuSystemType = normalizeSystemTypeCode(menu.system_type_code);
        const formSystemType = normalizeSystemTypeCode(formData.systemTypeCode);
        // 공통(ALL)이거나, 선택한 시스템 타입과 일치하는 부모만 선택 가능
        return menuSystemType === DEFAULT_SYSTEM_TYPE_CODE || menuSystemType === formSystemType;
      }),
    [formData.systemTypeCode, mainMenus],
  );

  // 시스템 타입 코드를 이름으로 변환하기 위한 맵
  const systemTypeNameMap = useMemo(
    () => new Map(systemTypeOptions.map((item) => [item.code, item.name] as const)),
    [systemTypeOptions],
  );

  /**
   * 입력된 코드를 시스템 타입 명칭으로 변환합니다.
   */
  const getSystemTypeName = (code: string) => {
    const normalized = normalizeSystemTypeCode(code);
    if (normalized === DEFAULT_SYSTEM_TYPE_CODE) return pt('t003'); // pt('t003') -> 공통(ALL)
    return systemTypeNameMap.get(normalized) || normalized;
  };

  /**
   * 현재 선택된 언어에 맞는 메뉴 명칭을 반환합니다.
   */
  const getMenuName = (menu: { names: MenuNames }) => {
    const lang = (i18n.language || 'ko') as LangKey;
    return menu.names[lang] || menu.names.ko || 'Untitled';
  };

  /**
   * 트리 행 확장/축소 토글
   */
  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  };

  /**
   * 시스템 타입 공통 코드 목록을 로드합니다.
   */
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

  /**
   * DB에서 메뉴 관리 데이터를 불러와 계층 구조로 변환합니다.
   */
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
      // 초기 로딩 시 모든 상위 메뉴를 펼쳐둠
      setExpandedIds(tree.map((m) => m.id));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t025')); // pt('t025') -> 메뉴 데이터를 불러오지 못했습니다.
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 페이지 초기 로딩 시 실생
   */
  useEffect(() => {
    loadMenus();
    loadSystemTypeOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 메뉴 등록 모달 열기
   */
  const openCreateModal = () => {
    // 현재 사용 중인 시스템 타입을 초기값으로 설정
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

  /**
   * 메뉴 수정 모달 열기
   */
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

  /**
   * 메뉴 저장(신규 등록 또는 수정) 처리 핸들러
   */
  const handleSaveMenu = async () => {
    // 1. 유효성 검사 (필수 입력값 확인)
    if (!formData.names.ko.trim() || !formData.names.en.trim() || !formData.names.zh.trim()) {
      alert(pt('t021')); // pt('t021') -> 한국어/영어/중국어 메뉴명을 모두 입력해주세요.
      return;
    }
    if (!formData.systemTypeCode.trim()) {
      alert(pt('t024')); // pt('t024') -> SYSTEM_TYPE 코드를 선택해주세요.
      return;
    }
    if (!formData.path.trim()) {
      alert(pt('t004')); // pt('t004') -> 메뉴 경로(path)를 입력해주세요.
      return;
    }
    if (formData.type === 'SUB' && !formData.parentId) {
      alert(pt('t018')); // pt('t018') -> 하위 메뉴는 상위 메뉴를 선택해야 합니다.
      return;
    }

    try {
      setIsMutating(true);
      // DB 전송을 위한 데이터 구조로 매핑
      const payload: MenuRow = {
        id: formData.id || 0,
        parent_id: formData.type === 'SUB' ? Number(formData.parentId) : null,
        menu_type: formData.type,
        path: formData.path.trim(),
        system_type_code: normalizeSystemTypeCode(formData.systemTypeCode),
        // 시작 메뉴 플래그 설정 (SUB 메뉴에서만 활성화 가능)
        is_start_menu: formData.type === 'SUB' ? formData.isStartMenu : false,
        order: Number(formData.order) || 1,
        status: formData.status || '사용중',
        names: {
          ko: formData.names.ko.trim(),
          en: formData.names.en.trim(),
          zh: formData.names.zh.trim(),
        },
      };

      // DB 저상 커맨드 호출
      const result = await invokeDbCommand<{ success: boolean; message: string }>('upsert_menu_management', {
        menu: payload,
      });

      await loadMenus(); // 데이터 갱신

      // 저장된 메뉴가 하위 메뉴라면 부모 노드를 펼쳐서 보여줌
      if (payload.parent_id) {
        setExpandedIds((prev) => (prev.includes(payload.parent_id!) ? prev : [...prev, payload.parent_id!]));
      }

      setIsModalOpen(false); // 모달 닫기
      // 사이드바 등 메뉴 데이터가 필요한 다른 컴포넌트들에 갱신 이벤트 발생
      window.dispatchEvent(new Event('menu-management-updated'));
      alert(formData.id ? pt('t026') : pt('t027')); // pt('t026') -> 메뉴 수정 완료 / pt('t027') -> 메뉴 추가 완료
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t028')); // pt('t028') -> 메뉴 저장에 실패했습니다.
    } finally {
      setIsMutating(false);
    }
  };

  /**
   * 메뉴 삭제 핸들러 (연계된 하위 메뉴도 함께 삭제됨 - DB Cascade 설정)
   * @param menuId 삭제할 메뉴 고유 ID
   */
  const handleDeleteMenu = async (menuId: number) => {
    // window.confirm(): 삭제 전 사용자 확인 팝업
    if (!window.confirm(pt('t013'))) return; // pt('t013') -> 선택한 메뉴를 삭제하시겠습니까? 하위 메뉴도 함께 삭제됩니다.

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('delete_menu_management', {
        menu_id: menuId,
      });
      await loadMenus();
      window.dispatchEvent(new Event('menu-management-updated'));
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t029')); // pt('t029') -> 메뉴 삭제에 실패했습니다.
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <LoadingOverlay visible={isDbBusy} />

      {/* 1. 페이지 헤더 섹션 */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            {pt('t030')} {/* pt('t030') -> 메뉴 관리 */}
          </h1>
          <p className="text-slate-500 mt-1">
            {pt('t005')} {/* pt('t005') -> 메뉴를 DB에서 조회하고 추가/수정/삭제합니다. */}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* DB 데이터 새로고침 버튼 */}
          <button
            onClick={loadMenus}
            disabled={isDbBusy}
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
            {isLoading ? pt('t031') : pt('t032')} {/* pt('t031') -> 불러오는 중... / pt('t032') -> DB 새로고침 */}
          </button>
          {/* 신구 메뉴 추가 버튼 */}
          <button
            onClick={openCreateModal}
            disabled={isDbBusy}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-primary/20 disabled:opacity-60"
          >
            <Plus size={18} />
            {pt('t033')} {/* pt('t033') -> 메뉴 추가 */}
          </button>
        </div>
      </div>

      {/* 2. 메뉴 트리 테이블 섹션 */}
      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-slate-200">
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider w-1/3">{pt('t006')}</th> {/* pt('t006') -> 메뉴명 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t014')}</th> {/* pt('t014') -> 시스템 타입 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t001')}</th> {/* pt('t001') -> 경로 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t015')}</th> {/* pt('t015') -> 정렬 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t034')}</th> {/* pt('t034') -> 상태 */}
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">시작메뉴</th>
              <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t035')}</th> {/* pt('t035') -> 작업 */}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {menuData.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400 text-sm">
                  {pt('t036')} {/* pt('t036') -> 등록된 메뉴가 없습니다. */}
                </td>
              </tr>
            ) : (
              menuData.map((menu) => (
                <React.Fragment key={menu.id}>
                  {/* 상위 메뉴 행 */}
                  <tr className="hover:bg-slate-50 transition-colors group">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        {/* 자식이 있을 때만 확장/축소 버튼 표시 */}
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
                    <td className="py-4 px-6 text-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {getSystemTypeName(menu.system_type_code)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-sm font-mono text-slate-500">{menu.path}</td>
                    <td className="py-4 px-6 text-sm text-center font-medium text-slate-600">{menu.order}</td>
                    <td className="py-4 px-6 text-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {menu.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      {/* 시작메뉴 뱃지 */}
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

                  {/* 하위 메뉴 행 리스트 (확장된 부모 아래에 노출) */}
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
                              {getSystemTypeName(child.system_type_code)}
                            </span>
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
                      ))}
                  </AnimatePresence>
                </React.Fragment>
              ))
            )}</tbody>
        </table>
      </div>

      {/* 3. 메뉴 등록/수정 전용 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            {/* 모달 헤더 */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">
                {formData.id ? pt('t037') : pt('t033')} {/* pt('t037') -> 메뉴 수정 / pt('t033') -> 메뉴 추가 */}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            {/* 모달 본문 폼 영역 */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* 상위/하위 메뉴 유형 선택 버튼 */}
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setFormData((prev) => ({ ...prev, type: 'MAIN', parentId: '', isStartMenu: false }))}
                  className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${formData.type === 'MAIN'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-slate-100 text-slate-400 hover:border-slate-200'
                    }`}
                >
                  <LayoutGrid size={18} />
                  <span className="font-bold text-sm">{pt('t010')}</span> {/* pt('t010') -> 상위 메뉴 */}
                </button>
                <button
                  onClick={() => setFormData((prev) => ({ ...prev, type: 'SUB' }))}
                  className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${formData.type === 'SUB'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-slate-100 text-slate-400 hover:border-slate-200'
                    }`}
                >
                  <ListIcon size={18} />
                  <span className="font-bold text-sm">{pt('t017')}</span> {/* pt('t017') -> 하위 메뉴 */}
                </button>
              </div>

              {/* 하위 메뉴 선택 시 부모 메뉴 선택 드롭다운 노출 */}
              {formData.type === 'SUB' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t011')}</label> {/* pt('t011') -> 상위 메뉴 선택 */}
                  <select
                    value={formData.parentId}
                    onChange={(e) => setFormData((prev) => ({ ...prev, parentId: e.target.value }))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">{pt('t012')}</option> {/* pt('t012') -> 상위 메뉴를 선택하세요 */}
                    {selectableMainMenus.map((m) => (
                      <option key={m.id} value={m.id}>
                        {getMenuName(m)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 다국어 메뉴명 입력 그룹 */}
              <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <label className="block text-xs font-bold text-slate-500 uppercase">{pt('t007')}</label> {/* pt('t007') -> 메뉴명 (다국어) */}
                <div>
                  <label className="text-xs text-slate-500">{pt('t019')}</label> {/* 한국어 */}
                  <input
                    type="text"
                    value={formData.names.ko}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, names: { ...prev.names, ko: e.target.value } }))
                    }
                    placeholder={pt('t020')} // pt('t020') -> 한국어 메뉴명
                    className="w-full mt-1 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">{pt('t022')}</label> {/* English */}
                  <input
                    type="text"
                    value={formData.names.en}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, names: { ...prev.names, en: e.target.value } }))
                    }
                    placeholder={pt('t023')} // pt('t023') -> English menu name
                    className="w-full mt-1 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">{pt('t035')}</label> {/* 中文(简体) */}
                  <input
                    type="text"
                    value={formData.names.zh}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, names: { ...prev.names, zh: e.target.value } }))
                    }
                    placeholder={pt('t039')} // pt('t039') -> 中文菜单名称
                    className="w-full mt-1 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              {/* 시스템 타입 선택 섹션 */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t040')}</label> {/* pt('t040') -> 시스템 타입 */}
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
                        // 부모 폴더가 현재 시스템 타입과 호환되지 않으면 부모 선택 해제
                        parentId: prev.type === 'SUB' && !isParentCompatible ? '' : prev.parentId,
                      };
                    })
                  }
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value={DEFAULT_SYSTEM_TYPE_CODE}>{pt('t003')}</option> {/* 공통(ALL) */}
                  {systemTypeOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name} ({option.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* 메뉴 경로(Path) 입력 */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t002')}</label> {/* pt('t002') -> 경로(Path) */}
                <input
                  type="text"
                  value={formData.path}
                  onChange={(e) => setFormData((prev) => ({ ...prev, path: e.target.value }))}
                  placeholder="/system/menu"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* 정렬 순서 */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t016')}</label> {/* pt('t016') -> 정렬 순서 */}
                  <input
                    type="number"
                    value={formData.order}
                    onChange={(e) => setFormData((prev) => ({ ...prev, order: parseInt(e.target.value, 10) || 1 }))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                {/* 사용 상태 선택 */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t034')}</label> {/* pt('t034') -> 상태 */}
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        status: e.target.value,
                        // 미사용 상태가 되면 시작메뉴 설정도 자동 취소
                        isStartMenu: e.target.value === '사용중' ? prev.isStartMenu : false,
                      }))
                    }
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="사용중">{pt('t009')}</option> {/* pt('t009') -> 사용중 */}
                    <option value="미사용">{pt('t008')}</option> {/* pt('t008') -> 미사용 */}
                  </select>
                </div>
              </div>

              {/* 시작 메뉴 지정 옵션 (체크박스) */}
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

            {/* 모달 하단 버튼 군 */}
            <div className="p-6 bg-slate-50 flex gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-100 transition-colors"
              >
                {pt('t041')} {/* pt('t041') -> 취소 */}
              </button>
              <button
                onClick={handleSaveMenu}
                disabled={isMutating}
                className="flex-1 px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {formData.id ? pt('t042') : pt('t043')} {/* pt('t042') -> 수정 / pt('t043') -> 추가 */}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
