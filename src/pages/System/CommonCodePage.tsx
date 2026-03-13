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
  Scissors,
} from 'lucide-react';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';

/**
 * 코드 그룹 정보 타입 (DB common_code_group 테이블 대응)
 */
type CodeGroup = {
  id: string;          // 그룹 ID (예: 'STR_CD')
  name: string;        // 그룹명 (예: '점포 코드')
  desc: string;        // 그룹 설명
  count: number;       // 소속된 상세 코드 개수
  displayOrder: number; // 화면 표시 순서
};

/**
 * 상세 코드 정보 타입 (DB common_code_detail 테이블 대응)
 */
type CodeDetail = {
  group: string;       // 소속 그룹 ID
  code: string;        // 상세 코드 (예: 'HAIR_001')
  name: string;        // 상세 코드명 (예: '본점')
  order: number;       // 정렬 순서
  useYn: 'Y' | 'N';    // 사용 여부
};

/**
 * 그룹 등록/수정 폼 데이터 타입
 */
type GroupForm = {
  id: string;          // 입력된 그룹 ID
  name: string;        // 입력된 그룹명
  desc: string;        // 입력된 설명
  displayOrder: number; // 입력된 표시 순서
};

/**
 * 상세 코드 등록/수정 폼 데이터 타입
 */
type CodeForm = {
  code: string;        // 입력된 상세 코드
  name: string;        // 입력된 상세 코드명
  order: number;       // 입력된 정렬 순서
  useYn: 'Y' | 'N';    // 선택된 사용 여부
};

/**
 * 미용실 기본 카테고리 그룹 ID 상수
 */
const SALON_CATEGORY_GROUP_ID = 'SALON_SERVICE_CATEGORY';

/**
 * 미용실 기본 카테고리 상세 코드 데이터 (초기 설정용)
 */
const SALON_CATEGORY_CODES: Array<{ code: string; name: string; order: number }> = [
  { code: 'CUT', name: '커트', order: 1 },
  { code: 'PERM', name: '파마', order: 2 },
  { code: 'COLOR', name: '염색', order: 3 },
];

/**
 * 공통 코드 관리 페이지 컴포넌트
 */
