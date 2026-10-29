/**
 * Client side of AURA Premium. Premium is granted only by the database:
 * either by the server after a confirmed YooKassa payment, or by the
 * redeem_promo() function for a valid unused promo code. The client just
 * reads the user's own subscription row (allowed by RLS) — nothing here can
 * grant Premium on its own.
 */
import { create } from 'zustand';
import { accessToken, supabase, useAuth } from '../auth/auth';
import type { PlanId } from './plans';

/** Desktop builds can point billing at a deployed server (see README). */
const BASE = ((import.meta.env.VITE_BILLING_API_URL as string | undefined) ?? '').replace(/\/$/, '');

export interface Subscription {
  plan: PlanId | 'lifetime';
  status: 'active' | 'expired' | 'canceled';
  current_period_end: string;
}

interface PremiumState {
  config: { accounts: boolean; payments: boolean; testMode: boolean } | null;
  subscription: Subscription | null;
  loading: boolean;
  refresh(): Promise<void>;
  checkout(plan: PlanId): Promise<{ orderId: string; confirmationUrl: string }>;
  confirm(orderId: string): Promise<'pending' | 'succeeded' | 'canceled'>;
  redeemPromo(code: string): Promise<Subscription>;
}

const PROMO_ERRORS: Record<string, string> = {
  not_signed_in: 'Войдите в аккаунт, чтобы активировать промокод',
  invalid_code: 'Такого промокода нет. Проверьте, что он введён без ошибок',
  already_used: 'Этот промокод уже активирован на другом аккаунте',
  already_lifetime: 'У вас уже бессрочный Premium — промокод не нужен',
};

/** Normalises whatever the user typed/pasted into AURA-XXXX-XXXX-XXXX. */
export function normalizePromo(raw: string) {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^AURA/, '');
  return s.length === 12 ? `AURA-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}` : raw.trim().toUpperCase();
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${BASE}/api/billing/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Ошибка сервера (${res.status})`);
  return body;
}

export const usePremium = create<PremiumState>((set) => ({
  config: null,
  subscription: null,
  loading: false,
  async refresh() {
    set({ loading: true });
    const user = useAuth.getState().user;
    // The subscription row is read straight from Supabase (RLS: own row only),
    // so Premium works in the desktop app and on the phone without a billing server.
    const sub = supabase && user
      ? supabase.from('subscriptions').select('plan,status,current_period_end').eq('user_id', user.id).maybeSingle()
      : Promise.resolve({ data: null });
    const [cfg, row] = await Promise.all([api<PremiumState['config']>('config').catch(() => null), sub]);
    set({
      config: cfg ?? { accounts: !!supabase, payments: false, testMode: false },
      subscription: (row.data as Subscription | null) ?? null,
      loading: false,
    });
  },
  async redeemPromo(raw) {
    if (!supabase) throw new Error('Аккаунты не подключены');
    const { data, error } = await supabase.rpc('redeem_promo', { p_code: normalizePromo(raw) });
    if (error) {
      const key = Object.keys(PROMO_ERRORS).find((k) => error.message.includes(k));
      throw new Error(key ? PROMO_ERRORS[key] : 'Не удалось активировать промокод. Попробуйте ещё раз');
    }
    const r = (Array.isArray(data) ? data[0] : data) as { sub_plan: Subscription['plan']; sub_end: string };
    const subscription: Subscription = { plan: r.sub_plan, status: 'active', current_period_end: r.sub_end };
    set({ subscription });
    return subscription;
  },
  checkout: (plan) => api('checkout', { method: 'POST', body: JSON.stringify({ plan }) }),
  async confirm(orderId) {
    const r = await api<{ status: 'pending' | 'succeeded' | 'canceled'; subscription: Subscription | null }>('confirm', {
      method: 'POST',
      body: JSON.stringify({ orderId }),
    });
    if (r.subscription) set({ subscription: r.subscription });
    return r.status;
  },
}));

export const isActive = (s: Subscription | null) => !!s && s.status === 'active' && Date.parse(s.current_period_end) > Date.now();

/** true while the signed-in user has an active paid subscription */
export const useIsPremium = () => usePremium((s) => isActive(s.subscription));
export const isPremiumNow = () => isActive(usePremium.getState().subscription);

// Re-check whenever the signed-in user changes.
useAuth.subscribe((s, prev) => {
  if (s.user?.id !== prev.user?.id) void usePremium.getState().refresh();
});
