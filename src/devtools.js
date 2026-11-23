const STYLE_ID = 'ludus-devtools-styles';
const ROOT_ID = 'ludus-devtools';
const HIGHLIGHT_CLASS = 'ludus-devtools__highlight';
const SELECTED_CLASS = 'ludus-devtools__selected';

const style = document.createElement('style');
style.id = STYLE_ID;
style.textContent = `
  #${ROOT_ID}{position:fixed;z-index:2147483000;right:18px;bottom:18px;color:#fff;font:13px/1.4 Arial,sans-serif;touch-action:none}
  #${ROOT_ID} *{box-sizing:border-box;font-family:Arial,sans-serif}
  #${ROOT_ID} button{border:1px solid #ffffff30;border-radius:6px;background:#222831;color:#fff;padding:8px 10px;font-size:12px;cursor:pointer}
  #${ROOT_ID} button:hover{background:#3a4554}
  #${ROOT_ID} .devtools-toggle{display:flex;align-items:center;gap:7px;box-shadow:0 4px 18px #0006;cursor:grab;touch-action:none;user-select:none}
  #${ROOT_ID} .devtools-toggle:active{cursor:grabbing}
  #${ROOT_ID} .devtools-panel{width:min(310px,calc(100vw - 20px));margin-bottom:8px;padding:10px;background:#222831;border:1px solid #3a4554;border-radius:8px;box-shadow:0 8px 28px #0008}
  #${ROOT_ID} .devtools-panel[hidden]{display:none}
  #${ROOT_ID} .devtools-panel__top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}
  #${ROOT_ID} .devtools-field{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;margin-top:8px}
  #${ROOT_ID} .devtools-field__content{min-width:0}
  #${ROOT_ID} .devtools-field label{display:block;margin-bottom:4px;color:#c5cbd3;font-size:10px}
  #${ROOT_ID} .devtools-field code{display:block;overflow-wrap:anywhere;padding:7px;background:#171c23;border-radius:4px;color:#fff;font:11px/1.4 monospace;user-select:text}
  #${ROOT_ID} .devtools-copy{white-space:nowrap}
  .${HIGHLIGHT_CLASS}{outline:2px solid #ffbd4a!important;outline-offset:3px!important;cursor:crosshair!important}
  .${SELECTED_CLASS}{outline:2px solid #7060ab!important;outline-offset:4px!important}
  body.ludus-devtools-active,body.ludus-devtools-active *{cursor:crosshair!important}
  @media(max-width:520px){#${ROOT_ID}{right:10px;bottom:10px}#${ROOT_ID} .devtools-panel{width:min(300px,calc(100vw - 20px))}}
`;
document.head.append(style);

const root = document.createElement('aside');
root.id = ROOT_ID;
root.innerHTML = `
  <section class="devtools-panel" data-dev-panel hidden>
    <div class="devtools-panel__top">
      <strong>Elemento selecionado</strong>
      <button type="button" data-dev-close>Fechar</button>
    </div>
    <div class="devtools-field">
      <div class="devtools-field__content">
        <label>Elemento HTML</label>
        <code data-dev-element>—</code>
      </div>
      <button class="devtools-copy" type="button" data-copy-element>Copiar</button>
    </div>
    <div class="devtools-field">
      <div class="devtools-field__content">
        <label>Classe CSS</label>
        <code data-dev-class>—</code>
      </div>
      <button class="devtools-copy" type="button" data-copy-class>Copiar</button>
    </div>
  </section>
  <button class="devtools-toggle" type="button" data-dev-toggle aria-pressed="false"><span aria-hidden="true">⌖</span> Modo desenvolvedor</button>
`;
document.body.append(root);

const panel = root.querySelector('[data-dev-panel]');
const toggle = root.querySelector('[data-dev-toggle]');
const elementOutput = root.querySelector('[data-dev-element]');
const classOutput = root.querySelector('[data-dev-class]');
let active = false;
let hovered = null;
let selected = null;
let dragStart = null;
let dragged = false;
let suppressClick = false;

function isOwnUI(element) {
  return Boolean(element?.closest('#' + ROOT_ID));
}

