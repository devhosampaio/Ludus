const STYLE_ID = 'ludus-devtools-styles';
const ROOT_ID = 'ludus-devtools';
const HIGHLIGHT_CLASS = 'ludus-devtools__highlight';
const SELECTED_CLASS = 'ludus-devtools__selected';

const style = document.createElement('style');
style.id = STYLE_ID;
style.textContent = `
  #${ROOT_ID}{position:fixed;z-index:2147483000;right:18px;bottom:18px;color:#f5f0e6;font:13px/1.45 Inter,Arial,sans-serif}
  #${ROOT_ID} *{box-sizing:border-box;font-family:Inter,Arial,sans-serif}
  #${ROOT_ID} button{border:1px solid #ffffff30;border-radius:8px;background:#302c3d;color:#f5f0e6;padding:9px 12px;font-size:12px;font-weight:600;cursor:pointer}
  #${ROOT_ID} button:hover{background:#454052}
  #${ROOT_ID} .devtools-toggle{display:flex;align-items:center;gap:8px;box-shadow:0 5px 24px #0007}
  #${ROOT_ID} .devtools-toggle[aria-pressed="true"]{background:#d96c55;color:#211e2b;border-color:#d96c55}
  #${ROOT_ID} .devtools-panel{width:min(390px,calc(100vw - 28px));margin-bottom:10px;padding:14px;background:#24212d;border:1px solid #ffffff26;border-radius:12px;box-shadow:0 12px 40px #0009}
  #${ROOT_ID} .devtools-panel[hidden]{display:none}
  #${ROOT_ID} .devtools-panel__top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}
  #${ROOT_ID} .devtools-panel__title{font-size:13px;font-weight:700}
  #${ROOT_ID} .devtools-panel__hint{color:#c2bdca;font-size:11px;margin:0 0 12px}
  #${ROOT_ID} .devtools-field{margin-top:10px}
  #${ROOT_ID} .devtools-field label{display:block;color:#c2bdca;font-size:10px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px}
  #${ROOT_ID} .devtools-field code{display:block;max-height:78px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:8px;background:#17151d;border-radius:6px;color:#f5f0e6;font:11px/1.5 ui-monospace,monospace;user-select:text}
  #${ROOT_ID} .devtools-panel__actions{display:flex;gap:8px;margin-top:12px}
  #${ROOT_ID} .devtools-properties{display:grid;grid-template-columns:105px minmax(0,1fr);gap:6px 10px;margin-top:14px;padding-top:12px;border-top:1px solid #ffffff20}
  #${ROOT_ID} .devtools-properties__title{grid-column:1/-1;color:#f5f0e6;font-size:11px;font-weight:700;margin-bottom:2px}
  #${ROOT_ID} .devtools-property__name{color:#c2bdca;font-size:10px;align-self:center}
  #${ROOT_ID} .devtools-property__value{min-width:0;color:#f5f0e6;font:10px/1.4 ui-monospace,monospace;overflow-wrap:anywhere;user-select:text}
  #${ROOT_ID} .devtools-panel__actions button:first-child{background:#d96c55;color:#211e2b;border-color:#d96c55}
  #${ROOT_ID} .devtools-status{min-height:16px;margin-top:8px;color:#a9d5b5;font-size:11px}
  #${ROOT_ID} .devtools-measure{margin-top:12px;padding-top:12px;border-top:1px solid #ffffff20}
  #${ROOT_ID} .devtools-measure__values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:9px}
  #${ROOT_ID} .devtools-measure__value{padding:8px;background:#17151d;border-radius:6px}
  #${ROOT_ID} .devtools-measure__value span{display:block;color:#c2bdca;font-size:9px;text-transform:uppercase}
  #${ROOT_ID} .devtools-measure__value strong{display:block;margin-top:3px;font:12px ui-monospace,monospace}
  .ludus-devtools-measure-point{outline:2px solid #70c7e8!important;outline-offset:3px!important}
  #${ROOT_ID} .devtools-measure-overlay{position:fixed;inset:0;width:100vw;height:100vh;overflow:visible;pointer-events:none;z-index:2147482999}
  #${ROOT_ID} .devtools-measure-overlay line{stroke:#70c7e8;stroke-width:2;stroke-dasharray:6 4;vector-effect:non-scaling-stroke}
  #${ROOT_ID} .devtools-measure-overlay circle{fill:#70c7e8;stroke:#17151d;stroke-width:2}
  #${ROOT_ID} .devtools-measure-overlay text{fill:#fff;font:12px ui-monospace,monospace;paint-order:stroke;stroke:#17151d;stroke-width:5px;stroke-linejoin:round}
  .${HIGHLIGHT_CLASS}{outline:2px solid #ffbd4a!important;outline-offset:3px!important;cursor:crosshair!important}
  .${SELECTED_CLASS}{outline:2px solid #d96c55!important;outline-offset:4px!important}
  body.ludus-devtools-active,body.ludus-devtools-active *{cursor:crosshair!important}
  @media(max-width:520px){#${ROOT_ID}{right:10px;bottom:10px}#${ROOT_ID} .devtools-panel{width:min(360px,calc(100vw - 20px))}}
`;
document.head.append(style);

