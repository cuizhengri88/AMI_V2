import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Users, UserPlus, Mail, MapPin, Phone, FileText, Search, Edit2, X, GripHorizontal, Trash2, Loader2, Database, Briefcase, Calendar } from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';
import { normalizeGenderForForm } from '../utils/pageCommon';

/**
 * 직원 데이터 모델 (DB employee_management 테이블 대응)
 */
type Employee = {
  employee_id: number;    // DB 기본키 (직원 고유번호)
  employee_name: string;  // 직원명
  employee_code: string;  // 사내 직원 코드 (예: EMP001)
  role_id?: string;       // 역할 코드 (권한/직군 식별값)
  role_name?: string;     // 역할 표시명 (예: 디자이너, 매니저)
  email?: string;         // 이메일 주소
  gender?: string;        // 성별 원본값 (M/F/문자열)
  phone?: string;         // 연락처 (전화번호)
  hire_date?: string;     // 입사일 (yyyy-mm-dd)
  status?: string;        // 재직 상태 (재직중/휴직/퇴직)
  remarks?: string;       // 비고 (특이사항)
};

/**
 * 등록 및 수정을 위한 폼 데이터 모델
 */
type FormData = {
  employee_id?: number;   // 수정 시에만 존재하는 ID
  employee_name: string;  // 직원명 (필수)
  employee_code: string;  // 직원 코드 (필수)
  role_id?: string;       // 선택된 역할 ID
  email?: string;         // 이메일
  gender?: string;        // 선택된 성별
  phone?: string;         // 연락처
  hire_date?: string;     // 입사일
  status?: string;        // 재직 상태
  remarks?: string;       // 비고
};

/**
 * 역할 선택 옵션 모델
 */
type Role = {
  role_id: string;        // 역할 코드
  role_name: string;      // 역할 이름
};

/**
 * 직원 관리 페이지 컴포넌트
 */
