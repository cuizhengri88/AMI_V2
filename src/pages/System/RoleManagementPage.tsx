import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Shield, 
  Plus, 
  Save, 
  Check, 
  X, 
  Lock, 
  Eye, 
  Edit3, 
  Trash2,
  ChevronRight
} from 'lucide-react';

const initialRoles = [
  { id: 'ROLE_OWNER', name: '사장', desc: '시스템의 모든 권한을 가지며 결제 및 정산 정보를 관리합니다.', userCount: 1 },
  { id: 'ROLE_MANAGER', name: '매니저', desc: '매장 운영 및 직원 관리, 재고 관리 권한을 가집니다.', userCount: 2 },
  { id: 'ROLE_STAFF', name: '직원', desc: '판매 등록 및 재고 조회 등 일반 업무 권한을 가집니다.', userCount: 5 },
  { id: 'ROLE_PARTTIME', name: '알바', desc: '제한된 판매 등록 및 조회 권한만 가집니다.', userCount: 3 },
];

const defaultModules = [
  '대시보드', '매출 통계', '상품 관리', '재고 관리', '구매 관리', '회원 관리', '직원 관리', '시스템 관리'
];

const initialPermissions: Record<string, any[]> = {
  ROLE_OWNER: defaultModules.map(m => ({ module: m, read: true, write: true, delete: true })),
  ROLE_MANAGER: [
    { module: '대시보드', read: true, write: true, delete: false },
    { module: '매출 통계', read: true, write: false, delete: false },
    { module: '상품 관리', read: true, write: true, delete: true },
    { module: '재고 관리', read: true, write: true, delete: true },
    { module: '구매 관리', read: true, write: true, delete: false },
    { module: '회원 관리', read: true, write: true, delete: false },
    { module: '직원 관리', read: true, write: false, delete: false },
    { module: '시스템 관리', read: false, write: false, delete: false },
  ],
  ROLE_STAFF: [
    { module: '대시보드', read: true, write: false, delete: false },
    { module: '매출 통계', read: false, write: false, delete: false },
    { module: '상품 관리', read: true, write: false, delete: false },
    { module: '재고 관리', read: true, write: true, delete: false },
    { module: '구매 관리', read: false, write: false, delete: false },
    { module: '회원 관리', read: true, write: false, delete: false },
    { module: '직원 관리', read: false, write: false, delete: false },
    { module: '시스템 관리', read: false, write: false, delete: false },
  ],
  ROLE_PARTTIME: [
    { module: '대시보드', read: true, write: false, delete: false },
    { module: '매출 통계', read: false, write: false, delete: false },
    { module: '상품 관리', read: true, write: false, delete: false },
    { module: '재고 관리', read: false, write: false, delete: false },
    { module: '구매 관리', read: false, write: false, delete: false },
    { module: '회원 관리', read: false, write: false, delete: false },
    { module: '직원 관리', read: false, write: false, delete: false },
    { module: '시스템 관리', read: false, write: false, delete: false },
  ],
};