const root = document.createElement('aside');
root.id = ROOT_ID;
root.innerHTML = `
  <section class="devtools-panel" data-dev-panel hidden>
    <div class="devtools-panel__top">
      <strong class="devtools-panel__title">Inspecionar elemento</strong>
      <button type="button" data-dev-close aria-label="Fechar modo desenvolvedor">Fechar</button>
    </div>
    <p class="devtools-panel__hint">Passe o mouse para destacar. Clique em um elemento para fixar sua identificação. Pressione Esc para sair.</p>
    <div class="devtools-field"><label>Elemento</label><code data-dev-name>Nenhum elemento selecionado</code></div>
    <div class="devtools-field"><label>Seletor CSS</label><code data-dev-selector>—</code></div>
    <div class="devtools-field"><label>Classes</label><code data-dev-classes>—</code></div>
    <div class="devtools-properties" data-dev-properties hidden>
      <strong class="devtools-properties__title">Propriedades computadas</strong>
      <span class="devtools-property__name">width</span><code class="devtools-property__value" data-prop-width>—</code>
      <span class="devtools-property__name">height</span><code class="devtools-property__value" data-prop-height>—</code>
      <span class="devtools-property__name">border</span><code class="devtools-property__value" data-prop-border>—</code>
      <span class="devtools-property__name">color</span><code class="devtools-property__value" data-prop-color>—</code>
      <span class="devtools-property__name">font-family</span><code class="devtools-property__value" data-prop-font-family>—</code>
      <span class="devtools-property__name">font-size</span><code class="devtools-property__value" data-prop-font-size>—</code>
      <span class="devtools-property__name">outline</span><code class="devtools-property__value" data-prop-outline>—</code>
    </div>
    <div class="devtools-panel__actions">
      <button type="button" data-dev-copy>Copiar identificação</button>
      <button type="button" data-dev-copy-selector>Copiar seletor</button>
    </div>
    <div class="devtools-status" data-dev-status aria-live="polite"></div>
  </section>
  <button class="devtools-toggle" type="button" data-dev-toggle aria-pressed="false"><span aria-hidden="true">⌖</span> Modo desenvolvedor</button>
`;
document.body.append(root);

const panel = root.querySelector('[data-dev-panel]');
const toggle = root.querySelector('[data-dev-toggle]');
const nameOutput = root.querySelector('[data-dev-name]');
const selectorOutput = root.querySelector('[data-dev-selector]');
const classesOutput = root.querySelector('[data-dev-classes]');
const statusOutput = root.querySelector('[data-dev-status]');
const propertiesOutput = root.querySelector('[data-dev-properties]');
const measureButton = root.querySelector('[data-dev-measure]');
const measureHint = root.querySelector('[data-dev-measure-hint]');
const measureValues = root.querySelector('[data-dev-measure-values]');
const measureOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
measureOverlay.setAttribute('class', 'devtools-measure-overlay');
measureOverlay.setAttribute('aria-hidden', 'true');
measureOverlay.setAttribute('viewBox', '0 0 100 100');
measureOverlay.setAttribute('preserveAspectRatio', 'none');
root.append(measureOverlay);
let measuring = false;
let measureFirst = null;
let measureSecond = null;
let active = false;
let hovered = null;
let selected = null;
let lastSelector = '';

