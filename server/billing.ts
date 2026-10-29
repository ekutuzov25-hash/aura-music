/**
 * AURA Premium billing: YooKassa payments + Supabase as the database.
 *
 * Flow:
 *  1. POST /api/billing/checkout  — the signed-in user picks a plan. We verify
 *     their Supabase session, create a YooKassa payment for the server-side
 *     price, store a pending order and return YooKassa's payment page URL.
 *  2. The user pays on YooKassa's page (card data never touches AURA).
 *  3. YooKassa calls POST /api/billing/webhook, and/or the app calls
 *     POST /api/billing/confirm after returning. Either way we re-fetch the
 *     payment from the YooKassa API (never trusting the incoming body), and
 *     only a "succeeded" payment extends the subscription — exactly once.
 *
 * Secrets (YooKassa secret key, Supabase service-role key) live only here.
 * Docs: https://yookassa.ru/developers/api
 */
import { randomUUID } from 'node:crypto';
import { planById, PLANS, type PlanId } from '../src/billing/plans.ts';
import { HttpError } from './soundcloud.ts';

const env = (k: string) => process.env[k]?.trim() ?? '';
const supaUrl = () => (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/$/, '');
const serviceKey = () => env('SUPABASE_SERVICE_ROLE_KEY');
const shopId = () => env('YOOKASSA_SHOP_ID');
const secretKey = () => env('YOOKASSA_SECRET_KEY');

export function billingConfig() {
  const accounts = Boolean(supaUrl() && serviceKey());
  return {
    accounts,
    payments: accounts && Boolean(shopId() && secretKey()),
    testMode: secretKey().startsWith('test_'),
    plans: PLANS,
  };
}

function requirePayments() {
  if (!billingConfig().payments) throw new HttpError(503, 'Оплата ещё не подключена на сервере');
}

// ───────────── Supabase (service role, server only) ─────────────
async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${supaUrl()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey(),
      // legacy service_role keys are JWTs and go in both headers; new sb_secret_ keys only in `apikey`
      ...(serviceKey().startsWith('sb_') ? {} : { Authorization: `Bearer ${serviceKey()}` }),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new HttpError(502, `Database error ${res.status}`);
  return (await res.json()) as T;
}

