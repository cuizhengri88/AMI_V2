import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  Users,
  Scissors,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  Download,
  Calendar,
} from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import { downloadCsvFile } from '../../lib/csvExport';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';

type ViewType = 'daily' | 'weekly' | 'monthly' | 'period';
type SettlementStatus = 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

type EmployeeRow = {
  employee_id: number;
  employee_name: string;
  role_name: string | null;
  role_id: string | null;
};

type ServiceRow = {
  service_id: number;
  category_name: string;
  service_name: string;
  unit_price: number;
  duration_minutes: number;
  use_yn: 'Y' | 'N';
};

type SettlementRow = {
  settlement_id: number;
  settlement_datetime: string;
  member_user_id: number | null;
  manager_employee_id: number;
  service_ids: number[];
  total_amount: number;
  total_time_minutes: number;
  payments: Array<{ payment_method_code: string; amount: number; coupon_service_id: number | null }>;
  status: string;
  reservation_ref: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
};

type SettlementSummary = {
  id: number;
  date: string;
  managerId: number | null;
  serviceIds: number[];
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  status: SettlementStatus;
};

type DailyStatRow = {
  date: string;
  label: string;
  count: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  avgTicket: number;
  growthRate: number | null;
};

type ManagerPerformanceRow = {
  name: string;
  sales: number;
  count: number;
  avg: number;
};

type CategorySalesRow = {
  name: string;
  value: number;
  color: string;
};

type ProcedureTopRow = {
  id: number;
  name: string;
  category: string;
  price: number;
  count: number;
  share: number;
  growthRate: number | null;
};

const CATEGORY_COLORS = ['#0ea5e9', '#ec4899', '#f59e0b', '#10b981', '#6366f1', '#ef4444'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayIso() {
  return toIsoDate(new Date());
}

function monthStartIso() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
}

function toSettlementStatus(value: string): SettlementStatus {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'CANCELLED') return 'CANCELLED';
  if (normalized === 'COMPLETED') return 'COMPLETED';
  return 'PROCESSING';
}

function toDateOnly(raw: string) {
  if (!raw) return '';
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return '';
  return toIsoDate(parsed);
}

function isCouponPaymentMethod(method: string) {
  return method?.trim().toUpperCase() === 'COUPON';
}

function isBalancePaymentMethod(method: string) {
  const normalized = method?.trim().toUpperCase();
  return normalized === 'PREPAID' || normalized === 'MEMBERSHIP';
}

function formatCurrency(value: number) {
  return `¥${Math.round(value).toLocaleString('ko-KR')}`;
}

