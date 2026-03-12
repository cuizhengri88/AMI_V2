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
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';
import { downloadCsvFile } from '../../lib/csvExport';
import LoadingOverlay from '../../components/LoadingOverlay';
import { usePageText } from '../../i18n/usePageText';
import {
  type DateRangeViewType,
  formatCurrency as formatCurrencyCommon,
  getDateRangeByViewType,
  isCouponPaymentMethod,
  pad2,
  shiftDailyDateRange,
  toDateOnly,
  toIsoDate,
  todayIso,
  toSettlementStatus,
} from '../utils/pageCommon';

/**
 * 차트 및 조회 단위 정의 (일별, 기간 직접 선택)
 */
type ViewType = DateRangeViewType;

/**
 * 정산 상태 타입 (진행 중, 완료됨, 취소됨)
 */
type SettlementStatus = 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

/**
 * 직원 정보 타입 (DB employee_management 테이블 대응)
 */
type EmployeeRow = {
  employee_id: number;     // 직원 고유 ID
  employee_name: string;   // 직원 이름
  role_name: string | null; // 역할 명칭 (예: 디자이너, 원장 등)
  role_id: string | null;   // 역할 ID 코드
};

/**
 * 시술 서비스 정보 타입 (DB service_catalog_management 테이블 대응)
 */
type ServiceRow = {
  service_id: number;       // 시술 고유 ID
  category_name: string;    // 카테고리 이름 (예: 커트, 펌)
  service_name: string;     // 시술 서비스 명칭
  unit_price: number;       // 기본 단가
  duration_minutes: number; // 예상 소요 시간 (분)
  use_yn: 'Y' | 'N';        // 사용 여부
};

/**
 * 정산 내역 정보 타입 (DB sales_settlement_management 테이블 대응)
 */
type SettlementRow = {
  settlement_id: number;       // 정산 고유 ID
  settlement_datetime: string; // 정산 일시 (ISO 문자열)
  member_user_id: number | null; // 회원 유저 ID (비회원일 경우 null)
  manager_employee_id: number; // 담당 직원(매니저) ID
  service_ids: number[];       // 포함된 시술 서비스 ID 목록
  total_amount: number;        // 총 결제 금액
  total_time_minutes: number;  // 총 시술 시간 (분)
  // 결제 수단별 상세 내역 (카드, 현금, 포인트, 쿠폰 등)
  payments: Array<{
    payment_method_code: string; // 결제 수단 코드
    amount: number;              // 해당 수단으로 결제한 금액
    coupon_service_id: number | null; // 쿠폰 결제 시 적용된 서비스 ID
  }>;
  status: string;              // 정산 상태 (PROCESSING, COMPLETED, CANCELLED)
  reservation_ref: string | null; // 연관된 예약 참조 번호
  cancel_reason: string | null;   // 취소 사유
  cancelled_at: string | null;    // 취소 일시
};

/**
 * 통계를 위해 가공된 정산 요약 데이터 타입
 */
type SettlementSummary = {
  id: number;            // 정산 ID
  date: string;          // 정산 일자 (YYYY-MM-DD)
  managerId: number | null; // 담당 매니저 ID
  serviceIds: number[];    // 시술 ID 목록
  grossAmount: number;     // 총 매출액 (할인 전)
  discountAmount: number;  // 총 할인액
  netAmount: number;       // 실매출액 (순수익)
  status: SettlementStatus; // 정산 상태
};

/**
 * 일별/기간별 통계 차트용 로우 데이터 타입
 */
type DailyStatRow = {
  date: string;        // 일자
  label: string;       // 차트 표시 라벨 (월-일 형식)
  count: number;       // 시술 건수
  grossAmount: number;  // 총 매출
  discountAmount: number; // 할인 금액
  netAmount: number;    // 순 매출
  avgTicket: number;    // 객단가
  growthRate: number | null; // 전일 대비 성장률 (%)
};

/**
 * 직원별 성과 데이터 타입
 */
type ManagerPerformanceRow = {
  name: string;  // 직원 이름
  sales: number; // 총 매출액
  count: number; // 총 시술 건수
  avg: number;   // 1건당 평균 매출
};

/**
 * 카테고리별 비중 데이터 타입
 */
type CategorySalesRow = {
  name: string;  // 카테고리 이름
  value: number; // 매출액 합계
  color: string; // 차트 표시 색상
};

/**
 * 인기 시술 TOP 5 데이터 타입
 */
