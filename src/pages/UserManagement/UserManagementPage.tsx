import React, { useState, useRef } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Users, UserPlus, Mail, MapPin, Phone, FileText, Search, MoreVertical, Edit2, X, GripHorizontal } from 'lucide-react';

const members = [
  { 
    id: 'MEM-001', 
    name: '김철수', 
    email: 'chulsoo@example.com', 
    address: '서울시 강남구 테헤란로 123', 
    phone: '010-1234-5678', 
    remarks: '우수 고객, 정기 구매자',
    avatar: 'https://picsum.photos/seed/m1/100/100'
  },
  { 
    id: 'MEM-002', 
    name: '이영희', 
    email: 'younghee@example.com', 
    address: '경기도 성남시 분당구 판교역로 45', 
    phone: '010-9876-5432', 
    remarks: '신규 가입, 환불 이력 1건',
    avatar: 'https://picsum.photos/seed/m2/100/100'
  },
  { 
    id: 'MEM-003', 
    name: '박민준', 
    email: 'minjun@example.com', 
    address: '부산시 해운대구 마린시티 78', 
    phone: '010-5555-4444', 
    remarks: 'VIP 고객, 대량 주문 선호',
    avatar: 'https://picsum.photos/seed/m3/100/100'
  },
  { 
    id: 'MEM-004', 
    name: '최지우', 
    email: 'jiwoo@example.com', 
    address: '대구시 수성구 달구벌대로 99', 
    phone: '010-1111-2222', 
    remarks: '이벤트 참여 활발',
    avatar: 'https://picsum.photos/seed/m4/100/100'
  },
];

export default function UserManagementPage() {
  const { t } = useTranslation();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<any>(null);

  const handleEditClick = (member: any) => {
    setSelectedMember(member);
    setIsEditModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    alert(t('user.modal_edit_title') + ' ' + t('common.save'));
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
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t('user.title')}</h1>
          <p className="text-slate-500 mt-1">{t('user.description')}</p>
        </div>
        
        <button className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95">
          <UserPlus size={18} />
          {t('user.add_button')}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder={t('user.search_placeholder')} 
              className="w-full pl-10 pr-4 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
          <div className="text-xs text-slate-400 font-medium">{t('user.total_count', { count: members.length })}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-slate-900 text-slate-200">
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_id')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_name')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_email')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_address')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_phone')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider">{t('user.col_remarks')}</th>
                <th className="py-4 px-6 font-semibold text-xs uppercase tracking-wider text-center">{t('common.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-4 px-6 text-sm font-mono font-bold text-slate-500">{member.id}</td>
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <img src={member.avatar} alt={member.name} className="size-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                      <span className="text-sm font-bold text-slate-900">{member.name}</span>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <Mail size={14} className="text-slate-400" />
                      {member.email}
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-slate-600 max-w-[200px] truncate">
                    <div className="flex items-center gap-2">
                      <MapPin size={14} className="text-slate-400 flex-shrink-0" />
                      {member.address}
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <Phone size={14} className="text-slate-400" />
                      {member.phone}
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-slate-400" />
                      {member.remarks}
                    </div>
                  </td>
                  <td className="py-4 px-6 text-center">
                    <button 
                      onClick={() => handleEditClick(member)}
                      className="text-primary hover:text-primary/80 font-bold text-xs flex items-center justify-center gap-1 mx-auto bg-primary/5 px-2 py-1 rounded transition-colors"
                    >
                      <Edit2 size={14} />
                      {t('common.edit')}
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
              title={t('user.modal_edit_title')} 
              onClose={() => setIsEditModalOpen(false)}
              icon={<Edit2 size={20} className="text-primary" />}
            >
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{t('user.form_name')}</label>
                  <input 
                    type="text" 
                    defaultValue={selectedMember?.name}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{t('user.form_email')}</label>
                  <input 
                    type="email" 
                    defaultValue={selectedMember?.email}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{t('user.form_phone')}</label>
                  <input 
                    type="text" 
                    defaultValue={selectedMember?.phone}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{t('user.form_address')}</label>
                  <input 
                    type="text" 
                    defaultValue={selectedMember?.address}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{t('user.form_remarks')}</label>
                  <textarea 
                    defaultValue={selectedMember?.remarks}
                    rows={3}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                  >
                    {t('common.save')}
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
