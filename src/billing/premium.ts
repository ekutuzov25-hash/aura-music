/**
 * Client side of AURA Premium. The subscription itself always comes from
 * the server (which only trusts confirmed YooKassa payments); nothing here
 * can grant Premium on its own.
 */
import { create } from 'zustand';
import { accessToken, useAuth } from '../auth/auth';
import type { PlanId } from './plans';

/** Desktop builds can point billing at a deployed server (see README). */
const BASE = ((import.meta.env.VITE_BILLING_API_URL as string | undefined) ?? '').replace(/\/$/, '');

export interface Subscription {
  plan: PlanId;
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

export const usePremium = create<PremiumState>((set, get) => ({
  config: null,
  subscription: null,
  loading: false,
  async refresh() {
    set({ loading: true });
    try {
      const config = await api<PremiumState['config']>('config');
      set({ config });
      if (config?.accounts && useAuth.getState().user) {
        const { subscription } = await api<{ subscription: Subscription | null }>('subscription');
        set({ subscription });
      } else set({ subscription: null });
    } catch {
      set({ config: get().config ?? { accounts: false, payments: false, testMode: false } });
    } finally {
      set({ loading: false });
    }
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
