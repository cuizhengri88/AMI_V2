import React, { useEffect, useMemo, useState } from 'react';
import { motion, useDragControls } from 'motion/react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit2,
  GripHorizontal,
  Loader2,
  PlusCircle,
  Scissors,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { invokeDbCommand } from '../../lib/dbClient';

type CodeOption = {
  code: string;
  label: string;
  order: number;
};

type ServiceItem = {
  id: number;
  categoryCode: string;
  categoryName: string;
  serviceName: string;
  unitPrice: number;
  durationMinutes: number;
};

type ReservationService = {
  lineId: number;
  serviceId: number;
  categoryCode: string;
  categoryName: string;
  serviceName: string;
  unitPrice: number;
  durationMinutes: number;
};

type ReservationRecord = {
  id: number;
  reservationDate: string;
  startTime: string;
  customerName: string;
  designerName: string;
  status: string;
  note: string;
  services: ReservationService[];
};

type ReservationForm = {
  reservationDate: string;
  startTime: string;
  customerName: string;
  designerName: string;
  status: string;
  note: string;
  selectedCategory: string;
  selectedServiceId: string;
  services: ReservationService[];
};

// 백엔드에서 내려주는 예약 시술 라인 원본 타입
type ReservationServiceRow = {
  line_id: number;
  service_id: number;
  category_code: string;
  category_name: string;
  service_name: string;
  unit_price: number;
  duration_minutes: number;
};

// 백엔드에서 내려주는 예약 헤더 원본 타입
type ReservationRow = {
  reservation_id: number;
  reservation_date: string;
  start_time: string;
  customer_name: string;
  designer_name: string;
  status: string;
  note: string | null;
  services: ReservationServiceRow[];
};

type StatusTone = {
  badge: string;
  chip: string;
  dot: string;
};

type ReservationViewMode = 'calendar' | 'list';

const STATUS_GROUP_ID = 'RESERVATION_STATUS';
const CATEGORY_GROUP_ID = 'T_CATEGORY';
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const FALLBACK_STATUSES: CodeOption[] = [
  { code: 'RESERVED', label: '예약중', order: 1 },
  { code: 'COMPLETED', label: '완료', order: 2 },
  { code: 'CANCELLED', label: '예약취소', order: 3 },
];

const FALLBACK_CATEGORIES: CodeOption[] = [
  { code: 'CUT', label: '커트', order: 1 },
  { code: 'PERM', label: '파마', order: 2 },
  { code: 'COLOR', label: '염색', order: 3 },
];

const FALLBACK_STATUS_LABEL_MAP: Record<string, string> = {
  RESERVED: '예약중',
  COMPLETED: '완료',
  CANCELLED: '예약취소',
};

// 예약 데이터는 항상 DB에서 불러오므로 초기값은 빈 배열로 유지한다.
const INITIAL_RESERVATIONS: ReservationRecord[] = [];

