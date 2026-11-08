import { createAnimalCharms } from './animal-charms.js';
import { animalCharmsConfig } from './animal-charms.config.js';

let activeCharms = null;
export const ready = (async () => {
  if (!animalCharmsConfig.enabled) return { enabled: false };
  const footer = document.querySelector('footer');
  if (!footer) return { enabled: false };
  const mount = document.createElement('div');
  mount.className = 'animal-charms-mount';
  mount.setAttribute('data-charms-protect', '');
  footer.before(mount);
  activeCharms = createAnimalCharms({
    ...animalCharmsConfig,
    controlsMount: mount,
    roamPage: true,
    showCredits: false,
    isMusicPlaying: () => document.querySelector('#music-toggle')?.getAttribute('aria-pressed') === 'true',
  });
  const result = await activeCharms.ready;
  if (!result.enabled) {
    activeCharms.destroy();
    mount.remove();
    return result;
  }
  const note = document.createElement('p');
  note.className = 'animal-charms-note';
  note.textContent = '轻轻漂游，碰面就弹开。点一点，和小伙伴打个招呼。';
  mount.querySelector('.animal-charms-caption').after(note);
  activeCharms.refresh();
  return result;
})();
export function getCharms() { return activeCharms; }