export default function RoleManagementPage() {
  const [roles, setRoles] = useState(initialRoles);
  const [selectedRole, setSelectedRole] = useState('ROLE_OWNER');
  const [rolePermissions, setRolePermissions] = useState(initialPermissions);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState({ id: '', name: '', desc: '' });

  const togglePermission = (module: string, type: 'read' | 'write' | 'delete') => {
    setRolePermissions(prev => ({
      ...prev,
      [selectedRole]: prev[selectedRole].map(p => 
        p.module === module ? { ...p, [type]: !p[type] } : p
      )
    }));
  };

  const handleOpenAddModal = () => {
    setModalMode('add');
    setFormData({ id: '', name: '', desc: '' });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (role: any) => {
    setModalMode('edit');
    setFormData({ id: role.id, name: role.name, desc: role.desc });
    setIsModalOpen(true);
  };

  const handleSaveRole = () => {
    if (!formData.id || !formData.name) {
      alert('역할 ID와 이름을 입력해주세요.');
      return;
    }

    if (modalMode === 'add') {
      if (roles.find(r => r.id === formData.id)) {
        alert('이미 존재하는 역할 ID입니다.');
        return;
      }
      const newRole = { ...formData, userCount: 0 };
      setRoles([...roles, newRole]);
      setRolePermissions({
        ...rolePermissions,
        [formData.id]: defaultModules.map(m => ({ module: m, read: false, write: false, delete: false }))
      });
      setSelectedRole(formData.id);
    } else {
      setRoles(roles.map(r => r.id === formData.id ? { ...r, name: formData.name, desc: formData.desc } : r));
    }
    setIsModalOpen(false);
  };

  const handleDeleteRole = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (id === 'ROLE_OWNER') {
      alert('사장 역할은 삭제할 수 없습니다.');
      return;
    }
    if (window.confirm('정말 이 역할을 삭제하시겠습니까?')) {
      const newRoles = roles.filter(r => r.id !== id);
      setRoles(newRoles);
      if (selectedRole === id) {
        setSelectedRole(newRoles[0]?.id || '');
      }
      const newPermissions = { ...rolePermissions };
      delete newPermissions[id];
      setRolePermissions(newPermissions);
    }
  };

  const currentPermissions = rolePermissions[selectedRole] || [];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">권한 관리</h1>
          <p className="text-slate-500 mt-1">역할별 시스템 접근 권한 및 기능을 설정합니다.</p>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={handleOpenAddModal}
            className="bg-white border border-slate-200 text-slate-700 text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-all active:scale-95"
          >
            <Plus size={18} />
            역할 추가
          </button>
          <button 
            onClick={() => alert('권한 설정이 저장되었습니다.')}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95"
          >
            <Save size={18} />
            변경사항 저장
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
                  key={role.id}
                  onClick={() => setSelectedRole(role.id)}
                  className={`w-full text-left p-3 rounded-lg transition-all group ${
                    selectedRole === role.id 
                      ? 'bg-primary/10 border-primary/20 border text-primary shadow-sm' 
                      : 'hover:bg-slate-50 text-slate-600 border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold">{role.name}</span>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleOpenEditModal(role); }}
                        className="p-1 hover:bg-white rounded text-slate-400 hover:text-primary transition-colors"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button 
                        onClick={(e) => handleDeleteRole(role.id, e)}
                        className="p-1 hover:bg-white rounded text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full group-hover:bg-white transition-colors">
                        {role.userCount}명
                      </span>
                    </div>
                  </div>
                  <div className="text-xs opacity-70 truncate">{role.id}</div>
                  <div className="mt-2 text-[11px] opacity-60 leading-relaxed">{role.desc}</div>
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
            </div>

            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900 text-slate-200">
                  <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">모듈/메뉴</th>
                  <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">조회 (Read)</th>
                  <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">저장 (Write)</th>
                  <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">삭제 (Delete)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentPermissions.map((perm) => (
                  <tr key={perm.module} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <ChevronRight size={14} className="text-slate-300" />
                        <span className="text-sm font-bold text-slate-700">{perm.module}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <PermissionToggle 
                        active={perm.read} 
                        onClick={() => togglePermission(perm.module, 'read')} 
                      />
                    </td>
                    <td className="py-4 px-6 text-center">
                      <PermissionToggle 
                        active={perm.write} 
                        onClick={() => togglePermission(perm.module, 'write')} 
                      />
                    </td>
                    <td className="py-4 px-6 text-center">
                      <PermissionToggle 
                        active={perm.delete} 
                        onClick={() => togglePermission(perm.module, 'delete')} 
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            <div className="p-6 bg-slate-50 border-t border-slate-100">
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-lg">
                <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-800">주의사항</p>
                  <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                    권한 변경 시 해당 역할을 가진 모든 사용자의 접근 권한이 즉시 변경됩니다. 
                    시스템 관리자 권한은 최소한의 인원에게만 부여하는 것을 권장합니다.
                  </p>
                </div>
              </div>
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
                  value={formData.id}
                  onChange={e => setFormData({ ...formData, id: e.target.value.toUpperCase() })}
                  placeholder="예: ROLE_GUEST"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">역할 이름 (Name)</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="예: 게스트"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">설명 (Description)</label>
                <textarea 
                  value={formData.desc}
                  onChange={e => setFormData({ ...formData, desc: e.target.value })}
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
                className="flex-1 px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors"
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

function PermissionToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`inline-flex items-center justify-center size-8 rounded-lg transition-all ${
        active 
          ? 'bg-emerald-100 text-emerald-600 border border-emerald-200 shadow-sm' 
          : 'bg-slate-100 text-slate-300 border border-slate-200'
      }`}
    >
      {active ? <Check size={16} strokeWidth={3} /> : <X size={16} strokeWidth={3} />}
    </button>
  );
}

function AlertTriangle(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
