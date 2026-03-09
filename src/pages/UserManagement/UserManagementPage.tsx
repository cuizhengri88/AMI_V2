import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Users, UserPlus, Mail, MapPin, Phone, FileText, Search, Edit2, X, GripHorizontal, Trash2, Loader2, Database } from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';

type User = {
  user_id: number;
  name: string;
  email: string;
  gender?: string;
  phone?: string;
  address?: string;
  remarks?: string;
};

type FormData = {
  user_id?: number;
  name: string;
  email: string;
  gender?: string;
  phone?: string;
  address?: string;
  remarks?: string;
};

export default function UserManagementPage() {
  const pt = usePageText('user_management_user_management');
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchText, setSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<FormData>({ name: '', email: '', gender: '' });

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const result = await invokeDbCommand<{ success: boolean; users: User[] }>('get_user_management_data');
      setUsers(result.users || []);
      setFilteredUsers(result.users || []);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '회원 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    const filtered = users.filter(user =>
      user.name.toLowerCase().includes(searchText.toLowerCase()) ||
      user.email.toLowerCase().includes(searchText.toLowerCase())
    );
    setFilteredUsers(filtered);
  }, [searchText, users]);

  const normalizeGenderForForm = (gender?: string) => {
    const normalized = (gender || '').trim().toUpperCase();
    if (normalized === 'M' || normalized === 'MALE' || normalized === '남' || normalized === '남성') return 'M';
    if (normalized === 'F' || normalized === 'FEMALE' || normalized === '여' || normalized === '여성') return 'F';
    return '';
  };

  const handleAddClick = () => {
    setModalMode('add');
    setFormData({ name: '', email: '', gender: '' });
    setIsModalOpen(true);
  };

  const handleEditClick = (user: User) => {
    setModalMode('edit');
    setFormData({ ...user, gender: normalizeGenderForForm(user.gender) });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email) {
      alert(pt('t001'));
      return;
    }

    try {
      setIsMutating(true);
      await invokeDbCommand('upsert_user_management', {
        user: formData,
      });
      await loadUsers();
      setIsModalOpen(false);
      alert(modalMode === 'add' ? '회원이 추가되었습니다.' : '회원이 수정되었습니다.');
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '저장에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async (userId: number) => {
    if (!window.confirm(pt('t003'))) return;
    try {
      setIsMutating(true);
      await invokeDbCommand('delete_user_management', { user_id: userId });
      await loadUsers();
      alert(pt('t006'));
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '삭제에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const getGenderLabel = (gender?: string) => {
    const normalized = (gender || '').trim().toUpperCase();
    if (normalized === 'M') return pt('t009');
    if (normalized === 'F') return pt('t010');
    return gender?.trim() || '-';
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <LoadingOverlay visible={isLoading} message="로딩 중..." />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t('user.title')}</h1>
          <p className="text-slate-500 mt-1">{t('user.description')}</p>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={loadUsers}
            disabled={isLoading}
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
            {isLoading ? '불러오는 중...' : 'DB 새로고침'}
          </button>
          <button 
            onClick={handleAddClick}
            disabled={isLoading}
            className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 disabled:opacity-60"
          >
            <UserPlus size={18} />
            {t('user.add_button')}</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder={t('user.search_placeholder')} value={searchText}
              onChange={(e) => setSearchText(e.target.value)} className="w-full pl-10 pr-4 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
          <div className="text-xs text-slate-400 font-medium">{t('user.total_count', { count: filteredUsers.length })}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1120px]">
            <thead>
              <tr className="bg-slate-900 text-slate-200">
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">ID</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_name')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_email')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t007')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_address')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_phone')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_remarks')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('common.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400 text-sm">
                    회원 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.user_id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6 text-sm font-mono font-bold text-slate-500">{user.user_id}</td>
                    <td className="py-4 px-6">
                      <span className="text-sm font-bold text-slate-900">{user.name}</span>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <Mail size={14} className="text-slate-400" />
                        {user.email}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">{getGenderLabel(user.gender)}</td>
                    <td className="py-4 px-6 text-sm text-slate-600 max-w-[200px] truncate">
                      <div className="flex items-center gap-2">
                        <MapPin size={14} className="text-slate-400 flex-shrink-0" />
                        {user.address || '-'}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <Phone size={14} className="text-slate-400" />
                        {user.phone || '-'}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-slate-400" />
                        {user.remarks || '-'}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button 
                          onClick={() => handleEditClick(user)} disabled={isMutating}
                          className="text-primary hover:text-primary/80 font-bold text-xs flex items-center justify-center gap-1 bg-primary/5 px-2 py-1 rounded transition-colors disabled:opacity-50"
                        >
                          <Edit2 size={14} />
                          {t('common.edit')}</button>
                        <button 
                          onClick={() => handleDelete(user.user_id)} disabled={isMutating}
                          className="text-red-500 hover:text-red-600 font-bold text-xs flex items-center justify-center gap-1 bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                          삭제
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
              title={modalMode === 'add' ? '새 회원 추가' : '회원 정보 수정'} 
              onClose={() => setIsModalOpen(false)} icon={<UserPlus size={20} className="text-primary" />}
            >
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">이름</label>
                  <input 
                    type="text" 
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder={pt('t005')} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">이메일</label>
                  <input 
                    type="email" 
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder={pt('t002')} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t007')}</label>
                  <select
                    value={formData.gender || ''}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="">{pt('t008')}</option>
                    <option value="M">{pt('t009')}</option>
                    <option value="F">{pt('t010')}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">전화번호</label>
                  <input 
                    type="text" 
                    value={formData.phone || ''}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="010-1234-5678"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">주소</label>
                  <input 
                    type="text" 
                    value={formData.address || ''}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="주소"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">비고</label>
                  <textarea 
                    value={formData.remarks || ''}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} placeholder={pt('t004')} rows={3}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)} disabled={isMutating}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
                  >
                    {t('common.cancel')}</button>
                  <button 
                    type="submit"
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                  >
                    {isMutating ? '저장 중...' : t('common.save')}</button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}</AnimatePresence>
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
