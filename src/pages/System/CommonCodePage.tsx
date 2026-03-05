import React, { useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { Plus, Edit2, Trash2, Search, Filter, Database, Tag, X, GripHorizontal, Hash, Type as TypeIcon, AlignLeft } from 'lucide-react';

const initialCodeGroups = [
  { id: 'CLOTH_SIZE', name: '의류 사이즈 코드', desc: '의류 제품의 사이즈 구분', count: 5 },
  { id: 'ASSET_STATUS', name: '자산 상태 코드', desc: '자산의 현재 상태 구분', count: 4 },
  { id: 'DEPT_CODE', name: '부서 코드', desc: '조직 부서 구분', count: 6 },
  { id: 'EMP_ROLE', name: '직원 직책 코드', desc: '직원 권한 및 직책 구분', count: 4 },
];

const initialCodes = [
  { group: 'CLOTH_SIZE', code: 'XS', name: 'Extra Small', order: 1, useYn: 'Y' },
  { group: 'CLOTH_SIZE', code: 'S', name: 'Small', order: 2, useYn: 'Y' },
  { group: 'CLOTH_SIZE', code: 'M', name: 'Medium', order: 3, useYn: 'Y' },
  { group: 'CLOTH_SIZE', code: 'L', name: 'Large', order: 4, useYn: 'Y' },
  { group: 'CLOTH_SIZE', code: 'XL', name: 'Extra Large', order: 5, useYn: 'Y' },
  { group: 'ASSET_STATUS', code: 'ONLINE', name: '정상 가동', order: 1, useYn: 'Y' },
  { group: 'ASSET_STATUS', code: 'MAINTENANCE', name: '유지 보수', order: 2, useYn: 'Y' },
  { group: 'ASSET_STATUS', code: 'CRITICAL', name: '위험 상태', order: 3, useYn: 'Y' },
  { group: 'ASSET_STATUS', code: 'OFFLINE', name: '가동 중지', order: 4, useYn: 'Y' },
  { group: 'EMP_ROLE', code: 'OWNER', name: '사장', order: 1, useYn: 'Y' },
  { group: 'EMP_ROLE', code: 'MANAGER', name: '매니저', order: 2, useYn: 'Y' },
  { group: 'EMP_ROLE', code: 'STAFF', name: '직원', order: 3, useYn: 'Y' },
  { group: 'EMP_ROLE', code: 'PARTTIME', name: '알바', order: 4, useYn: 'Y' },
];

export default function CommonCodePage() {
  const [codeGroups, setCodeGroups] = useState(initialCodeGroups);
  const [codes, setCodes] = useState(initialCodes);
  const [selectedGroup, setSelectedGroup] = useState('ASSET_STATUS');

  // Modal States
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [currentGroup, setCurrentGroup] = useState<any>(null);
  const [currentCode, setCurrentCode] = useState<any>(null);

  const filteredCodes = codes.filter(c => c.group === selectedGroup);

  // Group CRUD
  const handleGroupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modalMode === 'create') {
      setCodeGroups([...codeGroups, { ...currentGroup, count: 0 }]);
      alert('코드 그룹이 생성되었습니다.');
    } else {
      setCodeGroups(codeGroups.map(g => g.id === currentGroup.id ? currentGroup : g));
      alert('코드 그룹이 수정되었습니다.');
    }
    setIsGroupModalOpen(false);
  };

  const deleteGroup = (id: string) => {
    if (window.confirm('이 그룹과 포함된 모든 코드가 삭제됩니다. 계속하시겠습니까?')) {
      setCodeGroups(codeGroups.filter(g => g.id !== id));
      setCodes(codes.filter(c => c.group !== id));
      if (selectedGroup === id) setSelectedGroup(codeGroups[0]?.id || '');
    }
  };

  // Code CRUD
  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modalMode === 'create') {
      setCodes([...codes, { ...currentCode, group: selectedGroup }]);
      setCodeGroups(codeGroups.map(g => g.id === selectedGroup ? { ...g, count: g.count + 1 } : g));
      alert('상세 코드가 생성되었습니다.');
    } else {
      setCodes(codes.map(c => (c.group === selectedGroup && c.code === currentCode.code) ? currentCode : c));
      alert('상세 코드가 수정되었습니다.');
    }
    setIsCodeModalOpen(false);
  };

  const deleteCode = (code: string) => {
    if (window.confirm('이 코드를 삭제하시겠습니까?')) {
      setCodes(codes.filter(c => !(c.group === selectedGroup && c.code === code)));
      setCodeGroups(codeGroups.map(g => g.id === selectedGroup ? { ...g, count: g.count - 1 } : g));
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">공통 코드 관리</h1>
          <p className="text-slate-500 mt-1">시스템 전반에서 사용되는 기준 코드를 관리합니다.</p>
        </div>
        
        <button 
          onClick={() => {
            setModalMode('create');
            setCurrentGroup({ id: '', name: '', desc: '' });
            setIsGroupModalOpen(true);
          }}
          className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-primary/20"
        >
          <Plus size={18} />
          코드 그룹 추가
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Code Groups List */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <Database size={16} className="text-primary" />
                코드 그룹
              </h3>
              <button 
                onClick={() => {
                  setCodeGroups(initialCodeGroups);
                  setCodes(initialCodes);
                }}
                className="text-xs text-primary font-bold hover:underline"
              >
                새로고침
              </button>
            </div>
            <div className="p-2 max-h-[600px] overflow-y-auto">
              {codeGroups.map((group) => (
                <div 
                  key={group.id}
                  className={`group relative w-full rounded-lg transition-all mb-1 ${
                    selectedGroup === group.id 
                      ? 'bg-primary/10 border-primary/20 border text-primary shadow-sm' 
                      : 'hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <button
                    onClick={() => setSelectedGroup(group.id)}
                    className="w-full text-left p-3 pr-16"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold">{group.name}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full">{group.count}</span>
                    </div>
                    <div className="text-xs opacity-70 truncate">{group.id} • {group.desc}</div>
                  </button>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setModalMode('edit');
                        setCurrentGroup(group);
                        setIsGroupModalOpen(true);
                      }}
                      className="p-1.5 hover:bg-white rounded text-slate-400 hover:text-primary transition-colors"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteGroup(group.id);
                      }}
                      className="p-1.5 hover:bg-white rounded text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Codes Detail List */}
        <div className="lg:col-span-8">
          <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Tag size={16} className="text-primary" />
                  상세 코드 목록
                </h3>
                <span className="text-xs text-slate-400 font-medium">| {selectedGroup}</span>
              </div>
              <button 
                onClick={() => {
                  setModalMode('create');
                  setCurrentCode({ code: '', name: '', order: filteredCodes.length + 1, useYn: 'Y' });
                  setIsCodeModalOpen(true);
                }}
                className="bg-white border border-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-slate-50 shadow-sm"
              >
                <Plus size={14} />
                코드 추가
              </button>
            </div>

            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900 text-slate-200">
                  <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider">코드</th>
                  <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider">코드명</th>
                  <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider text-center">정렬</th>
                  <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider text-center">사용여부</th>
                  <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider text-center">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCodes.length > 0 ? filteredCodes.map((code) => (
                  <tr key={code.code} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-6 text-sm font-mono font-bold text-slate-500">{code.code}</td>
                    <td className="py-3 px-6 text-sm font-medium text-slate-700">{code.name}</td>
                    <td className="py-3 px-6 text-sm text-center text-slate-500">{code.order}</td>
                    <td className="py-3 px-6 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        code.useYn === 'Y' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {code.useYn === 'Y' ? '사용' : '미사용'}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button 
                          onClick={() => {
                            setModalMode('edit');
                            setCurrentCode(code);
                            setIsCodeModalOpen(true);
                          }}
                          className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 rounded transition-colors"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button 
                          onClick={() => deleteCode(code.code)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400 text-sm">등록된 코드가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Group Modal */}
      <AnimatePresence>
        {isGroupModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal 
              title={modalMode === 'create' ? '코드 그룹 추가' : '코드 그룹 수정'}
              onClose={() => setIsGroupModalOpen(false)}
              icon={<Database size={20} className="text-primary" />}
            >
              <form onSubmit={handleGroupSubmit} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                    <Hash size={12} /> 그룹 ID
                  </label>
                  <input 
                    type="text" 
                    required
                    readOnly={modalMode === 'edit'}
                    value={currentGroup?.id}
                    onChange={(e) => setCurrentGroup({ ...currentGroup, id: e.target.value.toUpperCase() })}
                    className={`w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none ${modalMode === 'edit' ? 'bg-slate-50 text-slate-400' : ''}`}
                    placeholder="GROUP_ID"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                    <TypeIcon size={12} /> 그룹명
                  </label>
                  <input 
                    type="text" 
                    required
                    value={currentGroup?.name}
                    onChange={(e) => setCurrentGroup({ ...currentGroup, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="그룹 이름을 입력하세요"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                    <AlignLeft size={12} /> 설명
                  </label>
                  <textarea 
                    value={currentGroup?.desc}
                    onChange={(e) => setCurrentGroup({ ...currentGroup, desc: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none min-h-[80px]"
                    placeholder="그룹에 대한 설명을 입력하세요"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsGroupModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    취소
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    {modalMode === 'create' ? '그룹 생성' : '수정 완료'}
                  </button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}
      </AnimatePresence>

      {/* Code Modal */}
      <AnimatePresence>
        {isCodeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal 
              title={modalMode === 'create' ? '상세 코드 추가' : '상세 코드 수정'}
              onClose={() => setIsCodeModalOpen(false)}
              icon={<Tag size={20} className="text-primary" />}
            >
              <form onSubmit={handleCodeSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">코드 ID</label>
                    <input 
                      type="text" 
                      required
                      readOnly={modalMode === 'edit'}
                      value={currentCode?.code}
                      onChange={(e) => setCurrentCode({ ...currentCode, code: e.target.value.toUpperCase() })}
                      className={`w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none ${modalMode === 'edit' ? 'bg-slate-50 text-slate-400' : ''}`}
                      placeholder="CODE_ID"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">코드명</label>
                    <input 
                      type="text" 
                      required
                      value={currentCode?.name}
                      onChange={(e) => setCurrentCode({ ...currentCode, name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      placeholder="코드 이름을 입력하세요"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">정렬 순서</label>
                    <input 
                      type="number" 
                      required
                      value={currentCode?.order}
                      onChange={(e) => setCurrentCode({ ...currentCode, order: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">사용 여부</label>
                    <select 
                      value={currentCode?.useYn}
                      onChange={(e) => setCurrentCode({ ...currentCode, useYn: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    >
                      <option value="Y">사용 (Y)</option>
                      <option value="N">미사용 (N)</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsCodeModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    취소
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    {modalMode === 'create' ? '코드 생성' : '수정 완료'}
                  </button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DraggableModal({ title, children, onClose, icon }: { title: string; children: React.ReactNode; onClose: () => void; icon: React.ReactNode }) {
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
        onPointerDown={(e) => dragControls.start(e)}
        className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 cursor-move active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <GripHorizontal size={18} className="text-slate-300" />
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X size={20} className="text-slate-500" />
          </button>
        </div>
      </div>
      {children}
    </motion.div>
  );
}
