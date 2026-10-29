/**
 * Accounts via Supabase Auth (email + password, password recovery).
 * Only the public "anon" key is used in the browser; data is protected by
 * Row Level Security policies (supabase/schema.sql). Without configuration
 * the app runs in local mode: everything is saved on this device only.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && anon ? createClient(url, anon) : null;
export const authConfigured = !!supabase;

interface AuthState {
  ready: boolean;
  user: { id: string; email?: string } | null;
  /** true after following a password-reset link: user must set a new password */
  recovering: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, profile: { username: string; displayName: string }): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
}

const friendly = (msg: string) => {
  if (/invalid login/i.test(msg)) return 'Неверный email или пароль';
  if (/already registered|already exists/i.test(msg)) return 'Аккаунт с таким email уже существует';
  if (/password should be/i.test(msg)) return 'Пароль слишком короткий — минимум 8 символов';
  if (/email not confirmed/i.test(msg)) return 'Подтвердите email по ссылке из письма';
  if (/rate limit/i.test(msg)) return 'Слишком много попыток. Подождите немного';
  if (/fetch/i.test(msg)) return 'Нет связи с сервером авторизации';
  return msg;
};

function need(): SupabaseClient {
  if (!supabase) throw new Error('Авторизация не настроена (нет ключей Supabase)');
  return supabase;
}

export const useAuth = create<AuthState>((set) => ({
  ready: !supabase,
  user: null,
  recovering: false,
  async signIn(email, password) {
    const { error } = await need().auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendly(error.message));
  },
  async signUp(email, password, profile) {
    if (!(await usernameAvailable(profile.username))) throw new Error('Этот логин уже занят');
    const { data, error } = await need().auth.signUp({
      email,
      password,
      // the database trigger (supabase/schema.sql) creates the profile with this login
      options: { emailRedirectTo: location.origin, data: { username: profile.username, display_name: profile.displayName } },
    });
    if (error) throw new Error(/database error saving/i.test(error.message) ? 'Этот логин уже занят' : friendly(error.message));
    return { needsConfirmation: !data.session };
  },
  async signOut() {
    await need().auth.signOut();
  },
  async resetPassword(email) {
    const { error } = await need().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/profile` });
    if (error) throw new Error(friendly(error.message));
  },
  async updatePassword(password) {
    const { error } = await need().auth.updateUser({ password });
    if (error) throw new Error(friendly(error.message));
    set({ recovering: false });
  },
}));

export async function usernameAvailable(name: string): Promise<boolean> {
  const { data, error } = await need().rpc('username_available', { name });
  if (error) throw new Error('Не удалось проверить логин — проверьте, что схема базы обновлена (supabase/schema.sql)');
  return data === true;
}

/** Current session token, sent to our server for billing requests. */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

if (supabase) {
  supabase.auth.getSession().then(({ data }) => {
    const u = data.session?.user;
    useAuth.setState({ ready: true, user: u ? { id: u.id, email: u.email } : null });
  });
  supabase.auth.onAuthStateChange((event, session) => {
    const u = session?.user;
    useAuth.setState({
      ready: true,
      user: u ? { id: u.id, email: u.email } : null,
      ...(event === 'PASSWORD_RECOVERY' ? { recovering: true } : {}),
    });
  });
}
