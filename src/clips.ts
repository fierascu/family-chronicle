/**
 * Newspaper clippings: full-screen viewer for the page images linked to events (clippings/<doc>_p<page>.jpg).
 * Thumbnails in the record card call openClip(); Prev/Next and the arrow keys step through every clipping in date order.
 */
import { EV, P } from './data';
import type { ChronicleEvent } from './types';
import { evTitle, L } from './i18n';
import { esc, label } from './util';

/** every (image, event) pair, oldest first; one page can back more than one event */
export const CLIPS: { f: string; e: ChronicleEvent }[] = EV
  .flatMap(e => (e.images ?? []).map(f => ({ f, e })))
  .sort((a, b) => a.e.date.y - b.e.date.y);

export const clipSrc = (f: string) => 'clippings/' + encodeURIComponent(f);

let dlg: HTMLDialogElement | null = null;
let at = 0;

function build() {
  const d = document.createElement('dialog');
  d.className = 'lb';
  d.setAttribute('aria-label', L.clip.dialog);
  d.innerHTML = `<div class="lb-bar">
      <div class="lb-cap"></div>
      <button type="button" data-go="-1" aria-label="${esc(L.clip.prev)}">${esc(L.clip.prevBtn)}</button>
      <span class="lb-n meta"></span>
      <button type="button" data-go="1" aria-label="${esc(L.clip.next)}">${esc(L.clip.nextBtn)}</button>
      <button type="button" data-close aria-label="${esc(L.clip.close)}">${esc(L.clip.closeBtn)}</button>
    </div>
    <div class="lb-stage"><img alt="" title="${esc(L.clip.fit)}"></div>`;
  d.addEventListener('click', ev => {
    const t = ev.target as HTMLElement;
    if (t.closest('[data-close]')) d.close();
    else if (t.closest('[data-go]')) show(at + Number(t.closest<HTMLElement>('[data-go]')!.dataset.go));
    else if (t.tagName === 'IMG') d.classList.toggle('full');
  });
  d.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowLeft') show(at - 1);
    else if (ev.key === 'ArrowRight') show(at + 1);
  });
  d.addEventListener('close', () => d.querySelector('img')!.removeAttribute('src'));
  document.body.append(d);
  return d;
}

function show(i: number) {
  const d = dlg!;
  at = (i + CLIPS.length) % CLIPS.length;
  const { f, e } = CLIPS[at];
  const who = e.person && P[e.person] ? label(P[e.person]) : '';
  const img = d.querySelector('img')!;
  img.src = clipSrc(f);
  img.alt = evTitle(e);
  const cap = d.querySelector('.lb-cap')!;
  cap.replaceChildren();
  const b = document.createElement('b');
  b.textContent = evTitle(e);
  cap.append(b, document.createElement('br'), [who, e.date.y].filter(Boolean).join(' · '));
  if (e.link) {
    const a = document.createElement('a');
    a.href = e.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = L.clip.arcanum;
    cap.append(' · ', a);
  }
  d.querySelector('.lb-n')!.textContent = `${at + 1} / ${CLIPS.length}`;
  d.classList.remove('full');
  d.querySelector('.lb-stage')!.scrollTo(0, 0);
}

/** after a language change: the viewer is built again, in the new language, the next time it opens */
export function resetClips() {
  if (dlg && !dlg.open) { dlg.remove(); dlg = null; }
}

/** open the viewer at the clipping for this event and image (or the first one) */
export function openClip(e?: ChronicleEvent, f?: string) {
  if (!CLIPS.length) return;
  dlg ??= build();
  const i = CLIPS.findIndex(c => c.e.id === e?.id && c.f === f);
  show(Math.max(i, 0));
  if (!dlg.open) dlg.showModal();
}
