/**
 * Controle (Xbox, PlayStation ou genérico) pelo Gamepad API, lido a cada quadro do Phaser.
 *
 *  Analógico esquerdo / direcional → andar
 *  A (Cruz)       → interagir; num menu aberto, confirma o botão em foco
 *  B (Bola)       → abre/fecha o menu; em painéis, fecha (Esc)
 *  Direcional ↑↓  → com menu/painel aberto, navega entre os botões
 *  Start          → menu
 *
 * Os menus são React: aqui só movemos o foco e "clicamos" nos botões — nenhuma regra nova.
 */
const DEADZONE = 0.25;
const BTN = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

let prev: boolean[] = [];

export interface PadFrame {
  x: number;
  y: number;
  /** Botões que acabaram de ser apertados neste quadro. */
  pressed: Set<number>;
}

export function readGamepad(): PadFrame | null {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  const pad = [...navigator.getGamepads()].find((p): p is Gamepad => !!p && p.connected);
  if (!pad) {
    prev = [];
    return null;
  }
  const down = pad.buttons.map((b) => b.pressed);
  const pressed = new Set<number>();
  down.forEach((d, i) => d && !prev[i] && pressed.add(i));
  prev = down;
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  let x = Math.abs(ax) > DEADZONE ? ax : 0;
  let y = Math.abs(ay) > DEADZONE ? ay : 0;
  if (down[BTN.LEFT]) x = -1;
  if (down[BTN.RIGHT]) x = 1;
  if (down[BTN.UP]) y = -1;
  if (down[BTN.DOWN]) y = 1;
  return { x, y, pressed };
}

/** Painel/menu React aberto por cima do mundo (o de cima é o último no DOM). */
function openDialog(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return all.length ? all[all.length - 1] : null;
}

function buttonsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, [tabindex]:not([tabindex='-1'])")].filter(
    (el) => el.offsetParent !== null,
  );
}

function moveFocus(root: HTMLElement, dir: 1 | -1) {
  const list = buttonsIn(root);
  if (!list.length) return;
  const i = list.indexOf(document.activeElement as HTMLElement);
  list[i < 0 ? 0 : (i + dir + list.length) % list.length].focus();
}

function toggleMenu() {
  document.querySelector<HTMLElement>(".world-btn-b")?.click();
}

/**
 * Trata os botões do quadro. Devolve true se um menu/painel está aberto
 * (o mundo não deve andar com o analógico nesse caso).
 */
export function handlePadButtons(frame: PadFrame, interact: () => void): boolean {
  const dialog = openDialog();
  const p = frame.pressed;
  if (dialog) {
    if (p.has(BTN.UP)) moveFocus(dialog, -1);
    if (p.has(BTN.DOWN)) moveFocus(dialog, 1);
    if (p.has(BTN.A)) {
      const el = document.activeElement as HTMLElement | null;
      if (el && dialog.contains(el)) el.click();
      else moveFocus(dialog, 1);
    }
    if (p.has(BTN.B)) {
      if (dialog.classList.contains("world-menu")) toggleMenu();
      else window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    }
    if (p.has(BTN.START)) toggleMenu();
    return true;
  }
  if (p.has(BTN.A)) interact();
  if (p.has(BTN.B) || p.has(BTN.START)) toggleMenu();
  return false;
}
