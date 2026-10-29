import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, ChevronRight, Cloud, CloudOff, Crown, LogOut, Pencil, Settings } from 'lucide-react';
import { usePremium, isActive } from '../billing/premium';
import { authConfigured, useAuth } from '../auth/auth';
import { pushProfile } from '../auth/sync';
import { useLibrary } from '../store/library';
import { useSettings, type Profile } from '../store/settings';
import { toast } from '../store/ui';
import { buildTaste } from '../recommend/engine';
import { cn, resizeImage } from '../lib/util';
import { Shelf, TrackCard } from '../components/cards';
import { Artwork, Button, Chip, SectionHeader } from '../components/ui/primitives';
import { Sheet } from '../components/ui/overlays';
import { Onboarding } from './Onboarding';

const USERNAME = /^[a-z0-9_.]{3,24}$/;

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-xs font-semibold text-fg-2">{label}</label>
      <div className="mt-1.5">{children}</div>
      {error ? <p className="mt-1 text-xs text-red-400" role="alert">{error}</p> : hint && <p className="mt-1 text-xs text-fg-3">{hint}</p>}
    </div>
  );
}
const inputCls = 'h-11 w-full rounded-xl bg-surface px-3 text-[15px] outline-none focus:ring-2 focus:ring-dyn';

function EditProfile({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useSettings((s) => s.profile);
  const [f, setF] = useState<Profile>(profile);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const user = useAuth((s) => s.user);
  const usernameError = f.username && !USERNAME.test(f.username) ? '3–24 символа: латиница в нижнем регистре, цифры, «_» и «.»' : undefined;

  return (
    <Sheet open={open} onClose={onClose} title="Редактировать профиль">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setTouched(true);
          if (usernameError || !f.displayName.trim()) return;
          setSaving(true);
          try {
            // check uniqueness on the server first so we don't save a taken nickname locally
            if (user) await pushProfile(f);
            useSettings.getState().setProfile({ ...f, displayName: f.displayName.trim() });
            toast('Профиль сохранён', { tone: 'success' });
            onClose();
          } catch (err) {
            toast((err as Error).message, { tone: 'error' });
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="flex justify-center">
          <button type="button" onClick={() => fileRef.current?.click()} className="group relative" aria-label="Изменить аватар">
            <Artwork src={f.avatar} alt="" seed={f.displayName} className="size-28" rounded="rounded-full" />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Camera className="size-6" /></span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (file) setF({ ...f, avatar: await resizeImage(file, 256).catch(() => f.avatar) }); }} />
        </div>
        <Field id="p-name" label="Имя" error={touched && !f.displayName.trim() ? 'Введите имя' : undefined}>
          <input id="p-name" maxLength={40} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} className={inputCls} />
        </Field>
        <Field id="p-user" label="Никнейм" error={(touched || f.username.length > 2) ? usernameError : undefined} hint={user ? 'Уникальность проверяется на сервере' : 'Уникальность проверяется после входа в аккаунт'}>
          <div className="relative">
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-fg-3">@</span>
            <input id="p-user" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} onBlur={() => setTouched(true)} className={cn(inputCls, 'pl-7')} autoCapitalize="off" autoCorrect="off" />
          </div>
        </Field>
        <Field id="p-bio" label="О себе" hint={`${f.bio.length}/300`}>
          <textarea id="p-bio" maxLength={300} rows={3} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} className="w-full resize-none rounded-xl bg-surface p-3 text-[15px] outline-none focus:ring-2 focus:ring-dyn" />
        </Field>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</Button>
        </div>
      </form>
    </Sheet>
  );
}

