/**
 * @file RoleManagementPage.tsx
 * @description 시스템 사용자 역할(Role) 및 메뉴별 권한(Permission)을 관리하는 페이지입니다.
 * 
 * 주요 기능:
 * - 사용자 역할 추가, 수정, 삭제
 * - 역할별 메뉴 접근 권한(읽기, 쓰기, 삭제) 설정
 * - 트리 구조를 통한 직관적인 메뉴 권한 관리
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield,
  Plus,
  Check,
  X,
  Lock,
  Edit3,
  Trash2,
  ChevronRight,
  ChevronDown,
  Database,
  Loader2,
  Save,
  LayoutGrid,
  List as ListIcon
} from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';

/**
 * @type Role
 * @description 사용자 역할의 기본 정보를 담는 타입입니다.
 */
type Role = {
  role_id: string;    // 역할 식별자 (예: ADMIN, MANAGER)
  role_name: string;  // 역할 명칭 (예: 관리자)
  role_desc: string;  // 역할에 대한 상세 설명
  user_count: number; // 해당 역할을 보유한 사용자 수
};

/**
 * @type Permission
 * @description 특정 역할의 메뉴별 상세 권한 정보를 담는 타입입니다.
 */
type Permission = {
  id: number;           // 권한 레코드 고유 ID
  role_id: string;      // 대상 역할 ID
  menu_id: number;      // 대상 메뉴 ID
  menu_name_ko: string; // 메뉴 한글명
  menu_name_en: string; // 메뉴 영문명
  menu_name_zh: string; // 메뉴 중문명
  can_read: boolean;    // 읽기(조회) 권한 여부
  can_write: boolean;   // 쓰기(저장/수정) 권한 여부
  can_delete: boolean;  // 삭제 권한 여부
};

/**
 * @type MenuNode
 * @description 메뉴 권한 설정을 위한 트리 구조 노드 타입입니다.
 */
type MenuNode = {
  id: number;           // 메뉴 ID
  parent_id: number | null; // 부모 메뉴 ID
  menu_name_ko: string; // 메뉴명 (한글)
  children: MenuNode[]; // 하위 메뉴 목록
  permission?: Permission; // 해당 메뉴의 권한 설정 데이터
};

/**
 * @type FormData
 * @description 역할 추가/수정 모달에서 사용하는 폼 데이터 타입입니다.
 */
type FormData = {
  role_id: string;
  role_name: string;
  role_desc: string;
};