export default function EmployeeManagementPage() {
  // 페이지 전용 다국어 훅 (user_management_employee_management 영역)
  const pt = usePageText('user_management_employee_management');
  const { t } = useTranslation();

  /**
   * 상태 관리 (useState)
   * employees: DB에서 불러온 전체 직원 목록
   * filteredEmployees: 검색어가 적용된 화면 표시용 직원 목록
   * roles: 직원의 직책/역할 옵션 목록
   * searchText: 검색창 입력값
   * isLoading: 초기 데이터 로드 상태
   * isMutating: 저장/삭제 등 변경 작업 중 상태
   * isModalOpen: 등록/수정 모달 오픈 여부
   * modalMode: 모달 작업 유형 (add/edit)
   * formData: 모달 내 입력 폼 데이터
   */
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [searchText, setSearchText] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<FormData>({ employee_name: '', employee_code: '', email: '', gender: '' });

  // 재직 상태값 상수 정의
  const STATUS_ACTIVE = '재직중';
  const STATUS_ON_LEAVE = '휴직';
  const STATUS_RESIGNED = '퇴직';

  /**
   * 역할(Role) 목록을 DB에서 조회합니다.
   */
  const loadRoles = async () => {
    try {
      const result = await invokeDbCommand<{ success: boolean; roles: Role[] }>('get_role_management_data');
      setRoles(result.roles || []);
    } catch (error: any) {
      console.error('Failed to load roles:', error);
    }
  };

  /**
   * 전체 직원 목록을 DB에서 조회합니다.
   */
  const loadEmployees = async () => {
    try {
      setIsLoading(true);
      const result = await invokeDbCommand<{ success: boolean; employees: Employee[] }>('get_employee_management_data');
      setEmployees(result.employees || []);
      setFilteredEmployees(result.employees || []);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t020')); // pt('t020') -> 직원 데이터를 불러오지 못했습니다.
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 컴포넌트 마운트 시 초기 데이터 로딩
   */
  useEffect(() => {
    loadRoles();
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 검색어(이름 또는 전화번호) 변경 시 실시간 필터링 수행
   */
  useEffect(() => {
    const normalizedSearchText = searchText.trim().toLowerCase();
    const normalizedSearchPhone = searchText.replace(/\D/g, ''); // 숫자만 추출

    const filtered = employees.filter((emp) => {
      // 이름 검색 확인
      const nameMatched = emp.employee_name.toLowerCase().includes(normalizedSearchText);
      // 전화번호 검색 확인 (기호 제외 비교)
      const phoneMatched =
        normalizedSearchPhone.length > 0 &&
        (emp.phone || '').replace(/\D/g, '').includes(normalizedSearchPhone);

      return nameMatched || phoneMatched;
    });
    setFilteredEmployees(filtered);
  }, [searchText, employees]);

  /**
   * 신규 등록 버튼 클릭 핸들러
   */
  const handleAddClick = () => {
    setModalMode('add');
    setFormData({ employee_name: '', employee_code: '', email: '', gender: '' });
    setIsModalOpen(true);
  };

  /**
   * 수정 버튼 클릭 핸들러
   * @param employee 선택된 직원 객체
   */
  const handleEditClick = (employee: Employee) => {
    setModalMode('edit');
    // 성별 값 정규화 및 데이터 복사
    setFormData({
      ...employee,
      email: employee.email || '',
      gender: normalizeGenderForForm(employee.gender)
    });
    setIsModalOpen(true);
  };

  /**
   * 폼 저장(등록/수정) 제출 핸들러
   * @param e 폼 이벤트
   */
  const handleSave = async (e: React.FormEvent) => {
    // e.preventDefault(): 전송 시 페이지가 리로드되는 브라우저 기본 동작 방지
    e.preventDefault();

    // 필수값 검증
    if (!formData.employee_name || !formData.employee_code) {
      alert(pt('t012')); // pt('t012') -> 직원명과 직원코드는 필수입니다.
      return;
    }

    try {
      setIsMutating(true);
      // DB 저장 커맨드 실행
      await invokeDbCommand('upsert_employee_management', {
        employee: formData,
      });
      await loadEmployees(); // 목록 새로고침
      setIsModalOpen(false); // 모달 닫기
      alert(modalMode === 'add' ? pt('t021') : pt('t022')); // pt('t021') -> 직원이 추가되었습니다. / pt('t022') -> 직원이 수정되었습니다.
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t023')); // pt('t023') -> 저장에 실패했습니다.
    } finally {
      setIsMutating(false);
    }
  };

  /**
   * 직원 삭제 핸들러
   * @param employeeId 삭제할 직원 ID
   */
  const handleDelete = async (employeeId: number) => {
    if (!window.confirm(pt('t008'))) return; // pt('t008') -> 정말 이 직원을 삭제하시겠습니까?
    try {
      setIsMutating(true);
      await invokeDbCommand('delete_employee_management', { employee_id: employeeId });
      await loadEmployees();
      alert(pt('t014')); // pt('t014') -> 직원이 삭제되었습니다.
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t024')); // pt('t024') -> 삭제에 실패했습니다.
    } finally {
      setIsMutating(false);
    }
  };

  /**
   * DB의 상태값을 다국어 라벨로 변환하여 반환합니다.
   */
  const getStatusLabel = (status?: string) => {
    switch (status) {
      case STATUS_ON_LEAVE:
        return pt('t019'); // pt('t019') -> 휴직
      case STATUS_RESIGNED:
        return pt('t017'); // pt('t017') -> 퇴직
      case STATUS_ACTIVE:
      case '':
      case undefined:
        return pt('t006'); // pt('t006') -> 재직중
      default:
        return status;
    }
  };

  /**
   * 성별 코드/문자열을 다국어 명칭으로 변환합니다.
   */
  const getGenderLabel = (gender?: string) => {
    const normalized = (gender || '').trim().toUpperCase();
    if (normalized === 'M') return pt('t049'); // pt('t049') -> 남성
    if (normalized === 'F') return pt('t050'); // pt('t050') -> 여성
    return gender?.trim() || '-';
  };

  /**
   * 상태값에 따른 뱃지 색상 클래스를 반환합니다.
   */
  const getStatusBadgeClass = (status?: string) =>
    status === STATUS_ACTIVE || !status ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <LoadingOverlay visible={isLoading} message={pt('t025')} /> {/* pt('t025') -> 로딩 중... */}

      {/* 페이지 상단 헤더 영역 */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            {pt('t026')} {/* pt('t026') -> 직원 관리 */}
          </h1>
          <p className="text-slate-500 mt-1">
            {pt('t010')} {/* pt('t010') -> 직원 정보를 관리합니다 */}
          </p>
        </div>

        <div className="flex gap-2">
          {/* 데이터 새로고침 버튼 */}
          <button
            onClick={loadEmployees}
            disabled={isLoading}
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
            {isLoading ? pt('t027') : pt('t028')} {/* pt('t027') -> 불러오는 중... / pt('t028') -> DB 새로고침 */}
          </button>
          {/* 직원 추가 모달 호출 버튼 */}
          <button
            onClick={handleAddClick}
            disabled={isLoading}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            <UserPlus size={18} />
            {pt('t029')} {/* pt('t029') -> 직원 추가 */}
          </button>
        </div>
      </div>

      {/* 메인 리스트 카드 영역 */}
      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        {/* 리스트 헤더: 검색창 및 건수 표시 */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder={pt('t013')} // pt('t013') -> 직원명, 전화번호 검색
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full pl-10 pr-4 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
          <div className="text-xs text-slate-400 font-medium">{pt('t030', { count: filteredEmployees.length })}</div> {/* pt('t030') -> 총 {{count}}명 */}
        </div>

        {/* 직원 목록 테이블 */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1320px]">
            <thead>
              <tr className="bg-slate-900 text-slate-200">
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t031')}</th> {/* pt('t031') -> ID */}
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t032')}</th> {/* pt('t032') -> 직원명 */}
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t015')}</th> {/* pt('t015') -> 직원코드 */}
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t047')}</th> {/* pt('t047') -> 성별 */}
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t001')}</th> {/* pt('t001') -> 역할 */}
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t033')}</th> {/* pt('t033') -> 이메일 */}
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t007')}</th> {/* pt('t007') -> 전화 */}
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t005')}</th> {/* pt('t005') -> 입사일 */}
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t034')}</th> {/* pt('t034') -> 상태 */}
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t035')}</th> {/* pt('t035') -> 작업 */}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400 text-sm">
                    {pt('t036')} {/* pt('t036') -> 직원 데이터가 없습니다. */}
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
                        {/* 수정 버튼 */}
                        <button
                          onClick={() => handleEditClick(emp)}
                          disabled={isMutating}
                          className="text-primary hover:text-primary/80 font-bold text-xs flex items-center justify-center gap-1 bg-primary/5 px-2 py-1 rounded transition-colors disabled:opacity-50"
                        >
                          <Edit2 size={14} />
                          {pt('t037')} {/* pt('t037') -> 수정 */}
                        </button>
                        {/* 삭제 버튼 */}
                        <button
                          onClick={() => handleDelete(emp.employee_id)}
                          disabled={isMutating}
                          className="text-red-500 hover:text-red-600 font-bold text-xs flex items-center justify-center gap-1 bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                          {pt('t038')} {/* pt('t038') -> 삭제 */}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 직원 등록/수정 전용 모달 */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={modalMode === 'add' ? pt('t039') : pt('t040')} // pt('t039') -> 새 직원 추가 / pt('t040') -> 직원 정보 수정
              onClose={() => setIsModalOpen(false)}
              icon={<UserPlus size={20} className="text-primary" />}
            >
              <form onSubmit={handleSave} className="p-6 space-y-4">
                {/* 직원명 입력 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t011')}</label> {/* pt('t011') -> 직원명 * */}
                  <input
                    type="text"
                    value={formData.employee_name}
                    onChange={(e) => setFormData({ ...formData, employee_name: e.target.value })}
                    placeholder={pt('t009')} // pt('t009') -> 직원 이름
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                {/* 직원 코드 입력 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t016')}</label> {/* pt('t016') -> 직원코드 * */}
                  <input
                    type="text"
                    value={formData.employee_code}
                    onChange={(e) => setFormData({ ...formData, employee_code: e.target.value })}
                    placeholder="EMP001"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                {/* 이메일 입력 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t003')}</label> {/* pt('t003') -> 이메일 */}
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder={pt('t004')} // pt('t004') -> 이메일 주소
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                {/* 성별 선택 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t047')}</label> {/* pt('t047') -> 성별 */}
                  <select
                    value={formData.gender || ''}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="">{pt('t048')}</option> {/* pt('t048') -> 성별 선택 */}
                    <option value="M">{pt('t049')}</option> {/* pt('t049') -> 남성 */}
                    <option value="F">{pt('t050')}</option> {/* pt('t050') -> 여성 */}
                  </select>
                </div>
                {/* 역할(직책) 선택 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t001')}</label> {/* pt('t001') -> 역할 */}
                  <select
                    value={formData.role_id || ''}
                    onChange={(e) => setFormData({ ...formData, role_id: e.target.value || undefined })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="">{pt('t002')}</option> {/* pt('t002') -> 역할 선택 */}
                    {roles.map((role) => (
                      <option key={role.role_id} value={role.role_id}>
                        {role.role_name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 전화번호 입력 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t041')}</label> {/* pt('t041') -> 전화번호 */}
                  <input
                    type="text"
                    value={formData.phone || ''}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="010-1234-5678"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                {/* 입사일 입력 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t005')}</label> {/* pt('t005') -> 입사일 */}
                  <input
                    type="date"
                    value={formData.hire_date || ''}
                    onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                {/* 재직 상태 선택 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t042')}</label> {/* pt('t042') -> 상태 */}
                  <select
                    value={formData.status || STATUS_ACTIVE}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value={STATUS_ACTIVE}>{pt('t006')}</option> {/* pt('t006') -> 재직중 */}
                    <option value={STATUS_ON_LEAVE}>{pt('t019')}</option> {/* pt('t019') -> 휴직 */}
                    <option value={STATUS_RESIGNED}>{pt('t017')}</option> {/* pt('t017') -> 퇴직 */}
                  </select>
                </div>
                {/* 비고 입력 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t043')}</label> {/* pt('t043') -> 비고 */}
                  <textarea
                    value={formData.remarks || ''}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                    placeholder={pt('t018')} // pt('t018') -> 특이사항 입력
                    rows={3}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none resize-none"
                  />
                </div>

                {/* 하단 버튼 군 */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
                  >
                    {pt('t044')} {/* pt('t044') -> 취소 */}
                  </button>
                  <button
                    type="submit"
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                  >
                    {isMutating ? pt('t045') : pt('t046')} {/* pt('t045') -> 저장 중... / pt('t046') -> 저장 */}
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

/**
 * 드래그 가능한 공통 모달 레이아웃 컴포넌트
 */
function DraggableModal({
  title,
  children,
  onClose,
  icon
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  icon: React.ReactNode
}) {
  // 헤더 드래그 핸들 제어 객체 (사용 수동 제어)
  const dragControls = useDragControls();

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false} // 헤더 부분만 드래그 리스너로 동작하게 함
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative"
    >
      {/* 모달 상단 헤더 및 드래그 핸들 */}
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
      {/* 폼 또는 본문 컨텐츠 삽입 영역 */}
      {children}
    </motion.div>
  );
}
