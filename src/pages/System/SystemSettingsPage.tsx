import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { DB_CONNECTION } from '../../config/dbConfig';
import { invokeDbCommand, invokeDbConnectionTest } from '../../lib/dbClient';
import { usePageText } from '../../i18n/usePageText';
import {
  DEFAULT_SYSTEM_TYPE_CODE,
  normalizeSystemTypeCode,
  SYSTEM_TYPE_GROUP_ID,
  SYSTEM_TYPE_STORAGE_KEY,
} from '../../constants/systemType';
import {
  DEFAULT_STORE_CODE,
  normalizeStoreCode,
  STORE_CODE_GROUP_ID,
  STORE_CODE_STORAGE_KEY,
} from '../../constants/store';
import { 
  Monitor, 
  Database, 
  Download, 
  Upload, 
  Save, 
  RefreshCw, 
  Server,
  Maximize,
  ShieldCheck,
  Layout,
  Type as TypeIcon,
  Image as ImageIcon,
  CalendarDays,
  Scissors,
  Users,
  Briefcase,
  CreditCard,
  History,
  TrendingUp,
  Trash2,
} from 'lucide-react';

type CodeDetailRow = {
  group: string;
  code: string;
  name: string;
  order: number;
  use_yn: 'Y' | 'N';
};

type SystemTypeOption = {
  code: string;
  name: string;
  order: number;
};

type StoreOption = {
  code: string;
  name: string;
  order: number;
};

type ResetSalonDataTarget =
  | 'SALES'
  | 'RESERVATION'
  | 'SERVICE_CATALOG'
  | 'MEMBER'
  | 'EMPLOYEE'
  | 'MEMBER_POINT'
  | 'POINT_USAGE_HISTORY';