type ProcedureTopRow = {
  id: number;     // 시술 ID
  name: string;   // 시술 이름
  category: string; // 카테고리
  price: number;  // 단가
  count: number;  // 시술 횟수
  share: number;  // 비중 (%)
  growthRate: number | null; // 전기간 대비 성장률 (%)
};

/**
 * UI 상수 설정
 */
const CATEGORY_COLORS = ['#0ea5e9', '#ec4899', '#f59e0b', '#10b981', '#6366f1', '#ef4444']; // 차트에 사용될 색상 팔레트
const MS_PER_DAY = 24 * 60 * 60 * 1000; // 하루를 밀리초로 환산

/**
 * 통화 형식 포맷팅 (한국 원화 기준)
 */
function formatCurrency(value: number) {
  return formatCurrencyCommon(value, { locale: 'ko-KR', round: true });
}
/**
 * 문자열 날짜를 안전하게 Date 객체로 변환
 * @param value ISO 날짜 문자열
 */
function parseDateSafe(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 미용실 매출 통계 페이지 메인 컴포넌트
 */
export default function HairSalesStatisticsPage() {
  const pt = usePageText('sales_hair_sales_statistics');
  const initialDateRange = getDateRangeByViewType('daily');

  /**
   * 상태 관리 (useState)
   */
  const [viewType, setViewType] = useState<ViewType>('daily'); // 조회 단위 (기본: 일별)
  const [startDate, setStartDate] = useState(initialDateRange.startDate); // 조회 시작일
  const [endDate, setEndDate] = useState(initialDateRange.endDate); // 조회 종료일
  const [isLoading, setIsLoading] = useState(false); // 데이터 로딩 오버레이 제어

  // DB 원본 데이터 저장소
  const [settlements, setSettlements] = useState<SettlementSummary[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);

  // 공유 날짜 프리셋: 일별 -> 오늘, 기간별 -> 7일 전 ~ 오늘
  const handleViewTypeChange = (nextViewType: ViewType) => {
    setViewType(nextViewType);
    const nextRange = getDateRangeByViewType(nextViewType);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
  };

  const moveDailyDate = (dayOffset: number) => {
    const nextRange = shiftDailyDateRange(startDate, dayOffset);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
  };

  /**
   * DB에서 데이터 로드 및 집계용 데이터로 변형
   */
  const loadData = async () => {
    try {
      setIsLoading(true);

      // 다수의 DB 커맨드를 병렬로 실행하여 성능 최적화
      const [employeeResult, serviceResult, settlementResult] = await Promise.all([
        invokeDbCommand<{ employees: EmployeeRow[] }>('get_employee_management_data'),
        invokeDbCommand<{ items: ServiceRow[] }>('get_service_catalog_data'),
        invokeDbCommand<{ settlements: SettlementRow[] }>('get_sales_settlement_data'),
      ]);

      setEmployees(employeeResult.employees || []);
      setServices((serviceResult.items || []).filter((item) => item.use_yn === 'Y'));

      // 서비스 단가를 시술 ID로 즉시 조회하기 위해 Map(해시테이블) 생성
      const servicePriceById = new Map((serviceResult.items || []).map((item) => [item.service_id, Number(item.unit_price || 0)]));

      // 복잡한 정산 데이터를 통계 차트에서 쓰기 좋은 SettlementSummary 형태로 변환
      const summaryRows = (settlementResult.settlements || []).map((row) => {
        // 현금, 카드 등 실제 수납액 필터링 및 합계
        const nonCouponPaid = (row.payments || [])
          .filter((payment) => !isCouponPaymentMethod(payment.payment_method_code))
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

        // 쿠폰으로 명시된 지불액 합계
        const couponPaid = (row.payments || [])
          .filter((payment) => isCouponPaymentMethod(payment.payment_method_code))
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

        // 시술 전용 쿠폰일 경우, 해당 시술의 단가를 찾아서 가액으로 인정
        const couponCovered = (row.payments || [])
          .filter((payment) => isCouponPaymentMethod(payment.payment_method_code) && typeof payment.coupon_service_id === 'number')
          .reduce((sum, payment) => sum + (servicePriceById.get(payment.coupon_service_id as number) || 0), 0);

        // 최종적으로 인정되는 쿠폰 가액 (단가 기준이 있으면 우선 적용)
        const effectiveCouponPaid = couponCovered > 0 ? couponCovered : couponPaid;

        // 순수하게 현금/카드 등으로 들어온 실결제액
        const netPaid = (row.payments || [])
          .filter((payment) => !isCouponPaymentMethod(payment.payment_method_code))
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

        return {
          id: row.settlement_id,
          date: row.settlement_datetime,
          managerId: row.manager_employee_id ?? null,
          serviceIds: row.service_ids || [],
          grossAmount: Number(row.total_amount || 0), // 정가 기준 총액
          // 할인액 = 정가 - (수납액 + 쿠폰 인정액)
          discountAmount: Math.max(0, Number(row.total_amount || 0) - (nonCouponPaid + effectiveCouponPaid)),
          netAmount: netPaid, // 실매출 계산
          status: toSettlementStatus(row.status),
        } as SettlementSummary;
      });

      setSettlements(summaryRows);
    } catch (error: any) {
      alert(typeof error === 'string' ? error : error?.message || pt('t013')); // pt('t013') -> 미용실 매출 통계 데이터를 불러오지 못했습니다.
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 페이지 로드 시 데이터 초기 호출
   */
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 담당자 ID로 이름을 빠르게 찾기 위한 맵 캐싱
   */
  const employeeNameById = useMemo(() => {
    return new Map(employees.map((employee) => [employee.employee_id, employee.employee_name]));
  }, [employees]);

  /**
   * 시술 ID로 상세 정보를 빠르게 찾기 위한 맵 캐싱
   */
  const serviceById = useMemo(() => {
    return new Map(services.map((service) => [service.service_id, service]));
  }, [services]);

  /**
   * 유효한(취소되지 않은) 정산 내역만 필터링
   */
  const activeSettlements = useMemo(() => {
    return settlements.filter((row) => row.status !== 'CANCELLED');
  }, [settlements]);

  /**
   * 현재 설정된 날짜 범위 내의 정산 데이터만 추출
   */
  const filteredSettlements = useMemo(() => {
    return activeSettlements.filter((row) => {
      const day = toDateOnly(row.date);
      if (!day) return false;
      if (startDate && day < startDate) return false;
      if (endDate && day > endDate) return false;
      return true;
    });
  }, [activeSettlements, startDate, endDate]);

  /**
   * [통계 로직] 일별 매출 데이터 집계 및 차트 데이터 가공
   */
  const dailyStats = useMemo<DailyStatRow[]>(() => {
    const map = new Map<string, Omit<DailyStatRow, 'growthRate' | 'avgTicket' | 'label'>>();

    // 1단계: 날짜별로 그룹화하여 금액 및 건수 누적 합산
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

    // 2단계: 날짜순 정렬 및 부가 지표(라벨, 객단가) 계산
    const sorted = Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        ...row,
        label: row.date.slice(5), // 차트용 'MM-DD' 라벨
        avgTicket: row.count > 0 ? Math.round(row.netAmount / row.count) : 0, // 객단가
        growthRate: null as number | null,
      }));

    // 3단계: 전일 대비 성장률 계산
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

  /**
   * 전체 요약 수치 (매출 합계, 총 건수)
   */
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

  /**
   * [통계 로직] 담당 매니저별 판매 성과 집계
   */
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
        name: employeeNameById.get(managerId) || `${pt('t014')}#${managerId}`, // pt('t014') -> 직원
        sales: value.sales,
        count: value.count,
        avg: value.count > 0 ? Math.round(value.sales / value.count) : 0,
      }))
      .sort((a, b) => b.sales - a.sales);
  }, [filteredSettlements, employeeNameById, pt]);

  /**
   * [통계 로직] 시술 카탈로그 카테고리별 매출 비중 집계
   */
  const categorySales = useMemo<CategorySalesRow[]>(() => {
    const map = new Map<string, number>();
    filteredSettlements.forEach((row) => {
      const baseCount = row.serviceIds.length > 0 ? row.serviceIds.length : 1;
      row.serviceIds.forEach((serviceId) => {
        const service = serviceById.get(serviceId);
        const category = service?.category_name?.trim() || pt('t015'); // pt('t015') -> 미분류
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
  }, [filteredSettlements, serviceById, pt]);

  /**
   * 비교 분석을 위한 '이전 기간' 범위 계산 (사용자 설정 기간만큼 뒤로 이동)
   */
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

  /**
   * 이전 기간 시술별 건수 집계 (성장률 분석을 위한 베이스 데이터)
   */
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

  /**
   * [통계 로직] 인기 시술 리스트 분석 (건수 기준 TOP 5)
   */
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
          name: service?.service_name || `${pt('t016')}#${serviceId}`, // pt('t016') -> 시술
          category: service?.category_name || pt('t015'), // pt('t015') -> 미분류
          price: service?.unit_price || 0,
          count: value.count,
          share: totalCount > 0 ? (value.count / totalCount) * 100 : 0,
          growthRate: prevCount > 0 ? ((value.count - prevCount) / prevCount) * 100 : null,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredSettlements, serviceById, previousServiceCountMap, pt]);

  // 차트 스케일링을 위한 최다 판매 시술 건수 추출
  const topProcedureMaxCount = useMemo(() => {
    if (popularProcedures.length === 0) return 1;
    return popularProcedures[0].count;
  }, [popularProcedures]);

  // 카테고리 전체 매출 합계
  const categoryTotal = useMemo(() => {
    return categorySales.reduce((sum, row) => sum + row.value, 0);
  }, [categorySales]);

  /**
   * [핸들러] 통계 데이터를 CSV 파일로 추출하여 다운로드
   */
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
      headers: [
        pt('t002'), // 날짜
        pt('t007'), // 시술 건수
        pt('t010'), // 총 매출액
        pt('t012'), // 할인 금액
        pt('t008'), // 실수납액
        pt('t001'), // 객단가
        pt('t006'), // 성장률
      ],
      rows,
    });

    if (!result.success && !result.cancelled) {
      alert(pt('t013')); // pt('t013') -> 미용실 매출 통계 데이터를 불러오지 못했습니다.
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

      {/* 1. 상단 섹션: 타이틀 및 조회 필터 도구 */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            {pt('t004')} {/* pt('t004') -> 미용실 매출 통계 */}
          </h1>
          <p className="text-slate-500 mt-1">
            {pt('t003')} {/* pt('t003') -> 매장의 매출 흐름과 성과를 데이터로 시각화합니다. */}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* 조회 주기 선택 버튼 군 */}
          <div className="bg-white border border-slate-200 rounded-xl p-1 flex">
            {(['daily', 'period'] as const).map((type) => (
              <button
                key={type}
                onClick={() => handleViewTypeChange(type)} className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${viewType === type
                    ? 'bg-primary text-white shadow-lg shadow-primary/20'
                    : 'text-slate-400 hover:text-slate-600'
                  }`}
              >
                {type === 'daily' ? pt('t017') : pt('t020')}
              </button>
            ))}</div>

          {viewType === 'daily' && (
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
              <button
                type="button"
                onClick={() => moveDailyDate(-1)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                aria-label="Previous day"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-2 text-xs font-black text-slate-700 min-w-[100px] text-center">
                {startDate}
              </span>
              <button
                type="button"
                onClick={() => moveDailyDate(1)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                aria-label="Next day"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {/* 기간 직접 선택 모드 시 날짜 Picker 노출 */}
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
          )}

          <button
            onClick={() => { void exportCsv(); }}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all"
          >
            <Download size={18} />
            {pt('t021')} {/* pt('t021') -> 보고서 출력 */}
          </button>
        </div>
      </div>

      {/* 2. 핵심 KPI 요약 카드 섹션 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 총 매출액 카드 */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="size-10 bg-indigo-50 text-indigo-500 rounded-xl flex items-center justify-center">
              <TrendingUp size={20} />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {pt('t010')} {/* pt('t010') -> 총 매출액 */}
            </p>
            <h3 className="text-2xl font-black text-slate-900">{formatCurrency(summary.totalSales)}</h3>
          </div>
        </div>

        {/* 총 시술 건수 카드 */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="size-10 bg-amber-50 text-amber-500 rounded-xl flex items-center justify-center">
              <Scissors size={20} />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {pt('t011')} {/* pt('t011') -> 총 시술 건수 */}
            </p>
            <h3 className="text-2xl font-black text-slate-900">
              {summary.totalCount}{pt('t030')} {/* pt('t030') -> 건 */}
            </h3>
          </div>
        </div>
      </div>

      {/* 3. 대형 차트 및 분석 섹션 (매출 추이 & 카테고리 비중) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 매출 추이 영역형 차트 */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" />
              {pt('t022')} {/* pt('t022') -> 매출 추이 분석 */}
            </h3>
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyStats}>
                {/* 차트 그라데이션 효과 정의 */}
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
                  tickFormatter={(value) => `¥${Math.round(value / 10000).toLocaleString()}${pt('t031')}`} // pt('t031') -> 만
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  labelFormatter={(label) => `${pt('t032')} ${label}`} // pt('t032') -> 날짜:
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

        {/* 카테고리 비중 도넛 차트 */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Scissors size={18} className="text-pink-500" />
            {pt('t023')} {/* pt('t023') -> 카테고리별 비중 */}
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
          {/* 차트 범례 리스트 */}
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
            ))}
            {categorySales.length === 0 && (
              <p className="text-xs text-slate-400 font-bold">{pt('t009')}</p> // pt('t009') -> 조회 기간에 해당하는 시술 데이터가 없습니다.
            )}
          </div>
        </div>
      </div>

      {/* 4. 심층 분석 섹션 (매니저 성과 & 인기 시술) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 매니저별 성과 막대 차트 (매출과 건수를 같이 표시) */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Users size={18} className="text-blue-500" />
              {pt('t024')} {/* pt('t024') -> 매니저별 성과 지표 (매출 & 건수) */}
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
                  tickFormatter={(val) => `${Math.round(val / 10000)}${pt('t031')}`} // pt('t031') -> 만
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#10b981' }}
                  tickFormatter={(val) => `${val}${pt('t030')}`} // pt('t030') -> 건
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
                <Bar yAxisId="left" dataKey="sales" name={pt('t025')} fill="#0ea5e9" radius={[4, 4, 0, 0]} barSize={30} /> {/* pt('t025') -> 매출액 */}
                <Bar yAxisId="right" dataKey="count" name={pt('t033')} fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} /> {/* pt('t033') -> 시술건수 */}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 인기 시술 TOP 5 리스트 (진행 바 형태) */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <CreditCard size={18} className="text-emerald-500" />
            {pt('t026')} {/* pt('t026') -> 인기 시술 TOP 5 */}
          </h3>
          <div className="space-y-4">
            {popularProcedures.map((proc, idx) => (
              <div key={proc.id} className="flex items-center gap-4 group cursor-pointer">
                {/* 랭킹 번호 패딩처리된 라벨 */}
                <div className="size-8 bg-slate-50 rounded-lg flex items-center justify-center text-xs font-black text-slate-400 group-hover:bg-primary group-hover:text-white transition-all">
                  {pad2(idx + 1)}</div>
                <div className="flex-1">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-slate-900">{proc.name}</span>
                    <span className="text-xs font-black text-slate-900">{formatCurrency(proc.price)}</span>
                  </div>
                  {/* 점유율 시각화 바 */}
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
                  <p className="text-xs font-black text-slate-900">
                    {proc.count}{pt('t030')} {/* pt('t030') -> 건 */}
                  </p>
                  {/* 전기간 대비 성장률 표시 */}
                  <p className="text-[10px] font-bold text-slate-400">
                    {proc.growthRate == null
                      ? pt('t027') // pt('t027') -> 비교 데이터 없음
                      : `${pt('t028')} ${proc.growthRate >= 0 ? '+' : ''}${proc.growthRate.toFixed(1)}%`} {/* pt('t028') -> 전기간 대비 */}
                  </p>
                </div>
              </div>
            ))}
            {popularProcedures.length === 0 && (
              <p className="text-xs text-slate-400 font-bold">{pt('t009')}</p>
            )}
          </div>
        </div>
      </div>

      {/* 5. 하단 상세 테이블 섹션: 그리드 데이터 집계 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-black text-slate-900">
            {pt('t005')} {/* pt('t005') -> 상세 매출 데이터 */}
          </h3>
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
                <th className="py-4 px-6">{pt('t002')}</th> {/* 날짜 */}
                <th className="py-4 px-6">{pt('t007')}</th> {/* 시술 건수 */}
                <th className="py-4 px-6">{pt('t010')}</th> {/* 총 매출액 */}
                <th className="py-4 px-6">{pt('t012')}</th> {/* 할인 금액 */}
                <th className="py-4 px-6">{pt('t008')}</th> {/* 실수납액 */}
                <th className="py-4 px-6">{pt('t001')}</th> {/* 객단가 */}
                <th className="py-4 px-6">{pt('t006')}</th> {/* 성장률 */}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {dailyStats.length === 0
                ? (
                  <tr>
                    <td colSpan={7} className="py-20 text-center text-slate-400 font-bold">
                      {pt('t029')} {/* pt('t029') -> 조회 조건에 맞는 데이터가 없습니다. */}
                    </td>
                  </tr>
                )
                : dailyStats.map((row) => {
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
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
