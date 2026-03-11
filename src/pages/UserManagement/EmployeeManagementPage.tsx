import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Users, UserPlus, Mail, MapPin, Phone, FileText, Search, Edit2, X, GripHorizontal, Trash2, Loader2, Database, Briefcase, Calendar } from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';

// 직원 목록 테이블에서 사용하는 1건의 직원 데이터 모델
type Employee = {
  // DB 기본키(직원 고유번호)
  employee_id: number;
  // 직원명
  employee_name: string;
  // 사내 직원 코드(예: EMP001)
  employee_code: string;
  // 역할 코드(권한/직군 식별값)
  role_id?: string;
  // 역할 표시명(예: 디자이너, 매니저)
  role_name?: string;
  // 이메일
  email?: string;
  // 성별 원본값(M/F/문자열)
  gender?: string;
  // 연락처
  phone?: string;
  // 입사일(yyyy-mm-dd)
  hire_date?: string;
  // 재직 상태 텍스트(재직중/휴직/퇴직)
  status?: string;
  // 비고
  remarks?: string;
};

// 등록/수정 모달에서 저장용으로 사용하는 폼 상태 모델
type FormData = {
  // 수정 모드에서만 존재하는 직원 ID
  employee_id?: number;
  // 필수 입력: 직원명
  employee_name: string;
  // 필수 입력: 직원 코드
  employee_code: string;
  // 선택 입력: 역할 코드
  role_id?: string;
  // 선택 입력: 이메일
  email?: string;
  // 선택 입력: 성별
  gender?: string;
  // 선택 입력: 연락처
  phone?: string;
  // 선택 입력: 입사일
  hire_date?: string;
  // 선택 입력: 재직 상태
  status?: string;
  // 선택 입력: 비고
  remarks?: string;
};

// 역할 선택 박스 옵션 모델
type Role = {
  // 역할 코드
  role_id: string;
  // 역할명
  role_name: string;
};

