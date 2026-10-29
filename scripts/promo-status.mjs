#!/usr/bin/env node
// Shows how many AURA promo codes are used, per plan, and saves a status
// table to ~/Desktop/AURA/Промокоды/статус.csv. Reads the service key from
// aura/.env (never prints it). Usage: node scripts/promo-status.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

process.loadEnvFile(new URL('../.env', import.meta.url));
const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('В aura/.env нет VITE_SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY');

const headers = { apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }) };
const res = await fetch(`${url}/rest/v1/promo_codes?select=code,plan,redeemed_at&order=plan,code`, { headers });
if (!res.ok) throw new Error(`Supabase ответил ${res.status}`);
const rows = await res.json();

const names = { month: '1 месяц', half_year: '6 месяцев', year: '12 месяцев', lifetime: 'навсегда' };
for (const [plan, label] of Object.entries(names)) {
  const all = rows.filter((r) => r.plan === plan);
  const used = all.filter((r) => r.redeemed_at).length;
  console.log(`${label.padEnd(11)} всего ${String(all.length).padStart(3)}  активировано ${String(used).padStart(3)}  свободно ${String(all.length - used).padStart(3)}`);
}
const dir = join(homedir(), 'Desktop', 'AURA', 'Промокоды');
mkdirSync(dir, { recursive: true });
const csv = ['код;тариф;активирован'].concat(rows.map((r) => `${r.code};${names[r.plan]};${r.redeemed_at ? new Date(r.redeemed_at).toLocaleString('ru-RU') : ''}`));
writeFileSync(join(dir, 'статус.csv'), '﻿' + csv.join('\n') + '\n');
console.log(`\nТаблица сохранена: ${join(dir, 'статус.csv')}`);