function AuthPanel() {
  const auth = useAuth();
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  if (!authConfigured) {
    return (
      <div className="flex gap-3 rounded-[24px] bg-surface p-5">
        <CloudOff className="mt-0.5 size-5 shrink-0 text-fg-2" />
        <div>
          <div className="font-semibold">Локальный режим</div>
          <p className="mt-1 text-sm text-fg-2">Плейлисты, лайки и профиль сохраняются в этом браузере. Регистрация с логином и паролем, вход с разных устройств, синхронизация и подписка Premium заработают после подключения сервера аккаунтов (Supabase) — инструкция в README.</p>
        </div>
      </div>
    );
  }
  if (auth.recovering) {
    return (
      <form className="rounded-[24px] bg-surface p-5" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try { await auth.updatePassword(password); toast('Пароль обновлён', { tone: 'success' }); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>
        <div className="font-semibold">Новый пароль</div>
        <Field id="np" label="Пароль" error={error}><input id="np" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} /></Field>
        <Button type="submit" className="mt-4" disabled={busy}>Сохранить пароль</Button>
      </form>
    );
  }
  if (auth.user) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-[24px] bg-surface p-5">
        <Cloud className="size-5 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Синхронизация включена</div>
          <div className="truncate text-sm text-fg-2">{auth.user.email}</div>
        </div>
        <Button variant="secondary" onClick={() => auth.signOut().then(() => toast('Вы вышли из аккаунта'))}><LogOut className="size-4" />Выйти</Button>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'in') await auth.signIn(email, password);
      else if (mode === 'up') {
        if (!USERNAME.test(login)) throw new Error('Логин: 3–24 символа — латиница в нижнем регистре, цифры, «_» и «.»');
        const r = await auth.signUp(email, password, { username: login, displayName: name.trim() || login });
        useSettings.getState().setProfile({ username: login, displayName: name.trim() || login });
        if (r.needsConfirmation) setInfo('Мы отправили письмо для подтверждения. Откройте ссылку из письма, затем войдите.');
      } else {
        await auth.resetPassword(email);
        setInfo('Если аккаунт существует, мы отправили ссылку для восстановления пароля.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-[24px] bg-surface p-5">
      <div className="flex gap-1 rounded-full bg-surface p-1" role="tablist">
        {(['in', 'up'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => (setMode(m), setError(''), setInfo(''))} className={cn('h-9 flex-1 rounded-full text-sm font-semibold', mode === m ? 'bg-fg text-bg' : 'text-fg-2')}>
            {m === 'in' ? 'Вход' : 'Регистрация'}
          </button>
        ))}
      </div>
      {mode === 'up' && (
        <>
          <Field id="a-login" label="Логин" hint="Уникальный, виден в профиле как @логин">
            <div className="relative">
              <span className="absolute top-1/2 left-3 -translate-y-1/2 text-fg-3">@</span>
              <input id="a-login" required autoComplete="username" autoCapitalize="off" autoCorrect="off" value={login} onChange={(e) => setLogin(e.target.value.toLowerCase())} className={cn(inputCls, 'pl-7')} />
            </div>
          </Field>
          <Field id="a-name" label="Имя">
            <input id="a-name" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
        </>
      )}
      <Field id="a-email" label="Email" hint={mode === 'up' ? 'Нужен для входа и восстановления пароля' : undefined}><input id="a-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></Field>
      {mode !== 'reset' && (
        <Field id="a-pass" label="Пароль" hint={mode === 'up' ? 'Минимум 8 символов' : undefined}>
          <input id="a-pass" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} minLength={mode === 'up' ? 8 : undefined} required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </Field>
      )}
      {error && <p className="mt-3 text-sm text-red-400" role="alert">{error}</p>}
      {info && <p className="mt-3 text-sm text-emerald-400" role="status">{info}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? 'Подождите…' : mode === 'in' ? 'Войти' : mode === 'up' ? 'Создать аккаунт' : 'Отправить ссылку'}</Button>
        <button type="button" onClick={() => setMode(mode === 'reset' ? 'in' : 'reset')} className="text-sm text-fg-2 hover:text-fg">
          {mode === 'reset' ? 'Назад ко входу' : 'Забыли пароль?'}
        </button>
      </div>
      <p className="mt-4 text-xs text-fg-3">После входа ваши локальные плейлисты и лайки будут объединены с аккаунтом.</p>
    </form>
  );
}

function PremiumCard() {
  const sub = usePremium((s) => s.subscription);
  const active = isActive(sub);
  return (
    <Link to="/premium" className="mt-3 flex items-center gap-4 rounded-[24px] bg-[linear-gradient(120deg,rgba(168,85,247,0.35),transparent_70%),var(--surface)] p-5 hover:bg-surface-hover">
      <Crown className="size-6 shrink-0 text-fuchsia-300" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{active ? 'AURA Premium активен' : 'AURA Premium'}</span>
        <span className="block text-sm text-fg-2">
          {active && sub ? `До ${new Date(sub.current_period_end).toLocaleDateString('ru-RU')}` : '300 ₽ в месяц · 800 ₽ за 6 месяцев · 1200 ₽ за год'}
        </span>
      </span>
      <ChevronRight className="size-5 text-fg-3" />
    </Link>
  );
}