export default function EmployeeManagementPage() {
  // 페이지별 다국어 텍스트 조회 헬퍼
  const pt = usePageText('user_management_employee_management');
  const { t } = useTranslation();
  // 전체 직원 원본 목록
  const [employees, setEmployees] = useState<Employee[]>([]);
  // 검색 조건이 반영된 화면 표시용 목록
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  // 역할 드롭다운 옵션 목록
  const [roles, setRoles] = useState<Role[]>([]);
  // 이름/전화 통합 검색 입력값
  const [searchText, setSearchText] = useState('');
  // 데이터 조회 로딩 상태
  const [isLoading, setIsLoading] = useState(false);
  // 저장/삭제 등 변경 작업 진행 상태
  const [isMutating, setIsMutating] = useState(false);
  // 등록/수정 모달 열림 여부
  const [isModalOpen, setIsModalOpen] = useState(false);
  // 모달 동작 모드(add: 신규, edit: 수정)
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  // 모달 입력 폼 상태
  const [formData, setFormData] = useState<FormData>({ employee_name: '', employee_code: '', email: '', gender: '' });
  // 상태값 상수(화면 비교/라벨 변환 기준)
  const STATUS_ACTIVE = '재직중';
  const STATUS_ON_LEAVE = '휴직';
  const STATUS_RESIGNED = '퇴직';

  // 역할 목록 조회
  const loadRoles = async () => {
    try {
      const result = await invokeDbCommand<{ success: boolean; roles: Role[] }>('get_role_management_data');
      setRoles(result.roles || []);
    } catch (error: any) {
      console.error('Failed to load roles:', error);
    }
  };

  // 직원 목록 조회(원본 + 필터 목록 동기화)
  const loadEmployees = async () => {
    try {
      setIsLoading(true);
      const result = await invokeDbCommand<{ success: boolean; employees: Employee[] }>('get_employee_management_data');
      setEmployees(result.employees || []);
      setFilteredEmployees(result.employees || []);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t020'));
    } finally {
      setIsLoading(false);
    }
  };

  // 최초 진입 시 역할/직원 데이터 로드
  useEffect(() => {
    loadRoles();
    loadEmployees();
  }, []);

  // 검색어 변경 시 이름/전화 기준으로 화면 목록 재계산
  useEffect(() => {
    const normalizedSearchText = searchText.trim().toLowerCase();
    const normalizedSearchPhone = searchText.replace(/\D/g, '');
    const filtered = employees.filter((emp) => {
      const nameMatched = emp.employee_name.toLowerCase().includes(normalizedSearchText);
      const phoneMatched =
        normalizedSearchPhone.length > 0 &&
        (emp.phone || '').replace(/\D/g, '').includes(normalizedSearchPhone);
      return nameMatched || phoneMatched;
    });
    setFilteredEmployees(filtered);
  }, [searchText, employees]);

  // 다양한 성별 표현값을 폼 저장용 M/F 값으로 정규화
  const normalizeGenderForForm = (gender?: string) => {
    const normalized = (gender || '').trim().toUpperCase();
    if (normalized === 'M' || normalized === 'MALE' || normalized === '남' || normalized === '남성') return 'M';
    if (normalized === 'F' || normalized === 'FEMALE' || normalized === '여' || normalized === '여성') return 'F';
    return '';
  };

  // 신규 등록 모달 오픈 + 폼 초기화
  const handleAddClick = () => {
    setModalMode('add');
    setFormData({ employee_name: '', employee_code: '', email: '', gender: '' });
    setIsModalOpen(true);
  };

  // 수정 모달 오픈 + 선택 직원 데이터 주입
  const handleEditClick = (employee: Employee) => {
    setModalMode('edit');
    setFormData({ ...employee, email: employee.email || '', gender: normalizeGenderForForm(employee.gender) });
    setIsModalOpen(true);
  };

  // 등록/수정 저장 처리
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.employee_name || !formData.employee_code) {
      alert(pt('t012'));
      return;
    }

    try {
      setIsMutating(true);
      await invokeDbCommand('upsert_employee_management', {
        employee: formData,
      });
      await loadEmployees();
      setIsModalOpen(false);
      alert(modalMode === 'add' ? pt('t021') : pt('t022'));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t023'));
    } finally {
      setIsMutating(false);
    }
  };

  // 직원 삭제 처리
  const handleDelete = async (employeeId: number) => {
    if (!window.confirm(pt('t008'))) return;
    try {
      setIsMutating(true);
      await invokeDbCommand('delete_employee_management', { employee_id: employeeId });
      await loadEmployees();
      alert(pt('t014'));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t024'));
    } finally {
      setIsMutating(false);
    }
  };

  // DB 상태값을 화면 라벨로 변환
  const getStatusLabel = (status?: string) => {
    switch (status) {
      case STATUS_ON_LEAVE:
        return pt('t019');
      case STATUS_RESIGNED:
        return pt('t017');
      case STATUS_ACTIVE:
      case '':
      case undefined:
        return pt('t006');
      default:
        return status;
    }
  };

  // 성별 코드/문자열을 화면 표시용 라벨로 변환
  const getGenderLabel = (gender?: string) => {
    const normalized = (gender || '').trim().toUpperCase();
    if (normalized === 'M') return pt('t049');
    if (normalized === 'F') return pt('t050');
    return gender?.trim() || '-';
  };

  // 상태 배지 색상 클래스 결정
  const getStatusBadgeClass = (status?: string) =>
    status === STATUS_ACTIVE || !status ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <LoadingOverlay visible={isLoading} message={pt('t025')} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t026')}</h1>
          <p className="text-slate-500 mt-1">{pt('t010')}</p>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={loadEmployees}
            disabled={isLoading}
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
            {isLoading ? pt('t027') : pt('t028')}
          </button>
          <button 
            onClick={handleAddClick}
            disabled={isLoading}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            <UserPlus size={18} />
            {pt('t029')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder={pt('t013')} value={searchText}
              onChange={(e) => setSearchText(e.target.value)} className="w-full pl-10 pr-4 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
          <div className="text-xs text-slate-400 font-medium">{pt('t030', { count: filteredEmployees.length })}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1320px]">
            <thead>
              <tr className="bg-slate-900 text-slate-200">
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t031')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t032')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t015')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t047')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t001')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t033')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t007')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t005')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t034')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t035')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400 text-sm">
                    {pt('t036')}
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => (
                  <tr key={emp.employee_id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6 text-sm font-mono font-bold text-slate-500">{emp.employee_id}</td>
                    <td className="py-4 px-6">
                      <span className="text-sm font-bold text-slate-900">{emp.employee_name}</span>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">{emp.employee_code}</td>
                    <td className="py-4 px-6 text-sm text-slate-600">{getGenderLabel(emp.gender)}</td>
                    <td className="py-4 px-6 text-sm text-slate-600">
                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-semibold">
                        {emp.role_name || '-'}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <Mail size={14} className="text-slate-400" />
                        {emp.email || '-'}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <Phone size={14} className="text-slate-400" />
                        {emp.phone || '-'}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-slate-400" />
                        {emp.hire_date || '-'}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${getStatusBadgeClass(emp.status)}`}>
                        {getStatusLabel(emp.status)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button 
                          onClick={() => handleEditClick(emp)} disabled={isMutating}
                          className="text-primary hover:text-primary/80 font-bold text-xs flex items-center justify-center gap-1 bg-primary/5 px-2 py-1 rounded transition-colors disabled:opacity-50"
                        >
                          <Edit2 size={14} />
                          {pt('t037')}
                        </button>
                        <button 
                          onClick={() => handleDelete(emp.employee_id)} disabled={isMutating}
                          className="text-red-500 hover:text-red-600 font-bold text-xs flex items-center justify-center gap-1 bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                          {pt('t038')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}</tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal 
              title={modalMode === 'add' ? pt('t039') : pt('t040')} 
              onClose={() => setIsModalOpen(false)} icon={<UserPlus size={20} className="text-primary" />}
            >
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t011')}</label>
                  <input 
                    type="text" 
                    value={formData.employee_name}
                    onChange={(e) => setFormData({ ...formData, employee_name: e.target.value })} placeholder={pt('t009')} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t016')}</label>
                  <input 
                    type="text" 
                    value={formData.employee_code}
                    onChange={(e) => setFormData({ ...formData, employee_code: e.target.value })} placeholder="EMP001"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t003')}</label>
                  <input 
                    type="email" 
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder={pt('t004')} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t047')}</label>
                  <select
                    value={formData.gender || ''}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="">{pt('t048')}</option>
                    <option value="M">{pt('t049')}</option>
                    <option value="F">{pt('t050')}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t001')}</label>
                  <select 
                    value={formData.role_id || ''}
                    onChange={(e) => setFormData({ ...formData, role_id: e.target.value || undefined })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="">{pt('t002')}</option>
                    {roles.map((role) => (
                      <option key={role.role_id} value={role.role_id}>
                        {role.role_name}
                      </option>
                    ))}</select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t041')}</label>
                  <input 
                    type="text" 
                    value={formData.phone || ''}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="010-1234-5678"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t005')}</label>
                  <input 
                    type="date" 
                    value={formData.hire_date || ''}
                    onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t042')}</label>
                  <select 
                    value={formData.status || STATUS_ACTIVE}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value={STATUS_ACTIVE}>{pt('t006')}</option>
                    <option value={STATUS_ON_LEAVE}>{pt('t019')}</option>
                    <option value={STATUS_RESIGNED}>{pt('t017')}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t043')}</label>
                  <textarea 
                    value={formData.remarks || ''}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} placeholder={pt('t018')} rows={3}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)} disabled={isMutating}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
                  >
                    {pt('t044')}
                  </button>
                  <button 
                    type="submit"
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                  >
                    {isMutating ? pt('t045') : pt('t046')}
                  </button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}</AnimatePresence>
    </motion.div>
  );
}

function DraggableModal({ title, children, onClose, icon }: { title: string; children: React.ReactNode; onClose: () => void; icon: React.ReactNode }) {
  // 헤더 드래그 핸들 제어 객체
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
        onPointerDown={(e) => dragControls.start(e)} className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50 cursor-move active:cursor-grabbing"
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