function toIsoDate(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function todayIso() {
  return toIsoDate(new Date());
}

function parseIsoDate(iso: string) {
  const [y, m, d] = iso.split('-').map((value) => Number(value));
  return new Date(y, (m || 1) - 1, d || 1);
}

function shiftDate(iso: string, diffDays: number) {
  const base = parseIsoDate(iso);
  base.setDate(base.getDate() + diffDays);
  return toIsoDate(base);
}

function formatCurrency(value: number) {
  return `${value.toLocaleString('ko-KR')}원`;
}

function formatMonthLabel(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}.${mm}`;
}

function formatDateLabel(isoDate: string) {
  const date = parseIsoDate(isoDate);
  const dayOfWeek = WEEKDAY_LABELS[date.getDay()];
  return `${isoDate} (${dayOfWeek})`;
}

function buildCalendarCells(monthCursor: Date) {
  const firstDay = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const startOffset = firstDay.getDay();
  return Array.from({ length: 42 }, (_, index) => {
    const cellDate = new Date(
      monthCursor.getFullYear(),
      monthCursor.getMonth(),
      index - startOffset + 1,
    );
    return {
      date: cellDate,
      isoDate: toIsoDate(cellDate),
      inMonth: cellDate.getMonth() === monthCursor.getMonth(),
    };
  });
}

function getExpectedMinutes(services: ReservationService[]) {
  return services.reduce((sum, service) => sum + service.durationMinutes, 0);
}

function getExpectedAmount(services: ReservationService[]) {
  return services.reduce((sum, service) => sum + service.unitPrice, 0);
}

function normalizeStatusText(code: string, label: string) {
  return `${code} ${label}`.toUpperCase();
}

function getStatusTone(code: string, label: string): StatusTone {
  const normalized = normalizeStatusText(code, label);
  if (normalized.includes('CANCEL') || label.includes('취소')) {
    return {
      badge: 'bg-rose-50 text-rose-700 border-rose-200',
      chip: 'bg-rose-100 text-rose-700',
      dot: 'bg-rose-500',
    };
  }
  if (normalized.includes('COMPLETE') || label.includes('완료')) {
    return {
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      chip: 'bg-emerald-100 text-emerald-700',
      dot: 'bg-emerald-500',
    };
  }
  return {
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    chip: 'bg-sky-100 text-sky-700',
    dot: 'bg-sky-500',
  };
}

function sortReservations(items: ReservationRecord[]) {
  return [...items].sort((a, b) => {
    const dateCompare = a.reservationDate.localeCompare(b.reservationDate);
    if (dateCompare !== 0) return dateCompare;
    return a.startTime.localeCompare(b.startTime);
  });
}

// DB 응답(row) 구조를 화면에서 쓰는 예약 구조로 변환한다.
function mapReservationRowToRecord(row: ReservationRow): ReservationRecord {
  return {
    id: row.reservation_id,
    reservationDate: row.reservation_date,
    startTime: row.start_time,
    customerName: row.customer_name,
    designerName: row.designer_name,
    status: row.status,
    note: row.note || '',
    services: (row.services || []).map((service) => ({
      lineId: service.line_id,
      serviceId: service.service_id,
      categoryCode: service.category_code,
      categoryName: service.category_name,
      serviceName: service.service_name,
      unitPrice: service.unit_price,
      durationMinutes: service.duration_minutes,
    })),
  };
}

// 새로 추가하는 시술의 임시 lineId가 기존 DB lineId와 겹치지 않도록 보정한다.
function getNextLineIdSeed(items: ReservationRecord[]) {
  const maxLineId = items.reduce((max, reservation) => {
    const currentMax = reservation.services.reduce(
      (lineMax, service) => Math.max(lineMax, service.lineId),
      0,
    );
    return Math.max(max, currentMax);
  }, 0);

  return Math.max(maxLineId + 1, 2000);
}

// 이름 목록은 중복/공백 제거 후 한글 정렬로 맞춰 셀렉트 품질을 일정하게 유지한다.
function toUniqueSortedNames(items: string[]) {
  return Array.from(
    new Set(
      items
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b, 'ko'));
}

function createEmptyForm(
  date: string,
  status: string,
  category: string,
  selectedServiceId = '',
): ReservationForm {
  return {
    reservationDate: date,
    startTime: '10:00',
    customerName: '',
    designerName: '',
    status,
    note: '',
    selectedCategory: category,
    selectedServiceId,
    services: [],
  };
}

export default function ReservationCalendarPage() {
  const [statusOptions, setStatusOptions] = useState<CodeOption[]>(FALLBACK_STATUSES);
  const [categories, setCategories] = useState<CodeOption[]>(FALLBACK_CATEGORIES);
  const [serviceItems, setServiceItems] = useState<ServiceItem[]>([]);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [designerNames, setDesignerNames] = useState<string[]>([]);
  const [reservations, setReservations] = useState<ReservationRecord[]>(INITIAL_RESERVATIONS);
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [viewMode, setViewMode] = useState<ReservationViewMode>('calendar');
  const modalDragControls = useDragControls();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [nextLineId, setNextLineId] = useState(2000);
  const [form, setForm] = useState<ReservationForm>(() =>
    createEmptyForm(
      todayIso(),
      FALLBACK_STATUSES[0].code,
      FALLBACK_CATEGORIES[0].code,
      '',
    ),
  );

  const isDbBusy = isLoading || isMutating;

  const statusMap = useMemo(
    () => new Map(statusOptions.map((status) => [status.code, status])),
    [statusOptions],
  );

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.code, category])),
    [categories],
  );

  const monthKey = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, '0')}`;
  const calendarCells = useMemo(() => buildCalendarCells(monthCursor), [monthCursor]);

  const reservationsByDate = useMemo(() => {
    const map = new Map<string, ReservationRecord[]>();
    reservations.forEach((reservation) => {
      const current = map.get(reservation.reservationDate) || [];
      current.push(reservation);
      map.set(reservation.reservationDate, current);
    });
    map.forEach((value, key) => {
      map.set(
        key,
        [...value].sort((a, b) => a.startTime.localeCompare(b.startTime)),
      );
    });
    return map;
  }, [reservations]);

  const selectedDateReservations = useMemo(
    () => reservationsByDate.get(selectedDate) || [],
    [reservationsByDate, selectedDate],
  );

  const dailyReservationGroups = useMemo(() => {
    return Array.from(reservationsByDate.entries())
      .filter(([date]) => date.startsWith(monthKey))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({ date, items }));
  }, [reservationsByDate, monthKey]);

  const categoryServices = useMemo(() => {
    return serviceItems.filter((service) => service.categoryCode === form.selectedCategory);
  }, [serviceItems, form.selectedCategory]);

  const selectedService = useMemo(
    () => categoryServices.find((service) => String(service.id) === form.selectedServiceId) || null,
    [categoryServices, form.selectedServiceId],
  );

  const formExpectedMinutes = useMemo(
    () => getExpectedMinutes(form.services),
    [form.services],
  );

  const formExpectedAmount = useMemo(
    () => getExpectedAmount(form.services),
    [form.services],
  );

  // 공통코드/시술목록 조회: 예약 폼에서 쓰는 선택값을 준비한다.
  const loadLookupData = async () => {
    const [commonResult, serviceResult, memberResult, employeeResult] = await Promise.all([
      invokeDbCommand<{
        success: boolean;
        message: string;
        details: Array<{
          group: string;
          code: string;
          name: string;
          order: number;
          use_yn: 'Y' | 'N';
        }>;
      }>('get_common_code_management_data'),
      invokeDbCommand<{
        success: boolean;
        message: string;
        items: Array<{
          service_id: number;
          category_code: string;
          category_name: string;
          service_name: string;
          unit_price: number;
          duration_minutes: number;
          use_yn: 'Y' | 'N';
          note: string | null;
        }>;
      }>('get_service_catalog_data'),
      invokeDbCommand<{
        success: boolean;
        message: string;
        users: Array<{
          user_id: number;
          name: string;
        }>;
      }>('get_user_management_data'),
      invokeDbCommand<{
        success: boolean;
        message: string;
        employees: Array<{
          employee_id: number;
          employee_name: string;
        }>;
      }>('get_employee_management_data'),
    ]);

    const details = commonResult.details || [];
    const loadedStatuses = details
      .filter((detail) => detail.group === STATUS_GROUP_ID && detail.use_yn === 'Y')
      .sort(
        (a, b) => (a.order - b.order) || a.code.localeCompare(b.code),
      )
      .map((detail) => ({
        code: detail.code,
        label: detail.name,
        order: detail.order,
      }));

    const loadedServices = (serviceResult.items || [])
      .filter((item) => item.use_yn === 'Y')
      .map((item) => ({
        id: item.service_id,
        categoryCode: item.category_code,
        categoryName: item.category_name || item.category_code,
        serviceName: item.service_name,
        unitPrice: item.unit_price,
        durationMinutes: item.duration_minutes,
      }))
      .sort((a, b) => {
        const categoryCompare = a.categoryCode.localeCompare(b.categoryCode);
        if (categoryCompare !== 0) return categoryCompare;
        return a.serviceName.localeCompare(b.serviceName);
      });

    const loadedCategories = details
      .filter((detail) => detail.group === CATEGORY_GROUP_ID && detail.use_yn === 'Y')
      .sort(
        (a, b) => (a.order - b.order) || a.code.localeCompare(b.code),
      )
      .map((detail) => ({
        code: detail.code,
        label: detail.name,
        order: detail.order,
      }));

    const serviceDerivedCategories = Array.from(
      loadedServices.reduce((map, item) => {
        if (!map.has(item.categoryCode)) {
          map.set(item.categoryCode, {
            code: item.categoryCode,
            label: item.categoryName,
            order: map.size + 1,
          });
        }
        return map;
      }, new Map<string, CodeOption>()),
    ).map(([, value]) => value);

    const nextStatuses =
      loadedStatuses.length > 0 ? loadedStatuses : FALLBACK_STATUSES;
    const nextCategories =
      loadedCategories.length > 0
        ? loadedCategories
        : serviceDerivedCategories.length > 0
          ? serviceDerivedCategories
          : FALLBACK_CATEGORIES;

    // 고객/디자이너는 각각 회원/직원 테이블의 이름 목록을 선택 소스로 사용한다.
    const nextMemberNames = toUniqueSortedNames(
      (memberResult.users || []).map((user) => user.name || ''),
    );
    const nextDesignerNames = toUniqueSortedNames(
      (employeeResult.employees || []).map((employee) => employee.employee_name || ''),
    );

    setStatusOptions(nextStatuses);
    setCategories(nextCategories);
    setServiceItems(loadedServices);
    setMemberNames(nextMemberNames);
    setDesignerNames(nextDesignerNames);
  };

  // 예약 목록 조회: 헤더 + 시술라인을 화면에서 쓰는 구조로 변환한다.
  const loadReservations = async () => {
    const result = await invokeDbCommand<{
      success: boolean;
      message: string;
      reservations: ReservationRow[];
    }>('get_reservation_calendar_data');

    const mappedReservations = sortReservations(
      (result.reservations || []).map((row) => mapReservationRowToRecord(row)),
    );
    setReservations(mappedReservations);
    setNextLineId(getNextLineIdSeed(mappedReservations));
  };

  // 초기 진입 시 조회성 데이터는 한 번에 불러와 화면 깜빡임을 줄인다.
  const loadInitialData = async () => {
    try {
      setIsLoading(true);
      await Promise.all([loadLookupData(), loadReservations()]);
    } catch (error) {
      console.error('Failed to load reservation page data:', error);
      setStatusOptions(FALLBACK_STATUSES);
      setCategories(FALLBACK_CATEGORIES);
      setMemberNames([]);
      setDesignerNames([]);
      setReservations([]);
      alert(
        typeof error === 'string'
          ? error
          : (error as { message?: string })?.message || '예약 데이터를 불러오지 못했습니다.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setForm((prev) => {
      const nextStatus = statusOptions.some((status) => status.code === prev.status)
        ? prev.status
        : (statusOptions[0]?.code || prev.status);

      const nextCategory = categories.some((category) => category.code === prev.selectedCategory)
        ? prev.selectedCategory
        : (categories[0]?.code || prev.selectedCategory);

      const nextCategoryServices = serviceItems.filter(
        (service) => service.categoryCode === nextCategory,
      );
      const nextSelectedService = nextCategoryServices.some(
        (service) => String(service.id) === prev.selectedServiceId,
      )
        ? prev.selectedServiceId
        : (nextCategoryServices[0] ? String(nextCategoryServices[0].id) : '');

      if (
        nextStatus === prev.status
        && nextCategory === prev.selectedCategory
        && nextSelectedService === prev.selectedServiceId
      ) {
        return prev;
      }

      return {
        ...prev,
        status: nextStatus,
        selectedCategory: nextCategory,
        selectedServiceId: nextSelectedService,
      };
    });
  }, [statusOptions, categories, serviceItems]);

  const getStatusLabel = (statusCode: string) => {
    return (
      statusMap.get(statusCode)?.label
      || FALLBACK_STATUS_LABEL_MAP[statusCode]
      || statusCode
    );
  };

  const openCreateModal = (date = selectedDate) => {
    const defaultStatus = statusOptions[0]?.code || FALLBACK_STATUSES[0].code;
    const defaultCategory =
      categories[0]?.code || serviceItems[0]?.categoryCode || FALLBACK_CATEGORIES[0].code;
    const defaultServiceId =
      serviceItems.find((service) => service.categoryCode === defaultCategory)?.id;
    const defaultDesignerName = designerNames[0] || '';

    setModalMode('create');
    setEditingId(null);
    setForm(
      {
        ...createEmptyForm(
          date,
          defaultStatus,
          defaultCategory,
          defaultServiceId ? String(defaultServiceId) : '',
        ),
        // 디자이너는 직원 목록에서 선택하는 구조라 첫 번째 직원을 기본값으로 둔다.
        designerName: defaultDesignerName,
      },
    );
    setIsModalOpen(true);
  };

  const openEditModal = (reservation: ReservationRecord) => {
    const preferredCategory =
      reservation.services[0]?.categoryCode
      || categories[0]?.code
      || serviceItems[0]?.categoryCode
      || FALLBACK_CATEGORIES[0].code;
    const defaultServiceId =
      serviceItems.find((service) => service.categoryCode === preferredCategory)?.id;

    setModalMode('edit');
    setEditingId(reservation.id);
    setForm({
      reservationDate: reservation.reservationDate,
      startTime: reservation.startTime,
      customerName: reservation.customerName,
      designerName: reservation.designerName,
      status: reservation.status,
      note: reservation.note,
      selectedCategory: preferredCategory,
      selectedServiceId: defaultServiceId ? String(defaultServiceId) : '',
      services: reservation.services.map((service, index) => ({
        ...service,
        lineId: service.lineId || Date.now() + index,
      })),
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const addSelectedService = () => {
    if (!selectedService) {
      alert('시술 항목을 선택해 주세요.');
      return;
    }

    if (form.services.some((service) => service.serviceId === selectedService.id)) {
      alert('이미 추가된 시술 항목입니다.');
      return;
    }

    setForm((prev) => ({
      ...prev,
      services: [
        ...prev.services,
        {
          lineId: nextLineId,
          serviceId: selectedService.id,
          categoryCode: selectedService.categoryCode,
          categoryName:
            categoryMap.get(selectedService.categoryCode)?.label || selectedService.categoryName,
          serviceName: selectedService.serviceName,
          unitPrice: selectedService.unitPrice,
          durationMinutes: selectedService.durationMinutes,
        },
      ],
    }));
    setNextLineId((prev) => prev + 1);
  };

  const removeService = (lineId: number) => {
    setForm((prev) => ({
      ...prev,
      services: prev.services.filter((service) => service.lineId !== lineId),
    }));
  };

  // 예약 등록/수정: 헤더 + 시술 service_id 목록을 함께 DB에 저장한다.
  const saveReservation = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!form.reservationDate || !form.startTime) {
      alert('예약 날짜와 시간을 입력해 주세요.');
      return;
    }
    if (!form.customerName.trim() || !form.designerName.trim()) {
      alert('고객명과 디자이너를 입력해 주세요.');
      return;
    }
    if (!form.status) {
      alert('예약 상태를 선택해 주세요.');
      return;
    }
    if (form.services.length === 0) {
      alert('시술 항목을 1건 이상 추가해 주세요.');
      return;
    }

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>(
        'upsert_reservation_calendar_item',
        {
          item: {
            reservation_id: modalMode === 'edit' ? editingId : undefined,
            reservation_date: form.reservationDate,
            start_time: form.startTime,
            customer_name: form.customerName.trim(),
            designer_name: form.designerName.trim(),
            status: form.status,
            note: form.note.trim() || null,
            service_ids: form.services.map((service) => service.serviceId),
          },
        },
      );

      await loadReservations();
      setSelectedDate(form.reservationDate);
      closeModal();
      alert(result.message || (modalMode === 'edit' ? '예약 수정이 완료되었습니다.' : '예약 등록이 완료되었습니다.'));
    } catch (error) {
      alert(
        typeof error === 'string'
          ? error
          : (error as { message?: string })?.message || '예약 저장에 실패했습니다.',
      );
    } finally {
      setIsMutating(false);
    }
  };

  // 예약 삭제: 헤더를 삭제하면 시술 라인도 CASCADE로 함께 정리된다.
  const deleteReservation = async (reservationId: number) => {
    if (!window.confirm('선택한 예약을 삭제하시겠습니까?')) return;

    try {
      setIsMutating(true);
      const result = await invokeDbCommand<{ success: boolean; message: string }>(
        'delete_reservation_calendar_item',
        { reservation_id: reservationId },
      );
      await loadReservations();
      alert(result.message || '예약이 삭제되었습니다.');
    } catch (error) {
      alert(
        typeof error === 'string'
          ? error
          : (error as { message?: string })?.message || '예약 삭제에 실패했습니다.',
      );
    } finally {
      setIsMutating(false);
    }
  };

  const moveMonth = (diff: number) => {
    setMonthCursor(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + diff, 1),
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      {isDbBusy && (
        <div className="fixed inset-0 z-[70] bg-slate-900/20 backdrop-blur-[1px] flex items-center justify-center">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg flex items-center gap-2">
            <Loader2 size={18} className="animate-spin text-primary" />
            <span className="text-sm font-semibold text-slate-700">
              {isMutating ? '저장중...' : '로딩중...'}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">예약 캘린더 관리</h1>
          <p className="text-slate-500 mt-1">
            예약 등록/수정/상태 변경을 팝업에서 처리하고, 캘린더와 일별 리스트를 함께 관리합니다.
          </p>
        </div>
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1">
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${viewMode === 'calendar' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Calendar
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${viewMode === 'list' ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            List
          </button>
        </div>
        <button
          onClick={() => openCreateModal(selectedDate)}
          disabled={isDbBusy}
          className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2.5 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-60"
        >
          <PlusCircle size={16} />
          예약 등록
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section
          className={`${viewMode === 'calendar' ? 'xl:col-span-12' : 'hidden'} bg-white border border-slate-200 rounded-xl overflow-hidden grid-shadow`}
        >
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-primary" />
              <h2 className="text-sm font-bold text-slate-700">월간 예약 캘린더</h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => moveMonth(-1)}
                className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600"
                aria-label="previous-month"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="w-28 text-center text-sm font-bold text-slate-800">
                {formatMonthLabel(monthCursor)}
              </div>
              <button
                onClick={() => moveMonth(1)}
                className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600"
                aria-label="next-month"
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => {
                  const now = new Date();
                  setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
                  setSelectedDate(todayIso());
                }}
                className="px-2.5 py-1.5 rounded-md text-xs font-semibold border border-slate-200 hover:bg-slate-100 text-slate-600"
              >
                Today
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-100">
            {WEEKDAY_LABELS.map((weekday) => (
              <div
                key={weekday}
                className="px-2 py-2 text-center text-xs font-bold text-slate-600 border-r border-slate-200 last:border-r-0"
              >
                {weekday}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {calendarCells.map((cell) => {
              const dayReservations = reservationsByDate.get(cell.isoDate) || [];
              const isToday = cell.isoDate === todayIso();
              const isSelected = cell.isoDate === selectedDate;

              return (
                <button
                  key={cell.isoDate}
                  onClick={() => setSelectedDate(cell.isoDate)}
                  className={`min-h-[126px] border-r border-b border-slate-200 p-2 align-top text-left transition-colors ${cell.inMonth ? 'bg-white hover:bg-slate-50' : 'bg-slate-50 text-slate-400'} ${isSelected ? 'ring-2 ring-primary/40 ring-inset' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${isToday ? 'text-primary' : ''}`}>{cell.date.getDate()}</span>
                    {dayReservations.length > 0 && (
                      <span className="text-[10px] font-semibold text-slate-400">
                        {dayReservations.length}건
                      </span>
                    )}
                  </div>

                  <div className="mt-1 space-y-1">
                    {dayReservations.slice(0, 3).map((reservation) => {
                      const statusLabel = getStatusLabel(reservation.status);
                      const tone = getStatusTone(reservation.status, statusLabel);
                      return (
                        <button
                          key={reservation.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditModal(reservation);
                          }}
                          disabled={isDbBusy}
                          className={`w-full text-left rounded px-1.5 py-1 text-[10px] font-semibold truncate ${tone.chip}`}
                        >
                          {reservation.startTime} {reservation.customerName}
                        </button>
                      );
                    })}
                    {dayReservations.length > 3 && (
                      <p className="text-[10px] text-slate-400 font-semibold pl-1">
                        +{dayReservations.length - 3}건 더보기
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="hidden xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden grid-shadow">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-700">선택일 예약 목록</h2>
              <p className="text-xs text-slate-500 mt-1">{formatDateLabel(selectedDate)}</p>
            </div>
            <button
              onClick={() => openCreateModal(selectedDate)}
              disabled={isDbBusy}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-60"
            >
              선택일 등록
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[760px]">
              <thead>
                <tr className="bg-slate-900 text-slate-200">
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">시간</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">고객</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">디자이너</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider">시술</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-right">예상금액</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-center">상태</th>
                  <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-center">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selectedDateReservations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-sm text-slate-400">
                      선택한 날짜의 예약이 없습니다.
                    </td>
                  </tr>
                ) : (
                  selectedDateReservations.map((reservation) => {
                    const statusLabel = getStatusLabel(reservation.status);
                    const tone = getStatusTone(reservation.status, statusLabel);
                    return (
                      <tr key={reservation.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 text-sm font-semibold text-slate-700">{reservation.startTime}</td>
                        <td className="py-3 px-4 text-sm text-slate-700">
                          <div className="flex items-center gap-2">
                            <UserRound size={14} className="text-slate-400" />
                            <span className="font-semibold">{reservation.customerName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-sm text-slate-600">{reservation.designerName}</td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {reservation.services.map((service) => service.serviceName).join(', ')}
                        </td>
                        <td className="py-3 px-4 text-sm text-right font-semibold text-slate-700">
                          {formatCurrency(getExpectedAmount(reservation.services))}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border ${tone.badge}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openEditModal(reservation)}
                              disabled={isDbBusy}
                              className="p-1.5 rounded text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                              title="수정"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => deleteReservation(reservation.id)}
                              disabled={isDbBusy}
                              className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              title="삭제"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {viewMode === 'list' && (
      <section className="mt-6 bg-white border border-slate-200 rounded-xl overflow-hidden grid-shadow">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2 md:order-2">
            <button
              onClick={() => moveMonth(-1)}
              className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600"
              aria-label="previous-month"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="w-28 text-center text-sm font-bold text-slate-800">
              {formatMonthLabel(monthCursor)}
            </div>
            <button
              onClick={() => moveMonth(1)}
              className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-600"
              aria-label="next-month"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => {
                const now = new Date();
                setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
                setSelectedDate(todayIso());
              }}
              className="px-2.5 py-1.5 rounded-md text-xs font-semibold border border-slate-200 hover:bg-slate-100 text-slate-600"
            >
                Today
              </button>
          </div>
          <h2 className="text-sm font-bold text-slate-700">일별 예약 리스트 ({formatMonthLabel(monthCursor)})</h2>
        </div>

        <div className="p-4 space-y-4">
          {dailyReservationGroups.length === 0 ? (
            <p className="text-sm text-slate-400">해당 월에 예약이 없습니다.</p>
          ) : (
            dailyReservationGroups.map((group) => (
              <div key={group.date} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-700">{formatDateLabel(group.date)}</p>
                  <span className="text-xs font-semibold text-slate-500">{group.items.length}건</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left min-w-[900px]">
                    <thead>
                      <tr className="bg-slate-900 text-slate-200">
                        <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">시간</th>
                        <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">고객</th>
                        <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">디자이너</th>
                        <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">예상시간</th>
                        <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider text-right">예상금액</th>
                        <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider text-center">상태</th>
                        <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider">비고</th>
                        <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wider text-center">작업</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {group.items.map((reservation) => {
                        const statusLabel = getStatusLabel(reservation.status);
                        const tone = getStatusTone(reservation.status, statusLabel);
                        return (
                          <tr key={reservation.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-2.5 px-4 text-sm font-semibold text-slate-700">{reservation.startTime}</td>
                            <td className="py-2.5 px-4 text-sm text-slate-700">{reservation.customerName}</td>
                            <td className="py-2.5 px-4 text-sm text-slate-600">{reservation.designerName}</td>
                            <td className="py-2.5 px-4 text-sm text-slate-600">
                              {getExpectedMinutes(reservation.services)}분
                            </td>
                            <td className="py-2.5 px-4 text-sm text-right font-semibold text-slate-700">
                              {formatCurrency(getExpectedAmount(reservation.services))}
                            </td>
                            <td className="py-2.5 px-4 text-center">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold border ${tone.badge}`}>
                                {statusLabel}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-sm text-slate-500">{reservation.note || '-'}</td>
                            <td className="py-2.5 px-4">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => openEditModal(reservation)}
                                  disabled={isDbBusy}
                                  className="p-1.5 rounded text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                                  title="수정"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => deleteReservation(reservation.id)}
                                  disabled={isDbBusy}
                                  className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                  title="삭제"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      )}

      {isModalOpen && (
        <div
          className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <motion.div
            drag
            dragControls={modalDragControls}
            dragListener={false}
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-5xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              onPointerDown={(event) => modalDragControls.start(event)}
              className="px-5 py-4 border-b border-slate-200 flex items-center justify-between cursor-move active:cursor-grabbing"
            >
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  {modalMode === 'edit' ? '예약 수정' : '예약 등록'}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  예약 정보, 상태, 시술 항목을 한 번에 수정할 수 있습니다.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <GripHorizontal size={16} className="text-slate-300" />
                <button
                  onClick={closeModal}
                  disabled={isDbBusy}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  aria-label="close-modal"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <form onSubmit={saveReservation} className="max-h-[calc(90vh-80px)] overflow-y-auto p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">예약일</label>
                  <input
                    type="date"
                    value={form.reservationDate}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, reservationDate: event.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">시간</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(event) => setForm((prev) => ({ ...prev, startTime: event.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">예약상태</label>
                  <select
                    value={form.status}
                    onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    {statusOptions.map((status) => (
                      <option key={status.code} value={status.code}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">고객명</label>
                  <input
                    value={form.customerName}
                    onChange={(event) => setForm((prev) => ({ ...prev, customerName: event.target.value }))}
                    list="reservation-customer-options"
                    placeholder="회원 선택 또는 직접 입력"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                  {/* 고객명은 회원 목록 추천 + 직접 입력을 동시에 허용하기 위해 datalist를 사용한다. */}
                  <datalist id="reservation-customer-options">
                    {memberNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">디자이너</label>
                  <select
                    value={form.designerName}
                    onChange={(event) => setForm((prev) => ({ ...prev, designerName: event.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none bg-white"
                  >
                    <option value="">
                      {designerNames.length > 0 ? '디자이너를 선택해 주세요' : '직원 테이블에 디자이너가 없습니다'}
                    </option>
                    {designerNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    {/* 기존 예약 수정 시, 현재 직원 목록에 없는 이름도 값 유지를 위해 임시 옵션으로 노출한다. */}
                    {form.designerName && !designerNames.includes(form.designerName) && (
                      <option value={form.designerName}>
                        {form.designerName} (기존값)
                      </option>
                    )}
                  </select>
                </div>

                <div className="space-y-1 md:col-span-2 lg:col-span-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">비고</label>
                  <input
                    value={form.note}
                    onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                    placeholder="특이사항 입력"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <section className="lg:col-span-5 border border-slate-200 rounded-xl p-4 bg-slate-50/60">
                  <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-3">
                    <Scissors size={16} className="text-primary" />
                    시술 선택
                  </h4>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">카테고리</label>
                      <select
                        value={form.selectedCategory}
                        onChange={(event) => {
                          const nextCategory = event.target.value;
                          const firstService = serviceItems.find(
                            (service) => service.categoryCode === nextCategory,
                          );
                          setForm((prev) => ({
                            ...prev,
                            selectedCategory: nextCategory,
                            selectedServiceId: firstService ? String(firstService.id) : '',
                          }));
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary/20 outline-none"
                      >
                        {categories.map((category) => (
                          <option key={category.code} value={category.code}>
                            {category.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">시술 항목</label>
                      <select
                        value={form.selectedServiceId}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, selectedServiceId: event.target.value }))
                        }
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary/20 outline-none"
                      >
                        {categoryServices.length === 0 ? (
                          <option value="">등록된 시술이 없습니다</option>
                        ) : (
                          categoryServices.map((service) => (
                            <option key={service.id} value={String(service.id)}>
                              {service.serviceName} ({service.durationMinutes}분 / {formatCurrency(service.unitPrice)})
                            </option>
                          ))
                        )}
                      </select>
                    </div>

                    {selectedService && (
                      <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 space-y-1">
                        <p className="font-semibold text-slate-700">{selectedService.serviceName}</p>
                        <p>예상시간: {selectedService.durationMinutes}분</p>
                        <p>단가: {formatCurrency(selectedService.unitPrice)}</p>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={addSelectedService}
                      disabled={!selectedService || isDbBusy}
                      className="w-full bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                    >
                      <PlusCircle size={16} />
                      선택 시술 추가
                    </button>
                  </div>
                </section>

                <section className="lg:col-span-7 border border-slate-200 rounded-xl p-4">
                  <h4 className="text-sm font-bold text-slate-700 mb-3">추가된 시술 내역</h4>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left min-w-[620px]">
                      <thead>
                        <tr className="bg-slate-900 text-slate-200">
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider">카테고리</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider">시술명</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-right">예상시간</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-right">단가</th>
                          <th className="py-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-center">삭제</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {form.services.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-sm text-slate-400">
                              아직 추가된 시술이 없습니다.
                            </td>
                          </tr>
                        ) : (
                          form.services.map((service) => (
                            <tr key={service.lineId} className="hover:bg-slate-50 transition-colors">
                              <td className="py-2.5 px-3 text-sm text-slate-700">{service.categoryName}</td>
                              <td className="py-2.5 px-3 text-sm font-semibold text-slate-700">{service.serviceName}</td>
                              <td className="py-2.5 px-3 text-sm text-right text-slate-600">{service.durationMinutes}분</td>
                              <td className="py-2.5 px-3 text-sm text-right font-semibold text-slate-700">
                                {formatCurrency(service.unitPrice)}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeService(service.lineId)}
                                  disabled={isDbBusy}
                                  className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1">
                <div className="flex flex-wrap gap-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="text-xs font-bold text-slate-500 uppercase">예상 작업시간</p>
                    <p className="font-black text-slate-900 mt-1">{formExpectedMinutes}분</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="text-xs font-bold text-slate-500 uppercase">예상 금액</p>
                    <p className="font-black text-slate-900 mt-1">{formatCurrency(formExpectedAmount)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={isDbBusy}
                    className="px-4 py-2.5 rounded-lg text-sm font-bold bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={isDbBusy}
                    className="px-4 py-2.5 rounded-lg text-sm font-bold text-white bg-primary hover:bg-primary/90 flex items-center gap-2"
                  >
                    <Clock3 size={15} />
                    {modalMode === 'edit' ? '예약 수정 저장' : '예약 등록'}
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
