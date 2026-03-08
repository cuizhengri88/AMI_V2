import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';

export default function DashboardLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f7f8]">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-auto p-8">
          {/* 각 페이지의 내용이 여기에 렌더링됩니다 */}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
