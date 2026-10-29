/** AURA Premium plans. Shared by the UI and the server (the server is the source of truth for prices). */
export type PlanId = 'month' | 'half_year' | 'year';

export interface Plan {
  id: PlanId;
  title: string;
  months: number;
  /** price in roubles */
  price: number;
  badge?: string;
}

export const PLANS: Plan[] = [
  { id: 'month', title: '1 месяц', months: 1, price: 300 },
  { id: 'half_year', title: '6 месяцев', months: 6, price: 800, badge: 'Популярный' },
  { id: 'year', title: '12 месяцев', months: 12, price: 1200, badge: 'Выгоднее всего' },
];

export const planById = (id: string) => PLANS.find((p) => p.id === id);

/** Saving vs paying monthly, in percent. */
export const savingPercent = (p: Plan) => Math.round((1 - p.price / (PLANS[0].price * p.months)) * 100);

/** Free tier limit for playlists. */
export const FREE_PLAYLIST_LIMIT = 5;