function setHovered(element) {
  if (hovered && hovered !== selected) hovered.classList.remove(HIGHLIGHT_CLASS);
  hovered = element;
  if (hovered && hovered !== selected) hovered.classList.add(HIGHLIGHT_CLASS);
}

function showSelection(element) {
  if (selected) selected.classList.remove(SELECTED_CLASS);
  selected = element;
  if (!selected) return;
  selected.classList.remove(HIGHLIGHT_CLASS);
  selected.classList.add(SELECTED_CLASS);
  elementOutput.textContent = '<' + selected.tagName.toLowerCase() + '>';
  const classes = [...selected.classList].filter((name) => name !== HIGHLIGHT_CLASS && name !== SELECTED_CLASS);
  classOutput.textContent = classes.length ? classes.map((name) => '.' + name).join(' ') : '(sem classe)';
}

function setActive(next) {
  active = next;
  toggle.setAttribute('aria-pressed', String(active));
  toggle.innerHTML = active ? '<span aria-hidden="true">⌖</span> Modo ativo' : '<span aria-hidden="true">⌖</span> Modo desenvolvedor';
  panel.hidden = !active;
  document.body.classList.toggle('ludus-devtools-active', active);
  if (!active) {
    setHovered(null);
    if (selected) selected.classList.remove(SELECTED_CLASS);
    selected = null;
    elementOutput.textContent = '—';
    classOutput.textContent = '—';
  }
}

async function copyValue(value, button) {
  if (!value || value === '—' || value === '(sem classe)') return;
  try {
    await navigator.clipboard.writeText(value);
    const original = button.textContent;
    button.textContent = 'Copiado!';
    window.setTimeout(() => { button.textContent = original; }, 1100);
  } catch {
    button.textContent = 'Falhou';
    window.setTimeout(() => { button.textContent = 'Copiar'; }, 1100);
  }
}

toggle.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const rect = root.getBoundingClientRect();
  dragStart = { pointerX: event.clientX, pointerY: event.clientY, left: rect.left, top: rect.top };
  dragged = false;
  toggle.setPointerCapture(event.pointerId);
});

toggle.addEventListener('pointermove', (event) => {
  if (!dragStart) return;
  const dx = event.clientX - dragStart.pointerX;
  const dy = event.clientY - dragStart.pointerY;
  if (!dragged && Math.hypot(dx, dy) < 5) return;
  dragged = true;
  const maxLeft = Math.max(0, window.innerWidth - toggle.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - toggle.offsetHeight);
  root.style.left = Math.max(0, Math.min(maxLeft, dragStart.left + dx)) + 'px';
  root.style.top = Math.max(0, Math.min(maxTop, dragStart.top + dy)) + 'px';
  root.style.right = 'auto';
  root.style.bottom = 'auto';
});

function finishDrag() {
  if (!dragStart) return;
  if (dragged) suppressClick = true;
  dragStart = null;
}

toggle.addEventListener('pointerup', finishDrag);
toggle.addEventListener('pointercancel', finishDrag);
toggle.addEventListener('click', (event) => {
  if (suppressClick) {
    event.preventDefault();
    suppressClick = false;
    return;
  }
  setActive(!active);
});

root.querySelector('[data-dev-close]').addEventListener('click', () => setActive(false));
root.querySelector('[data-copy-element]').addEventListener('click', (event) => copyValue(elementOutput.textContent, event.currentTarget));
root.querySelector('[data-copy-class]').addEventListener('click', (event) => copyValue(classOutput.textContent, event.currentTarget));

document.addEventListener('pointermove', (event) => {
  if (!active) return;
  const element = document.elementFromPoint(event.clientX, event.clientY);
  if (!element || isOwnUI(element)) return;
  setHovered(element);
}, true);

document.addEventListener('click', (event) => {
  if (!active || isOwnUI(event.target)) return;
  const element = event.target instanceof Element ? event.target : event.target.parentElement;
  if (!element) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  showSelection(element);
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && active) {
    event.preventDefault();
    setActive(false);
  }
});