function parseDateSafe(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default function HairSalesStatisticsPage() {
  const pt = usePageText('sales_hair_sales_statistics');
  const [viewType, setViewType] = useState<ViewType>('monthly');
  const [startDate, setStartDate] = useState(monthStartIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [isLoading, setIsLoading] = useState(false);

  const [settlements, setSettlements] = useState<SettlementSummary[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);

  useEffect(() => {
    const now = new Date();
    let nextStart = startDate;
    let nextEnd = endDate;

    if (viewType === 'daily') {
      const today = toIsoDate(now);
      nextStart = today;
      nextEnd = today;
    } else if (viewType === 'weekly') {
      const current = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const day = current.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(current);
      monday.setDate(current.getDate() + diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      nextStart = toIsoDate(monday);
      nextEnd = toIsoDate(sunday);
    } else if (viewType === 'monthly') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      nextStart = toIsoDate(firstDay);
      nextEnd = toIsoDate(lastDay);
    }

    if (viewType !== 'period') {
      setStartDate(nextStart);
      setEndDate(nextEnd);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewType]);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [employeeResult, serviceResult, settlementResult] = await Promise.all([
        invokeDbCommand<{
          employees: EmployeeRow[];
        }>('get_employee_management_data'),
        invokeDbCommand<{
          items: ServiceRow[];
        }>('get_service_catalog_data'),
        invokeDbCommand<{
          settlements: SettlementRow[];
        }>('get_sales_settlement_data'),
      ]);

      setEmployees(employeeResult.employees || []);
      setServices((serviceResult.items || []).filter((item) => item.use_yn === 'Y'));
      const servicePriceById = new Map((serviceResult.items || []).map((item) => [item.service_id, Number(item.unit_price || 0)]));

      const summaryRows = (settlementResult.settlements || []).map((row) => {
        const nonCouponPaid = (row.payments || [])
          .filter((payment) => !isCouponPaymentMethod(payment.payment_method_code))
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const couponPaid = (row.payments || [])
          .filter((payment) => isCouponPaymentMethod(payment.payment_method_code))
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const couponCovered = (row.payments || [])
          .filter((payment) => isCouponPaymentMethod(payment.payment_method_code) && typeof payment.coupon_service_id === 'number')
          .reduce((sum, payment) => sum + (servicePriceById.get(payment.coupon_service_id as number) || 0), 0);
        const effectiveCouponPaid = couponCovered > 0 ? couponCovered : couponPaid;
        const netPaid = (row.payments || [])
          .filter(
            (payment) =>
              !isCouponPaymentMethod(payment.payment_method_code)
              && !isBalancePaymentMethod(payment.payment_method_code),
          )
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        return {
          id: row.settlement_id,
          date: row.settlement_datetime,
          managerId: row.manager_employee_id ?? null,
          serviceIds: row.service_ids || [],
          grossAmount: Number(row.total_amount || 0),
          discountAmount: Math.max(0, Number(row.total_amount || 0) - (nonCouponPaid + effectiveCouponPaid)),
          netAmount: netPaid,
          status: toSettlementStatus(row.status),
        } as SettlementSummary;
      });

      setSettlements(summaryRows);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t013'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const employeeNameById = useMemo(() => {
    return new Map(employees.map((employee) => [employee.employee_id, employee.employee_name]));
  }, [employees]);

  const serviceById = useMemo(() => {
    return new Map(services.map((service) => [service.service_id, service]));
  }, [services]);

  const activeSettlements = useMemo(() => {
    return settlements.filter((row) => row.status !== 'CANCELLED');
  }, [settlements]);

  const filteredSettlements = useMemo(() => {
    return activeSettlements.filter((row) => {
      const day = toDateOnly(row.date);
      if (!day) return false;
      if (startDate && day < startDate) return false;
      if (endDate && day > endDate) return false;
      return true;
    });
  }, [activeSettlements, startDate, endDate]);

  const dailyStats = useMemo<DailyStatRow[]>(() => {
    const map = new Map<string, Omit<DailyStatRow, 'growthRate' | 'avgTicket' | 'label'>>();

    filteredSettlements.forEach((row) => {
      const day = toDateOnly(row.date);
      if (!day) return;
      const procedureCount = row.serviceIds.length > 0 ? row.serviceIds.length : 1;
      const prev = map.get(day);
      if (prev) {
        prev.count += procedureCount;
        prev.grossAmount += row.grossAmount;
        prev.discountAmount += row.discountAmount;
        prev.netAmount += row.netAmount;
        return;
      }
      map.set(day, {
        date: day,
        count: procedureCount,
        grossAmount: row.grossAmount,
        discountAmount: row.discountAmount,
        netAmount: row.netAmount,
      });
    });

    const sorted = Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        ...row,
        label: row.date.slice(5),
        avgTicket: row.count > 0 ? Math.round(row.netAmount / row.count) : 0,
        growthRate: null as number | null,
      }));

    for (let i = 0; i < sorted.length; i += 1) {
      if (i === 0) {
        sorted[i].growthRate = null;
        continue;
      }
      const prevSales = sorted[i - 1].netAmount;
      if (prevSales <= 0) {
        sorted[i].growthRate = null;
        continue;
      }
      sorted[i].growthRate = ((sorted[i].netAmount - prevSales) / prevSales) * 100;
    }

    return sorted;
  }, [filteredSettlements]);

  const summary = useMemo(() => {
    return dailyStats.reduce(
      (acc, row) => {
        acc.totalSales += row.netAmount;
        acc.totalCount += row.count;
        return acc;
      },
      { totalSales: 0, totalCount: 0 },
    );
  }, [dailyStats]);

  const managerPerformance = useMemo<ManagerPerformanceRow[]>(() => {
    const map = new Map<number, { sales: number; count: number }>();
    filteredSettlements.forEach((row) => {
      if (row.managerId == null) return;
      const procedureCount = row.serviceIds.length > 0 ? row.serviceIds.length : 1;
      const prev = map.get(row.managerId);
      if (prev) {
        prev.sales += row.netAmount;
        prev.count += procedureCount;
        return;
      }
      map.set(row.managerId, { sales: row.netAmount, count: procedureCount });
    });

    return Array.from(map.entries())
      .map(([managerId, value]) => ({
        name: employeeNameById.get(managerId) || `${pt('t014')}#${managerId}`,
        sales: value.sales,
        count: value.count,
        avg: value.count > 0 ? Math.round(value.sales / value.count) : 0,
      }))
      .sort((a, b) => b.sales - a.sales);
  }, [filteredSettlements, employeeNameById]);

  const categorySales = useMemo<CategorySalesRow[]>(() => {
    const map = new Map<string, number>();
    filteredSettlements.forEach((row) => {
      const baseCount = row.serviceIds.length > 0 ? row.serviceIds.length : 1;
      row.serviceIds.forEach((serviceId) => {
        const service = serviceById.get(serviceId);
        const category = service?.category_name?.trim() || pt('t015');
        const fallbackPrice = Math.round(row.netAmount / baseCount);
        map.set(category, (map.get(category) || 0) + (service?.unit_price || fallbackPrice));
      });
    });

    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], index) => ({
        name,
        value,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      }));
  }, [filteredSettlements, serviceById]);

  const previousRange = useMemo(() => {
    const start = parseDateSafe(startDate);
    const end = parseDateSafe(endDate);
    if (!start || !end || end < start) return null;
    const diffDays = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
    const prevEnd = new Date(start);
    prevEnd.setDate(start.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevEnd.getDate() - diffDays + 1);
    return {
      start: toIsoDate(prevStart),
      end: toIsoDate(prevEnd),
    };
  }, [startDate, endDate]);

  const previousServiceCountMap = useMemo(() => {
    const map = new Map<number, number>();
    if (!previousRange) return map;
    activeSettlements.forEach((row) => {
      const day = toDateOnly(row.date);
      if (!day || day < previousRange.start || day > previousRange.end) return;
      row.serviceIds.forEach((serviceId) => {
        map.set(serviceId, (map.get(serviceId) || 0) + 1);
      });
    });
    return map;
  }, [activeSettlements, previousRange]);

  const popularProcedures = useMemo<ProcedureTopRow[]>(() => {
    const map = new Map<number, { count: number; sales: number }>();
    filteredSettlements.forEach((row) => {
      row.serviceIds.forEach((serviceId) => {
        const service = serviceById.get(serviceId);
        const prev = map.get(serviceId);
        if (prev) {
          prev.count += 1;
          prev.sales += service?.unit_price || 0;
          return;
        }
        map.set(serviceId, { count: 1, sales: service?.unit_price || 0 });
      });
    });

    const totalCount = Array.from(map.values()).reduce((sum, row) => sum + row.count, 0);
    return Array.from(map.entries())
      .map(([serviceId, value]) => {
        const service = serviceById.get(serviceId);
        const prevCount = previousServiceCountMap.get(serviceId) || 0;
        return {
          id: serviceId,
          name: service?.service_name || `${pt('t016')}#${serviceId}`,
          category: service?.category_name || pt('t015'),
          price: service?.unit_price || 0,
          count: value.count,
          share: totalCount > 0 ? (value.count / totalCount) * 100 : 0,
          growthRate: prevCount > 0 ? ((value.count - prevCount) / prevCount) * 100 : null,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredSettlements, serviceById, previousServiceCountMap]);

  const topProcedureMaxCount = useMemo(() => {
    if (popularProcedures.length === 0) return 1;
    return popularProcedures[0].count;
  }, [popularProcedures]);

  const categoryTotal = useMemo(() => {
    return categorySales.reduce((sum, row) => sum + row.value, 0);
  }, [categorySales]);

  const exportCsv = async () => {
    const rows = dailyStats.map((row) => [
      row.date,
      row.count,
      row.grossAmount,
      row.discountAmount,
      row.netAmount,
      row.avgTicket,
      row.growthRate == null ? '-' : `${row.growthRate.toFixed(1)}%`,
    ]);
    const result = await downloadCsvFile({
      filename: `hair-sales-stats-${todayIso()}.csv`,
      headers: [pt('t002'), pt('t007'), pt('t010'), pt('t012'), pt('t008'), pt('t001'), pt('t006')],
      rows,
    });

    if (!result.success && !result.cancelled) {
      alert(pt('t013'));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="max-w-7xl mx-auto space-y-6 pb-20"
    >
      <LoadingOverlay visible={isLoading} />

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{pt('t004')}</h1>
          <p className="text-slate-500 mt-1">{pt('t003')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-1 flex">
            {(['daily', 'weekly', 'monthly', 'period'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setViewType(type)} className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${
                  viewType === type
                    ? 'bg-primary text-white shadow-lg shadow-primary/20'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {type === 'daily'
                  ? pt('t017')
                  : type === 'weekly'
                    ? pt('t018')
                    : type === 'monthly'
                      ? pt('t019')
                      : pt('t020')}
              </button>
            ))}</div>

          {viewType === 'period' && (
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-1 px-2">
              <Calendar size={14} className="text-slate-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)} className="bg-transparent border-none text-xs font-bold outline-none"
              />
              <span className="text-slate-300 font-bold">~</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)} className="bg-transparent border-none text-xs font-bold outline-none"
              />
            </div>
          )}<button
            onClick={() => { void exportCsv(); }}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all"
          >
            <Download size={18} />
            {pt('t021')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="size-10 bg-indigo-50 text-indigo-500 rounded-xl flex items-center justify-center">
              <TrendingUp size={20} />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t010')}</p>
            <h3 className="text-2xl font-black text-slate-900">{formatCurrency(summary.totalSales)}</h3>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="size-10 bg-amber-50 text-amber-500 rounded-xl flex items-center justify-center">
              <Scissors size={20} />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{pt('t011')}</p>
            <h3 className="text-2xl font-black text-slate-900">{summary.totalCount}{pt('t030')}</h3>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" />
              {pt('t022')}
            </h3>
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyStats}>
                <defs>
                  <linearGradient id="hairSalesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                  tickFormatter={(value) => `¥${Math.round(value / 10000).toLocaleString()}${pt('t031')}`}
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)} labelFormatter={(label) => `${pt('t032')} ${label}`}
                  contentStyle={{
                    backgroundColor: '#fff',
                    borderRadius: '12px',
                    border: '1px solid #f1f5f9',
                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                    fontSize: '12px',
                    fontWeight: 'bold',
                  }}
                />
                <Area type="monotone" dataKey="netAmount" stroke="#0ea5e9" strokeWidth={3} fill="url(#hairSalesGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Scissors size={18} className="text-pink-500" />
            {pt('t023')}
          </h3>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categorySales}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {categorySales.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}</Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3">
            {categorySales.map((cat) => (
              <div key={cat.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="text-xs font-bold text-slate-600">{cat.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-black text-slate-900">{formatCurrency(cat.value)}</span>
                  <span className="text-[10px] font-black text-slate-400 w-10 text-right">
                    {categoryTotal > 0 ? Math.round((cat.value / categoryTotal) * 100) : 0}%
                  </span>
                </div>
              </div>
            ))} {categorySales.length === 0 && (
              <p className="text-xs text-slate-400 font-bold">{pt('t009')}</p>
            )}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Users size={18} className="text-blue-500" />
              {pt('t024')}
            </h3>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={managerPerformance} margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fontWeight: 700, fill: '#475569' }}
                />
                <YAxis
                  yAxisId="left"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#0ea5e9' }}
                  tickFormatter={(val) => `${Math.round(val / 10000)}${pt('t031')}`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#10b981' }}
                  tickFormatter={(val) => `${val}${pt('t030')}`}
                />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', paddingBottom: '10px' }}
                />
                <Bar yAxisId="left" dataKey="sales" name={pt('t025')} fill="#0ea5e9" radius={[4, 4, 0, 0]} barSize={30} />
                <Bar yAxisId="right" dataKey="count" name={pt('t033')} fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <CreditCard size={18} className="text-emerald-500" />
            {pt('t026')}
          </h3>
          <div className="space-y-4">
            {popularProcedures.map((proc, idx) => (
              <div key={proc.id} className="flex items-center gap-4 group cursor-pointer">
                <div className="size-8 bg-slate-50 rounded-lg flex items-center justify-center text-xs font-black text-slate-400 group-hover:bg-primary group-hover:text-white transition-all">
                  {pad2(idx + 1)}</div>
                <div className="flex-1">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-slate-900">{proc.name}</span>
                    <span className="text-xs font-black text-slate-900">{formatCurrency(proc.price)}</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(6, (proc.count / topProcedureMaxCount) * 100)}%` }}
                      transition={{ duration: 1, delay: idx * 0.1 }}
                      className="h-full bg-primary rounded-full"
                    />
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-slate-900">{proc.count}{pt('t030')}</p>
                  <p className="text-[10px] font-bold text-slate-400">
                    {proc.growthRate == null ? pt('t027') : `${pt('t028')} ${proc.growthRate >= 0 ? '+' : ''}${proc.growthRate.toFixed(1)}%`}
                  </p>
                </div>
              </div>
            ))} {popularProcedures.length === 0 && (
              <p className="text-xs text-slate-400 font-bold">{pt('t009')}</p>
            )}</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-black text-slate-900">{pt('t005')}</h3>
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 transition-colors" aria-label="filter">
              <Filter size={18} />
            </button>
            <button
              className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 transition-colors"
              onClick={() => { void exportCsv(); }}
              aria-label="download"
            >
              <Download size={18} />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
              <tr>
                <th className="py-4 px-6">{pt('t002')}</th>
                <th className="py-4 px-6">{pt('t007')}</th>
                <th className="py-4 px-6">{pt('t010')}</th>
                <th className="py-4 px-6">{pt('t012')}</th>
                <th className="py-4 px-6">{pt('t008')}</th>
                <th className="py-4 px-6">{pt('t001')}</th>
                <th className="py-4 px-6">{pt('t006')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {dailyStats.map((row) => {
                const growth = row.growthRate;
                const isUp = growth != null && growth >= 0;
                return (
                  <tr key={row.date} className="hover:bg-slate-50 transition-colors group">
                    <td className="py-4 px-6 text-sm font-bold text-slate-900">{row.date}</td>
                    <td className="py-4 px-6 text-sm font-bold text-slate-600">{row.count}{pt('t030')}</td>
                    <td className="py-4 px-6 text-sm font-bold text-slate-400 line-through">{formatCurrency(row.grossAmount)}</td>
                    <td className="py-4 px-6 text-sm font-bold text-red-400">-{formatCurrency(row.discountAmount)}</td>
                    <td className="py-4 px-6 text-sm font-black text-slate-900">{formatCurrency(row.netAmount)}</td>
                    <td className="py-4 px-6 text-sm font-bold text-slate-600">{formatCurrency(row.avgTicket)}</td>
                    <td className="py-4 px-6">
                      {growth == null ? (
                        <span className="text-xs font-black text-slate-300">-</span>
                      ) : (
                        <div className={`flex items-center gap-1 text-xs font-black ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>
                          {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                          {`${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`}
                        </div>
                      )}</td>
                  </tr>
                );
              })} {dailyStats.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-20 text-center text-slate-400 font-bold">
                    {pt('t029')}
                  </td>
                </tr>
              )}</tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

