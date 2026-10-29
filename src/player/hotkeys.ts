import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibrary } from '../store/library';
import { toast, useUI } from '../store/ui';
import { player } from './controller';
import { usePlayerState } from './store';

export const SHORTCUTS: Array<[string, string]> = [
  ['Пробел', 'Пуск / пауза'],
  ['← / →', 'Перемотка на 5 сек'],
  ['Shift + ← / →', 'Предыдущий / следующий трек'],
  ['↑ / ↓', 'Громкость'],
  ['M', 'Без звука'],
  ['S', 'Перемешать'],
  ['R', 'Режим повтора'],
  ['L', 'Нравится'],
  ['F', 'Полноэкранный плеер'],
  ['Q', 'Очередь'],
  ['/ или ⌘K', 'Поиск'],
  ['?', 'Эта подсказка'],
  ['Esc', 'Закрыть окно'],
];

/** Desktop keyboard shortcuts. Ignored while typing in inputs. */
export function useHotkeys() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.closest('input, textarea, select, [contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate('/search');
        requestAnimationFrame(() => document.getElementById('search-input')?.focus());
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const ui = useUI.getState();
      const track = usePlayerState.getState().queue[usePlayerState.getState().index];
      switch (e.key) {
        case ' ':
          if (el.closest('button, a, [role="slider"]')) return;
          e.preventDefault();
          player.toggle();
          break;
        case 'ArrowRight':
          if (el.closest('[role="slider"]')) return;
          e.preventDefault();
          if (e.shiftKey) void player.next();
          else player.seekBy(5);
          break;
        case 'ArrowLeft':
          if (el.closest('[role="slider"]')) return;
          e.preventDefault();
          if (e.shiftKey) void player.prev();
          else player.seekBy(-5);
          break;
        case 'ArrowUp':
          if (el.closest('[role="slider"], [role="listbox"]')) return;
          e.preventDefault();
          player.setVolume(usePlayerState.getState().volume + 0.05);
          break;
        case 'ArrowDown':
          if (el.closest('[role="slider"], [role="listbox"]')) return;
          e.preventDefault();
          player.setVolume(usePlayerState.getState().volume - 0.05);
          break;
        case 'm':
        case 'M':
          player.toggleMute();
          break;
        case 's':
        case 'S':
          player.toggleShuffle();
          toast(usePlayerState.getState().shuffle ? 'Перемешивание включено' : 'Перемешивание выключено');
          break;
        case 'r':
        case 'R': {
          player.cycleRepeat();
          const r = usePlayerState.getState().repeat;
          toast(r === 'off' ? 'Повтор выключен' : r === 'all' ? 'Повтор очереди' : 'Повтор трека');
          break;
        }
        case 'l':
        case 'L':
          if (track) toast(useLibrary.getState().toggleLike(track) ? 'Добавлено в «Любимые»' : 'Удалено из «Любимых»');
          break;
        case 'f':
        case 'F':
          if (track) ui.setNowPlaying(!ui.nowPlayingOpen);
          break;
        case 'q':
        case 'Q':
          ui.setQueue(!ui.queueOpen);
          break;
        case '/':
          e.preventDefault();
          navigate('/search');
          requestAnimationFrame(() => document.getElementById('search-input')?.focus());
          break;
        case '?':
          ui.setShortcuts(!ui.shortcutsOpen);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}
