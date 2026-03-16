const TZ = 'Europe/Madrid';
const CACHE_KEY = 'agenda-santfeliu-cache-v3';
const EVENTS_URL = './events.json';

const state = {
  allEvents: [],
  visibleEvents: [],
  source: 'none',
  lastLoadedAt: null,
};

const el = {
  search: document.getElementById('search'),
  typeFilter: document.getElementById('typeFilter'),
  rangeFilter: document.getElementById('rangeFilter'),
  reloadBtn: document.getElementById('reloadBtn'),
  todayBtn: document.getElementById('todayBtn'),
  resetBtn: document.getElementById('resetBtn'),
  dayJump: document.getElementById('dayJump'),
  backToTopBtn: document.getElementById('backToTopBtn'),
  statVisible: document.getElementById('statVisible'),
  statDays: document.getElementById('statDays'),
  statToday: document.getElementById('statToday'),
  statTomorrow: document.getElementById('statTomorrow'),
  activeFilters: document.getElementById('activeFilters'),
  footerStatus: document.getElementById('footerStatus'),
  container: document.getElementById('calendarContainer'),
};

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat('ca-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: TZ,
  }).format(date);
}

function formatDayHeading(date) {
  return new Intl.DateTimeFormat('ca-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TZ,
  }).format(date);
}

function formatTimeRange(start, end) {
  const fmt = new Intl.DateTimeFormat('ca-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
  const startText = fmt.format(start);
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) return startText;
  return `${startText} - ${fmt.format(end)}`;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function formatMoney(value) {
  if (value == null || value === '') return '';
  const num = Number(String(value).replace(',', '.'));
  if (Number.isNaN(num)) return String(value);
  return new Intl.NumberFormat('ca-ES', {
    style: 'currency',
    currency: 'EUR'
  }).format(num);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function inferTypeFromText(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return '';

  const rules = [
    ['Música', /\b(concert|m[uú]sica|dj|jam|orquestra|recital)\b/i],
    ['Teatre', /\b(teatre|obra|escena|dramat)\b/i],
    ['Cinema', /\b(cinema|film|pel[·l]?[íi]cula|projecci[oó])\b/i],
    ['Família', /\b(fam[ií]lia|infantil|nens|nenes|kids|familiar)\b/i],
    ['Esports', /\b(esport|cursa|torneig|partit|running|futbol|b[àa]squet)\b/i],
    ['Taller', /\b(taller|workshop|curs|formaci[oó])\b/i],
    ['Exposició', /\b(exposici[oó]|mostra|museu|galeria)\b/i],
    ['Festa', /\b(festa|festiu|revetlla|correfoc|carnaval)\b/i],
    ['Xerrada', /\b(xerrada|confer[eè]ncia|taula rodona|col[·l]oqui)\b/i],
  ];

  for (const [label, pattern] of rules) {
    if (pattern.test(normalized)) return label;
  }

  return '';
}

function normalizeType(record) {
  const explicitType = normalizeText(
    record.type ||
    record.tipus ||
    record.tipus_acte ||
    record.category ||
    record.eventType ||
    record.tipusActe ||
    ''
  );

  if (explicitType) return explicitType;

  const fallbackText = [record.title, record.description].filter(Boolean).join(' ');
  return inferTypeFromText(fallbackText);
}

function normalizeRecord(record) {
  const start = new Date(record.start);
  const end = new Date(record.end);

  if (Number.isNaN(start.getTime())) return null;

  const locationName = normalizeText(record.locationName || record.location || '');
  const address = normalizeText(record.address || '');
  const type = normalizeType({
    ...record,
    type: record.type || record.tipusActe || record.tipus_acte || record.tipus || '',
  });
  const description = normalizeText(record.description || '');
  const url = normalizeText(record.url || '');
  const free = normalizeText(record.free || '');
  const price = normalizeText(record.price || '');

  const mapQuery = address || locationName;

  return {
    id: record.id || `${record.title}-${record.start}`,
    title: normalizeText(record.title || 'Sense títol'),
    description,
    locationName,
    address,
    start,
    end: Number.isNaN(end.getTime()) ? new Date(start.getTime() + 60 * 60 * 1000) : end,
    type,
    url,
    mapsUrl: mapQuery ? `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}` : '',
    free,
    price,
  };
}

function saveCache(events) {
  try {
    const payload = {
      savedAt: new Date().toISOString(),
      events: events.map(event => ({
        ...event,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
      })),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('No s’ha pogut guardar la cache', error);
  }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.events)) return null;

    return {
      savedAt: parsed.savedAt,
      events: parsed.events.map(event => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end),
      })),
    };
  } catch (error) {
    console.warn('No s’ha pogut llegir la cache', error);
    return null;
  }
}