function isOwnUI(element) {
  return Boolean(element?.closest('#' + ROOT_ID));
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => '\\\\' + char);
}

function selectorFor(element) {
  if (!(element instanceof Element)) return '';
  if (element.id) return '#' + cssEscape(element.id);

  const stableAttributes = ['data-review-id','data-comment-id','data-game-id','data-profile-username','data-feed-mode','data-newcomers-list','data-header-search','data-notifications','data-account-details'];
  for (const attribute of stableAttributes) {
    if (element.hasAttribute(attribute)) {
      const value = element.getAttribute(attribute);
      return element.tagName.toLowerCase() + '[' + attribute + (value ? '="' + value.replace(/"/g, '\\"') + '"' : '') + ']';
    }
  }

  const parts = [];
  let current = element;
  while (current && current !== document.body && parts.length < 5) {
    let part = current.tagName.toLowerCase();
    const usefulClasses = [...current.classList].filter((name) => !name.startsWith('is-') && !name.startsWith('has-')).slice(0, 3);
    if (usefulClasses.length) part += '.' + usefulClasses.map(cssEscape).join('.');
    if (!usefulClasses.length && current.parentElement) {
      const siblings = [...current.parentElement.children].filter((sibling) => sibling.tagName === current.tagName);
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
    }
    parts.unshift(part);
    if (current.id) { parts[0] = '#' + cssEscape(current.id); break; }
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function describe(element) {
  const tag = element.tagName.toLowerCase();
  const classes = [...element.classList].filter((name) => name !== HIGHLIGHT_CLASS && name !== SELECTED_CLASS);
  const label = element.getAttribute('aria-label') || element.getAttribute('title') ||
    element.getAttribute('data-testid') || element.getAttribute('data-feed-mode') ||
    element.getAttribute('data-review-id') || element.getAttribute('data-game-id') ||
    element.getAttribute('data-profile-username') || element.textContent.trim().replace(/\\s+/g, ' ').slice(0, 90);
  return {
    name: '<' + tag + '>' + (label ? ' — ' + label : '') ,
    selector: selectorFor(element),
    classes: classes.length ? classes.join(' ') : '(sem classes)',
    tag,
    label
  };
}

function setHovered(element) {
  if (hovered && hovered !== selected) hovered.classList.remove(HIGHLIGHT_CLASS);
  hovered = element;
  if (hovered && hovered !== selected) hovered.classList.add(HIGHLIGHT_CLASS);
}

function updateProperties(element) {
  // Ignora temporariamente o contorno do próprio inspetor para mostrar o outline real do elemento.
  element.classList.remove(SELECTED_CLASS);
  const computed = window.getComputedStyle(element);
  const values = {
    width: computed.width,
    height: computed.height,
    border: computed.border,
    color: computed.color,
    'font-family': computed.fontFamily,
    'font-size': computed.fontSize,
    outline: computed.outline
  };
  element.classList.add(SELECTED_CLASS);
  for (const [property, value] of Object.entries(values)) {
    const output = propertiesOutput.querySelector('[data-prop-' + property.replace(/[^a-z-]/g, '') + ']');
    if (output) output.textContent = value;
  }
  propertiesOutput.hidden = false;
}

function showSelection(element) {
  if (selected) selected.classList.remove(SELECTED_CLASS);
  selected = element;
  if (!selected) return;
  selected.classList.remove(HIGHLIGHT_CLASS);
  selected.classList.add(SELECTED_CLASS);
  const details = describe(selected);
  lastSelector = details.selector;
  nameOutput.textContent = details.name;
  selectorOutput.textContent = details.selector;
  classesOutput.textContent = details.classes;
  updateProperties(selected);
  statusOutput.textContent = 'Elemento selecionado. Você pode copiar e enviar aqui no chat.';
}

function clearMeasurement() {
  measureFirst?.classList.remove('ludus-devtools-measure-point');
  measureSecond?.classList.remove('ludus-devtools-measure-point');
  measureFirst = null;
  measureSecond = null;
  measureOverlay.innerHTML = '';
  measureValues.hidden = true;
  measureHint.textContent = measuring
    ? 'Clique no primeiro elemento e depois no segundo.'
    : 'Ative e clique em dois elementos para comparar suas posições.';
}

function measureElement(element) {
  if (!measureFirst || measureSecond) {
    clearMeasurement();
    measureFirst = element;
    measureFirst.classList.add('ludus-devtools-measure-point');
    measureHint.textContent = 'Primeiro elemento selecionado. Agora clique no segundo.';
    return;
  }
  measureSecond = element;
  measureSecond.classList.add('ludus-devtools-measure-point');
  const first = measureFirst.getBoundingClientRect();
  const second = measureSecond.getBoundingClientRect();
  const x1 = first.left + first.width / 2;
  const y1 = first.top + first.height / 2;
  const x2 = second.left + second.width / 2;
  const y2 = second.top + second.height / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.hypot(dx, dy);
  const ns = 'http://www.w3.org/2000/svg';
  measureOverlay.innerHTML = '';
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y1);
  line.setAttribute('x2', x2); line.setAttribute('y2', y2);
  measureOverlay.append(line);
  for (const [x, y] of [[x1, y1], [x2, y2]]) {
    const point = document.createElementNS(ns, 'circle');
    point.setAttribute('cx', x); point.setAttribute('cy', y); point.setAttribute('r', 5);
    measureOverlay.append(point);
  }
  const label = document.createElementNS(ns, 'text');
  label.setAttribute('x', (x1 + x2) / 2 + 8);
  label.setAttribute('y', (y1 + y2) / 2 - 8);
  label.textContent = distance.toFixed(1) + ' px';
  measureOverlay.append(label);
  root.querySelector('[data-measure-x]').textContent = Math.abs(dx).toFixed(1) + ' px';
  root.querySelector('[data-measure-y]').textContent = Math.abs(dy).toFixed(1) + ' px';
  root.querySelector('[data-measure-distance]').textContent = distance.toFixed(1) + ' px';
  measureValues.hidden = false;
  measureHint.textContent = 'Medição entre os centros dos dois elementos. Clique novamente para iniciar outra.';
}

function setActive(next) {
  active = next;
  toggle.setAttribute('aria-pressed', String(active));
  toggle.innerHTML = active ? '<span aria-hidden="true">⌖</span> Modo ativo' : '<span aria-hidden="true">⌖</span> Modo desenvolvedor';
  panel.hidden = !active;
  document.body.classList.toggle('ludus-devtools-active', active);
  if (!active) {
    measuring = false;
    measureButton.setAttribute('aria-pressed', 'false');
    measureButton.textContent = '⌖ Medir distância entre elementos';
    clearMeasurement();
    setHovered(null);
    if (selected) selected.classList.remove(SELECTED_CLASS);
    selected = null;
  }
}

async function copyText(value) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    statusOutput.textContent = 'Copiado. Agora é só colar na conversa.';
  } catch {
    statusOutput.textContent = 'Não foi possível copiar automaticamente. Selecione o texto acima.';
  }
}

toggle.addEventListener('click', () => setActive(!active));
root.querySelector('[data-dev-close]').addEventListener('click', () => setActive(false));
measureButton.addEventListener('click', () => {
  measuring = !measuring;
  measureButton.setAttribute('aria-pressed', String(measuring));
  measureButton.textContent = measuring ? 'Cancelar medição' : '⌖ Medir distância entre elementos';
  clearMeasurement();
  if (measuring) measureHint.textContent = 'Clique no primeiro elemento e depois no segundo.';
});
root.querySelector('[data-dev-measure-clear]').addEventListener('click', clearMeasurement);
root.querySelector('[data-dev-copy-selector]').addEventListener('click', () => copyText(lastSelector));
root.querySelector('[data-dev-copy]').addEventListener('click', () => {
  if (!selected) return;
  const details = describe(selected);
  copyText('Elemento: ' + details.name + '\\nSeletor CSS: ' + details.selector + '\\nClasses: ' + details.classes);
});

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
  if (measuring) {
    measureElement(element);
    return;
  }
  showSelection(element);
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && active) {
    event.preventDefault();
    setActive(false);
  }
});
