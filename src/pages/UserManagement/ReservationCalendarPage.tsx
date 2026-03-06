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

const INITIAL_RESERVATIONS: ReservationRecord[] = [
  {
    id: 1,
    reservationDate: todayIso(),
    startTime: '10:30',
    customerName: '김서연',
    designerName: '지우 디자이너',
    status: 'RESERVED',
    note: '첫 방문',
    services: [
      {
        lineId: 1001,
        serviceId: 1,
        categoryCode: 'CUT',
        categoryName: '커트',
        serviceName: '여성 커트',
        unitPrice: 30000,
        durationMinutes: 50,
      },
      {
        lineId: 1002,
        serviceId: 2,
        categoryCode: 'COLOR',
        categoryName: '염색',
        serviceName: '뿌리 염색',
        unitPrice: 70000,
        durationMinutes: 80,
      },
    ],
  },
  {
    id: 2,
    reservationDate: todayIso(),
    startTime: '14:00',
    customerName: '박민지',
    designerName: '리안 디자이너',
    status: 'COMPLETED',
    note: '',
    services: [
      {
        lineId: 1003,
        serviceId: 3,
        categoryCode: 'PERM',
        categoryName: '파마',
        serviceName: '디지털 펌',
        unitPrice: 120000,
        durationMinutes: 120,
      },
    ],
  },
  {
    id: 3,
    reservationDate: shiftDate(todayIso(), 1),
    startTime: '11:00',
    customerName: '최하윤',
    designerName: '민아 디자이너',
    status: 'CANCELLED',
    note: '고객 일정 변경',
    services: [
      {
        lineId: 1004,
        serviceId: 4,
        categoryCode: 'CUT',
        categoryName: '커트',
        serviceName: '남성 커트',
        unitPrice: 25000,
        durationMinutes: 40,
      },
    ],
  },
];

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
  const [reservations, setReservations] = useState<ReservationRecord[]>(INITIAL_RESERVATIONS);
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [isLoading, setIsLoading] = useState(false);
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

  useEffect(() => {
    const loadLookupData = async () => {
      try {
        setIsLoading(true);

        const [commonResult, serviceResult] = await Promise.all([
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

        setStatusOptions(nextStatuses);
        setCategories(nextCategories);
        setServiceItems(loadedServices);
      } catch (error) {
        console.error('Failed to load reservation lookups:', error);
        setStatusOptions(FALLBACK_STATUSES);
        setCategories(FALLBACK_CATEGORIES);
      } finally {
        setIsLoading(false);
      }
    };

    loadLookupData();
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

    setModalMode('create');
    setEditingId(null);
    setForm(
      createEmptyForm(
        date,
        defaultStatus,
        defaultCategory,
        defaultServiceId ? String(defaultServiceId) : '',
      ),
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

  const saveReservation = (event: React.FormEvent) => {
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

    setReservations((prev) => {
      const normalized: ReservationRecord = {
        id: editingId ?? 0,
        reservationDate: form.reservationDate,
        startTime: form.startTime,
        customerName: form.customerName.trim(),
        designerName: form.designerName.trim(),
        status: form.status,
        note: form.note.trim(),
        services: form.services.map((service) => ({ ...service })),
      };

      if (modalMode === 'edit' && editingId !== null) {
        return sortReservations(
          prev.map((reservation) =>
            reservation.id === editingId
              ? { ...normalized, id: editingId }
              : reservation,
          ),
        );
      }

      const nextId = prev.length > 0 ? Math.max(...prev.map((item) => item.id)) + 1 : 1;
      return sortReservations([{ ...normalized, id: nextId }, ...prev]);
    });

    setSelectedDate(form.reservationDate);
    closeModal();
  };

  const deleteReservation = (reservationId: number) => {
    if (!window.confirm('선택한 예약을 삭제하시겠습니까?')) return;
    setReservations((prev) => prev.filter((reservation) => reservation.id !== reservationId));
  };

  const moveMonth = (diff: number) => {
    setMonthCursor(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + diff, 1),
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      {isLoading && (
        <div className="fixed inset-0 z-[70] bg-slate-900/20 backdrop-blur-[1px] flex items-center justify-center">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-lg flex items-center gap-2">
            <Loader2 size={18} className="animate-spin text-primary" />
            <span className="text-sm font-semibold text-slate-700">로딩중...</span>
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
          className="bg-primary hover:bg-primary/90 text-white text-sm font-bold px-4 py-2.5 rounded-lg flex items-center gap-2 transition-colors"
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
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-primary hover:bg-primary/90"
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
                              className="p-1.5 rounded text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                              title="수정"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => deleteReservation(reservation.id)}
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
                                  className="p-1.5 rounded text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                                  title="수정"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => deleteReservation(reservation.id)}
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
                    placeholder="예: 김서연"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">디자이너</label>
                  <input
                    value={form.designerName}
                    onChange={(event) => setForm((prev) => ({ ...prev, designerName: event.target.value }))}
                    placeholder="예: 지우 디자이너"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  />
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
                      disabled={!selectedService}
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
                    className="px-4 py-2.5 rounded-lg text-sm font-bold bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
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
