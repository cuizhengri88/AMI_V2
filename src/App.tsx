import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayout';
import UserManagementPage from './pages/UserManagement/UserManagementPage';
import EmployeeManagementPage from './pages/UserManagement/EmployeeManagementPage';
import ProductManagementPage from './pages/Product/ProductManagementPage';
import StockManagementPage from './pages/Product/StockManagementPage';
import StockHistoryPage from './pages/Product/StockHistoryPage';
import PurchaseManagementPage from './pages/Sales/PurchaseManagementPage';
import SalesStatisticsPage from './pages/Sales/SalesStatisticsPage';
import MenuManagementPage from './pages/System/MenuManagementPage';
import CommonCodePage from './pages/System/CommonCodePage';
import RoleManagementPage from './pages/System/RoleManagementPage';
import SystemSettingsPage from './pages/System/SystemSettingsPage';
import ServiceCatalogPage from './pages/System/ServiceCatalogPage';
import PointRechargePage from './pages/UserManagement/PointRechargePage';
import ReservationCalendarPage from './pages/UserManagement/ReservationCalendarPage';
import SalesEntryPage from './pages/UserManagement/SalesEntryPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<Navigate to="/sales-stats" replace />} />
          <Route path="/products" element={<ProductManagementPage />} />
          <Route path="/inventory" element={<StockManagementPage />} />
          <Route path="/inventory/history" element={<StockHistoryPage />} />
          <Route path="/purchases" element={<PurchaseManagementPage />} />
          <Route path="/sales-stats" element={<SalesStatisticsPage />} />
          <Route path="/users" element={<UserManagementPage />} />
          <Route path="/employees" element={<EmployeeManagementPage />} />
          <Route path="/system/menu" element={<MenuManagementPage />} />
          <Route path="/system/code" element={<CommonCodePage />} />
          <Route path="/system/service-catalog" element={<ServiceCatalogPage />} />
          <Route path="/system/role" element={<RoleManagementPage />} />
          <Route path="/system/settings" element={<SystemSettingsPage />} />
          <Route path="/users/points" element={<PointRechargePage />} />
          <Route path="/users/reservations" element={<ReservationCalendarPage />} />
          <Route path="/users/sales" element={<SalesEntryPage />} />
          {/* Fallback */}
          <Route path="*" element={<Navigate to="/sales-stats" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
