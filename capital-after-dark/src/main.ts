import { Game } from './core/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
Game.create(canvas).then((game) => {
  (window as any).__cad = game; // exposed for automated browser checks and debugging
}).catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:0;margin:0;padding:24px;background:#100;color:#f88;z-index:99">Capital: After Dark failed to start.\n\n${String(err?.stack ?? err)}</pre>`);
});