export default function ProfileScreen() {
  const profile = useSettings((s) => s.profile);
  const setProfile = useSettings((s) => s.setProfile);
  const lib = useLibrary();
  const [edit, setEdit] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const taste = useMemo(() => buildTaste(lib), [lib]);
  const favs = lib.likes.slice(0, 20).map((l) => l.item);
  const recent = lib.history.slice(0, 20).map((h) => h.track);

  return (
    <div className="page-pad pt-[calc(12px+var(--safe-t))]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(70%_100%_at_50%_0%,rgb(var(--dyn)/0.35),transparent)]" aria-hidden />
      <header className="relative flex flex-col items-center px-4 pt-8 text-center md:flex-row md:items-end md:gap-6 md:px-8 md:text-left">
        <Artwork src={profile.avatar} alt="Аватар" seed={profile.displayName} className="size-32 shadow-2xl md:size-40" rounded="rounded-full" eager />
        <div className="mt-4 min-w-0 flex-1 md:mt-0">
          <div className="text-xs font-bold tracking-[0.14em] text-fg-2 uppercase">Профиль{profile.isPrivate ? ' · приватный' : ' · публичный'}</div>
          <h1 className="mt-1 text-4xl font-extrabold tracking-tight">{profile.displayName}</h1>
          {profile.username && <div className="mt-0.5 text-fg-2">@{profile.username}</div>}
          {profile.bio && <p className="mt-2 max-w-xl text-[15px] text-fg-2">{profile.bio}</p>}
          <div className="mt-3 flex justify-center gap-5 text-sm md:justify-start">
            <Link to="/library" className="hover:underline"><b>{lib.playlists.length}</b> <span className="text-fg-2">плейлистов</span></Link>
            <Link to="/library?tab=liked" className="hover:underline"><b>{lib.likes.length}</b> <span className="text-fg-2">любимых</span></Link>
            <Link to="/library?tab=artists" className="hover:underline"><b>{lib.artists.length}</b> <span className="text-fg-2">исполнителей</span></Link>
          </div>
        </div>
        <div className="mt-4 flex gap-2 md:mt-0">
          <Button variant="secondary" onClick={() => setEdit(true)}><Pencil className="size-4" />Редактировать</Button>
          <Link to="/settings" aria-label="Настройки" title="Настройки" className="glass grid size-11 place-items-center rounded-full md:hidden"><Settings className="size-5" /></Link>
        </div>
      </header>

      <section className="mt-10 px-4 md:px-8">
        <h2 className="mb-3 text-[22px] font-bold tracking-tight">Аккаунт</h2>
        <AuthPanel />
        <PremiumCard />
      </section>

      {favs.length > 0 && (
        <section className="mt-9">
          <SectionHeader title="Избранные треки" action={<Link to="/library?tab=liked" className="text-sm font-semibold text-fg-2 hover:text-fg">Все</Link>} />
          <Shelf>{favs.map((t, i) => <TrackCard key={t.id} track={t} list={favs} index={i} context={{ label: 'Любимые треки', path: '/library?tab=liked' }} />)}</Shelf>
        </section>
      )}

      {profile.showHistory && recent.length > 0 && (
        <section className="mt-9">
          <SectionHeader title="Недавно прослушанное" />
          <Shelf>{recent.map((t, i) => <TrackCard key={t.id} track={t} list={recent} index={i} context={{ label: 'Недавно прослушанное' }} />)}</Shelf>
        </section>
      )}

      <section className="mt-9 px-4 md:px-8">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[22px] font-bold tracking-tight">Музыкальные предпочтения</h2>
          <button onClick={() => setPrefs(true)} className="text-sm font-semibold text-fg-2 hover:text-fg">Изменить</button>
        </div>
        {taste.hasData ? (
          <>
            <div className="text-xs font-semibold text-fg-3 uppercase">Жанры</div>
            <div className="mt-2 flex flex-wrap gap-2">{taste.genres.slice(0, 10).map(([g]) => <Chip key={g} onClick={() => setPrefs(true)}>{g}</Chip>)}</div>
            <div className="mt-4 text-xs font-semibold text-fg-3 uppercase">Любимые исполнители</div>
            <div className="mt-2 flex flex-wrap gap-2">{taste.artists.slice(0, 10).map(([a]) => <Chip key={a} onClick={() => setPrefs(true)}>{a}</Chip>)}</div>
            <p className="mt-3 text-xs text-fg-3">Вычисляются из лайков, прослушиваний, плейлистов и вашего выбора — так же, как рекомендации на главной.</p>
          </>
        ) : (
          <p className="text-sm text-fg-2">Пока пусто. <button onClick={() => setPrefs(true)} className="font-semibold text-fg underline">Выберите жанры</button>, чтобы получать рекомендации.</p>
        )}
      </section>

      <section className="mt-9 px-4 md:px-8">
        <h2 className="mb-3 text-[22px] font-bold tracking-tight">Приватность</h2>
        <div className="divide-y divide-line rounded-[24px] bg-surface">
          {([
            ['isPrivate', 'Приватный профиль', 'Профиль и публичные плейлисты видны только вам (действует при включённой синхронизации)'],
            ['showHistory', 'Показывать историю в профиле', 'Блок «Недавно прослушанное» на странице профиля'],
          ] as const).map(([k, title, desc]) => (
            <label key={k} className="flex cursor-pointer items-center justify-between gap-4 p-4">
              <span>
                <span className="block font-medium">{title}</span>
                <span className="block text-sm text-fg-2">{desc}</span>
              </span>
              <input type="checkbox" checked={profile[k]} onChange={(e) => setProfile({ [k]: e.target.checked })} className="size-5 shrink-0 accent-[rgb(var(--dyn))]" />
            </label>
          ))}
        </div>
      </section>

      <EditProfile key={String(edit)} open={edit} onClose={() => setEdit(false)} />
      <Onboarding open={prefs} onClose={() => setPrefs(false)} />
    </div>
  );
}