export default function SystemSettingsPage() {
  const pt = usePageText('system_system_settings');
  const [windowSize, setWindowSize] = useState('1920x1080');
  const [dbHost, setDbHost] = useState(DB_CONNECTION.host);
  const [dbPort, setDbPort] = useState(String(DB_CONNECTION.port));
  const [dbName, setDbName] = useState(DB_CONNECTION.database);
  const [dbUser, setDbUser] = useState(DB_CONNECTION.username);
  const [dbPassword, setDbPassword] = useState(DB_CONNECTION.password);
  const [dbSchema, setDbSchema] = useState(DB_CONNECTION.schema);
  const [isRemoteDb, setIsRemoteDb] = useState(true);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isRunningIntegrityCheck, setIsRunningIntegrityCheck] = useState(false);
  
  // Brand Settings
  const [programName, setProgramName] = useState(localStorage.getItem('programName') || 'GovData');
  const [logoUrl, setLogoUrl] = useState(localStorage.getItem('logoUrl') || '');
  const [systemTypeOptions, setSystemTypeOptions] = useState<SystemTypeOption[]>([]);
  const [selectedSystemType, setSelectedSystemType] = useState(
    normalizeSystemTypeCode(localStorage.getItem(SYSTEM_TYPE_STORAGE_KEY)),
  );
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([]);
  const [selectedStoreCode, setSelectedStoreCode] = useState(
    normalizeStoreCode(localStorage.getItem(STORE_CODE_STORAGE_KEY)),
  );
  const [resettingTarget, setResettingTarget] = useState<ResetSalonDataTarget | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const resetActions: Array<{
    target: ResetSalonDataTarget;
    label: string;
    description: string;
    icon: React.ReactNode;
  }> = [
    {
      target: 'SALES',
      label: '매출데이터',
      description: '시술 정산/결제 데이터를 초기화합니다.',
      icon: <TrendingUp size={16} />,
    },
    {
      target: 'RESERVATION',
      label: '예약데이터',
      description: '예약 캘린더 데이터를 초기화합니다.',
      icon: <CalendarDays size={16} />,
    },
    {
      target: 'SERVICE_CATALOG',
      label: '시술항목 데이터',
      description: '시술 카탈로그(메뉴) 데이터를 초기화합니다. (연관 예약/매출이 있으면 차단)',
      icon: <Scissors size={16} />,
    },
    {
      target: 'MEMBER',
      label: '회원데이터',
      description: '회원 기본 데이터를 초기화합니다. (연관 포인트 데이터 포함)',
      icon: <Users size={16} />,
    },
    {
      target: 'EMPLOYEE',
      label: '직원데이터',
      description: '직원 관리 데이터를 초기화합니다.',
      icon: <Briefcase size={16} />,
    },
    {
      target: 'MEMBER_POINT',
      label: '회원포인트 데이터',
      description: '회원 포인트 잔액/충전내역을 초기화합니다.',
      icon: <CreditCard size={16} />,
    },
    {
      target: 'POINT_USAGE_HISTORY',
      label: '포인트사용내역 데이터',
      description: '회원 포인트 사용내역을 초기화합니다.',
      icon: <History size={16} />,
    },
  ];

  const loadSystemTypeOptions = async () => {
    try {
      const result = await invokeDbCommand<{
        success: boolean;
        message: string;
        details: CodeDetailRow[];
      }>('get_common_code_management_data');

      const options = (result.details || [])
        .filter((detail) => detail.group === SYSTEM_TYPE_GROUP_ID && detail.use_yn === 'Y')
        .map((detail) => ({
          code: detail.code,
          name: detail.name,
          order: detail.order,
        }))
        .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code));

      setSystemTypeOptions(options);

      if (options.length > 0) {
        const normalized = normalizeSystemTypeCode(selectedSystemType);
        if (!options.some((item) => item.code === normalized)) {
          setSelectedSystemType(options[0].code);
        }
      }

      const loadedStores = (result.details || [])
        .filter((detail) => detail.group === STORE_CODE_GROUP_ID && detail.use_yn === 'Y')
        .map((detail) => ({
          code: detail.code,
          name: detail.name,
          order: detail.order,
        }))
        .sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code));

      setStoreOptions(loadedStores);

      if (loadedStores.length > 0) {
        const normalizedStore = normalizeStoreCode(selectedStoreCode);
        if (!loadedStores.some((item) => item.code === normalizedStore)) {
          const hairStore = loadedStores.find((item) => item.code === DEFAULT_STORE_CODE);
          setSelectedStoreCode(hairStore?.code || loadedStores[0].code);
        }
      } else {
        setSelectedStoreCode(DEFAULT_STORE_CODE);
      }
    } catch (error) {
      console.error('Failed to load SYSTEM_TYPE common codes:', error);
      setSystemTypeOptions([]);
      setStoreOptions([]);
      setSelectedStoreCode(DEFAULT_STORE_CODE);
    }
  };

  useEffect(() => {
    loadSystemTypeOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBackup = () => {
    alert(pt('t007'));
  };

  const handleRestore = () => {
    alert(pt('t013'));
  };

  const handleSave = async () => {
    try {
      setIsSavingSettings(true);
      const resolvedStoreCode = normalizeStoreCode(selectedStoreCode);
      await invokeDbCommand<{
        success: boolean;
        message: string;
      }>('verify_or_register_store_binding', {
        store_code: resolvedStoreCode,
      });

      localStorage.setItem('programName', programName);
      localStorage.setItem('logoUrl', logoUrl);
      localStorage.setItem(SYSTEM_TYPE_STORAGE_KEY, normalizeSystemTypeCode(selectedSystemType));
      localStorage.setItem(STORE_CODE_STORAGE_KEY, resolvedStoreCode);
      window.dispatchEvent(new Event('system-type-updated'));
      window.dispatchEvent(new Event('store-code-updated'));
      alert(pt('t021'));
      window.location.reload();
    } catch (error: any) {
      const message =
        typeof error === 'string'
          ? error
          : error?.message || '점포코드 인증에 실패하여 저장할 수 없습니다.';
      alert(message);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleTestDbConnection = async () => {
    try {
      setIsTestingConnection(true);
      const result = await invokeDbConnectionTest<{
        success: boolean;
        message: string;
        current_schema: string;
        server_version: string;
      }>({
        host: dbHost.trim(),
        port: Number(dbPort),
        database: dbName.trim(),
        username: dbUser.trim(),
        password: dbPassword,
        schema: dbSchema.trim(),
      });

      alert(
        `${result.message}\nSchema: ${result.current_schema}\nVersion: ${result.server_version.split('\n')[0]}`,
      );
    } catch (error: any) {
      const message =
        typeof error === 'string'
          ? error
          : error?.message || 'DB 연결 테스트 중 오류가 발생했습니다.';
      alert(message);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleRunDbIntegrityCheck = async () => {
    try {
      setIsRunningIntegrityCheck(true);
      const result = await invokeDbCommand<{
        success: boolean;
        message: string;
      }>('run_db_integrity_check', {
        connection: {
          host: dbHost.trim(),
          port: Number(dbPort),
          database: dbName.trim(),
          username: dbUser.trim(),
          password: dbPassword,
          schema: dbSchema.trim(),
        },
      });

      alert(result.message || 'DB 무결성검사가 완료되었습니다.');
    } catch (error: any) {
      const message =
        typeof error === 'string'
          ? error
          : error?.message || 'DB 무결성검사 중 오류가 발생했습니다.';
      alert(message);
    } finally {
      setIsRunningIntegrityCheck(false);
    }
  };

  const handleResetSalonData = async (target: ResetSalonDataTarget, label: string) => {
    const storeCode = normalizeStoreCode(selectedStoreCode);
    const shouldReset = window.confirm(
      `[${storeCode}] 점포의 ${label}를 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
    );
    if (!shouldReset) return;

    try {
      setResettingTarget(target);
      const result = await invokeDbCommand<{
        success: boolean;
        message: string;
      }>('reset_salon_data', {
        target,
        store_code: storeCode,
      });

      alert(result.message || `${label} 초기화 완료`);
    } catch (error: any) {
      const message =
        typeof error === 'string'
          ? error
          : error?.message || `${label} 초기화 중 오류가 발생했습니다.`;
      alert(message);
    } finally {
      setResettingTarget(null);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-4xl"
    >
      <div className="mb-8">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t023')}</h1>
        <p className="text-slate-500 mt-1">{pt('t031')}</p>
      </div>

      <div className="space-y-6">
        {/* 브랜드 및 UI 설정 */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Layout size={18} className="text-primary" />
            <h2 className="font-bold text-slate-800">{pt('t016')}</h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <TypeIcon size={14} />
                  프로그램 명칭
                </label>
                <input 
                  type="text" 
                  value={programName}
                  onChange={(e) => setProgramName(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder={pt('t030')} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <ImageIcon size={14} />
                  사이드바 로고 이미지 URL
                </label>
                <input 
                  type="text" 
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder={pt('t025')} />
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <p className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">{pt('t012')}</p>
              <div className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg w-fit min-w-[200px]">
                <div className="bg-primary p-1.5 rounded-lg text-white size-9 flex items-center justify-center overflow-hidden">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <Database size={20} />
                  )}</div>
                <span className="text-lg font-bold tracking-tight text-slate-900">{programName}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">{pt('t033')}</label>
              <select
                value={selectedStoreCode}
                onChange={(e) => setSelectedStoreCode(normalizeStoreCode(e.target.value))} className="w-full max-w-sm px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              >
                {storeOptions.length === 0 && <option value={DEFAULT_STORE_CODE}>HAIR_001</option>}
                {storeOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name} ({option.code})
                  </option>
                ))}</select>
              <p className="text-xs text-slate-400">
                모든 데이터 저장/조회는 선택한 점포코드 기준으로 처리됩니다.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">{pt('t032')}</label>
              <select
                value={selectedSystemType}
                onChange={(e) => setSelectedSystemType(normalizeSystemTypeCode(e.target.value))} className="w-full max-w-sm px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              >
                {systemTypeOptions.length === 0 && <option value={DEFAULT_SYSTEM_TYPE_CODE}>{pt('t004')}</option>}
                {systemTypeOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name} ({option.code})
                  </option>
                ))}</select>
              <p className="text-xs text-slate-400">
                저장 후 사이드바 메뉴가 선택한 시스템 타입 기준으로 필터링됩니다.
              </p>
            </div>
          </div>
        </section>

        {/* 프로그램 실행 설정 */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Monitor size={18} className="text-primary" />
            <h2 className="font-bold text-slate-800">{pt('t029')}</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Maximize size={14} />
                기본 창 크기 설정 (프로그램 시작 시)
              </label>
              <select 
                value={windowSize}
                onChange={(e) => setWindowSize(e.target.value)} className="w-full max-w-xs px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              >
                <option value="1280x720">{pt('t001')}</option>
                <option value="1600x900">{pt('t002')}</option>
                <option value="1920x1080">{pt('t003')}</option>
                <option value="fullscreen">{pt('t026')}</option>
              </select>
              <p className="text-xs text-slate-400">{pt('t020')}</p>
            </div>
          </div>
        </section>

        {/* 데이터베이스 설정 */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Server size={18} className="text-primary" />
            <h2 className="font-bold text-slate-800">{pt('t009')}</h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-700">{pt('t024')}</p>
                <p className="text-xs text-slate-400">{pt('t011')}</p>
              </div>
              <button 
                onClick={() => setIsRemoteDb(!isRemoteDb)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isRemoteDb ? 'bg-primary' : 'bg-slate-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isRemoteDb ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {isRemoteDb && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t019')}</label>
                  <input 
                    type="text" 
                    value={dbHost}
                    onChange={(e) => setDbHost(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="example.com"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t028')}</label>
                  <input 
                    type="text" 
                    value={dbPort}
                    onChange={(e) => setDbPort(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="5432"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t010')}</label>
                  <input
                    type="text"
                    value={dbName}
                    onChange={(e) => setDbName(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="postgres"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t018')}</label>
                  <input
                    type="text"
                    value={dbUser}
                    onChange={(e) => setDbUser(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="postgres"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t017')}</label>
                  <input
                    type="password"
                    value={dbPassword}
                    onChange={(e) => setDbPassword(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="password"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">{pt('t022')}</label>
                  <input
                    type="text"
                    value={dbSchema}
                    onChange={(e) => setDbSchema(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="czr_ami"
                  />
                </div>
              </div>
            )}<div className="flex justify-end gap-2">
              <button
                onClick={handleRunDbIntegrityCheck}
                disabled={isRunningIntegrityCheck}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-700 text-white text-sm font-bold rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <ShieldCheck size={16} className={isRunningIntegrityCheck ? 'animate-pulse' : ''} />
                {isRunningIntegrityCheck ? '무결성검사 중...' : 'DB 무결성검사'}
              </button>
              <button
                onClick={handleTestDbConnection}
                disabled={isTestingConnection}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-bold rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <RefreshCw size={16} className={isTestingConnection ? 'animate-spin' : ''} />
                {isTestingConnection ? '테스트 중...' : '연결 테스트'}
              </button>
            </div>
          </div>
        </section>

        {/* 미용실 데이터 초기화 */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-rose-50 flex items-center gap-2">
            <Trash2 size={18} className="text-rose-700" />
            <h2 className="font-bold text-slate-800">미용실 데이터 초기화</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="p-4 rounded-lg bg-rose-50 border border-rose-100 text-rose-700 text-sm">
              선택한 점포코드(<span className="font-bold">{normalizeStoreCode(selectedStoreCode)}</span>) 기준으로
              데이터가 즉시 삭제됩니다.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {resetActions.map((action) => (
                <div
                  key={action.target}
                  className="p-4 border border-slate-200 rounded-xl bg-white flex flex-col gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="size-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                      {action.icon}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{action.label}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{action.description}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleResetSalonData(action.target, action.label)}
                    disabled={resettingTarget !== null}
                    className="w-full py-2 bg-white border border-rose-200 text-rose-700 text-sm font-bold rounded-lg hover:bg-rose-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {resettingTarget === action.target ? '초기화 중...' : `${action.label} 초기화`}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 데이터 백업 및 복구 */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Database size={18} className="text-primary" />
            <h2 className="font-bold text-slate-800">{pt('t006')}</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 border border-slate-100 rounded-xl bg-slate-50/50">
                <div className="flex items-center gap-3 mb-4">
                  <div className="size-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <Download size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">{pt('t005')}</h3>
                    <p className="text-xs text-slate-400">{pt('t034')}</p>
                  </div>
                </div>
                <button 
                  onClick={handleBackup}
                  className="w-full py-2 bg-white border border-emerald-200 text-emerald-700 text-sm font-bold rounded-lg hover:bg-emerald-50 transition-colors flex items-center justify-center gap-2"
                >
                  백업 파일 생성
                </button>
              </div>

              <div className="p-4 border border-slate-100 rounded-xl bg-slate-50/50">
                <div className="flex items-center gap-3 mb-4">
                  <div className="size-10 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
                    <Upload size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">{pt('t008')}</h3>
                    <p className="text-xs text-slate-400">{pt('t014')}</p>
                  </div>
                </div>
                <button 
                  onClick={handleRestore}
                  className="w-full py-2 bg-white border border-amber-200 text-amber-700 text-sm font-bold rounded-lg hover:bg-amber-50 transition-colors flex items-center justify-center gap-2"
                >
                  백업 파일 불러오기
                </button>
              </div>
            </div>
            <div className="mt-6 p-4 rounded-lg bg-blue-50 border border-blue-100 flex items-start gap-3">
              <ShieldCheck className="text-blue-500 mt-0.5" size={18} />
              <div>
                <p className="text-xs font-bold text-blue-800">{pt('t015')}</p>
                <p className="text-[11px] text-blue-600 mt-0.5">{pt('t027')}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-3 pt-4">
          <button className="px-6 py-2.5 bg-slate-200 text-slate-700 text-sm font-bold rounded-lg hover:bg-slate-300 transition-colors">
            초기화
          </button>
          <button 
            onClick={handleSave}
            disabled={isSavingSettings}
            className="px-6 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Save size={18} />
            {isSavingSettings ? '저장중...' : '설정 저장'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
