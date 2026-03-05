import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { invokeDbCommand } from '../../lib/dbClient';
import {
  Plus,
  Edit2,
  Trash2,
  Database,
  Tag,
  X,
  GripHorizontal,
  Hash,
  Type as TypeIcon,
  AlignLeft,
  Loader2,
} from 'lucide-react';

type CodeGroup = {
  id: string;
  name: string;
  desc: string;
  count: number;
  displayOrder: number;
};

type CodeDetail = {
  group: string;
  code: string;
  name: string;
  order: number;
  useYn: 'Y' | 'N';
};

type GroupForm = {
  id: string;
  name: string;
  desc: string;
  displayOrder: number;
};

type CodeForm = {
  code: string;
  name: string;
  order: number;
  useYn: 'Y' | 'N';
};

export default function CommonCodePage() {
  const [codeGroups, setCodeGroups] = useState<CodeGroup[]>([]);
  const [codes, setCodes] = useState<CodeDetail[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const isDbBusy = isLoading || isMutating;

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [currentGroup, setCurrentGroup] = useState<GroupForm | null>(null);
  const [currentCode, setCurrentCode] = useState<CodeForm | null>(null);

  const filteredCodes = codes.filter((c) => c.group === selectedGroup);

  const loadCommonCodeData = async () => {
    try {
      setIsLoading(true);
      const result = await invokeDbCommand<{
        success: boolean;
        message: string;
        groups: { id: string; name: string; desc: string; count: number; display_order: number }[];
        details: { group: string; code: string; name: string; order: number; use_yn: 'Y' | 'N' }[];
      }>('get_common_code_management_data');

      const groups: CodeGroup[] = result.groups.map((g) => ({
        id: g.id,
        name: g.name,
        desc: g.desc,
        count: g.count,
        displayOrder: g.display_order,
      }));

      const details: CodeDetail[] = result.details.map((d) => ({
        group: d.group,
        code: d.code,
        name: d.name,
        order: d.order,
        useYn: d.use_yn,
      }));

      setCodeGroups(groups);
      setCodes(details);

      if (groups.length === 0) {
        setSelectedGroup('');
      } else if (!groups.some((g) => g.id === selectedGroup)) {
        setSelectedGroup(groups[0].id);
      }
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '공통코드 데이터를 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCommonCodeData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentGroup) return;
    if (!currentGroup.id.trim() || !currentGroup.name.trim()) {
      alert('그룹 ID와 그룹명은 필수입니다.');
      return;
    }

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('upsert_common_code_group', {
        group: {
          id: currentGroup.id.trim().toUpperCase(),
          name: currentGroup.name.trim(),
          desc: currentGroup.desc.trim(),
          display_order: currentGroup.displayOrder > 0 ? currentGroup.displayOrder : 1,
        },
      });

      await loadCommonCodeData();
      setSelectedGroup(currentGroup.id.trim().toUpperCase());
      setIsGroupModalOpen(false);
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '그룹 저장에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const deleteGroup = async (groupId: string) => {
    if (!window.confirm('선택한 그룹과 포함된 상세코드를 모두 삭제하시겠습니까?')) return;
    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('delete_common_code_group', {
        group_id: groupId,
      });
      await loadCommonCodeData();
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '그룹 삭제에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCode) return;
    if (!selectedGroup) {
      alert('먼저 그룹을 선택해주세요.');
      return;
    }
    if (!currentCode.code.trim() || !currentCode.name.trim()) {
      alert('상세코드와 상세코드명은 필수입니다.');
      return;
    }

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('upsert_common_code_detail', {
        detail: {
          group_id: selectedGroup,
          code: currentCode.code.trim().toUpperCase(),
          name: currentCode.name.trim(),
          sort_order: currentCode.order > 0 ? currentCode.order : 1,
          use_yn: currentCode.useYn,
        },
      });
      await loadCommonCodeData();
      setIsCodeModalOpen(false);
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '상세코드 저장에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  const deleteCode = async (codeId: string) => {
    if (!window.confirm('선택한 상세코드를 삭제하시겠습니까?')) return;
    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('delete_common_code_detail', {
        group_id: selectedGroup,
        code: codeId,
      });
      await loadCommonCodeData();
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || '상세코드 삭제에 실패했습니다.');
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
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
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">공통 코드 관리</h1>
          <p className="text-slate-500 mt-1">시스템에서 공통으로 사용하는 그룹코드/상세코드를 관리합니다.</p>
        </div>

        <button
          disabled={isMutating}
          onClick={() => {
            setModalMode('create');
            setCurrentGroup({ id: '', name: '', desc: '', displayOrder: codeGroups.length + 1 });
            setIsGroupModalOpen(true);
          }}
          className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-primary/20 disabled:opacity-60"
        >
          <Plus size={18} />
          코드 그룹 추가
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <Database size={16} className="text-primary" />
                코드 그룹
              </h3>
              <button
                onClick={loadCommonCodeData}
                className="text-xs text-primary font-bold hover:underline disabled:opacity-50 flex items-center gap-1"
                disabled={isLoading || isMutating}
              >
                {isLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                {isLoading ? '불러오는 중...' : '새로고침'}
              </button>
            </div>
            <div className="p-2 max-h-[600px] overflow-y-auto">
              {codeGroups.length === 0 ? (
                <div className="text-sm text-slate-400 px-3 py-6 text-center">등록된 그룹이 없습니다.</div>
              ) : (
                codeGroups.map((group) => (
                  <div
                    key={group.id}
                    className={`group relative w-full rounded-lg transition-all mb-1 ${
                      selectedGroup === group.id
                        ? 'bg-primary/10 border-primary/20 border text-primary shadow-sm'
                        : 'hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <button onClick={() => setSelectedGroup(group.id)} className="w-full text-left p-3 pr-16">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold">{group.name}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full">
                          {group.count}
                        </span>
                      </div>
                      <div className="text-xs opacity-70 truncate">
                        {group.id} • {group.desc}
                      </div>
                    </button>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setModalMode('edit');
                          setCurrentGroup({
                            id: group.id,
                            name: group.name,
                            desc: group.desc,
                            displayOrder: group.displayOrder,
                          });
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
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-8">
          <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Tag size={16} className="text-primary" />
                  상세 코드 목록
                </h3>
                <span className="text-xs text-slate-400 font-medium">| {selectedGroup || '선택 없음'}</span>
              </div>
              <button
                disabled={!selectedGroup || isMutating}
                onClick={() => {
                  setModalMode('create');
                  setCurrentCode({ code: '', name: '', order: filteredCodes.length + 1, useYn: 'Y' });
                  setIsCodeModalOpen(true);
                }}
                className="bg-white border border-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-slate-50 shadow-sm disabled:opacity-50"
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
                {filteredCodes.length > 0 ? (
                  filteredCodes.map((code) => (
                    <tr key={`${code.group}-${code.code}`} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-6 text-sm font-mono font-bold text-slate-500">{code.code}</td>
                      <td className="py-3 px-6 text-sm font-medium text-slate-700">{code.name}</td>
                      <td className="py-3 px-6 text-sm text-center text-slate-500">{code.order}</td>
                      <td className="py-3 px-6 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            code.useYn === 'Y'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {code.useYn === 'Y' ? '사용' : '미사용'}
                        </span>
                      </td>
                      <td className="py-3 px-6 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => {
                              setModalMode('edit');
                              setCurrentCode({
                                code: code.code,
                                name: code.name,
                                order: code.order,
                                useYn: code.useYn,
                              });
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
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400 text-sm">
                      등록된 상세코드가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

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
                    value={currentGroup?.id || ''}
                    onChange={(e) =>
                      setCurrentGroup((prev) => ({
                        ...(prev || { id: '', name: '', desc: '', displayOrder: 1 }),
                        id: e.target.value.toUpperCase(),
                      }))
                    }
                    className={`w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none ${
                      modalMode === 'edit' ? 'bg-slate-50 text-slate-400' : ''
                    }`}
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
                    value={currentGroup?.name || ''}
                    onChange={(e) =>
                      setCurrentGroup((prev) => ({
                        ...(prev || { id: '', name: '', desc: '', displayOrder: 1 }),
                        name: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="그룹명을 입력하세요"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                    <AlignLeft size={12} /> 설명
                  </label>
                  <textarea
                    value={currentGroup?.desc || ''}
                    onChange={(e) =>
                      setCurrentGroup((prev) => ({
                        ...(prev || { id: '', name: '', desc: '', displayOrder: 1 }),
                        desc: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none min-h-[80px]"
                    placeholder="그룹 설명을 입력하세요"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">표시 순서</label>
                  <input
                    type="number"
                    value={currentGroup?.displayOrder || 1}
                    onChange={(e) =>
                      setCurrentGroup((prev) => ({
                        ...(prev || { id: '', name: '', desc: '', displayOrder: 1 }),
                        displayOrder: parseInt(e.target.value, 10) || 1,
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
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
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                  >
                    {modalMode === 'create' ? '생성' : '수정'}
                  </button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}
      </AnimatePresence>

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
                    <label className="text-xs font-bold text-slate-500 uppercase">상세코드</label>
                    <input
                      type="text"
                      required
                      readOnly={modalMode === 'edit'}
                      value={currentCode?.code || ''}
                      onChange={(e) =>
                        setCurrentCode((prev) => ({
                          ...(prev || { code: '', name: '', order: 1, useYn: 'Y' }),
                          code: e.target.value.toUpperCase(),
                        }))
                      }
                      className={`w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none ${
                        modalMode === 'edit' ? 'bg-slate-50 text-slate-400' : ''
                      }`}
                      placeholder="DETAIL_CODE"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">상세코드명</label>
                    <input
                      type="text"
                      required
                      value={currentCode?.name || ''}
                      onChange={(e) =>
                        setCurrentCode((prev) => ({
                          ...(prev || { code: '', name: '', order: 1, useYn: 'Y' }),
                          name: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      placeholder="상세코드명을 입력하세요"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">정렬 순서</label>
                    <input
                      type="number"
                      required
                      value={currentCode?.order || 1}
                      onChange={(e) =>
                        setCurrentCode((prev) => ({
                          ...(prev || { code: '', name: '', order: 1, useYn: 'Y' }),
                          order: parseInt(e.target.value, 10) || 1,
                        }))
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">사용 여부</label>
                    <select
                      value={currentCode?.useYn || 'Y'}
                      onChange={(e) =>
                        setCurrentCode((prev) => ({
                          ...(prev || { code: '', name: '', order: 1, useYn: 'Y' }),
                          useYn: e.target.value as 'Y' | 'N',
                        }))
                      }
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
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                  >
                    {modalMode === 'create' ? '생성' : '수정'}
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

function DraggableModal({
  title,
  children,
  onClose,
  icon,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  icon: React.ReactNode;
}) {
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
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>
      </div>
      {children}
    </motion.div>
  );
}