export default function CommonCodePage() {
  // 페이지 전용 다국어 훅 (system_common_code 영역)
  const pt = usePageText('system_common_code');

  /**
   * 상태 관리 (useState)
   * codeGroups: 코드 그룹 목록
   * codes: 모든 상세 코드 목록 (백엔드에서 전체 조회 후 프론트에서 필터링)
   * selectedGroup: 좌측 목록에서 선택된 그룹 ID
   * isLoading: 초기 데이터 로딩 상태
   * isMutating: 등록/수정/삭제 등 데이터 변경 작업 상태
   */
  const [codeGroups, setCodeGroups] = useState<CodeGroup[]>([]);
  const [codes, setCodes] = useState<CodeDetail[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  // DB 작업 중 여부
  const isDbBusy = isLoading || isMutating;

  // 모달 제어 상태
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');

  // 폼 입력 데이터 상태
  const [currentGroup, setCurrentGroup] = useState<GroupForm | null>(null);
  const [currentCode, setCurrentCode] = useState<CodeForm | null>(null);

  /**
   * 현재 선택된 그룹에 속한 상세 코드들만 추출
   */
  const filteredCodes = codes.filter((c) => c.group === selectedGroup);

  /**
   * 서버로부터 모든 공통 코드(그룹 및 상세 내역)를 불러옵니다.
   */
  const loadCommonCodeData = async () => {
    try {
      setIsLoading(true);
      const result = await invokeDbCommand<{
        success: boolean;
        message: string;
        groups: { id: string; name: string; desc: string; count: number; display_order: number }[];
        details: { group: string; code: string; name: string; order: number; use_yn: 'Y' | 'N' }[];
      }>('get_common_code_management_data');

      // 백엔드 스네이크 케이스 데이터를 프론트엔드 카멜 케이스로 변환
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

      // 선택된 그룹 유지 또는 초기화 로직
      if (groups.length === 0) {
        setSelectedGroup('');
      } else if (!groups.some((g) => g.id === selectedGroup)) {
        // 기존 선택 그룹이 없어졌거나 하면 첫 번째 그룹 선택
        setSelectedGroup(groups[0].id);
      }
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t024')); // pt('t024') -> 공통코드 데이터를 불러오지 못했습니다.
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 미용실 업종을 위한 기본 코드들을 자동으로 생성합니다.
   */
  const setupSalonDefaultCodes = async () => {
    if (!window.confirm(pt('t008'))) return; // pt('t008') -> 미용실 기본 카테고리(커트/파마/염색)를 생성 또는 업데이트하시겠습니까?

    try {
      setIsMutating(true);

      // 1. 그룹 생성 요청
      await invokeDbCommand<{ success: boolean; message: string }>('upsert_common_code_group', {
        group: {
          id: SALON_CATEGORY_GROUP_ID,
          name: '미용실 카테고리',
          desc: '미용실 기본 시술 카테고리(커트/파마/염색)',
          display_order: 1,
        },
      });

      // 2. 상세 코드들 하나씩 생성 (순차적 처리)
      for (const item of SALON_CATEGORY_CODES) {
        await invokeDbCommand<{ success: boolean; message: string }>('upsert_common_code_detail', {
          detail: {
            group_id: SALON_CATEGORY_GROUP_ID,
            code: item.code,
            name: item.name,
            sort_order: item.order,
            use_yn: 'Y',
          },
        });
      }

      await loadCommonCodeData();
      setSelectedGroup(SALON_CATEGORY_GROUP_ID);
      alert(pt('t007')); // pt('t007') -> 미용실 기본 카테고리 코드가 반영되었습니다.
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t025')); // pt('t025') -> 미용실 기본 카테고리 생성에 실패했습니다.
    } finally {
      setIsMutating(false);
    }
  };

  /**
   * 컴포넌트 마운트 시 데이터 로드
   */
  useEffect(() => {
    loadCommonCodeData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 그룹 등록/수정 처리 핸들러
   * @param e 폼 이벤트
   */
  const handleGroupSubmit = async (e: React.FormEvent) => {
    // e.preventDefault(): 전송 버튼 클릭 시 페이지가 새로고침되는 브라우저 기본 동작을 차단
    e.preventDefault();
    if (!currentGroup) return;

    // 필수값 검증
    if (!currentGroup.id.trim() || !currentGroup.name.trim()) {
      alert(pt('t002')); // pt('t002') -> 그룹 ID와 그룹명은 필수입니다.
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
      setIsGroupModalOpen(false); // 성공 시 모달 닫기
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t026')); // pt('t026') -> 그룹 저장에 실패했습니다.
    } finally {
      setIsMutating(false);
    }
  };

  /**
   * 선택된 그룹 삭제 핸들러
   * @param groupId 삭제할 그룹 ID
   */
  const deleteGroup = async (groupId: string) => {
    if (!window.confirm(pt('t016'))) return; // pt('t016') -> 선택한 그룹과 포함된 상세코드를 모두 삭제하시겠습니까?
    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('delete_common_code_group', {
        group_id: groupId,
      });
      await loadCommonCodeData();
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t027')); // pt('t027') -> 그룹 삭제에 실패했습니다.
    } finally {
      setIsMutating(false);
    }
  };

  /**
   * 상세 코드 등록/수정 처리 핸들러
   * @param e 폼 이벤트
   */
  const handleCodeSubmit = async (e: React.FormEvent) => {
    // e.preventDefault(): 폼 제출 시의 기본 페이지 리로드 동작을 막음
    e.preventDefault();
    if (!currentCode) return;

    // 소속 그룹이 선택되어 있는지 먼저 확인
    if (!selectedGroup) {
      alert(pt('t005')); // pt('t005') -> 먼저 그룹을 선택해주세요.
      return;
    }

    // 필수 데이터 확인
    if (!currentCode.code.trim() || !currentCode.name.trim()) {
      alert(pt('t015')); // pt('t015') -> 상세코드와 상세코드명은 필수입니다.
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
      setIsCodeModalOpen(false); // 저장 후 모달 닫기
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t028')); // pt('t028') -> 상세코드 저장에 실패했습니다.
    } finally {
      setIsMutating(false);
    }
  };

  /**
   * 특정 상세 코드 삭제 핸들러
   * @param codeId 삭제할 코드 아이디
   */
  const deleteCode = async (codeId: string) => {
    if (!window.confirm(pt('t017'))) return; // pt('t017') -> 선택한 상세코드를 삭제하시겠습니까?
    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>('delete_common_code_detail', {
        group_id: selectedGroup,
        code: codeId,
      });
      await loadCommonCodeData();
      alert(result.message);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t029')); // pt('t029') -> 상세코드 삭제에 실패했습니다.
    } finally {
      setIsMutating(false);
    }
  };

  return (
    /**
     * motion.div: 페이지 진입 시 페이드 인 애니메이션 적용
     */
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <LoadingOverlay visible={isDbBusy} />

      {/* 페이지 헤더: 타이틀과 작업 버튼 */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            {pt('t030')} {/* pt('t030') -> 공통 코드 관리 */}
          </h1>
          <p className="text-slate-500 mt-1">
            {pt('t018')} {/* pt('t018') -> 시스템에서 공통으로 사용하는 그룹코드/상세코드를 관리합니다. */}
          </p>
        </div>

        <div className="flex gap-2">
          {/* 미용실 기본 카테고리 일괄 생성 버튼 */}
          <button
            disabled={isMutating}
            onClick={setupSalonDefaultCodes}
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-slate-800/10 disabled:opacity-60"
          >
            <Scissors size={18} />
            {pt('t031')} {/* pt('t031') -> 미용실 기본 코드 생성 */}
          </button>

          {/* 그룹 추가 모달 열기 버튼 */}
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
            {pt('t032')} {/* pt('t032') -> 코드 그룹 추가 */}
          </button>
        </div>
      </div>

      {/* 메인 컨텐츠: 2컬럼 레이아웃 (그룹 목록 | 상세 코드 목록) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* 좌측: 코드 그룹 목록 (4컬럼) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <Database size={16} className="text-primary" />
                {pt('t033')} {/* pt('t033') -> 코드 그룹 */}
              </h3>
              <button
                onClick={loadCommonCodeData}
                className="text-xs text-primary font-bold hover:underline disabled:opacity-50 flex items-center gap-1"
                disabled={isLoading || isMutating}
              >
                {isLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                {isLoading ? pt('t034') : pt('t035')} {/* pt('t034') -> 불러오는 중... / pt('t035') -> 새로고침 */}
              </button>
            </div>

            <div className="p-2 max-h-[600px] overflow-y-auto">
              {codeGroups.length === 0 ? (
                <div className="text-sm text-slate-400 px-3 py-6 text-center">
                  {pt('t004')} {/* pt('t004') -> 등록된 그룹이 없습니다. */}
                </div>
              ) : (
                codeGroups.map((group) => (
                  <div
                    key={group.id}
                    className={`group relative w-full rounded-lg transition-all mb-1 ${selectedGroup === group.id
                        ? 'bg-primary/10 border-primary/20 border text-primary shadow-sm'
                        : 'hover:bg-slate-50 text-slate-600'
                      }`}
                  >
                    {/* 그룹 선택 버튼 */}
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

                    {/* 그룹 수정/삭제 버튼 (호버 시 노출) */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // 버튼 클릭 시 그룹 선택 버튼이 눌리지 않도록 전파 차단
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

        {/* 우측: 상세 코드 목록 테이블 (8컬럼) */}
        <div className="lg:col-span-8">
          <div className="bg-white rounded-xl border border-slate-200 grid-shadow overflow-hidden">
            {/* 테이블 헤더 영역 */}
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Tag size={16} className="text-primary" />
                  {pt('t036')} {/* pt('t036') -> 상세 코드 목록 */}
                </h3>
                <span className="text-xs text-slate-400 font-medium">| {selectedGroup || pt('t037')}</span> {/* pt('t037') -> 선택 없음 */}
              </div>

              {/* 상세 코드 추가 버튼 */}
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
                {pt('t038')} {/* pt('t038') -> 코드 추가 */}
              </button>
            </div>

            {/* 상세 코드 테이블 */}
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900 text-slate-200">
                  <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t021')}</th>{/* pt('t021') -> 코드 */}
                  <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider">{pt('t022')}</th>{/* pt('t022') -> 코드명 */}
                  <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t019')}</th>{/* pt('t019') -> 정렬 */}
                  <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t011')}</th>{/* pt('t011') -> 사용여부 */}
                  <th className="py-3 px-6 font-semibold text-xs uppercase tracking-wider text-center">{pt('t039')}</th>{/* pt('t039') -> 작업 */}
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
                        {/* 사용 여부 뱃지 */}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${code.useYn === 'Y'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-500'
                            }`}
                        >
                          {code.useYn === 'Y' ? pt('t040') : pt('t041')} {/* pt('t040') -> 사용 / pt('t041') -> 미사용 */}
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
                      {pt('t042')} {/* pt('t042') -> 등록된 상세코드가 없습니다. */}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 코드 그룹 등록/수정 모달 */}
      <AnimatePresence>
        {isGroupModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={modalMode === 'create' ? pt('t032') : pt('t043')} // pt('t032') -> 코드 그룹 추가 / pt('t043') -> 코드 그룹 수정
              onClose={() => setIsGroupModalOpen(false)}
              icon={<Database size={20} className="text-primary" />}
            >
              <form onSubmit={handleGroupSubmit} className="p-6 space-y-4">
                {/* 그룹 ID 입력 필드 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                    <Hash size={12} /> {pt('t044')} {/* pt('t044') -> 그룹 ID */}
                  </label>
                  <input
                    type="text"
                    required
                    readOnly={modalMode === 'edit'} // 수정 모드일 때는 ID 변경 불가
                    value={currentGroup?.id || ''}
                    onChange={(e) =>
                      setCurrentGroup((prev) => ({
                        ...(prev || { id: '', name: '', desc: '', displayOrder: 1 }),
                        id: e.target.value.toUpperCase(), // 소문자 입력 시 대문자로 자동 변환
                      }))
                    }
                    className={`w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none ${modalMode === 'edit' ? 'bg-slate-50 text-slate-400' : ''
                      }`}
                    placeholder="GROUP_ID"
                  />
                </div>

                {/* 그룹명 입력 필드 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                    <TypeIcon size={12} /> {pt('t045')} {/* pt('t045') -> 그룹명 */}
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
                    placeholder={pt('t003')} // pt('t003') -> 그룹명을 입력하세요
                  />
                </div>

                {/* 설명 입력 필드 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                    <AlignLeft size={12} /> {pt('t046')} {/* pt('t046') -> 설명 */}
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
                    placeholder={pt('t001')} // pt('t001') -> 그룹 설명을 입력하세요
                  />
                </div>

                {/* 정렬 순서 입력 필드 */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t023')}</label> {/* pt('t023') -> 표시 순서 */}
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

                {/* 하단 취소/저장 버튼 */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsGroupModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    {pt('t047')} {/* pt('t047') -> 취소 */}
                  </button>
                  <button
                    type="submit"
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                  >
                    {modalMode === 'create' ? pt('t048') : pt('t049')} {/* pt('t048') -> 생성 / pt('t049') -> 수정 */}
                  </button>
                </div>
              </form>
            </DraggableModal>
          </div>
        )}
      </AnimatePresence>

      {/* 상세 코드 등록/수정 모달 */}
      <AnimatePresence>
        {isCodeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <DraggableModal
              title={modalMode === 'create' ? pt('t050') : pt('t051')} // pt('t050') -> 상세 코드 추가 / pt('t051') -> 상세 코드 수정
              onClose={() => setIsCodeModalOpen(false)}
              icon={<Tag size={20} className="text-primary" />}
            >
              <form onSubmit={handleCodeSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">

                  {/* 상세 코드 ID */}
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">
                      {pt('t012')} {/* pt('t012') -> 상세코드 */}
                    </label>
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
                      className={`w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none ${modalMode === 'edit' ? 'bg-slate-50 text-slate-400' : ''
                        }`}
                      placeholder="DETAIL_CODE"
                    />
                  </div>

                  {/* 상세 코드명 */}
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">
                      {pt('t013')} {/* pt('t013') -> 상세코드명 */}
                    </label>
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
                      placeholder={pt('t014')} // pt('t014') -> 상세코드명을 입력하세요
                    />
                  </div>

                  {/* 정렬 순서 */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">
                      {pt('t020')} {/* pt('t020') -> 정렬 순서 */}
                    </label>
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

                  {/* 사용 여부 선택 */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">
                      {pt('t010')} {/* pt('t010') -> 사용 여부 */}
                    </label>
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
                      <option value="Y">{pt('t009')}</option> {/* pt('t009') -> 사용 (Y) */}
                      <option value="N">{pt('t006')}</option> {/* pt('t006') -> 미사용 (N) */}
                    </select>
                  </div>
                </div>

                {/* 하단 버튼 군 */}
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsCodeModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    {pt('t047')} {/* pt('t047') -> 취소 */}
                  </button>
                  <button
                    type="submit"
                    disabled={isMutating}
                    className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-60"
                  >
                    {modalMode === 'create' ? pt('t048') : pt('t049')} {/* pt('t048') -> 생성 / pt('t049') -> 수정 */}
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
 * 드래그 가능한 모달 컴포넌트
 */
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
  /**
   * useDragControls: Framer Motion의 드래그를 수동으로 제어
   */
  const dragControls = useDragControls();

  return (
    /**
     * motion.div: 드래그 기능 및 진입/퇴장 애니메이션 적용
     */
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false} // 헤더를 통해서만 드래그 가능하게 설정
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative"
    >
      {/* 모달 상부: 타이틀 및 드래그 핸들 */}
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
      {/* 컨텐츠 영역 */}
      {children}
    </motion.div>
  );
}
