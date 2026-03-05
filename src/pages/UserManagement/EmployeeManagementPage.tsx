import React, { useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { UserPlus, Mail, MapPin, Phone, Shield, Search, MoreVertical, Briefcase, Edit2, X, GripHorizontal } from 'lucide-react';

const employees = [
  { 
    id: 'EMP-001', 
    name: '홍길동', 
    email: 'gildong.hong@enterprise.com', 
    address: '서울시 성동구 성수동 123', 
    phone: '010-1111-2222', 
    role: '사장',
    avatar: 'https://picsum.photos/seed/e1/100/100'
  },
  { 
    id: 'EMP-002', 
    name: '박서준', 
    email: 'sj.park@enterprise.com', 
    address: '서울시 마포구 상암동 456', 
    phone: '010-3333-4444', 
    role: '매니저',
    avatar: 'https://picsum.photos/seed/e2/100/100'
  },
  { 
    id: 'EMP-003', 
    name: '이지은', 
    email: 'je.lee@enterprise.com', 
    address: '경기도 고양시 일산동구 789', 
    phone: '010-5555-6666', 
    role: '직원',
    avatar: 'https://picsum.photos/seed/e3/100/100'
  },
  { 
    id: 'EMP-004', 
    name: '최우식', 
    email: 'ws.choi@enterprise.com', 
    address: '서울시 송파구 잠실동 101', 
    phone: '010-7777-8888', 
    role: '직원',
    avatar: 'https://picsum.photos/seed/e4/100/100'
  },
  { 
    id: 'EMP-005', 
    name: '김다미', 
    email: 'dm.kim@enterprise.com', 
    address: '서울시 서대문구 연희동 202', 
    phone: '010-9999-0000', 
    role: '알바',
    avatar: 'https://picsum.photos/seed/e5/100/100'
  },
];

export default function EmployeeManagementPage() {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);

  const handleEditClick = (emp: any) => {
    setSelectedEmployee(emp);
    setIsEditModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    alert('직원 정보가 수정되었습니다.');
    setIsEditModalOpen(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">직원 관리</h1>
          <p className="text-slate-500 mt-1">사내 직원 정보 및 권한을 관리합니다.</p>
        </div>
        
        <button className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95">
          <UserPlus size={18} />
          신규 직원 등록
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="직원 검색 (이름, ID)..." 
              className="w-full pl-10 pr-4 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
          <div className="text-xs text-slate-400 font-medium">총 {employees.length}명의 직원</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-slate-900 text-slate-200">
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">직원 ID</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">직원명</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">이메일</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">주소</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">전화번호</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">권한 (직책)</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-4 px-6 text-sm font-mono font-bold text-slate-500">{emp.id}</td>
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <img src={emp.avatar} alt={emp.name} className="size-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                      <span className="text-sm font-bold text-slate-900">{emp.name}</span>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <Mail size={14} className="text-slate-400" />
                      {emp.email}
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-slate-600 max-w-[200px] truncate">
                    <div className="flex items-center gap-2">
                      <MapPin size={14} className="text-slate-400 flex-shrink-0" />
                      {emp.address}
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <Phone size={14} className="text-slate-400" />
                      {emp.phone}
                    </div>
                  </td>
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-2">
                      <div className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
                        emp.role === '사장' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                        emp.role === '매니저' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                        emp.role === '알바' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                        'bg-slate-50 text-slate-700 border border-slate-200'
                      }`}>
                        <Briefcase size={12} />
                        {emp.role}
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-center">
                    <button 
                      onClick={() => handleEditClick(emp)}
                      className="text-primary hover:text-primary/80 font-bold text-xs flex items-center justify-center gap-1 mx-auto bg-primary/5 px-2 py-1 rounded transition-colors"
                    >
                      <Edit2 size={14} />
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal 
              title="직원 정보 수정" 
              onClose={() => setIsEditModalOpen(false)}
              icon={<Edit2 size={20} className="text-primary" />}
            >
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">직원명</label>
                  <input 
                    type="text" 
                    defaultValue={selectedEmployee?.name}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">직책</label>
                  <select 
                    defaultValue={selectedEmployee?.role}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="사장">사장</option>
                    <option value="매니저">매니저</option>
                    <option value="직원">직원</option>
                    <option value="알바">알바</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">이메일</label>
                  <input 
                    type="email" 
                    defaultValue={selectedEmployee?.email}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">전화번호</label>
                  <input 
                    type="text" 
                    defaultValue={selectedEmployee?.phone}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">주소</label>
                  <input 
                    type="text" 
                    defaultValue={selectedEmployee?.address}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    취소
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    저장하기
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
