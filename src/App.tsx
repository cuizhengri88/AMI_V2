import React, { Suspense, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isTauri } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import DashboardLayout from './layouts/DashboardLayout';
import { invokeDbCommand } from './lib/dbClient';
import { normalizeSystemTypeCode, SYSTEM_TYPE_STORAGE_KEY } from './constants/systemType';
import { normalizeStoreCode, STORE_CODE_STORAGE_KEY } from './constants/store';

// --- React.lazy: 페이지별 코드 스플리팅 (방문 시 동적 로드) ---
// Product (상품관리)
const ProductManagementPage = React.lazy(() => import('./pages/Product/ProductManagementPage'));
const StockManagementPage = React.lazy(() => import('./pages/Product/StockManagementPage'));
const StockHistoryPage = React.lazy(() => import('./pages/Product/StockHistoryPage'));
// Sales (매출관리)
const PurchaseManagementPage = React.lazy(() => import('./pages/Sales/PurchaseManagementPage'));
const SalesStatisticsPage = React.lazy(() => import('./pages/Sales/SalesStatisticsPage'));
const HairSalesStatisticsPage = React.lazy(() => import('./pages/Sales/HairSalesStatisticsPage'));
const ReservationCalendarPage = React.lazy(() => import('./pages/Sales/ReservationCalendarPage'));
const SalesEntryPage = React.lazy(() => import('./pages/Sales/SalesEntryPage'));
const SalesHistoryPage = React.lazy(() => import('./pages/Sales/SalesHistoryPage'));
// UserManagement (회원관리)
const UserManagementPage = React.lazy(() => import('./pages/UserManagement/UserManagementPage'));
const EmployeeManagementPage = React.lazy(() => import('./pages/UserManagement/EmployeeManagementPage'));
const PointRechargePage = React.lazy(() => import('./pages/UserManagement/PointRechargePage'));
const MemberPointHistoryPage = React.lazy(() => import('./pages/UserManagement/MemberPointHistoryPage'));
// System (시스템)
const MenuManagementPage = React.lazy(() => import('./pages/System/MenuManagementPage'));
const CommonCodePage = React.lazy(() => import('./pages/System/CommonCodePage'));
const RoleManagementPage = React.lazy(() => import('./pages/System/RoleManagementPage'));
const SystemSettingsPage = React.lazy(() => import('./pages/System/SystemSettingsPage'));
const ServiceCatalogPage = React.lazy(() => import('./pages/System/ServiceCatalogPage'));

type MenuRow = {
  id: number;
  menu_type: string;
  path: string;
  system_type_code: string;
  is_start_menu: boolean;
  order: number;
  status: string;
};

type StoreBindingStatusResult = {
  success: boolean;
  message: string;
  hwid: string;
  cpu_id: string;
  bound_store_code: string | null;
  registered_at: string | null;
};

type VerifyStoreBindingResult = {
  success: boolean;
  message: string;
  store_code: string;
  hwid: string;
  cpu_id: string;
  registered_at: string;
  is_new_registration: boolean;
};

const STATUS_ACTIVE = '사용중';
const STORE_BINDING_DENIED_MESSAGE = '인증이 거부 되었습니다.';

const ROUTABLE_PATHS = new Set<string>([
  // --- Product (상품관리) ---
  '/products',                // 상품 관리
  '/products/stock',          // 재고 관리
  '/products/stock-history',  // 재고 이력
  '/products/service-catalog',  // 시술항목 관리
  // --- Sales (매출관리) ---
  '/sales/purchases',         // 매입 관리
  '/sales/statistics',        // 매출 통계
  '/sales/hair-statistics',   // 시술 매출 통계
  '/sales/reservations',      // 예약 캘린더
  '/sales/entry',             // 매출 등록
  '/sales/history',           // 매출 내역
  // --- UserManagement (회원관리) ---
  '/users',                   // 회원 관리
  '/users/employees',         // 직원 관리
  '/users/points',            // 포인트 충전
  '/users/point-history',     // 포인트 이력
  // --- System (시스템) ---
  '/system/menu',             // 메뉴 관리
  '/system/code',             // 공통코드 관리
  '/system/role',             // 권한 관리
  '/system/settings',         // 시스템 설정
]);

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '요청 처리 중 오류가 발생했습니다.';
}

