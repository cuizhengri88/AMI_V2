import React, { useState } from 'react';
import { motion } from 'motion/react';
import { DB_CONNECTION } from '../../config/dbConfig';
import { invokeDbConnectionTest } from '../../lib/dbClient';
import { 
  Settings, 
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
  Image as ImageIcon
} from 'lucide-react';

export default function SystemSettingsPage() {
  const [windowSize, setWindowSize] = useState('1920x1080');
  const [dbHost, setDbHost] = useState(DB_CONNECTION.host);
  const [dbPort, setDbPort] = useState(String(DB_CONNECTION.port));
  const [dbName, setDbName] = useState(DB_CONNECTION.database);
  const [dbUser, setDbUser] = useState(DB_CONNECTION.username);
  const [dbPassword, setDbPassword] = useState(DB_CONNECTION.password);
  const [dbSchema, setDbSchema] = useState(DB_CONNECTION.schema);
  const [isRemoteDb, setIsRemoteDb] = useState(true);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  
  // Brand Settings
  const [programName, setProgramName] = useState(localStorage.getItem('programName') || 'GovData');
  const [logoUrl, setLogoUrl] = useState(localStorage.getItem('logoUrl') || '');

  const handleBackup = () => {
    alert('데이터 백업이 시작되었습니다. (backup_20240305.sql)');
  };

  const handleRestore = () => {
    alert('백업 파일 불러오기 창이 활성화됩니다.');
  };

  const handleSave = () => {
    localStorage.setItem('programName', programName);
    localStorage.setItem('logoUrl', logoUrl);
    alert('설정이 저장되었습니다. 페이지를 새로고침하면 적용됩니다.');
    window.location.reload();
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

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-4xl"
    >
      <div className="mb-8">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">시스템 설정</h1>
        <p className="text-slate-500 mt-1">프로그램 환경 및 데이터베이스, 백업 설정을 관리합니다.</p>
      </div>

      <div className="space-y-6">
        {/* 브랜드 및 UI 설정 */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Layout size={18} className="text-primary" />
            <h2 className="font-bold text-slate-800">브랜드 및 UI 설정</h2>
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
                  onChange={(e) => setProgramName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="프로그램 이름을 입력하세요"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <ImageIcon size={14} />
                  사이드바 로고 이미지 URL
                </label>
                <input 
                  type="text" 
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="이미지 URL을 입력하세요 (비워두면 기본 아이콘)"
                />
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <p className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">미리보기</p>
              <div className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg w-fit min-w-[200px]">
                <div className="bg-primary p-1.5 rounded-lg text-white size-9 flex items-center justify-center overflow-hidden">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <Database size={20} />
                  )}
                </div>
                <span className="text-lg font-bold tracking-tight text-slate-900">{programName}</span>
              </div>
            </div>
          </div>
        </section>

        {/* 프로그램 실행 설정 */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Monitor size={18} className="text-primary" />
            <h2 className="font-bold text-slate-800">프로그램 실행 설정</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Maximize size={14} />
                기본 창 크기 설정 (프로그램 시작 시)
              </label>
              <select 
                value={windowSize}
                onChange={(e) => setWindowSize(e.target.value)}
                className="w-full max-w-xs px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
              >
                <option value="1280x720">1280 x 720 (HD)</option>
                <option value="1600x900">1600 x 900</option>
                <option value="1920x1080">1920 x 1080 (FHD)</option>
                <option value="fullscreen">전체 화면 (Full Screen)</option>
              </select>
              <p className="text-xs text-slate-400">설정된 크기는 다음 프로그램 실행 시부터 적용됩니다.</p>
            </div>
          </div>
        </section>

        {/* 데이터베이스 설정 */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Server size={18} className="text-primary" />
            <h2 className="font-bold text-slate-800">데이터베이스(DB) 연결 설정</h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-700">원격 서버(DB) 사용 여부</p>
                <p className="text-xs text-slate-400">로컬 DB 대신 원격지에 있는 데이터베이스를 사용합니다.</p>
              </div>
              <button 
                onClick={() => setIsRemoteDb(!isRemoteDb)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isRemoteDb ? 'bg-primary' : 'bg-slate-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isRemoteDb ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {isRemoteDb && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">서버 호스트 (Host)</label>
                  <input 
                    type="text" 
                    value={dbHost}
                    onChange={(e) => setDbHost(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="example.com"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">포트 (Port)</label>
                  <input 
                    type="text" 
                    value={dbPort}
                    onChange={(e) => setDbPort(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="5432"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">데이터베이스명 (Database)</label>
                  <input
                    type="text"
                    value={dbName}
                    onChange={(e) => setDbName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="postgres"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">사용자명 (User)</label>
                  <input
                    type="text"
                    value={dbUser}
                    onChange={(e) => setDbUser(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="postgres"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">비밀번호 (Password)</label>
                  <input
                    type="password"
                    value={dbPassword}
                    onChange={(e) => setDbPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="password"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">스키마 (Schema)</label>
                  <input
                    type="text"
                    value={dbSchema}
                    onChange={(e) => setDbSchema(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                    placeholder="czr_ami"
                  />
                </div>
              </div>
            )}
            
            <div className="flex justify-end">
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

        {/* 데이터 백업 및 복구 */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Database size={18} className="text-primary" />
            <h2 className="font-bold text-slate-800">데이터 백업 및 복구</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 border border-slate-100 rounded-xl bg-slate-50/50">
                <div className="flex items-center gap-3 mb-4">
                  <div className="size-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <Download size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">데이터 백업</h3>
                    <p className="text-xs text-slate-400">현재 DB 상태를 파일로 저장합니다.</p>
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
                    <h3 className="text-sm font-bold text-slate-800">데이터 복구</h3>
                    <p className="text-xs text-slate-400">백업 파일을 불러와 데이터를 복원합니다.</p>
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
                <p className="text-xs font-bold text-blue-800">보안 권장사항</p>
                <p className="text-[11px] text-blue-600 mt-0.5">정기적인 백업은 데이터 유실을 방지하는 가장 좋은 방법입니다. 백업 파일은 외부 저장소에 보관하는 것을 권장합니다.</p>
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
            className="px-6 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-all flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95"
          >
            <Save size={18} />
            설정 저장
          </button>
        </div>
      </div>
    </motion.div>
  );
}