function getUniqueTypes(events) {
  return [...new Set(events.map(event => event.type).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ca'));
}

function renderTypeOptions() {
  const current = el.typeFilter.value;
  const types = getUniqueTypes(state.allEvents);

  el.typeFilter.innerHTML =
    '<option value="all">Tots</option>' +
    types.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('');

  if ([...el.typeFilter.options].some(option => option.value === current)) {
    el.typeFilter.value = current;
  } else {
    el.typeFilter.value = 'all';
  }
}

function getFilteredEvents() {
  const query = el.search.value.trim().toLowerCase();
  const type = el.typeFilter.value;
  const range = el.rangeFilter.value;
  const now = new Date();
  const rangeEnd = range === 'all'
    ? null
    : new Date(now.getTime() + Number(range) * 24 * 60 * 60 * 1000);

  return state.allEvents.filter(event => {
    if (event.end < now) return false;
    if (rangeEnd && event.start > rangeEnd) return false;
    if (type !== 'all' && event.type !== type) return false;

    if (!query) return true;

    const haystack = [
      event.title,
      event.locationName,
      event.address,
      event.description,
      event.type,
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();

    return haystack.includes(query);
  });
}

function updateStats(events) {
  const days = new Set(events.map(event => event.start.toISOString().slice(0, 10)));
  const todayStart = startOfToday();
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const afterTomorrowStart = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000);

  const todayCount = events.filter(event => event.start >= todayStart && event.start < tomorrowStart).length;
  const tomorrowCount = events.filter(event => event.start >= tomorrowStart && event.start < afterTomorrowStart).length;

  el.statVisible.textContent = String(events.length);
  el.statDays.textContent = String(days.size);
  el.statToday.textContent = String(todayCount);
  el.statTomorrow.textContent = String(tomorrowCount);
}

function updateFooterStatus() {
  let sourceText = 'sense dades';
  if (state.source === 'json') sourceText = 'events.json';
  if (state.source === 'cache') sourceText = 'cache del navegador';

  const updated = state.lastLoadedAt ? formatDateTime(state.lastLoadedAt) : '—';
  el.footerStatus.textContent = `Font: ${sourceText} · Darrera actualització visible: ${updated}`;
}

function populateDayJump(events) {
  const groups = [...new Set(events.map(event => event.start.toISOString().slice(0, 10)))];
  const current = el.dayJump.value;

  el.dayJump.innerHTML =
    '<option value="">Selecciona un dia</option>' +
    groups.map(key => {
      const date = new Date(`${key}T12:00:00`);
      return `<option value="${key}">${escapeHtml(formatDayHeading(date))}</option>`;
    }).join('');

  if ([...el.dayJump.options].some(option => option.value === current)) {
    el.dayJump.value = current;
  }
}

function renderActiveFilters() {
  const chips = [];
  const search = el.search.value.trim();
  const type = el.typeFilter.value;
  const range = el.rangeFilter.value;

  if (search) chips.push(`Cerca: ${search}`);
  if (type !== 'all') chips.push(`Tipus: ${type}`);

  const rangeMap = {
    '1': 'Avui',
    '7': '7 dies',
    '30': '30 dies',
    '60': '60 dies',
    'all': 'Tot'
  };
  chips.push(`Rang: ${rangeMap[range] || range}`);

  if (!chips.length) {
    el.activeFilters.hidden = true;
    el.activeFilters.innerHTML = '';
    return;
  }

  el.activeFilters.hidden = false;
  el.activeFilters.innerHTML = chips
    .map(chip => `<span class="active-filter-chip">${escapeHtml(chip)}</span>`)
    .join('');
}

function renderEvents() {
  const events = getFilteredEvents();
  state.visibleEvents = events;

  updateStats(events);
  updateFooterStatus();
  populateDayJump(events);
  renderActiveFilters();

  if (!events.length) {
    el.container.className = 'calendar-container empty';
    el.container.innerHTML = 'No hi ha esdeveniments per als filtres actuals.';
    return;
  }

  const grouped = new Map();
  for (const event of events) {
    const key = event.start.toISOString().slice(0, 10);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }

  const html = [];

  for (const [key, items] of grouped.entries()) {
    const anchorId = `day-${key}`;
    html.push(`<section class="day-group" id="${anchorId}">`);
    html.push(`<h2 class="day-title">${escapeHtml(formatDayHeading(items[0].start))}</h2>`);
    html.push('<div class="day-events-grid">');

    for (const event of items) {
      const badges = [];
      if (event.type) badges.push(`<span class="badge">${escapeHtml(event.type)}</span>`);

      if (event.free) {
        const freeText = ['si', 'sí', 'true', '1', 'gratuït', 'gratuit']
          .includes(event.free.toLowerCase())
          ? 'Gratuït'
          : event.free;
        badges.push(`<span class="badge">${escapeHtml(freeText)}</span>`);
      } else if (event.price) {
        badges.push(`<span class="badge">${escapeHtml(formatMoney(event.price))}</span>`);
      }

      const metaParts = [];
      if (event.locationName) metaParts.push(event.locationName);
      if (event.address) metaParts.push(event.address);

      const actions = [];
      if (event.description) {
        actions.push(
          `<button type="button" class="toggle-desc-btn" data-target="desc-${escapeHtml(event.id)}">Mostra descripció</button>`
        );
      }
      if (event.url) {
        actions.push(`<a href="${escapeHtml(event.url)}" target="_blank" rel="noopener noreferrer">Veure fitxa</a>`);
      }
      if (event.mapsUrl) {
        actions.push(`<a href="${escapeHtml(event.mapsUrl)}" target="_blank" rel="noopener noreferrer">Obrir mapa</a>`);
      }

      html.push(`
        <article class="event-card">
          <div class="event-top">
            <div class="event-main">
              <h3 class="event-title">${escapeHtml(event.title)}</h3>
              ${badges.length ? `<div class="event-badges">${badges.join('')}</div>` : ''}
              ${metaParts.length ? `<div class="meta event-location">${escapeHtml(metaParts.join('\n'))}</div>` : ''}
            </div>
            <div class="event-time">${escapeHtml(formatTimeRange(event.start, event.end))}</div>
          </div>

          ${event.description ? `<div id="desc-${escapeHtml(event.id)}" class="desc" hidden>${escapeHtml(event.description)}</div>` : ''}

          ${actions.length ? `<div class="event-actions">${actions.join('')}</div>` : ''}
        </article>
      `);
    }

    html.push('</div>');
    html.push('</section>');
  }

  el.container.className = 'calendar-container';
  el.container.innerHTML = html.join('');
}

async function loadEvents() {
  el.container.className = 'calendar-container loading';
  el.container.textContent = 'Carregant esdeveniments...';

  try {
    const response = await fetch(`${EVENTS_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const raw = await response.json();
    const events = raw.map(normalizeRecord).filter(Boolean);

    state.allEvents = events;
    state.source = 'json';
    state.lastLoadedAt = new Date();

    saveCache(events);
    renderTypeOptions();
    renderEvents();
  } catch (error) {
    console.error(error);

    const cached = loadCache();
    if (cached?.events?.length) {
      state.allEvents = cached.events;
      state.source = 'cache';
      state.lastLoadedAt = cached.savedAt ? new Date(cached.savedAt) : null;
      renderTypeOptions();
      renderEvents();
      return;
    }

    state.allEvents = [];
    state.visibleEvents = [];
    state.source = 'none';
    state.lastLoadedAt = null;
    updateStats([]);
    updateFooterStatus();
    renderActiveFilters();
    el.container.className = 'calendar-container error';
    el.container.innerHTML = 'Ara mateix no s’ha pogut carregar l’agenda. Torna-ho a provar més tard.';
  }
}

el.search.addEventListener('input', renderEvents);
el.typeFilter.addEventListener('change', renderEvents);
el.rangeFilter.addEventListener('change', renderEvents);
el.reloadBtn.addEventListener('click', loadEvents);

el.todayBtn.addEventListener('click', () => {
  el.rangeFilter.value = '1';
  el.search.value = '';
  el.typeFilter.value = 'all';
  renderEvents();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

el.resetBtn.addEventListener('click', () => {
  el.search.value = '';
  el.typeFilter.value = 'all';
  el.rangeFilter.value = 'all';
  renderEvents();
});

el.dayJump.addEventListener('change', () => {
  if (!el.dayJump.value) return;
  const target = document.getElementById(`day-${el.dayJump.value}`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

el.backToTopBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

el.container.addEventListener('click', (event) => {
  const btn = event.target.closest('.toggle-desc-btn');
  if (!btn) return;

  const targetId = btn.getAttribute('data-target');
  const panel = document.getElementById(targetId);
  if (!panel) return;

  const isHidden = panel.hasAttribute('hidden');
  if (isHidden) {
    panel.removeAttribute('hidden');
    btn.textContent = 'Amaga descripció';
  } else {
    panel.setAttribute('hidden', '');
    btn.textContent = 'Mostra descripció';
  }
});

loadEvents();
