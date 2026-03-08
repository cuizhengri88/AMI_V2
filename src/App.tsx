import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayout';
import UserManagementPage from './pages/UserManagement/UserManagementPage';
import EmployeeManagementPage from './pages/UserManagement/EmployeeManagementPage';
import ProductManagementPage from './pages/Product/ProductManagementPage';
import StockManagementPage from './pages/Product/StockManagementPage';
import StockHistoryPage from './pages/Product/StockHistoryPage';
import PurchaseManagementPage from './pages/Sales/PurchaseManagementPage';
import SalesStatisticsPage from './pages/Sales/SalesStatisticsPage';
import HairSalesStatisticsPage from './pages/Sales/HairSalesStatisticsPage';
import MenuManagementPage from './pages/System/MenuManagementPage';
import CommonCodePage from './pages/System/CommonCodePage';
import RoleManagementPage from './pages/System/RoleManagementPage';
import SystemSettingsPage from './pages/System/SystemSettingsPage';
import ServiceCatalogPage from './pages/System/ServiceCatalogPage';
import PointRechargePage from './pages/UserManagement/PointRechargePage';
import MemberPointHistoryPage from './pages/UserManagement/MemberPointHistoryPage';
import ReservationCalendarPage from './pages/UserManagement/ReservationCalendarPage';
import SalesEntryPage from './pages/UserManagement/SalesEntryPage';
import SalesHistoryPage from './pages/UserManagement/SalesHistoryPage';
import { invokeDbCommand } from './lib/dbClient';
import { normalizeSystemTypeCode, SYSTEM_TYPE_STORAGE_KEY } from './constants/systemType';
import { normalizeStoreCode, STORE_CODE_STORAGE_KEY } from './constants/store';

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

const ROUTABLE_PATHS = new Set<string>([
  '/products',
  '/inventory',
  '/inventory/history',
  '/purchases',
  '/sales-stats',
  '/hair_sales-stats',
  '/Hair_sales-stats',
  '/hair-sales-stats',
  '/users',
  '/employees',
  '/system/menu',
  '/system/code',
  '/system/service-catalog',
  '/system/role',
  '/system/settings',
  '/users/points',
  '/users/point-history',
  '/users/reservations',
  '/users/sales',
  '/users/sales-history',
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
  const [phase, setPhase] = useState<'checking' | 'input' | 'verifying' | 'ready'>('checking');
  const [storeCodeInput, setStoreCodeInput] = useState('');
  const [hwid, setHwid] = useState('');
  const [cpuId, setCpuId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    const checkBindingStatus = async () => {
      try {
        const result = await invokeDbCommand<StoreBindingStatusResult>('get_store_binding_status');
        if (!isMounted) return;

        setHwid(result.hwid || '');
        setCpuId(result.cpu_id || '');

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
        setErrorMessage(getErrorMessage(error));
        setStoreCodeInput((localStorage.getItem(STORE_CODE_STORAGE_KEY) || '').trim().toUpperCase());
        setPhase('input');
      }
    };

    checkBindingStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedStoreCode = storeCodeInput.trim().toUpperCase();
    if (!normalizedStoreCode) {
      setErrorMessage('점포코드를 입력해 주세요.');
      return;
    }

    try {
      setErrorMessage('');
      setPhase('verifying');
      const result = await invokeDbCommand<VerifyStoreBindingResult>('verify_or_register_store_binding', {
        store_code: normalizedStoreCode,
      });
      const resolvedStoreCode = normalizeStoreCode(result.store_code);
      localStorage.setItem(STORE_CODE_STORAGE_KEY, resolvedStoreCode);
      window.dispatchEvent(new Event('store-code-updated'));
      setPhase('ready');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setPhase('input');
    }
  };

  if (phase === 'ready') return <>{children}</>;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="px-6 py-5 border-b border-slate-100">
          <h1 className="text-xl font-black text-slate-900">점포코드 인증</h1>
          <p className="text-sm text-slate-500 mt-1">
            최초 실행 시 STR_CD(점포관리) 그룹의 상세코드를 입력해 장치를 인증합니다.
          </p>
        </div>
        <div className="px-6 py-5 space-y-4">
          {phase === 'checking' ? (
            <p className="text-sm text-slate-500">현재 장치의 점포 인증 상태를 확인 중입니다...</p>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">점포코드 (STR_CD)</label>
                <input
                  type="text"
                  value={storeCodeInput}
                  onChange={(e) => setStoreCodeInput(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="예: HAIR_001"
                  disabled={phase === 'verifying'}
                />
              </div>
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-3">
                <p>HWID: {hwid || '확인중'}</p>
                <p className="mt-1">CPU ID: {cpuId || '확인중'}</p>
              </div>
              {errorMessage ? (
                <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  {errorMessage}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={phase === 'verifying'}
                className="w-full py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {phase === 'verifying' ? '인증 중...' : '인증 후 시작'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreBindingGate>
      <BrowserRouter>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<MenuAwareRedirect />} />
            <Route path="/products" element={<ProductManagementPage />} />
            <Route path="/inventory" element={<StockManagementPage />} />
            <Route path="/inventory/history" element={<StockHistoryPage />} />
            <Route path="/purchases" element={<PurchaseManagementPage />} />
            <Route path="/sales-stats" element={<SalesStatisticsPage />} />
            <Route path="/hair_sales-stats" element={<HairSalesStatisticsPage />} />
            <Route path="/Hair_sales-stats" element={<HairSalesStatisticsPage />} />
            <Route path="/hair-sales-stats" element={<HairSalesStatisticsPage />} />
            <Route path="/users" element={<UserManagementPage />} />
            <Route path="/employees" element={<EmployeeManagementPage />} />
            <Route path="/system/menu" element={<MenuManagementPage />} />
            <Route path="/system/code" element={<CommonCodePage />} />
            <Route path="/system/service-catalog" element={<ServiceCatalogPage />} />
            <Route path="/system/role" element={<RoleManagementPage />} />
            <Route path="/system/settings" element={<SystemSettingsPage />} />
            <Route path="/users/points" element={<PointRechargePage />} />
            <Route path="/users/point-history" element={<MemberPointHistoryPage />} />
            <Route path="/users/reservations" element={<ReservationCalendarPage />} />
            <Route path="/users/sales" element={<SalesEntryPage />} />
            <Route path="/users/sales-history" element={<SalesHistoryPage />} />
            {/* Fallback */}
            <Route path="*" element={<MenuAwareRedirect />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreBindingGate>
  );
}
