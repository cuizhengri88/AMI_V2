import type { PaymentMethodOption, Reservation } from './types';

export const FALLBACK_PAYMENT_METHODS: PaymentMethodOption[] = [
    { code: 'CASH', name: 'CASH', order: 1 },
    { code: 'CARD', name: 'CARD', order: 2 },
    { code: 'WECHAT', name: 'WECHAT', order: 3 },
    { code: 'ALIPAY', name: 'ALIPAY', order: 4 },
    { code: 'PREPAID', name: 'PREPAID', order: 5 },
    { code: 'COUPON', name: 'COUPON', order: 6 },
];

export const EMPTY_RESERVATIONS: Reservation[] = [];