function resolveDefaultPath(menus: MenuRow[], selectedSystemType: string): string {
  const activeMenus = (menus || [])
    .filter((menu) => (menu.status || '').trim() === STATUS_ACTIVE)
    .sort((a, b) => (Number(a.order) - Number(b.order)) || (a.id - b.id));

  const startMenuPath = activeMenus
    .filter((menu) => Boolean(menu.is_start_menu))
    .filter((menu) => ROUTABLE_PATHS.has(menu.path))
    .sort((a, b) => {
      const aPriority = normalizeSystemTypeCode(a.system_type_code) === selectedSystemType ? 0 : 1;
      const bPriority = normalizeSystemTypeCode(b.system_type_code) === selectedSystemType ? 0 : 1;
      return (aPriority - bPriority) || (Number(a.order) - Number(b.order)) || (a.id - b.id);
    })
    .map((menu) => menu.path)[0];

  if (startMenuPath) return startMenuPath;

  const firstSubPath = activeMenus
    .filter((menu) => menu.menu_type?.trim().toUpperCase() === 'SUB')
    .map((menu) => menu.path)
    .find((path) => ROUTABLE_PATHS.has(path));

  if (firstSubPath) return firstSubPath;

  const firstKnownPath = activeMenus
    .map((menu) => menu.path)
    .find((path) => ROUTABLE_PATHS.has(path));

  return firstKnownPath || '/users';
}

function MenuAwareRedirect() {
  const [targetPath, setTargetPath] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadTargetPath = async () => {
      try {
        const selectedSystemType = normalizeSystemTypeCode(localStorage.getItem(SYSTEM_TYPE_STORAGE_KEY));
        const result = await invokeDbCommand<{
          success: boolean;
          message: string;
          menus: MenuRow[];
        }>('get_menu_management_data', {
          system_type_code: selectedSystemType,
        });

        if (!isMounted) return;
        setTargetPath(resolveDefaultPath(result.menus || [], selectedSystemType));
      } catch (error) {
        console.error('Failed to resolve initial route from menu data:', error);
        if (!isMounted) return;
        setTargetPath('/users');
      }
    };

    loadTargetPath();

    return () => {
      isMounted = false;
    };
  }, []);

  if (!targetPath) return null;
  return <Navigate to={targetPath} replace />;
}

function StoreBindingGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<'checking' | 'input' | 'verifying' | 'ready' | 'denied'>('checking');
  const [storeCodeInput, setStoreCodeInput] = useState('');
  const [cdkeyInput, setCdkeyInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const hasCheckedUpdateRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const checkBindingStatus = async () => {
      try {
        const result = await invokeDbCommand<StoreBindingStatusResult>('get_store_binding_status');
        if (!isMounted) return;

        const boundStoreCode = (result.bound_store_code || '').trim();
        if (boundStoreCode) {
          const normalized = normalizeStoreCode(boundStoreCode);
          localStorage.setItem(STORE_CODE_STORAGE_KEY, normalized);
          window.dispatchEvent(new Event('store-code-updated'));
          setPhase('ready');
          return;
        }

        const storedCode = localStorage.getItem(STORE_CODE_STORAGE_KEY);
        setStoreCodeInput((storedCode || '').trim().toUpperCase());
        setPhase('input');
      } catch (error) {
        if (!isMounted) return;
        const message = getErrorMessage(error);
        setErrorMessage(message);
        setStoreCodeInput((localStorage.getItem(STORE_CODE_STORAGE_KEY) || '').trim().toUpperCase());
        if (message.includes(STORE_BINDING_DENIED_MESSAGE)) {
          setPhase('denied');
          return;
        }
        setPhase('input');
      }
    };

    checkBindingStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'ready' || hasCheckedUpdateRef.current || !isTauri()) {
      return;
    }

    hasCheckedUpdateRef.current = true;
    let isDisposed = false;

    const runUpdateCheck = async () => {
      let update: Awaited<ReturnType<typeof check>> = null;
      try {
        update = await check();
        if (!update || isDisposed) return;

        const confirmed = window.confirm(
          `A new update is available.\nCurrent version: ${update.currentVersion}\nLatest version: ${update.version}\nInstall now?`,
        );
        if (!confirmed || isDisposed) return;

        await update.downloadAndInstall();
        if (isDisposed) return;

        window.alert('Update installed. Please restart the app to apply the new version.');
      } catch (error) {
        console.error('Failed to check or install update:', error);
      } finally {
        await update?.close().catch(() => undefined);
      }
    };

    runUpdateCheck();

    return () => {
      isDisposed = true;
    };
  }, [phase]);

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedStoreCode = storeCodeInput.trim().toUpperCase();
    if (!normalizedStoreCode) {
      setErrorMessage('점포코드를 입력해 주세요.');
      return;
    }
    const normalizedCdkey = cdkeyInput.trim().toUpperCase();
    if (!normalizedCdkey) {
      setErrorMessage('CDKEY를 입력해 주세요.');
      return;
    }

    try {
      setErrorMessage('');
      setPhase('verifying');
      const result = await invokeDbCommand<VerifyStoreBindingResult>('verify_or_register_store_binding', {
        store_code: normalizedStoreCode,
        cdkey: normalizedCdkey,
      });
      const resolvedStoreCode = normalizeStoreCode(result.store_code);
      localStorage.setItem(STORE_CODE_STORAGE_KEY, resolvedStoreCode);
      window.dispatchEvent(new Event('store-code-updated'));
      setPhase('ready');
    } catch (error) {
      const message = getErrorMessage(error);
      setErrorMessage(message);
      setPhase(message.includes(STORE_BINDING_DENIED_MESSAGE) ? 'denied' : 'input');
    }
  };

  if (phase === 'ready') return <>{children}</>;
  if (phase === 'checking') {
    return (
      <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_20%_20%,#dbeafe_0%,#e2e8f0_45%,#f8fafc_100%)] flex items-center justify-center p-6">
        <div className="relative w-full max-w-lg rounded-3xl border border-slate-200/80 bg-white/85 backdrop-blur-xl shadow-2xl shadow-slate-900/10 px-8 py-10">
          <div className="absolute -top-20 -right-20 size-40 rounded-full bg-sky-200/40 blur-2xl" />
          <div className="absolute -bottom-16 -left-10 size-32 rounded-full bg-blue-200/50 blur-2xl" />
          <div className="relative">
            <div className="mx-auto size-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center mb-5">
              <div className="size-6 rounded-full border-2 border-white border-t-transparent animate-spin" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 text-center">시스템 인증 중...</h1>
            <p className="text-sm text-slate-500 text-center mt-2">시스템 정보를 확인하고 있습니다. 잠시만 기다려 주세요.</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'denied') {
    return (
      <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_20%_20%,#dbeafe_0%,#e2e8f0_45%,#f8fafc_100%)] flex items-center justify-center p-6">
        <div className="relative w-full max-w-lg rounded-3xl border border-rose-200/80 bg-white/90 backdrop-blur-xl shadow-2xl shadow-slate-900/10 overflow-hidden">
          <div className="relative px-7 py-6 border-b border-rose-100/90">
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-bold text-rose-700">
              ACCESS BLOCKED
            </div>
            <h1 className="text-2xl font-black text-slate-900 mt-3 tracking-tight">{STORE_BINDING_DENIED_MESSAGE}</h1>
            <p className="text-sm text-slate-500 mt-1">관리자에게 문의해 주세요.</p>
          </div>
          {errorMessage ? (
            <div className="relative px-7 py-5 text-sm text-rose-700 bg-rose-50/80 border-t border-rose-100">
              {errorMessage}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_20%_20%,#dbeafe_0%,#e2e8f0_45%,#f8fafc_100%)] flex items-center justify-center p-6">
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-200/80 bg-white/90 backdrop-blur-xl shadow-2xl shadow-slate-900/10 overflow-hidden">
        <div className="absolute -top-24 -right-20 size-52 rounded-full bg-sky-200/45 blur-2xl" />
        <div className="absolute -bottom-24 -left-20 size-56 rounded-full bg-indigo-200/35 blur-2xl" />

        <div className="relative px-7 py-6 border-b border-slate-100/90">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-bold text-sky-700">
            <span className="size-2 rounded-full bg-sky-500 animate-pulse" />
            LICENSE SECURITY
          </div>
          <h1 className="text-2xl font-black text-slate-900 mt-3 tracking-tight">점포코드 인증</h1>
          <p className="text-sm text-slate-500 mt-1">최초 실행 시 STR_CD(점포관리) 점포코드와 CDKEY를 입력해 장치를 인증합니다.</p>
        </div>

        <div className="relative px-7 py-6">
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-xs font-extrabold tracking-wide text-slate-500 uppercase mb-1">점포코드 (STR_CD)</label>
              <input
                type="text"
                value={storeCodeInput}
                onChange={(e) => setStoreCodeInput(e.target.value.toUpperCase())}
                className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 bg-white/90 focus:ring-2 focus:ring-sky-200 outline-none"
                placeholder="예: HAIR_001"
                disabled={phase === 'verifying'}
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold tracking-wide text-slate-500 uppercase mb-1">CDKEY</label>
              <input
                type="text"
                value={cdkeyInput}
                onChange={(e) => setCdkeyInput(e.target.value.toUpperCase())}
                className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 bg-white/90 focus:ring-2 focus:ring-sky-200 outline-none"
                placeholder="예: A1B2-C3D4-E5F6-G7H8"
                disabled={phase === 'verifying'}
              />
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700">
              시스템정보 확인 완료
            </div>

            {errorMessage ? (
              <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={phase === 'verifying'}
              className="w-full h-11 rounded-xl bg-slate-900 text-white text-sm font-black tracking-wide hover:bg-slate-800 transition-colors disabled:opacity-70"
            >
              {phase === 'verifying' ? '시스템 인증 중...' : '인증 후 시작'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreBindingGate>
      <BrowserRouter>
        <Suspense fallback={
          <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <div className="size-8 rounded-full border-3 border-slate-200 border-t-primary animate-spin" />
          </div>
        }>
          <Routes>
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<MenuAwareRedirect />} />
              {/* --- Product (상품관리: pages/Product) --- */}
              <Route path="/products" element={<ProductManagementPage />} />
              <Route path="/products/stock" element={<StockManagementPage />} />
              <Route path="/products/stock-history" element={<StockHistoryPage />} />
              <Route path="/products/service-catalog" element={<ServiceCatalogPage />} />
              {/* --- Sales (매출관리: pages/Sales) --- */}
              <Route path="/sales/purchases" element={<PurchaseManagementPage />} />
              <Route path="/sales/statistics" element={<SalesStatisticsPage />} />
              <Route path="/sales/hair-statistics" element={<HairSalesStatisticsPage />} />
              <Route path="/sales/reservations" element={<ReservationCalendarPage />} />
              <Route path="/sales/entry" element={<SalesEntryPage />} />
              <Route path="/sales/history" element={<SalesHistoryPage />} />
              {/* --- UserManagement (회원관리: pages/UserManagement) --- */}
              <Route path="/users" element={<UserManagementPage />} />
              <Route path="/users/employees" element={<EmployeeManagementPage />} />
              <Route path="/users/points" element={<PointRechargePage />} />
              <Route path="/users/point-history" element={<MemberPointHistoryPage />} />
              {/* --- System (시스템: pages/System) --- */}
              <Route path="/system/menu" element={<MenuManagementPage />} />
              <Route path="/system/code" element={<CommonCodePage />} />
              <Route path="/system/role" element={<RoleManagementPage />} />
              <Route path="/system/settings" element={<SystemSettingsPage />} />
              {/* Fallback */}
              <Route path="*" element={<MenuAwareRedirect />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </StoreBindingGate>
  );
}
