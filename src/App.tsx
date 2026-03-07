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

type MenuRow = {
  id: number;
  menu_type: string;
  path: string;
  order: number;
  status: string;
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

function resolveDefaultPath(menus: MenuRow[]): string {
  const activeMenus = (menus || [])
    .filter((menu) => (menu.status || '').trim() === STATUS_ACTIVE)
    .sort((a, b) => (Number(a.order) - Number(b.order)) || (a.id - b.id));

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
        setTargetPath(resolveDefaultPath(result.menus || []));
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

export default function App() {
  return (
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
  );
}
