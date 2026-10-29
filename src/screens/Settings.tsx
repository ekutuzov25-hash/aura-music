import { useState } from 'react';
import { CheckCircle2, Keyboard, XCircle } from 'lucide-react';
import { providers, SOURCE_META } from '../providers/registry';
import type { ProviderStatus, SourceId } from '../providers/types';
import { authConfigured } from '../auth/auth';
import { useLibrary } from '../store/library';
import { usePlayerState } from '../player/store';
import { useAura } from '../recommend/aura';
import { useSettings, type MotionPref, type ThemePref } from '../store/settings';
import { toast, useUI } from '../store/ui';
import { useAsync } from '../lib/useAsync';
import { cn } from '../lib/util';
import { Button } from '../components/ui/primitives';
import { ConfirmDialog } from '../components/ui/overlays';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 px-4 md:px-8">
      <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-fg-3 uppercase">{title}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-[22px] bg-surface">{children}</div>
    </section>
  );
}

function Toggle({ title, desc, checked, onChange }: { title: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 p-4">
      <span>
        <span className="block font-medium">{title}</span>
        {desc && <span className="mt-0.5 block text-sm text-fg-2">{desc}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className="h-[31px] w-[51px] rounded-full bg-fg-3/40 transition-colors peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-dyn" />
        <span className="absolute top-0.5 left-0.5 size-[27px] rounded-full bg-white shadow transition-transform duration-300 [transition-timing-function:var(--ease-spring)] peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <span className="font-medium">{label}</span>
      <div className="flex rounded-full bg-surface p-0.5" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cn('h-8 rounded-full px-3 text-[13px] font-semibold transition-colors', value === v ? 'bg-fg text-bg' : 'text-fg-2 hover:text-fg')}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsScreen() {
  const s = useSettings();
  const [confirmReset, setConfirmReset] = useState(false);
  const statuses = useAsync(async () => Object.fromEntries(await Promise.all(providers.map(async (p) => [p.id, await p.status()] as const))) as Record<SourceId, ProviderStatus>, []);

  return (
    <div className="page-pad pt-[calc(12px+var(--safe-t))]">
      <h1 className="px-4 pt-3 text-3xl font-semibold tracking-tight md:px-8 md:pt-6">Настройки</h1>

      <Group title="Внешний вид">
        <Segmented<ThemePref> label="Тема" value={s.theme} onChange={(v) => s.set('theme', v)} options={[['dark', 'Тёмная'], ['light', 'Светлая'], ['system', 'Авто']]} />
        <Toggle title="Цвет от обложки" desc="Интерфейс плавно перекрашивается под текущий трек" checked={s.dynamicColor} onChange={(v) => s.set('dynamicColor', v)} />
        <Toggle title="Фирменный курсор" desc="Стеклянное кольцо вместо обычной стрелки (только с мышью или трекпадом)" checked={s.customCursor} onChange={(v) => s.set('customCursor', v)} />
        <Toggle title="Облегчённое стекло" desc="Отключает размытие фона — быстрее на слабых устройствах" checked={s.liteGlass} onChange={(v) => s.set('liteGlass', v)} />
      </Group>

      <Group title="Анимации и отклик">
        <Segmented<MotionPref> label="Анимации" value={s.motion} onChange={(v) => s.set('motion', v)} options={[['full', 'Полные'], ['reduced', 'Меньше'], ['system', 'Как в системе']]} />
        <Toggle title="Визуализатор" desc="Спектр звука в реальном времени. На iOS может мешать фоновому воспроизведению" checked={s.visualizer} onChange={(v) => s.set('visualizer', v)} />
        <Toggle title="Искать полные версии" desc="Если трек играет только 30 секунд или закрыт на SoundCloud, AURA включит полную версию, которую сам артист выложил на Audius (если она там есть). Каверы и перезаливы не подставляются" checked={s.autoFullVersion} onChange={(v) => s.set('autoFullVersion', v)} />
        <Toggle title="Тактильный отклик" desc={'vibrate' in navigator ? 'Лёгкая вибрация при нажатиях' : 'Не поддерживается этим браузером'} checked={s.haptics} onChange={(v) => s.set('haptics', v)} />
      </Group>

      <Group title="Источники музыки">
        {providers.map((p) => {
          const st = statuses.data?.[p.id];
          const on = s.enabledSources.includes(p.id);
          return (
            <div key={p.id} className="flex items-start gap-3 p-4">
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: SOURCE_META[p.id].color }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {p.name}
                  {st && (st.ready ? <CheckCircle2 className="size-4 text-emerald-400" aria-label="Готов" /> : <XCircle className="size-4 text-amber-400" aria-label="Требует настройки" />)}
                </div>
                <p className="mt-0.5 text-sm text-fg-2">{st?.message ?? p.description}</p>
              </div>
              <input
                type="checkbox"
                aria-label={`Искать в ${p.name}`}
                checked={on}
                onChange={(e) => s.set('enabledSources', e.target.checked ? [...s.enabledSources, p.id] : s.enabledSources.filter((x) => x !== p.id))}
                className="mt-1 size-5 accent-[rgb(var(--dyn))]"
              />
            </div>
          );
        })}
      </Group>

      <Group title="Данные">
        <div className="p-4 text-sm text-fg-2">
          {authConfigured ? 'Данные синхронизируются с аккаунтом после входа в разделе «Профиль».' : 'Сейчас данные хранятся только в этом браузере (Supabase не подключён).'}
        </div>
        <button onClick={() => useUI.getState().setShortcuts(true)} className="flex w-full items-center gap-3 p-4 text-left font-medium hover:bg-surface-hover">
          <Keyboard className="size-5 text-fg-2" /> Горячие клавиши
        </button>
        <div className="p-4">
          <Button variant="danger" onClick={() => setConfirmReset(true)}>Сбросить локальные данные</Button>
        </div>
      </Group>

      <p className="mt-8 px-5 text-center text-xs text-fg-3 md:px-8">
        AURA воспроизводит музыку только через официальные API, лицензированные превью и встроенные плееры. Права на треки принадлежат их авторам.
      </p>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Сбросить все локальные данные?"
        text={`Будут удалены ${useLibrary.getState().playlists.length} плейлистов, лайки, история и настройки на этом устройстве. Данные в аккаунте Supabase (если вы вошли) останутся.`}
        confirmLabel="Сбросить данные"
        onConfirm={() => {
          // through each store, so pending batched writes are dropped too
          useLibrary.persist.clearStorage();
          useSettings.persist.clearStorage();
          usePlayerState.persist.clearStorage();
          useAura.persist.clearStorage();
          toast('Данные сброшены');
          setTimeout(() => location.reload(), 600);
        }}
      />
    </div>
  );
}
