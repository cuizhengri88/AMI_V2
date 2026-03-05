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

type Role = {
  role_id: string;
  role_name: string;
  role_desc: string;
  user_count: number;
};

type Permission = {
  id: number;
  role_id: string;
  menu_id: number;
  menu_name_ko: string;
  menu_name_en: string;
  menu_name_zh: string;
  can_read: boolean;
  can_write: boolean;
  can_delete: boolean;
};

type MenuNode = {
  id: number;
  parent_id: number | null;
  menu_name_ko: string;
  children: MenuNode[];
  permission?: Permission;
};

type FormData = {
  role_id: string;
  role_name: string;
  role_desc: string;
};

export default function RoleManagementPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [menuTree, setMenuTree] = useState<MenuNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<FormData>({ role_id: '', role_name: '', role_desc: '' });
  const [permissionChanges, setPermissionChanges] = useState<Map<number, Permission>>(new Map());

  const loadRoles = async () => {
    try {
      setIsLoading(true);
      const result = await invokeDbCommand<{ success: boolean; roles: Role[] }>('get_role_management_data');
      setRoles(result.roles || []);
      if (result.roles && result.roles.length > 0) {
        setSelectedRole(result.roles[0].role_id);
      }
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '권한 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadPermissions = async (roleId: string) => {
    try {
      const result = await invokeDbCommand<{ success: boolean; permissions: Permission[] }>('get_role_menu_permissions', {
        role_id: roleId,
      });
      const perms = result.permissions || [];
      setPermissions(perms);
      setPermissionChanges(new Map());
      buildMenuTree(perms);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '권한별 메뉴를 불러오지 못했습니다.');
    }
  };

  const buildMenuTree = (perms: Permission[]) => {
    const permMap = new Map(perms.map(p => [p.menu_id, p]));
    const roots: MenuNode[] = [];
    const nodeMap = new Map<number, MenuNode>();

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

    nodeMap.forEach((node, id) => {
      const perm = permMap.get(id);
      if (perm?.menu_id === 100 || perm?.menu_id === 200 || perm?.menu_id === 300 || perm?.menu_id === 6) {
        roots.push(node);
      }
    });

    perms.forEach(p => {
      if ([1, 4, 2, 31, 32, 5, 11, 7, 8, 9, 10].includes(p.menu_id)) {
        const node = nodeMap.get(p.menu_id);
        if (node) {
          const parentId = [1, 4].includes(p.menu_id) ? 100 : [2, 31, 32].includes(p.menu_id) ? 200 : [5, 11].includes(p.menu_id) ? 300 : 6;
          const parent = nodeMap.get(parentId);
          if (parent) {
            parent.children.push(node);
            node.parent_id = parentId;
          }
        }
      }
    });

    roots.sort((a, b) => a.id - b.id);
    roots.forEach(r => r.children.sort((a, b) => a.id - b.id));
    setMenuTree(roots);
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

  const handleOpenAddModal = () => {
    setModalMode('add');
    setFormData({ role_id: '', role_name: '', role_desc: '' });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (role: Role) => {
    setModalMode('edit');
    setFormData({ role_id: role.role_id, role_name: role.role_name, role_desc: role.role_desc });
    setIsModalOpen(true);
  };

  const handleSaveRole = async () => {
    if (!formData.role_id || !formData.role_name) {
      alert('역할 ID와 이름을 입력해주세요.');
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

  const handleDeleteRole = async (roleId: string) => {
    if (!window.confirm('정말 이 역할을 삭제하시겠습니까?')) return;
    try {
      setIsMutating(true);
      await invokeDbCommand('delete_role_management', { role_id: roleId });
      await loadRoles();
      alert('역할이 삭제되었습니다.');
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '역할 삭제에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const getPermission = (menuId: number): Permission | undefined => {
    const changed = permissionChanges.get(menuId);
    if (changed) return changed;
    const original = permissions.find(p => p.menu_id === menuId);
    return original;
  };

  const togglePermission = (menuId: number, type: 'can_read' | 'can_write' | 'can_delete') => {
    const currentPerm = getPermission(menuId);
    if (!currentPerm) return;

    const updated = { ...currentPerm, [type]: !currentPerm[type] };
    setPermissionChanges(new Map(permissionChanges.set(menuId, updated)));
  };

  const handleSavePermissions = async () => {
    if (permissionChanges.size === 0) {
      alert('변경된 권한이 없습니다.');
      return;
    }

    try {
      setIsMutating(true);
      for (const perm of permissionChanges.values()) {
        await invokeDbCommand('upsert_role_menu_permission', { permission: perm });
      }
      await loadPermissions(selectedRole);
      alert('권한이 저장되었습니다.');
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
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
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">권한 관리</h1>
          <p className="text-slate-500 mt-1">역할별 시스템 접근 권한 및 기능을 설정합니다.</p>
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
                  onClick={() => setSelectedRole(role.role_id)}
                  className={`w-full text-left p-3 rounded-lg transition-all group ${
                    selectedRole === role.role_id 
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
              ))}
            </div>
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
                <div className="py-12 text-center text-slate-400 text-sm">권한 데이터가 없습니다.</div>
              ) : (
                menuTree.map(menu => (
                  <React.Fragment key={menu.id}>
                    <MenuTreeItem
                      menu={menu}
                      expanded={expandedIds.includes(menu.id)}
                      onToggleExpand={toggleExpand}
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
                            expanded={expandedIds.includes(child.id)}
                            onToggleExpand={toggleExpand}
                            onTogglePermission={togglePermission}
                            getPermission={getPermission}
                            isSubMenu
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </React.Fragment>
                ))
              )}
            </div>
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
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">역할 ID (ID)</label>
                <input 
                  type="text" 
                  disabled={modalMode === 'edit'}
                  value={formData.role_id}
                  onChange={e => setFormData({ ...formData, role_id: e.target.value.toUpperCase() })}
                  placeholder="예: ROLE_GUEST"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">역할 이름 (Name)</label>
                <input 
                  type="text" 
                  value={formData.role_name}
                  onChange={e => setFormData({ ...formData, role_name: e.target.value })}
                  placeholder="예: 게스트"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">설명 (Description)</label>
                <textarea 
                  value={formData.role_desc}
                  onChange={e => setFormData({ ...formData, role_desc: e.target.value })}
                  placeholder="역할에 대한 설명을 입력하세요."
                  rows={3}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                />
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
                onClick={handleSaveRole}
                disabled={isMutating}
                className="flex-1 px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                저장하기
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}

function MenuTreeItem({ menu, expanded, onToggleExpand, onTogglePermission, getPermission, isMainMenu, isSubMenu }: any) {
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
            )}
          </button>
        ) : (
          <div className="w-6" />
        )}
        
        <div className="size-8 rounded bg-slate-100 flex items-center justify-center text-primary flex-shrink-0">
          {isMainMenu ? <LayoutGrid size={16} /> : <ListIcon size={14} />}
        </div>

        <span className={`text-sm font-bold flex-1 ${isSubMenu ? 'text-slate-700' : 'text-slate-900'}`}>
          {menu.menu_name_ko}
        </span>

        {perm && (
          <div className="flex items-center gap-2">
            <PermissionCheckbox 
              active={perm.can_read} 
              onClick={() => onTogglePermission(menu.id, 'can_read')}
              title="조회"
            />
            <PermissionCheckbox 
              active={perm.can_write} 
              onClick={() => onTogglePermission(menu.id, 'can_write')}
              title="저장"
            />
            <PermissionCheckbox 
              active={perm.can_delete} 
              onClick={() => onTogglePermission(menu.id, 'can_delete')}
              title="삭제"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionCheckbox({ active, onClick, title }: { active: boolean; onClick: () => void; title: string }) {
  return (
    <button 
      onClick={onClick}
      title={title}
      className={`inline-flex items-center justify-center size-7 rounded transition-all ${
        active 
          ? 'bg-emerald-100 text-emerald-600 border border-emerald-200 shadow-sm' 
          : 'bg-slate-100 text-slate-300 border border-slate-200'
      }`}
    >
      {active ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
    </button>
  );
}