/** Validates the user's Supabase access token and returns who they are. */
export async function userFromToken(authHeader: string | undefined) {
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Войдите в аккаунт');
  const res = await fetch(`${supaUrl()}/auth/v1/user`, {
    headers: { apikey: serviceKey(), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new HttpError(401, 'Сессия истекла — войдите снова');
  return (await res.json()) as { id: string; email?: string };
}

interface PaymentRow {
  id: string;
  provider_id: string | null;
  user_id: string;
  plan: PlanId;
  amount: string;
  status: 'pending' | 'succeeded' | 'canceled';
}
interface SubscriptionRow {
  user_id: string;
  plan: PlanId | 'lifetime';
  status: 'active' | 'expired' | 'canceled';
  current_period_end: string;
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  const rows = await db<SubscriptionRow[]>(`subscriptions?user_id=eq.${userId}&select=*`);
  return rows[0] ?? null;
}

// ───────────── YooKassa ─────────────
interface YooPayment {
  id: string;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  paid: boolean;
  amount: { value: string; currency: string };
  confirmation?: { type: string; confirmation_url?: string };
  metadata?: Record<string, string>;
}

async function yoo<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = Buffer.from(`${shopId()}:${secretKey()}`).toString('base64');
  const res = await fetch(`https://api.yookassa.ru/v3/${path}`, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { description?: string };
    console.error('[yookassa]', res.status, body);
    throw new HttpError(502, 'Платёжный сервис временно недоступен');
  }
  return (await res.json()) as T;
}

export async function createCheckout(authHeader: string | undefined, planId: string, returnBase: string) {
  requirePayments();
  const plan = planById(planId);
  if (!plan) throw new HttpError(400, 'Неизвестный тариф');
  const user = await userFromToken(authHeader);
  const existing = await getSubscription(user.id);
  if (existing?.plan === 'lifetime' && existing.status === 'active') throw new HttpError(400, 'У вас уже бессрочный Premium');
  const orderId = randomUUID();
  const value = plan.price.toFixed(2);
  const description = `AURA Premium — ${plan.title}`;

  const payment = await yoo<YooPayment>('payments', {
    method: 'POST',
    headers: { 'Idempotence-Key': orderId },
    body: JSON.stringify({
      amount: { value, currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: `${returnBase}/premium?order=${orderId}` },
      description,
      metadata: { order_id: orderId, user_id: user.id, plan: plan.id },
      // 54-ФЗ: if your shop has YooKassa's online receipts enabled, a receipt is required.
      ...(env('YOOKASSA_RECEIPTS') === 'true' && user.email
        ? {
            receipt: {
              customer: { email: user.email },
              items: [
                {
                  description,
                  quantity: '1.00',
                  amount: { value, currency: 'RUB' },
                  vat_code: Number(env('YOOKASSA_VAT_CODE') || 1),
                  payment_mode: 'full_payment',
                  payment_subject: 'service',
                },
              ],
            },
          }
        : {}),
    }),
  });

  await db('payments', {
    method: 'POST',
    body: JSON.stringify({ id: orderId, provider_id: payment.id, user_id: user.id, plan: plan.id, amount: value }),
  });
  const url = payment.confirmation?.confirmation_url;
  if (!url) throw new HttpError(502, 'Платёжный сервис не вернул страницу оплаты');
  return { orderId, confirmationUrl: url };
}

const addMonths = (d: Date, n: number) => {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
};

/**
 * Checks an order against YooKassa and applies it. Safe to call many times
 * (webhook retries, app polling): the pending→succeeded update is atomic, so
 * a payment extends the subscription only once.
 */
export async function confirmOrder(orderId: string) {
  requirePayments();
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new HttpError(400, 'Bad order id');
  const [order] = await db<PaymentRow[]>(`payments?id=eq.${orderId}&select=*`);
  if (!order) throw new HttpError(404, 'Заказ не найден');
  if (order.status !== 'pending' || !order.provider_id) {
    return { status: order.status, subscription: await getSubscription(order.user_id) };
  }

  const p = await yoo<YooPayment>(`payments/${encodeURIComponent(order.provider_id)}`);
  const plan = planById(order.plan)!;
  const now = new Date().toISOString();

  if (p.status === 'succeeded' && p.paid && Number(p.amount.value) === Number(order.amount) && p.amount.currency === 'RUB') {
    // Atomic guard: only the request that flips pending→succeeded extends the subscription.
    const flipped = await db<PaymentRow[]>(`payments?id=eq.${orderId}&status=eq.pending`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'succeeded', updated_at: now }),
    });
    if (flipped.length) {
      const cur = await getSubscription(order.user_id);
      // never downgrade a lifetime subscription (e.g. from a promo code)
      if (cur?.plan === 'lifetime' && cur.status === 'active') return { status: 'succeeded' as const, subscription: cur };
      const curEnd = cur && cur.status === 'active' ? new Date(cur.current_period_end) : new Date(0);
      const base = curEnd > new Date() ? curEnd : new Date();
      await db('subscriptions', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          user_id: order.user_id,
          plan: plan.id,
          status: 'active',
          current_period_end: addMonths(base, plan.months).toISOString(),
          updated_at: now,
        }),
      });
    }
    return { status: 'succeeded' as const, subscription: await getSubscription(order.user_id) };
  }
  if (p.status === 'canceled') {
    await db(`payments?id=eq.${orderId}&status=eq.pending`, { method: 'PATCH', body: JSON.stringify({ status: 'canceled', updated_at: now }) });
    return { status: 'canceled' as const, subscription: await getSubscription(order.user_id) };
  }
  return { status: 'pending' as const, subscription: null };
}

/** YooKassa notification. We only use the payment id from it and re-check via the API. */
export async function handleWebhook(body: unknown) {
  requirePayments();
  const id = (body as { object?: { id?: string } })?.object?.id;
  if (!id || !/^[\w-]{10,64}$/.test(id)) throw new HttpError(400, 'Bad notification');
  const [order] = await db<PaymentRow[]>(`payments?provider_id=eq.${encodeURIComponent(id)}&select=id`);
  if (order) await confirmOrder(order.id);
  return { ok: true };
}
