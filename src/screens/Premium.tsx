import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Crown, Loader2, ShieldCheck } from 'lucide-react';
import { PREMIUM_FEATURES } from '../billing/features';
import { useAuth } from '../auth/auth';
import { PLANS, savingPercent, type PlanId } from '../billing/plans';
import { isActive, usePremium } from '../billing/premium';
import { toast } from '../store/ui';
import { cn } from '../lib/util';
import { Button, Pressable, softSpring } from '../components/ui/primitives';


const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
const date = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const isDesktop = () => !!(window as unknown as { auraDesktop?: unknown }).auraDesktop;

/** Polls the server until YooKassa reports a final status (max ~2 min). */
function useOrderStatus() {
  const confirm = usePremium((s) => s.confirm);
  const [state, setState] = useState<'idle' | 'checking' | 'succeeded' | 'canceled' | 'timeout'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const watch = (orderId: string) => {
    clearTimeout(timer.current);
    setState('checking');
    const started = Date.now();
    const tick = async () => {
      try {
        const st = await confirm(orderId);
        if (st === 'succeeded') return setState('succeeded');
        if (st === 'canceled') return setState('canceled');
      } catch {
        /* network blip — keep trying */
      }
      if (Date.now() - started > 120_000) return setState('timeout');
      timer.current = setTimeout(tick, 3000);
    };
    void tick();
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return { state, watch };
}

export default function Premium() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const user = useAuth((s) => s.user);
  const { config, subscription, refresh, checkout } = usePremium();
  const [plan, setPlan] = useState<PlanId>('half_year');
  const [busy, setBusy] = useState(false);
  const order = useOrderStatus();
  const active = isActive(subscription);
  const selected = PLANS.find((p) => p.id === plan)!;

  useEffect(() => {
    void refresh();
  }, [refresh, user?.id]);

  // Returned from YooKassa: /premium?order=<id>
  useEffect(() => {
    const id = params.get('order');
    if (id) {
      order.watch(id);
      setParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (order.state === 'succeeded') toast('Premium активирован — спасибо!', { tone: 'success' });
    if (order.state === 'canceled') toast('Оплата отменена, деньги не списаны', { tone: 'error' });
  }, [order.state]);

  const buy = async () => {
    if (!user) return navigate('/profile');
    setBusy(true);
    try {
      const { orderId, confirmationUrl } = await checkout(plan);
      if (isDesktop()) {
        // Desktop: pay in the system browser, this window waits for confirmation.
        window.open(confirmationUrl, '_blank');
        order.watch(orderId);
      } else {
        location.href = confirmationUrl;
      }
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const blocker = !config
    ? null
    : !config.accounts
      ? 'Аккаунты ещё не подключены на сервере (Supabase), поэтому оформить подписку пока нельзя.'
      : !config.payments
        ? 'Оплата ещё не подключена: владельцу приложения нужно добавить ключи ЮKassa на сервер.'
        : null;

  return (
    <div className="page-pad pt-[calc(12px+var(--safe-t))]">
      <section className="relative isolate mx-4 mt-3 overflow-hidden rounded-[32px] p-6 md:mx-8 md:mt-6 md:p-10">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(90%_120%_at_0%_0%,#f0abfc_0%,#8b5cf6_35%,#1e1b4b_75%,#07070a_100%)]" aria-hidden />
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={softSpring} className="text-white">
          <div className="inline-flex items-center gap-2 rounded-full bg-black/30 px-3 py-1 text-sm font-semibold">
            <Crown className="size-4" /> AURA Premium
          </div>
          <h1 className="text-balance mt-4 max-w-xl text-4xl font-extrabold tracking-tight md:text-5xl">Больше возможностей для вашей музыки</h1>
          <p className="mt-3 max-w-lg text-[15px] text-white/80">Слушать музыку в AURA можно бесплатно. Premium открывает дополнительные функции приложения.</p>
        </motion.div>
      </section>

      {(active || order.state !== 'idle') && (
        <div className="mx-4 mt-5 flex items-center gap-3 rounded-[22px] bg-surface p-4 md:mx-8" role="status">
          {order.state === 'checking' ? (
            <>
              <Loader2 className="size-5 animate-spin text-dyn" />
              <span className="text-sm">Ждём подтверждения оплаты от ЮKassa… {isDesktop() && 'Завершите оплату в открывшемся окне браузера.'}</span>
            </>
          ) : order.state === 'timeout' ? (
            <span className="text-sm text-fg-2">Оплата ещё не подтверждена. Если вы оплатили, статус обновится в течение нескольких минут — обновите страницу.</span>
          ) : active && subscription ? (
            <>
              <ShieldCheck className="size-5 text-emerald-400" />
              <span className="text-sm">
                <b>Premium активен</b> до {date(subscription.current_period_end)}. Новая оплата продлит подписку с этой даты.
              </span>
            </>
          ) : order.state === 'canceled' ? (
            <span className="text-sm text-fg-2">Оплата отменена. Деньги не списаны.</span>
          ) : null}
        </div>
      )}

      <section className="mt-8 grid gap-3 px-4 sm:grid-cols-2 md:px-8 lg:grid-cols-4">
        {PREMIUM_FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-[22px] bg-surface p-4">
            <Icon className="size-6 text-dyn" />
            <div className="mt-3 font-semibold">{title}</div>
            <div className="mt-0.5 text-sm text-fg-2">{text}</div>
          </div>
        ))}
      </section>

      <section className="mt-8 px-4 md:px-8">
        <h2 className="mb-3 text-[22px] font-bold tracking-tight">Выберите срок</h2>
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Тариф">
          {PLANS.map((p) => {
            const on = p.id === plan;
            const save = savingPercent(p);
            return (
              <Pressable
                key={p.id}
                role="radio"
                aria-checked={on}
                onClick={() => setPlan(p.id)}
                className={cn(
                  'relative rounded-[24px] p-5 text-left transition-colors',
                  on ? 'bg-surface-hover ring-2 ring-dyn' : 'bg-surface hover:bg-surface-hover',
                )}
              >
                {p.badge && <span className="absolute top-4 right-4 rounded-full bg-dyn px-2.5 py-0.5 text-[11px] font-bold text-white">{p.badge}</span>}
                <div className="text-sm font-semibold text-fg-2">{p.title}</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight">{rub(p.price)}</div>
                <div className="mt-1 text-sm text-fg-2">
                  {p.months > 1 ? `${rub(Math.round(p.price / p.months))} в месяц` : 'в месяц'}
                  {save > 0 && <span className="ml-2 font-semibold text-emerald-400">−{save}%</span>}
                </div>
                <span className={cn('absolute bottom-5 right-5 grid size-6 place-items-center rounded-full border-2', on ? 'border-dyn bg-dyn text-white' : 'border-fg-3')}>
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              </Pressable>
            );
          })}
        </div>

        {config?.testMode && (
          <p className="mt-4 rounded-2xl bg-amber-500/15 p-3 text-sm text-amber-300">Тестовый режим ЮKassa: деньги не списываются, используйте тестовые карты ЮKassa.</p>
        )}
        {blocker && <p className="mt-4 rounded-2xl bg-surface p-3 text-sm text-fg-2">{blocker}</p>}

        <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          {user ? (
            <Button className="h-12 px-7 text-base" disabled={busy || !!blocker || !config || order.state === 'checking'} onClick={buy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Crown className="size-4" />}
              {active ? 'Продлить' : 'Оформить'} за {rub(selected.price)}
            </Button>
          ) : (
            <Button className="h-12 px-7 text-base" onClick={() => navigate('/profile')}>
              Войдите или зарегистрируйтесь, чтобы оформить
            </Button>
          )}
          <span className="text-xs text-fg-3">Разовый платёж без автопродления. Оплата картой или СБП на защищённой странице ЮKassa — данные карты AURA не получает.</span>
        </div>
      </section>
    </div>
  );
}
