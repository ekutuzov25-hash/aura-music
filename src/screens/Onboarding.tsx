import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useLibrary } from '../store/library';
import { toast } from '../store/ui';
import { GENRES } from '../recommend/engine';
import { Button, Chip } from '../components/ui/primitives';
import { Sheet } from '../components/ui/overlays';

/** Lets the listener seed recommendations with genres and artists. */
export function Onboarding({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = useLibrary((s) => s.preferences);
  const [genres, setGenres] = useState<string[]>(prefs.genres);
  const [artists, setArtists] = useState<string[]>(prefs.artists);
  const [artist, setArtist] = useState('');

  useEffect(() => {
    if (open) {
      setGenres(prefs.genres);
      setArtists(prefs.artists);
    }
  }, [open, prefs]);

  const toggle = (g: string) => setGenres((x) => (x.includes(g) ? x.filter((y) => y !== g) : [...x, g]));
  const addArtist = (e: React.FormEvent) => {
    e.preventDefault();
    const a = artist.trim();
    if (a && !artists.includes(a)) setArtists([...artists, a]);
    setArtist('');
  };

  return (
    <Sheet open={open} onClose={onClose} title="Ваши музыкальные предпочтения" wide>
      <p className="text-sm text-fg-2">Отметьте 3 и более жанра. Чем больше вы слушаете и лайкаете, тем меньше рекомендации зависят от этого выбора.</p>
      <h3 className="mt-5 mb-2 text-sm font-bold">Жанры</h3>
      <div className="flex flex-wrap gap-2">
        {GENRES.map((g) => (
          <Chip key={g} active={genres.includes(g)} onClick={() => toggle(g)}>
            {g}
          </Chip>
        ))}
      </div>
      <h3 className="mt-6 mb-2 text-sm font-bold">Исполнители</h3>
      <form onSubmit={addArtist} className="flex gap-2">
        <label htmlFor="pref-artist" className="sr-only">Имя исполнителя</label>
        <input
          id="pref-artist"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="Например, Burial"
          className="h-11 min-w-0 flex-1 rounded-full bg-surface px-4 text-[15px] outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-dyn"
        />
        <Button type="submit" variant="secondary" disabled={!artist.trim()}>
          <Plus className="size-4" /> Добавить
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {artists.map((a) => (
          <span key={a} className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-hover pr-1 pl-3 text-[13px] font-medium">
            {a}
            <button aria-label={`Удалить ${a}`} onClick={() => setArtists(artists.filter((x) => x !== a))} className="grid size-6 place-items-center rounded-full hover:bg-surface">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="sticky bottom-0 mt-6 flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button
          disabled={!genres.length && !artists.length}
          onClick={() => {
            useLibrary.getState().setPreferences({ genres, artists, onboarded: true });
            toast('Предпочтения сохранены — подбираем музыку', { tone: 'success' });
            onClose();
          }}
        >
          Сохранить
        </Button>
      </div>
    </Sheet>
  );
}