export default function RoleManagementPage() {
  const pt = usePageText('system_role_management');

  // [상태] 서버에서 불러온 전체 역할 목록
  const [roles, setRoles] = useState<Role[]>([]);
  // [상태] 현재 오른쪽 권한 설정 화면에서 편집 중인 역할 ID
  const [selectedRole, setSelectedRole] = useState<string>('');
  // [상태] 현재 선택된 역할의 원본 권한 목록
  const [permissions, setPermissions] = useState<Permission[]>([]);
  // [상태] 화면에 표시할 트리 구조 메뉴 데이터
  const [menuTree, setMenuTree] = useState<MenuNode[]>([]);
  // [상태] 트리에서 펼쳐져 있는 메뉴 ID 목록 (아코디언 상태 관리)
  const [expandedIds, setExpandedIds] = useState<number[]>([]);

  // [상태] 데이터 로딩 중 여부 (DB 조회용)
  const [isLoading, setIsLoading] = useState(false);
  // [상태] 데이터 저장/삭제 진행 중 여부 (DB 수정용)
  const [isMutating, setIsMutating] = useState(false);

  // [상태] 역할 추가/수정 모달 오픈 여부
  const [isModalOpen, setIsModalOpen] = useState(false);
  // [상태] 모달 작업 모드 (신규 추가 또는 기존 수정)
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  // [상태] 모달 내 입력 폼 데이터
  const [formData, setFormData] = useState<FormData>({ role_id: '', role_name: '', role_desc: '' });

  // [상태] 권한 토글 시 변경된 사항만 임시 보관하는 Map (저장 버튼 클릭 시 반영)
  const [permissionChanges, setPermissionChanges] = useState<Map<number, Permission>>(new Map());

  // [로직] 역할 목록 조회
  const loadRoles = async () => {
    try {
      setIsLoading(true);
      const result = await invokeDbCommand<{ success: boolean; roles: Role[] }>('get_role_management_data');
      setRoles(result.roles || []);
      // 데이터 로드 성공 시 첫 번째 역할을 기본 선택
      if (result.roles && result.roles.length > 0) {
        setSelectedRole(result.roles[0].role_id);
      }
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '권한 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // [로직] 특정 역할의 메뉴 권한 정보를 조회
  const loadPermissions = async (roleId: string) => {
    try {
      const result = await invokeDbCommand<{ success: boolean; permissions: Permission[] }>('get_role_menu_permissions', {
        role_id: roleId,
      });
      const perms = result.permissions || [];
      setPermissions(perms);
      // 권한 새로 로드 시 변경 중인 임시 데이터 초기화
      setPermissionChanges(new Map());
      // 조회된 권한 정보를 바탕으로 UI 트리 구조 구성
      buildMenuTree(perms);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '권한별 메뉴를 불러오지 못했습니다.');
    }
  };

  /**
   * [보조 로직] 평면 구조의 권한 리스트를 화면에 표시할 트리 구조로 변환합니다.
   * 부모(대메뉴) ID가 100(매출), 200(제품), 300(인사), 6(시스템) 등으로 고정된 규칙을 따릅니다.
   */
  const buildMenuTree = (perms: Permission[]) => {
    const permMap = new Map(perms.map(p => [p.menu_id, p]));
    const roots: MenuNode[] = [];
    const nodeMap = new Map<number, MenuNode>();

    // 1단계: 모든 메뉴 노드 생성
    perms.forEach(p => {
      if (!nodeMap.has(p.menu_id)) {
        nodeMap.set(p.menu_id, {
          id: p.menu_id,
          parent_id: null,
          menu_name_ko: p.menu_name_ko,
          children: [],
          permission: p,
        });
      }
    });

    // 2단계: 최상위 대메뉴 구분
    nodeMap.forEach((node, id) => {
      const perm = permMap.get(id);
      if (perm?.menu_id === 100 || perm?.menu_id === 200 || perm?.menu_id === 300 || perm?.menu_id === 6) {
        roots.push(node);
      }
    });

    // 메뉴 간 계층 매핑 정보 (하드코딩된 메뉴 체계 대응)
    const salesChildren = [1, 4];
    const productChildren = [2, 31, 32];
    const hrChildren = [5, 11, 12, 13, 14, 16, 17];
    const systemChildren = [7, 8, 9, 10, 15];

    // 3단계: 하위 메뉴를 부모 노드의 children에 수집
    perms.forEach((p) => {
      if (
        ![...salesChildren, ...productChildren, ...hrChildren, ...systemChildren].includes(p.menu_id)
      ) {
        return;
      }

      const node = nodeMap.get(p.menu_id);
      if (!node) return;

      const parentId = salesChildren.includes(p.menu_id)
        ? 100
        : productChildren.includes(p.menu_id)
          ? 200
          : hrChildren.includes(p.menu_id)
            ? 300
            : 6;

      const parent = nodeMap.get(parentId);
      if (parent) {
        parent.children.push(node);
        node.parent_id = parentId;
      }
    });

    // 4단계: 정렬 및 초기 상태 설정
    roots.sort((a, b) => a.id - b.id);
    roots.forEach(r => r.children.sort((a, b) => a.id - b.id));
    setMenuTree(roots);
    // 대메뉴는 기본적으로 펼쳐진 상태로 표시
    setExpandedIds(roots.map(r => r.id));
  };

  useEffect(() => {
    loadRoles();
  }, []);

  useEffect(() => {
    if (selectedRole) {
      loadPermissions(selectedRole);
    }
  }, [selectedRole]);

  // [동작] 역할 추가 모달 열기
  const handleOpenAddModal = () => {
    setModalMode('add');
    setFormData({ role_id: '', role_name: '', role_desc: '' });
    setIsModalOpen(true);
  };

  // [동작] 역할 수정 모달 열기
  const handleOpenEditModal = (role: Role) => {
    setModalMode('edit');
    setFormData({ role_id: role.role_id, role_name: role.role_name, role_desc: role.role_desc });
    setIsModalOpen(true);
  };

  // [동작] 역할 정보 저장 (DB upsert)
  const handleSaveRole = async () => {
    // 필수 입력값 검증
    if (!formData.role_id || !formData.role_name) {
      alert(pt('t008') /* "역할 ID와 이름은 필수 항목입니다." */);
      return;
    }

    try {
      setIsMutating(true);
      await invokeDbCommand('upsert_role_management', {
        role: {
          role_id: formData.role_id.toUpperCase(),
          role_name: formData.role_name,
          role_desc: formData.role_desc,
          user_count: modalMode === 'add' ? 0 : roles.find(r => r.role_id === formData.role_id)?.user_count || 0,
        },
      });
      await loadRoles();
      setIsModalOpen(false);
      alert(modalMode === 'add' ? '역할이 추가되었습니다.' : '역할이 수정되었습니다.');
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '역할 저장에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  // [동작] 역할 삭제
  const handleDeleteRole = async (roleId: string) => {
    if (!window.confirm(pt('t014') /* "정말 삭제하시겠습니까? 연결된 권한 정보가 모두 삭제됩니다." */)) return;
    try {
      setIsMutating(true);
      await invokeDbCommand('delete_role_management', { role_id: roleId });
      await loadRoles();
      alert(pt('t011') /* "삭제가 완료되었습니다." */);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '역할 삭제에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  /**
   * [보조 동작] 현재 편집 중인 메뉴 권한 상태를 가져옵니다.
   * 변경 사항(Map)에 데이터가 있으면 그것을 우선 반환하고, 없으면 서버에서 받은 원본 권한을 반환합니다.
   */
  const getPermission = (menuId: number): Permission | undefined => {
    const changed = permissionChanges.get(menuId);
    if (changed) return changed;
    const original = permissions.find(p => p.menu_id === menuId);
    return original;
  };

  // [동작] 특정 메뉴의 개별 권한 항목(조회/저장/삭제)을 토글
  const togglePermission = (menuId: number, type: 'can_read' | 'can_write' | 'can_delete') => {
    const currentPerm = getPermission(menuId);
    if (!currentPerm) return;

    const updated = { ...currentPerm, [type]: !currentPerm[type] };
    // 임시 변경 이력 Map에 업데이트된 상태 저장
    setPermissionChanges(new Map(permissionChanges.set(menuId, updated)));
  };

  // [동작] 변경된 권한 일괄 저장
  const handleSavePermissions = async () => {
    if (permissionChanges.size === 0) {
      alert(pt('t004') /* "변경된 권한 설정이 없습니다." */);
      return;
    }

    try {
      setIsMutating(true);
      // 변경된 항목들에 대해 순차적으로 업데이트 실행
      for (const perm of permissionChanges.values()) {
        await invokeDbCommand('upsert_role_menu_permission', { permission: perm });
      }
      // 저장 후 데이터 재조회 및 상태 동기화
      await loadPermissions(selectedRole);
      alert(pt('t003') /* "권한 설정이 저장되었습니다." */);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '권한 저장에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  };

  const isDbBusy = isLoading || isMutating;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <LoadingOverlay visible={isDbBusy} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t001') /* "권한 그룹 설정" */}</h1>
          <p className="text-slate-500 mt-1">{pt('t009') /* "사용자 역할별 메뉴 접근 권한을 관리합니다." */}</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={loadRoles}
            disabled={isDbBusy}
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
            {isLoading ? '불러오는 중...' : 'DB 새로고침'}
          </button>
          <button
            onClick={handleOpenAddModal}
            disabled={isDbBusy}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            <Plus size={18} />
            역할 추가
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Roles List */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <Shield size={16} className="text-primary" />
                사용자 역할 (Roles)
              </h3>
            </div>
            <div className="p-2 space-y-1">
              {roles.map((role) => (
                <button
                  key={role.role_id}
                  onClick={() => setSelectedRole(role.role_id)} className={`w-full text-left p-3 rounded-lg transition-all group ${selectedRole === role.role_id
                    ? 'bg-primary/10 border-primary/20 border text-primary shadow-sm'
                    : 'hover:bg-slate-50 text-slate-600 border border-transparent'
                    }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold">{role.role_name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleOpenEditModal(role); }}
                        className="p-1 hover:bg-white rounded text-slate-400 hover:text-primary transition-colors"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteRole(role.role_id); }}
                        className="p-1 hover:bg-white rounded text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full group-hover:bg-white transition-colors">
                        {role.user_count}명
                      </span>
                    </div>
                  </div>
                  <div className="text-xs opacity-70 truncate">{role.role_id}</div>
                  <div className="mt-2 text-[11px] opacity-60 leading-relaxed">{role.role_desc}</div>
                </button>
              ))}</div>
          </div>
        </div>

        {/* Permissions Detail */}
        <div className="lg:col-span-8">
          <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Lock size={16} className="text-primary" />
                  기능별 권한 설정
                </h3>
                <span className="text-xs text-slate-400 font-medium">| {selectedRole}</span>
              </div>
              <button
                onClick={handleSavePermissions}
                disabled={isMutating || permissionChanges.size === 0}
                className="bg-primary hover:bg-primary/90 text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-all disabled:opacity-50"
              >
                <Save size={14} />
                저장
              </button>
            </div>

            <div className="p-4 space-y-1">
              {menuTree.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm">{pt('t002') /* "권한 항목을 불러올 수 없습니다." */}</div>
              ) : (
                menuTree.map(menu => (
                  <React.Fragment key={menu.id}>
                    <MenuTreeItem
                      menu={menu}
                      expanded={expandedIds.includes(menu.id)} onToggleExpand={toggleExpand}
                      onTogglePermission={togglePermission}
                      getPermission={getPermission}
                      isMainMenu
                    />
                    <AnimatePresence>
                      {expandedIds.includes(menu.id) && menu.children.map(child => (
                        <motion.div
                          key={child.id}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <MenuTreeItem
                            menu={child}
                            expanded={expandedIds.includes(child.id)} onToggleExpand={toggleExpand}
                            onTogglePermission={togglePermission}
                            getPermission={getPermission}
                            isSubMenu
                          />
                        </motion.div>
                      ))}</AnimatePresence>
                  </React.Fragment>
                ))
              )}</div>
          </div>
        </div>
      </div>

      {/* Role Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {modalMode === 'add' ? '새 역할 추가' : '역할 정보 수정'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t007') /* "역할 ID" */}</label>
                <input
                  type="text"
                  disabled={modalMode === 'edit'}
                  value={formData.role_id}
                  onChange={e => setFormData({ ...formData, role_id: e.target.value.toUpperCase() })} placeholder={pt('t013') /* "예: ADMIN" */} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t006') /* "역할 이름" */}</label>
                <input
                  type="text"
                  value={formData.role_name}
                  onChange={e => setFormData({ ...formData, role_name: e.target.value })} placeholder={pt('t012') /* "한글 명칭 입력" */} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{pt('t005') /* "상세 설명" */}</label>
                <textarea
                  value={formData.role_desc}
                  onChange={e => setFormData({ ...formData, role_desc: e.target.value })} placeholder={pt('t010') /* "이 역할에 대한 설명을 입력하세요." */} rows={3}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                />
              </div>
            </div>
            <div className="p-6 bg-slate-50 flex gap-3">
              <button
                onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-100 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveRole}
                disabled={isMutating}
                className="flex-1 px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                저장하기
              </button>
            </div>
          </motion.div>
        </div>
      )}</motion.div>
  );
}

/**
 * @component MenuTreeItem
 * @description 메뉴 트리에서의 개별 행 항목을 렌더링합니다.
 */
function MenuTreeItem({ menu, expanded, onToggleExpand, onTogglePermission, getPermission, isMainMenu, isSubMenu }: any) {
  const pt = usePageText('system_role_management');
  const perm = getPermission(menu.id);
  const hasChildren = menu.children && menu.children.length > 0;

  return (
    <div className={isSubMenu ? 'pl-8' : ''}>
      <div className={`flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors ${isSubMenu ? 'bg-slate-50/50' : ''}`}>
        {hasChildren ? (
          <button onClick={() => onToggleExpand(menu.id)} className="p-1 hover:bg-slate-200 rounded transition-colors">
            {expanded ? (
              <ChevronDown size={16} className="text-slate-600" />
            ) : (
              <ChevronRight size={16} className="text-slate-400" />
            )}</button>
        ) : (
          <div className="w-6" />
        )}<div className="size-8 rounded bg-slate-100 flex items-center justify-center text-primary flex-shrink-0">
          {isMainMenu ? <LayoutGrid size={16} /> : <ListIcon size={14} />}
        </div>

        <span className={`text-sm font-bold flex-1 ${isSubMenu ? 'text-slate-700' : 'text-slate-900'}`}>
          {menu.menu_name_ko}
        </span>

        {perm && (
          <div className="flex items-center gap-2">
            <PermissionCheckbox
              active={perm.can_read}
              onClick={() => onTogglePermission(menu.id, 'can_read')} title={pt('t015') /* "조회" */} />
            <PermissionCheckbox
              active={perm.can_write}
              onClick={() => onTogglePermission(menu.id, 'can_write')} title="저장"
            />
            <PermissionCheckbox
              active={perm.can_delete}
              onClick={() => onTogglePermission(menu.id, 'can_delete')} title="삭제"
            />
          </div>
        )}</div>
    </div>
  );
}

/**
 * @component PermissionCheckbox
 * @description 권한 토글을 위한 커스텀 체크박스 버튼입니다.
 */
function PermissionCheckbox({ active, onClick, title }: { active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex items-center justify-center size-7 rounded transition-all ${active
        ? 'bg-emerald-100 text-emerald-600 border border-emerald-200 shadow-sm'
        : 'bg-slate-100 text-slate-300 border border-slate-200'
        }`}
    >
      {active ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
    </button>
  );
}
