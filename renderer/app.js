/* Khalid Manager Dashboard — renderer logic with i18n. */

const t = window.t;
const I18N = window.I18N;

// ---------- Storage ----------
const hasApi = typeof window !== 'undefined' && window.api;
const storage = {
  async load() {
    if (hasApi) return await window.api.loadData();
    const raw = localStorage.getItem('scheduler-data');
    return raw ? JSON.parse(raw) : { tasks: [], meetings: [], teamMembers: [], followUps: [], notes: [] };
  },
  async save(d) {
    if (hasApi) return await window.api.saveData(d);
    localStorage.setItem('scheduler-data', JSON.stringify(d));
    return true;
  },
  async export(d) {
    if (hasApi) return await window.api.exportData(d);
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `scheduler-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    return { ok: true };
  },
  async notify(title, body) {
    if (hasApi) return await window.api.notify(title, body);
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
  },
};

// ---------- State ----------
const state = {
  data: { tasks: [], meetings: [], teamMembers: [], followUps: [], notes: [] },
  activeTab: 'tasks',
  taskFilter: 'all',
  calendarMonth: new Date(),
  selectedDate: new Date(),
  searchQuery: '',
  recording: null,
  selectedTaskIds: new Set(),
  lastClickedTaskId: null,
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(I18N.locale(), { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return iso; }
};
const fmtDateTime = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(I18N.locale(), { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
};
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(I18N.locale(), { hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};
const debounce = (fn, ms) => {
  let tm; return (...args) => { clearTimeout(tm); tm = setTimeout(() => fn(...args), ms); };
};

// ---------- Toast ----------
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2200);
}

// ---------- Modal ----------
const modalBackdrop = document.getElementById('modal-backdrop');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalFoot = document.getElementById('modal-foot');
document.getElementById('modal-close').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModal(); });
function openModal(title, bodyHTML, footerButtons) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHTML;
  modalFoot.innerHTML = '';
  for (const b of footerButtons) {
    const btn = document.createElement('button');
    btn.className = `btn ${b.class || 'btn-outline'}`;
    btn.textContent = b.label;
    btn.addEventListener('click', () => b.onClick && b.onClick(btn));
    modalFoot.appendChild(btn);
  }
  modalBackdrop.classList.remove('hidden');
}
function closeModal() { modalBackdrop.classList.add('hidden'); modalBody.innerHTML = ''; }

async function persist() { await storage.save(state.data); }

// ---------- Recurring expansion ----------
function expandRecurringTasks() {
  const today = todayISO();
  let added = 0;
  for (const tk of state.data.tasks) {
    if (!tk.recurring || tk.recurring === 'none') continue;
    const lastGen = tk.lastGenerated || tk.createdAt?.slice(0, 10);
    if (!lastGen) continue;
    let cursor = new Date(lastGen);
    const todayD = new Date(today);
    const step = (d) => {
      const nd = new Date(d);
      if (tk.recurring === 'daily') nd.setDate(nd.getDate() + 1);
      else if (tk.recurring === 'weekly') nd.setDate(nd.getDate() + 7);
      else if (tk.recurring === 'monthly') nd.setMonth(nd.getMonth() + 1);
      return nd;
    };
    cursor = step(cursor);
    while (cursor <= todayD) {
      const dueISO = cursor.toISOString().slice(0, 10);
      const exists = state.data.tasks.some((x) => x.parentRecurring === tk.id && x.dueDate === dueISO);
      if (!exists) {
        state.data.tasks.push({
          id: uid(), title: tk.title, description: tk.description, priority: tk.priority,
          status: 'pending', dueDate: dueISO, tags: [...(tk.tags || [])],
          subtasks: (tk.subtasks || []).map((s) => ({ id: uid(), title: s.title, done: false })),
          recurring: 'none', parentRecurring: tk.id, createdAt: new Date().toISOString(),
          order: state.data.tasks.length,
        });
        added++;
      }
      cursor = step(cursor);
    }
    tk.lastGenerated = today;
  }
  if (added > 0) persist();
}

// ---------- Theme ----------
const THEME_KEY = 'scheduler-theme';
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = theme === 'dark' ? t('btn.theme.toLight') : t('btn.theme.toDark');
  btn?.setAttribute('data-i18n', theme === 'dark' ? 'btn.theme.toLight' : 'btn.theme.toDark');
  localStorage.setItem(THEME_KEY, theme);
  if (state.activeTab === 'stats') renderStats();
}
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
document.getElementById('btn-theme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});

// ---------- Language ----------
let booted = false;
function applyLang(lang) {
  I18N.setLang(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('app.title');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const arr = t(el.dataset.i18n);
    if (typeof arr === 'string') el.textContent = arr;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  document.getElementById('today-date').textContent = fmtDate(new Date());
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const tb = document.getElementById('btn-theme');
  if (tb) tb.textContent = theme === 'dark' ? t('btn.theme.toLight') : t('btn.theme.toDark');
  if (booted) renderAll();
}
// Apply static text/dir/lang up front; renderAll comes later from boot IIFE.
applyLang(I18N.getLang());
document.getElementById('btn-lang').addEventListener('click', () => {
  applyLang(I18N.getLang() === 'ar' ? 'en' : 'ar');
});

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ['tasks', 'meetings', 'team', 'notes', 'stats'].forEach((n) => {
    document.getElementById('panel-' + n).classList.toggle('hidden', n !== tab);
  });
  if (tab === 'meetings') renderCalendar();
  if (tab === 'stats') renderStats();
}

// ---------- Counters ----------
function updateCounters() {
  const today = todayISO();
  document.getElementById('stat-today').textContent     = state.data.tasks.filter((t) => t.dueDate === today && t.status !== 'done').length;
  document.getElementById('stat-pending').textContent   = state.data.tasks.filter((t) => t.status !== 'done').length;
  document.getElementById('stat-meetings').textContent  = state.data.meetings.filter((m) => new Date(m.start) >= new Date()).length;
  document.getElementById('stat-followups').textContent = state.data.followUps.filter((f) => f.status !== 'done').length;
}

// ============================================================
// TASKS
// ============================================================
const taskListEl = document.getElementById('task-list');
const taskEmptyEl = document.getElementById('task-empty');

document.querySelectorAll('#task-filters .chip').forEach((c) => {
  c.addEventListener('click', () => {
    document.querySelectorAll('#task-filters .chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    state.taskFilter = c.dataset.filter;
    renderTasks();
  });
});

document.getElementById('btn-add-task').addEventListener('click', () => openTaskModal());

function filteredTasks() {
  const today = todayISO();
  return state.data.tasks.filter((tk) => {
    switch (state.taskFilter) {
      case 'today': return tk.dueDate === today;
      case 'pending': return tk.status !== 'done';
      case 'done': return tk.status === 'done';
      case 'high': return tk.priority === 'high';
      default: return true;
    }
  }).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function renderTasks() {
  const items = filteredTasks();
  taskListEl.innerHTML = '';
  taskEmptyEl.classList.toggle('hidden', items.length > 0);
  for (const tk of items) taskListEl.appendChild(renderTaskItem(tk));
  renderBulkBar();
}

// ---------- Bulk action bar ----------
function renderBulkBar() {
  let bar = document.getElementById('bulk-bar');
  const count = state.selectedTaskIds.size;
  if (count === 0) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'bulk-bar';
    bar.className = 'bulk-bar';
    document.body.appendChild(bar);
  }
  const isAr = I18N.getLang() === 'ar';
  bar.innerHTML = `
    <span class="bulk-bar-count">${count}</span>
    <span>${isAr ? 'محدد' : 'selected'}</span>
    <select id="bulk-priority" title="${isAr ? 'تغيير الأولوية' : 'Set priority'}">
      <option value="">${isAr ? 'الأولوية…' : 'Priority…'}</option>
      <option value="high">${t('stats.priority.high')}</option>
      <option value="medium">${t('stats.priority.medium')}</option>
      <option value="low">${t('stats.priority.low')}</option>
    </select>
    <input id="bulk-due" type="date" title="${isAr ? 'تاريخ الاستحقاق' : 'Due date'}">
    <input id="bulk-tag" type="text" placeholder="${isAr ? '+ وسم' : '+ tag'}" size="10">
    <button class="btn btn-danger" id="bulk-delete">${t('action.delete')}</button>
    <button class="btn btn-outline" id="bulk-clear">${isAr ? 'إلغاء التحديد' : 'Clear'}</button>
  `;
  document.getElementById('bulk-priority').addEventListener('change', async (e) => {
    const v = e.target.value;
    if (!v) return;
    selectedTasksForEach((tk) => { tk.priority = v; });
    await persist(); renderTasks();
  });
  document.getElementById('bulk-due').addEventListener('change', async (e) => {
    const v = e.target.value;
    if (!v) return;
    selectedTasksForEach((tk) => { tk.dueDate = v; });
    await persist(); renderTasks();
  });
  document.getElementById('bulk-tag').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const v = e.target.value.trim();
    if (!v) return;
    selectedTasksForEach((tk) => {
      tk.tags = tk.tags || [];
      if (!tk.tags.includes(v)) tk.tags.push(v);
    });
    await persist(); renderTasks();
    e.target.value = '';
  });
  document.getElementById('bulk-delete').addEventListener('click', () => {
    const n = state.selectedTaskIds.size;
    openModal(t('modal.delete.title'), `<p>${isAr ? `هل تريد حذف ${n} مهمة؟ لا يمكن التراجع.` : `Delete ${n} tasks? This cannot be undone.`}</p>`, [
      { label: t('action.cancel'), class: 'btn-outline', onClick: closeModal },
      { label: t('action.delete'), class: 'btn-danger', onClick: async () => {
          closeModal();
          state.data.tasks = state.data.tasks.filter((x) => !state.selectedTaskIds.has(x.id));
          state.selectedTaskIds.clear();
          await persist(); renderAll();
          toast(isAr ? `تم حذف ${n} مهمة` : `${n} tasks deleted`);
      }},
    ]);
  });
  document.getElementById('bulk-clear').addEventListener('click', () => {
    state.selectedTaskIds.clear();
    renderTasks();
  });
}
function selectedTasksForEach(fn) {
  for (const tk of state.data.tasks) if (state.selectedTaskIds.has(tk.id)) fn(tk);
}

function renderTaskItem(tk) {
  const li = document.createElement('li');
  li.className = 'task-item priority-' + (tk.priority || 'medium');
  if (state.selectedTaskIds.has(tk.id)) li.classList.add('selected');
  li.draggable = true;
  li.dataset.id = tk.id;

  const today = todayISO();
  const isOverdue = tk.dueDate && tk.dueDate < today && tk.status !== 'done';
  const priorityBadge =
    tk.priority === 'high' ? `<span class="badge badge-high">${t('priority.high')}</span>`
    : tk.priority === 'medium' ? `<span class="badge badge-medium">${t('priority.medium')}</span>`
    : `<span class="badge badge-low">${t('priority.low')}</span>`;
  const dueBadge = tk.dueDate
    ? `<span class="badge ${isOverdue ? 'badge-overdue' : 'badge-due'}">${isOverdue ? t('badge.overduePrefix') : ''}${fmtDate(tk.dueDate)}</span>`
    : '';
  const recurringBadge = tk.recurring && tk.recurring !== 'none'
    ? `<span class="badge badge-recurring">${t('badge.recurring', { x: t('recurring.' + tk.recurring) })}</span>` : '';
  const tagsBadges = (tk.tags || []).map((tg) => `<span class="badge badge-tag">${escapeHTML(tg)}</span>`).join('');

  const subtasksHTML = (tk.subtasks || []).length
    ? `<div class="subtasks">${tk.subtasks.map((s) => `
        <label class="subtask">
          <input type="checkbox" data-sub="${s.id}" ${s.done ? 'checked' : ''}>
          <span class="${s.done ? 'done' : ''}">${escapeHTML(s.title)}</span>
        </label>`).join('')}</div>` : '';

  li.innerHTML = `
    <input type="checkbox" class="task-checkbox" ${tk.status === 'done' ? 'checked' : ''}>
    <div class="task-content">
      <div class="task-title ${tk.status === 'done' ? 'done' : ''}">${escapeHTML(tk.title)}</div>
      ${tk.description ? `<div class="task-desc">${escapeHTML(tk.description)}</div>` : ''}
      <div class="task-meta">${priorityBadge} ${dueBadge} ${recurringBadge} ${tagsBadges}</div>
      ${subtasksHTML}
    </div>
    <div class="task-actions">
      <button class="text-btn" data-action="edit">${t('action.edit')}</button>
      <button class="text-btn text-btn-danger" data-action="delete">${t('action.delete')}</button>
    </div>
  `;

  li.querySelector('.task-checkbox').addEventListener('change', async (e) => {
    tk.status = e.target.checked ? 'done' : 'pending'; await persist(); renderAll();
  });

  // Bulk-select: Ctrl/Cmd-click toggles, Shift-click selects range
  li.addEventListener('click', (e) => {
    if (e.target.closest('input, button, a, label, .subtask')) return;
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
    e.preventDefault();
    if (e.shiftKey && state.lastClickedTaskId) {
      const ids = filteredTasks().map((x) => x.id);
      const a = ids.indexOf(state.lastClickedTaskId);
      const b = ids.indexOf(tk.id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) state.selectedTaskIds.add(ids[i]);
      }
    } else {
      if (state.selectedTaskIds.has(tk.id)) state.selectedTaskIds.delete(tk.id);
      else state.selectedTaskIds.add(tk.id);
    }
    state.lastClickedTaskId = tk.id;
    renderTasks();
    renderBulkBar();
  });
  li.querySelectorAll('input[data-sub]').forEach((cb) => {
    cb.addEventListener('change', async (e) => {
      const s = tk.subtasks.find((x) => x.id === e.target.dataset.sub);
      if (s) { s.done = e.target.checked; await persist(); renderTasks(); }
    });
  });
  li.querySelector('[data-action="edit"]').addEventListener('click', () => openTaskModal(tk));
  li.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete('task', async () => {
    state.data.tasks = state.data.tasks.filter((x) => x.id !== tk.id);
    await persist(); renderAll(); toast(t('msg.taskDeleted'));
  }));

  // Drag-drop
  li.addEventListener('dragstart', () => li.classList.add('dragging'));
  li.addEventListener('dragend', () => li.classList.remove('dragging'));
  li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drag-over'); });
  li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    li.classList.remove('drag-over');
    const dragging = document.querySelector('.task-item.dragging');
    if (!dragging || dragging === li) return;
    const draggedTask = state.data.tasks.find((x) => x.id === dragging.dataset.id);
    if (!draggedTask) return;
    const others = state.data.tasks.filter((x) => x.id !== draggedTask.id);
    const targetIdx = others.findIndex((x) => x.id === tk.id);
    others.splice(targetIdx, 0, draggedTask);
    others.forEach((x, i) => (x.order = i));
    state.data.tasks = others;
    await persist(); renderTasks();
  });

  return li;
}

function openTaskModal(task) {
  const isEdit = !!task;
  const tk = task || { title: '', description: '', priority: 'medium', dueDate: todayISO(), tags: [], subtasks: [], recurring: 'none' };
  const subtasksHTML = (tk.subtasks || []).map((s) => subtaskEditorHTML(s.id, s.title)).join('');

  openModal(isEdit ? t('modal.task.edit') : t('modal.task.add'), `
    <div class="field"><label>${t('form.title')}</label><input id="f-title" type="text" value="${escapeAttr(tk.title)}" placeholder="${escapeAttr(t('form.task.title.placeholder'))}"></div>
    <div class="field"><label>${t('form.description')}</label><textarea id="f-desc" placeholder="${escapeAttr(t('form.task.desc.placeholder'))}">${escapeHTML(tk.description || '')}</textarea></div>
    <div class="field-row">
      <div class="field"><label>${t('form.priority')}</label>
        <select id="f-priority">
          <option value="low" ${tk.priority==='low'?'selected':''}>${t('stats.priority.low')}</option>
          <option value="medium" ${tk.priority==='medium'?'selected':''}>${t('stats.priority.medium')}</option>
          <option value="high" ${tk.priority==='high'?'selected':''}>${t('stats.priority.high')}</option>
        </select>
      </div>
      <div class="field"><label>${t('form.dueDate')}</label><input id="f-due" type="date" value="${tk.dueDate || ''}"><div id="task-workload-warning"></div></div>
    </div>
    <div class="field-row">
      <div class="field"><label>${t('form.tags')}</label><input id="f-tags" type="text" value="${escapeAttr((tk.tags || []).join(', '))}" placeholder="${escapeAttr(t('form.tags.placeholder'))}"></div>
      <div class="field"><label>${t('form.recurring')}</label>
        <select id="f-recurring">
          <option value="none" ${(tk.recurring||'none')==='none'?'selected':''}>${t('recurring.none')}</option>
          <option value="daily" ${tk.recurring==='daily'?'selected':''}>${t('recurring.daily')}</option>
          <option value="weekly" ${tk.recurring==='weekly'?'selected':''}>${t('recurring.weekly')}</option>
          <option value="monthly" ${tk.recurring==='monthly'?'selected':''}>${t('recurring.monthly')}</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label>${t('form.subtasks')}</label>
      <div id="subtask-list">${subtasksHTML}</div>
      <button type="button" class="btn btn-outline" id="btn-add-sub" style="align-self: flex-start;">${t('form.addSubtask')}</button>
    </div>
  `, [
    { label: t('action.cancel'), class: 'btn-outline', onClick: closeModal },
    { label: isEdit ? t('action.save') : t('action.add'), class: 'btn-primary', onClick: async () => {
        const title = document.getElementById('f-title').value.trim();
        if (!title) { toast(t('msg.titleRequired')); return; }
        const description = document.getElementById('f-desc').value.trim();
        const priority = document.getElementById('f-priority').value;
        const dueDate = document.getElementById('f-due').value || null;
        const tags = document.getElementById('f-tags').value.split(/[,،]/).map(s => s.trim()).filter(Boolean);
        const recurring = document.getElementById('f-recurring').value;
        const subtasks = [...document.querySelectorAll('#subtask-list .subtask-editor')].map((row) => ({
          id: row.dataset.id,
          title: row.querySelector('input[type="text"]').value.trim(),
          done: row.querySelector('input[type="checkbox"]').checked,
        })).filter((s) => s.title);

        if (isEdit) Object.assign(task, { title, description, priority, dueDate, tags, recurring, subtasks });
        else state.data.tasks.push({
          id: uid(), title, description, priority, dueDate, tags, recurring, subtasks,
          status: 'pending', createdAt: new Date().toISOString(),
          lastGenerated: recurring !== 'none' ? todayISO() : undefined,
          order: state.data.tasks.length,
        });
        await persist(); closeModal(); renderAll();
        toast(isEdit ? t('msg.taskSaved') : t('msg.taskAdded'));
    }},
  ]);

  const list = document.getElementById('subtask-list');
  document.getElementById('btn-add-sub').addEventListener('click', () => {
    list.insertAdjacentHTML('beforeend', subtaskEditorHTML(uid(), ''));
    attachSubtaskRemovers(list);
  });
  attachSubtaskRemovers(list);

  // Workload warning when due date is on a busy day
  const wWarn = document.getElementById('task-workload-warning');
  const refreshWorkload = () => {
    const d = document.getElementById('f-due').value;
    if (!d) { wWarn.innerHTML = ''; return; }
    const count = countTasksOnDate(d, task?.id);
    if (count < 5) { wWarn.innerHTML = ''; return; }
    wWarn.innerHTML = `<div class="warning-box" style="margin-top:8px;">
      <div class="warning-box-title">${t('conflict.task.title')}</div>
      <div>${t('conflict.task.body', { n: count })}</div>
    </div>`;
  };
  document.getElementById('f-due').addEventListener('input', refreshWorkload);
  refreshWorkload();
}

function subtaskEditorHTML(id, title, done = false) {
  return `<div class="subtask-editor" data-id="${id}">
    <input type="checkbox" ${done ? 'checked' : ''}>
    <input type="text" value="${escapeAttr(title)}" placeholder="${escapeAttr(t('form.subtask.placeholder'))}">
    <button type="button" class="text-btn text-btn-danger" data-remove>${t('action.delete')}</button>
  </div>`;
}
function attachSubtaskRemovers(list) {
  list.querySelectorAll('[data-remove]').forEach((b) => { b.onclick = () => b.closest('.subtask-editor').remove(); });
}

// ============================================================
// MEETINGS + CALENDAR
// ============================================================
const calendarEl = document.getElementById('calendar');
const calTitleEl = document.getElementById('cal-title');
const dayMeetingsEl = document.getElementById('day-meetings');
const dayMeetingsEmpty = document.getElementById('day-meetings-empty');

document.getElementById('btn-cal-prev').addEventListener('click', () => {
  state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById('btn-cal-next').addEventListener('click', () => {
  state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
  renderCalendar();
});
document.getElementById('btn-add-meeting').addEventListener('click', () => openMeetingModal());

function renderCalendar() {
  const m = state.calendarMonth;
  calTitleEl.textContent = m.toLocaleDateString(I18N.locale(), { month: 'long', year: 'numeric' });
  calendarEl.innerHTML = '';

  const headers = t('cal.weekdays');
  headers.forEach((h) => {
    const d = document.createElement('div'); d.className = 'cal-head'; d.textContent = h;
    calendarEl.appendChild(d);
  });

  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const lastDay = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const startWeekday = first.getDay();

  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = new Date(m.getFullYear(), m.getMonth(), -i);
    calendarEl.appendChild(buildDayCell(d, true));
  }
  for (let i = 1; i <= lastDay; i++) {
    const d = new Date(m.getFullYear(), m.getMonth(), i);
    calendarEl.appendChild(buildDayCell(d, false));
  }
  const totalCells = startWeekday + lastDay;
  const pad = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= pad; i++) {
    const d = new Date(m.getFullYear(), m.getMonth() + 1, i);
    calendarEl.appendChild(buildDayCell(d, true));
  }
  renderDayMeetings();
}

function buildDayCell(date, otherMonth) {
  const cell = document.createElement('div');
  cell.className = 'cal-day';
  if (otherMonth) cell.classList.add('other-month');
  if (sameDay(date, new Date())) cell.classList.add('today');
  if (sameDay(date, state.selectedDate)) cell.classList.add('selected');

  const todays = state.data.meetings.filter((mt) => sameDay(mt.start, date));
  cell.innerHTML = `
    <div class="cal-num">${date.getDate()}</div>
    ${todays.slice(0, 2).map((mt) => `<div class="cal-event"><span class="cal-dot"></span>${escapeHTML(mt.title)}</div>`).join('')}
    ${todays.length > 2 ? `<div class="cal-event">${t('cal.moreEvents', { n: todays.length - 2 })}</div>` : ''}
  `;
  cell.addEventListener('click', () => { state.selectedDate = date; renderCalendar(); });
  return cell;
}

function renderDayMeetings() {
  const todays = state.data.meetings
    .filter((m) => sameDay(m.start, state.selectedDate))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  dayMeetingsEl.innerHTML = '';
  dayMeetingsEmpty.classList.toggle('hidden', todays.length > 0);
  todays.forEach((m) => dayMeetingsEl.appendChild(renderMeetingItem(m)));
}

function renderMeetingItem(m) {
  const li = document.createElement('li');
  li.className = 'meeting-item';
  const attachmentsHTML = (m.attachments || []).length
    ? `<div class="attachments">${m.attachments.map((a) => `<a href="${a.dataUrl}" download="${escapeAttr(a.name)}" class="attachment">${escapeHTML(a.name)}</a>`).join('')}</div>`
    : '';
  li.innerHTML = `
    <div style="flex:1; min-width:0;">
      <h4>${escapeHTML(m.title)}</h4>
      <div class="meeting-meta"><span class="meeting-meta-label">${t('meeting.label.time')}</span>${fmtDateTime(m.start)}${m.end ? ' — ' + fmtTime(m.end) : ''}</div>
      ${m.location ? `<div class="meeting-meta"><span class="meeting-meta-label">${t('meeting.label.location')}</span>${escapeHTML(m.location)}</div>` : ''}
      ${m.attendees ? `<div class="meeting-meta"><span class="meeting-meta-label">${t('meeting.label.attendees')}</span>${escapeHTML(m.attendees)}</div>` : ''}
      ${m.notes ? `<div class="meeting-meta" style="margin-top:8px;">${escapeHTML(m.notes)}</div>` : ''}
      ${attachmentsHTML}
    </div>
    <div class="task-actions">
      <button class="text-btn" data-action="edit">${t('action.edit')}</button>
      <button class="text-btn text-btn-danger" data-action="delete">${t('action.delete')}</button>
    </div>
  `;
  li.querySelector('[data-action="edit"]').addEventListener('click', () => openMeetingModal(m));
  li.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete('meeting', async () => {
    state.data.meetings = state.data.meetings.filter((x) => x.id !== m.id);
    await persist(); renderAll(); toast(t('msg.meetingDeleted'));
  }));
  return li;
}

function openMeetingModal(meeting) {
  const isEdit = !!meeting;
  const m = meeting || { title: '', start: new Date(state.selectedDate).toISOString().slice(0, 16), end: '', location: '', attendees: '', notes: '', attachments: [] };
  openModal(isEdit ? t('modal.meeting.edit') : t('modal.meeting.add'), `
    <div class="field"><label>${t('form.meeting.title')}</label><input id="f-title" type="text" value="${escapeAttr(m.title)}"></div>
    <div class="field-row">
      <div class="field"><label>${t('form.start')}</label><input id="f-start" type="datetime-local" value="${(m.start || '').slice(0,16)}"></div>
      <div class="field"><label>${t('form.end')}</label><input id="f-end" type="datetime-local" value="${(m.end || '').slice(0,16)}"></div>
    </div>
    <div id="meeting-conflict-warning"></div>
    <div class="field-row">
      <div class="field"><label>${t('form.location')}</label><input id="f-location" type="text" value="${escapeAttr(m.location || '')}"></div>
      <div class="field"><label>${t('form.attendees')}</label><input id="f-attendees" type="text" value="${escapeAttr(m.attendees || '')}" placeholder="${escapeAttr(t('form.attendees.placeholder'))}"></div>
    </div>
    <div class="field"><label>${t('form.notes')}</label><textarea id="f-notes">${escapeHTML(m.notes || '')}</textarea></div>
    <div class="field">
      <label>${t('form.attachments')}</label>
      <input id="f-files" type="file" multiple>
      <div id="existing-files" style="font-size:13px; color: var(--text-muted); margin-top:6px;">
        ${(m.attachments || []).map((a, i) => `<div data-idx="${i}" style="display:flex; align-items:center; gap:8px; padding: 4px 0;">${escapeHTML(a.name)} <button type="button" class="text-btn text-btn-danger" data-rm="${i}">${t('action.remove')}</button></div>`).join('')}
      </div>
    </div>
  `, [
    { label: t('action.cancel'), class: 'btn-outline', onClick: closeModal },
    { label: isEdit ? t('action.save') : t('action.add'), class: 'btn-primary', onClick: async () => {
        const title = document.getElementById('f-title').value.trim();
        const start = document.getElementById('f-start').value;
        if (!title || !start) { toast(t('msg.titleStartRequired')); return; }
        const end = document.getElementById('f-end').value || null;
        const location = document.getElementById('f-location').value.trim();
        const attendees = document.getElementById('f-attendees').value.trim();
        const notes = document.getElementById('f-notes').value.trim();
        const files = document.getElementById('f-files').files;
        const newAttachments = await Promise.all([...files].map(readFileAsDataURL));
        const keptAttachments = (m.attachments || []).filter((_, i) => !removedAttachmentIdx.has(i));
        const attachments = [...keptAttachments, ...newAttachments];

        if (isEdit) Object.assign(meeting, { title, start, end, location, attendees, notes, attachments });
        else state.data.meetings.push({ id: uid(), title, start, end, location, attendees, notes, attachments, createdAt: new Date().toISOString() });
        await persist(); closeModal(); renderAll();
        toast(isEdit ? t('msg.meetingSaved') : t('msg.meetingAdded'));
    }},
  ]);

  const removedAttachmentIdx = new Set();
  document.querySelectorAll('#existing-files [data-rm]').forEach((b) => {
    b.onclick = () => { removedAttachmentIdx.add(parseInt(b.dataset.rm, 10)); b.parentElement.remove(); };
  });

  // Live conflict detection
  const warn = document.getElementById('meeting-conflict-warning');
  const refreshConflicts = () => {
    const startV = document.getElementById('f-start').value;
    const endV = document.getElementById('f-end').value;
    const conflicts = findMeetingConflicts(startV, endV, meeting?.id);
    if (!conflicts.length) { warn.innerHTML = ''; return; }
    warn.innerHTML = `<div class="warning-box">
      <div class="warning-box-title">${t('conflict.meeting.title')}</div>
      ${conflicts.map((c) => `<div>• ${escapeHTML(c.title)} (${fmtTime(c.start)}${c.end ? ' – ' + fmtTime(c.end) : ''})</div>`).join('')}
    </div>`;
  };
  document.getElementById('f-start').addEventListener('input', refreshConflicts);
  document.getElementById('f-end').addEventListener('input', refreshConflicts);
  refreshConflicts();
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: r.result });
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ============================================================
// TEAM FOLLOW-UPS
// ============================================================
const followupListEl = document.getElementById('followup-list');
const followupEmptyEl = document.getElementById('followup-empty');
document.getElementById('btn-add-followup').addEventListener('click', () => openFollowupModal());

function renderFollowups() {
  followupListEl.innerHTML = '';
  followupEmptyEl.classList.toggle('hidden', state.data.followUps.length > 0);
  state.data.followUps.forEach((f) => followupListEl.appendChild(renderFollowupItem(f)));
}

function renderFollowupItem(f) {
  const li = document.createElement('li');
  li.className = 'followup-item';
  li.innerHTML = `
    <div style="flex:1; min-width:0;">
      <h4>${escapeHTML(f.member)} — ${escapeHTML(f.title)}</h4>
      ${f.details ? `<div class="followup-meta">${escapeHTML(f.details)}</div>` : ''}
      <div class="followup-meta" style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${f.dueDate ? `<span class="badge badge-due">${fmtDate(f.dueDate)}</span>` : ''}
        <span class="badge ${f.status==='done'?'badge-low':'badge-medium'}">${f.status==='done'?t('badge.done'):t('badge.inProgress')}</span>
      </div>
    </div>
    <div class="task-actions">
      <button class="text-btn" data-action="toggle">${f.status==='done'?t('action.toggle.reopen'):t('action.toggle.done')}</button>
      <button class="text-btn" data-action="edit">${t('action.edit')}</button>
      <button class="text-btn text-btn-danger" data-action="delete">${t('action.delete')}</button>
    </div>
  `;
  li.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
    f.status = f.status === 'done' ? 'pending' : 'done'; await persist(); renderAll();
  });
  li.querySelector('[data-action="edit"]').addEventListener('click', () => openFollowupModal(f));
  li.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete('followup', async () => {
    state.data.followUps = state.data.followUps.filter((x) => x.id !== f.id);
    await persist(); renderAll(); toast(t('msg.deleted'));
  }));
  return li;
}

function openFollowupModal(f) {
  const isEdit = !!f;
  const obj = f || { member: '', title: '', details: '', dueDate: todayISO(), status: 'pending' };
  openModal(isEdit ? t('modal.followup.edit') : t('modal.followup.add'), `
    <div class="field"><label>${t('form.member')}</label><input id="f-member" type="text" value="${escapeAttr(obj.member)}" placeholder="${escapeAttr(t('form.member.placeholder'))}"></div>
    <div class="field"><label>${t('form.followup.title')}</label><input id="f-title" type="text" value="${escapeAttr(obj.title)}"></div>
    <div class="field"><label>${t('form.details')}</label><textarea id="f-details">${escapeHTML(obj.details || '')}</textarea></div>
    <div class="field"><label>${t('form.dueDate')}</label><input id="f-due" type="date" value="${obj.dueDate || ''}"></div>
  `, [
    { label: t('action.cancel'), class: 'btn-outline', onClick: closeModal },
    { label: isEdit ? t('action.save') : t('action.add'), class: 'btn-primary', onClick: async () => {
        const member = document.getElementById('f-member').value.trim();
        const title = document.getElementById('f-title').value.trim();
        if (!member || !title) { toast(t('msg.nameTitleRequired')); return; }
        const details = document.getElementById('f-details').value.trim();
        const dueDate = document.getElementById('f-due').value || null;
        if (isEdit) Object.assign(f, { member, title, details, dueDate });
        else state.data.followUps.push({ id: uid(), member, title, details, dueDate, status: 'pending', createdAt: new Date().toISOString() });
        await persist(); closeModal(); renderAll();
        toast(isEdit ? t('msg.saved') : t('msg.added'));
    }},
  ]);
}

// ============================================================
// NOTES
// ============================================================
const noteListEl = document.getElementById('note-list');
const noteEmptyEl = document.getElementById('note-empty');
const recordStatusEl = document.getElementById('record-status');

document.getElementById('btn-add-note').addEventListener('click', () => openNoteModal());
document.getElementById('btn-record').addEventListener('click', toggleRecording);

function renderNotes() {
  noteListEl.innerHTML = '';
  noteEmptyEl.classList.toggle('hidden', state.data.notes.length > 0);
  [...state.data.notes].reverse().forEach((n) => noteListEl.appendChild(renderNoteItem(n)));
}

function renderNoteItem(n) {
  const li = document.createElement('li');
  li.className = 'note-item';
  const audioHTML = n.audio ? `<audio class="audio-player" controls src="${n.audio}"></audio>` : '';
  li.innerHTML = `
    <div style="flex:1; min-width:0;">
      <h4>${escapeHTML(n.title || t('notes.default'))}</h4>
      ${n.body ? `<div class="note-body">${renderMarkdown(n.body)}</div>` : ''}
      ${audioHTML}
      <div class="note-meta" style="margin-top:10px; color: var(--text-muted); font-size: 12px;">${fmtDateTime(n.createdAt)}</div>
    </div>
    <div class="task-actions">
      ${!n.audio ? `<button class="text-btn" data-action="edit">${t('action.edit')}</button>` : ''}
      <button class="text-btn text-btn-danger" data-action="delete">${t('action.delete')}</button>
    </div>
  `;
  // Wiki-link click → open or create that note
  li.querySelectorAll('a.wikilink').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      const title = decodeURIComponent(href.replace(/^#wiki:/, ''));
      openWikiNote(title);
    });
  });
  const editBtn = li.querySelector('[data-action="edit"]');
  if (editBtn) editBtn.addEventListener('click', () => openNoteModal(n));
  li.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete('note', async () => {
    state.data.notes = state.data.notes.filter((x) => x.id !== n.id);
    await persist(); renderAll(); toast(t('msg.deleted'));
  }));
  return li;
}

function openNoteModal(n) {
  const isEdit = !!n;
  const obj = n || { title: '', body: '' };
  openModal(isEdit ? t('modal.note.edit') : t('modal.note.add'), `
    <div class="field"><label>${t('form.title')}</label><input id="f-title" type="text" value="${escapeAttr(obj.title || '')}"></div>
    <div class="field">
      <label>${t('form.body')}</label>
      <textarea id="f-body" style="min-height:180px; font-family: 'Menlo','Consolas',monospace; font-size: 13px;">${escapeHTML(obj.body || '')}</textarea>
      <div class="field-hint">${t('form.body.hint')}</div>
    </div>
  `, [
    { label: t('action.cancel'), class: 'btn-outline', onClick: closeModal },
    { label: isEdit ? t('action.save') : t('action.add'), class: 'btn-primary', onClick: async () => {
        const title = document.getElementById('f-title').value.trim();
        const body = document.getElementById('f-body').value.trim();
        if (!title && !body) { toast(t('msg.titleOrBody')); return; }
        if (isEdit) Object.assign(n, { title, body });
        else state.data.notes.push({ id: uid(), title, body, createdAt: new Date().toISOString() });
        await persist(); closeModal(); renderAll();
        toast(isEdit ? t('msg.saved') : t('msg.added'));
    }},
  ]);
}

async function toggleRecording() {
  const btn = document.getElementById('btn-record');
  if (state.recording) { state.recording.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const dataUrl = await blobToDataURL(blob);
      state.data.notes.push({ id: uid(), title: t('notes.voice'), body: '', audio: dataUrl, createdAt: new Date().toISOString() });
      await persist();
      state.recording = null;
      recordStatusEl.classList.add('hidden');
      btn.textContent = t('notes.record');
      renderAll();
      toast(t('msg.voiceSaved'));
    };
    recorder.start();
    state.recording = recorder;
    recordStatusEl.classList.remove('hidden');
    recordStatusEl.innerHTML = `<span class="record-dot"></span>${t('notes.recording')}`;
    btn.textContent = t('notes.stop');
  } catch (err) {
    toast(t('msg.micFailed'));
    console.error(err);
  }
}
function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

// ============================================================
// SEARCH
// ============================================================
const searchEl = document.getElementById('global-search');
const searchResultsEl = document.getElementById('search-results');
searchEl.addEventListener('input', debounce((e) => {
  state.searchQuery = e.target.value.trim().toLowerCase();
  renderSearch();
}, 150));

function renderSearch() {
  const q = state.searchQuery;
  if (!q) {
    searchResultsEl.classList.add('hidden');
    document.getElementById('panel-' + state.activeTab).classList.remove('hidden');
    return;
  }
  ['tasks','meetings','team','notes','stats'].forEach((n) => document.getElementById('panel-' + n).classList.add('hidden'));
  searchResultsEl.classList.remove('hidden');

  const tHits = state.data.tasks.filter((tk) => [tk.title, tk.description, ...(tk.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(q));
  const mHits = state.data.meetings.filter((m) => [m.title, m.location, m.attendees, m.notes].filter(Boolean).join(' ').toLowerCase().includes(q));
  const fHits = state.data.followUps.filter((f) => [f.member, f.title, f.details].filter(Boolean).join(' ').toLowerCase().includes(q));
  const nHits = state.data.notes.filter((n) => [n.title, n.body].filter(Boolean).join(' ').toLowerCase().includes(q));

  searchResultsEl.innerHTML = `
    <h2 style="margin-top:0;">${t('search.resultsTitle', { q: escapeHTML(q) })}</h2>
    ${renderSearchSection(t('search.section.tasks'), tHits, (tk) => `${highlight(tk.title, q)} <span style="color:var(--text-muted);font-size:12px;">${tk.dueDate ? fmtDate(tk.dueDate) : ''}</span>`)}
    ${renderSearchSection(t('search.section.meetings'), mHits, (m) => `${highlight(m.title, q)} <span style="color:var(--text-muted);font-size:12px;">${fmtDateTime(m.start)}</span>`)}
    ${renderSearchSection(t('search.section.followups'), fHits, (f) => `${highlight(f.member + ' — ' + f.title, q)}`)}
    ${renderSearchSection(t('search.section.notes'), nHits, (n) => `${highlight(n.title || t('notes.default'), q)}`)}
    ${tHits.length + mHits.length + fHits.length + nHits.length === 0 ? `<div class="empty">${t('search.noResults')}</div>` : ''}
  `;
}

function renderSearchSection(title, hits, fmt) {
  if (!hits.length) return '';
  return `<div class="search-section">
    <h3>${title} (${hits.length})</h3>
    ${hits.map((h) => `<div class="search-result">${fmt(h)}</div>`).join('')}
  </div>`;
}

function highlight(text, q) {
  if (!text) return '';
  const safe = escapeHTML(text);
  const re = new RegExp(`(${escapeRegex(q)})`, 'gi');
  return safe.replace(re, '<strong>$1</strong>');
}

// ============================================================
// EXPORT
// ============================================================
document.getElementById('btn-export').addEventListener('click', () => {
  openModal(t('modal.export.title'), `
    <p>${t('modal.export.body')}</p>
    <div class="field"><label><input type="radio" name="fmt" value="json" checked> ${t('modal.export.json')}</label></div>
    <div class="field"><label><input type="radio" name="fmt" value="csv"> ${t('modal.export.csv')}</label></div>
  `, [
    { label: t('action.cancel'), class: 'btn-outline', onClick: closeModal },
    { label: t('action.export'), class: 'btn-primary', onClick: async () => {
        const fmt = document.querySelector('input[name="fmt"]:checked').value;
        closeModal();
        if (fmt === 'json') {
          const r = await storage.export(state.data);
          if (r.ok) toast(t('msg.exported') + (r.path ? ': ' + r.path : ''));
        } else {
          exportCSV();
        }
    }},
  ]);
});

function exportCSV() {
  const sections = [
    { name: 'Tasks', headers: ['Title','Description','Priority','Status','DueDate','Tags','Recurring'], rows: state.data.tasks.map((tk) => [tk.title, tk.description, tk.priority, tk.status, tk.dueDate, (tk.tags||[]).join('|'), tk.recurring]) },
    { name: 'Meetings', headers: ['Title','Start','End','Location','Attendees','Notes'], rows: state.data.meetings.map((m) => [m.title, m.start, m.end, m.location, m.attendees, m.notes]) },
    { name: 'FollowUps', headers: ['Member','Title','Details','DueDate','Status'], rows: state.data.followUps.map((f) => [f.member, f.title, f.details, f.dueDate, f.status]) },
    { name: 'Notes', headers: ['Title','Body','CreatedAt','HasAudio'], rows: state.data.notes.map((n) => [n.title, n.body, n.createdAt, n.audio ? 'yes' : 'no']) },
  ];
  let csv = '';
  for (const s of sections) {
    csv += `\n# ${s.name}\n`;
    csv += s.headers.join(',') + '\n';
    for (const row of s.rows) csv += row.map(csvEscape).join(',') + '\n';
  }
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `scheduler-${todayISO()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast(t('msg.exportedCsv'));
}
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return /[,"\n]/.test(s) ? `"${s}"` : s;
}

// ============================================================
// NOTIFICATIONS
// ============================================================
const NOTIFIED_KEY = 'scheduler-notified-ids';
let notifiedIds = new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]'));

function checkNotifications() {
  const now = new Date();
  const today = todayISO();
  for (const tk of state.data.tasks) {
    if (tk.status !== 'done' && tk.dueDate === today && !notifiedIds.has('task-' + tk.id)) {
      storage.notify(t('notif.taskDue'), tk.title);
      notifiedIds.add('task-' + tk.id);
    }
  }
  for (const m of state.data.meetings) {
    const start = new Date(m.start);
    const diffMin = (start - now) / 60000;
    if (diffMin > 0 && diffMin <= 15 && !notifiedIds.has('mtg-' + m.id)) {
      storage.notify(t('notif.meetingSoon'), `${m.title} - ${fmtDateTime(m.start)}`);
      notifiedIds.add('mtg-' + m.id);
    }
  }
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notifiedIds]));
}

// ============================================================
// STATISTICS
// ============================================================
let chartStatus, chartPriority, chartWeekly;
function renderStats() {
  if (typeof Chart === 'undefined') return;
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  Chart.defaults.color = theme === 'dark' ? '#b8b0bf' : '#5d544a';
  Chart.defaults.borderColor = theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  Chart.defaults.font.family = I18N.getLang() === 'ar' ? "'IBM Plex Sans Arabic', sans-serif" : "'IBM Plex Sans', sans-serif";
  const tasks = state.data.tasks;
  const done = tasks.filter((tk) => tk.status === 'done').length;
  const pending = tasks.length - done;
  drawDoughnut('chart-status', [t('stats.done'), t('stats.pending')], [done, pending], ['#6b8472', '#b88243']);
  const counts = { high: 0, medium: 0, low: 0 };
  tasks.forEach((tk) => { counts[tk.priority] = (counts[tk.priority] || 0) + 1; });
  drawBar('chart-priority', [t('stats.priority.high'), t('stats.priority.medium'), t('stats.priority.low')], [counts.high, counts.medium, counts.low], ['#a8534a', '#b88243', '#6b8472']);
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
  const labels = days.map((d) => d.toLocaleDateString(I18N.locale(), { weekday: 'short', day: 'numeric' }));
  const values = days.map((d) => tasks.filter((tk) => tk.status === 'done' && tk.dueDate && sameDay(tk.dueDate, d)).length);
  drawLine('chart-weekly', labels, values);
}
function drawDoughnut(id, labels, data, colors) {
  const ctx = document.getElementById(id);
  if (chartStatus && id === 'chart-status') chartStatus.destroy();
  const c = new Chart(ctx, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: colors }] }, options: { plugins: { legend: { position: 'bottom' } }, maintainAspectRatio: false } });
  if (id === 'chart-status') chartStatus = c;
}
function drawBar(id, labels, data, colors) {
  const ctx = document.getElementById(id);
  if (chartPriority && id === 'chart-priority') chartPriority.destroy();
  const c = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ data, backgroundColor: colors }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }, maintainAspectRatio: false } });
  if (id === 'chart-priority') chartPriority = c;
}
function drawLine(id, labels, data) {
  const ctx = document.getElementById(id);
  if (chartWeekly) chartWeekly.destroy();
  chartWeekly = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ label: t('stats.weeklyLabel'), data, borderColor: '#cc785c', backgroundColor: 'rgba(204,120,92,0.12)', fill: true, tension: 0.3, pointBackgroundColor: '#cc785c', pointRadius: 4 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }, maintainAspectRatio: false } });
}

// ============================================================
// PRINT BRIEFING
// ============================================================
document.getElementById('btn-print').addEventListener('click', () => {
  const today = todayISO();
  const todayTasks = state.data.tasks.filter((tk) => tk.dueDate === today);
  const todayMeetings = state.data.meetings.filter((m) => sameDay(m.start, new Date()));
  const openFollowups = state.data.followUps.filter((f) => f.status !== 'done');
  let briefing = document.getElementById('print-briefing');
  if (!briefing) { briefing = document.createElement('div'); briefing.id = 'print-briefing'; document.body.appendChild(briefing); }
  briefing.innerHTML = `
    <h1>${t('print.title', { date: fmtDate(new Date()) })}</h1>
    <div class="print-section">
      <h2>${t('print.tasks')} (${todayTasks.length})</h2>
      ${todayTasks.length ? todayTasks.map((tk) => `<div>• ${escapeHTML(tk.title)} [${t('stats.priority.' + tk.priority)}] — ${tk.status === 'done' ? t('badge.done') : t('badge.inProgress')}</div>`).join('') : `<p>${t('print.none')}</p>`}
    </div>
    <div class="print-section">
      <h2>${t('print.meetings')} (${todayMeetings.length})</h2>
      ${todayMeetings.length ? todayMeetings.map((m) => `<div>• ${fmtDateTime(m.start)} — ${escapeHTML(m.title)}${m.location ? ' @ ' + escapeHTML(m.location) : ''}</div>`).join('') : `<p>${t('print.none')}</p>`}
    </div>
    <div class="print-section">
      <h2>${t('print.followups')} (${openFollowups.length})</h2>
      ${openFollowups.length ? openFollowups.map((f) => `<div>• ${escapeHTML(f.member)}: ${escapeHTML(f.title)}${f.dueDate ? ' (' + fmtDate(f.dueDate) + ')' : ''}</div>`).join('') : `<p>${t('print.none')}</p>`}
    </div>
  `;
  window.print();
});

// ============================================================
// HELPERS
// ============================================================
function confirmDelete(labelKey, onConfirm) {
  const label = t('label.delete.' + labelKey);
  openModal(t('modal.delete.title'), `<p>${t('modal.delete.body', { label })}</p>`, [
    { label: t('action.cancel'), class: 'btn-outline', onClick: closeModal },
    { label: t('action.delete'), class: 'btn-danger', onClick: () => { closeModal(); onConfirm(); } },
  ]);
}
function escapeHTML(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function escapeAttr(s) { return escapeHTML(s); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Markdown + [[wiki-link]] rendering. Wiki-links resolve to existing notes
// (case-insensitive title match); clicking an unresolved link offers to create.
function renderMarkdown(text) {
  if (!text) return '';
  if (typeof marked === 'undefined') return escapeHTML(text);
  // Pre-process: turn [[Note Title]] into a wiki-link tag the renderer will style.
  const withWikiLinks = String(text).replace(/\[\[([^\]\n]+)\]\]/g, (_, title) => {
    const trimmed = title.trim();
    const note = findNoteByTitle(trimmed);
    const cls = note ? 'wikilink' : 'wikilink wikilink-missing';
    return `[${trimmed}](#wiki:${encodeURIComponent(trimmed)} "${cls}")`;
  });
  const html = marked.parse(withWikiLinks, { breaks: true, gfm: true, mangle: false, headerIds: false });
  // Promote our marker into a real class= attribute and strip any <script>.
  return html
    .replace(/<a (href="#wiki:[^"]+") title="(wikilink[^"]*)"/g, '<a $1 class="$2"')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
}

// ---------- Conflict detection ----------
const DEFAULT_MEETING_MIN = 30;
function findMeetingConflicts(startStr, endStr, excludeId) {
  if (!startStr) return [];
  const ns = new Date(startStr).getTime();
  const ne = endStr ? new Date(endStr).getTime() : ns + DEFAULT_MEETING_MIN * 60_000;
  return state.data.meetings.filter((m) => {
    if (m.id === excludeId) return false;
    const s = new Date(m.start).getTime();
    const e = m.end ? new Date(m.end).getTime() : s + DEFAULT_MEETING_MIN * 60_000;
    return ns < e && ne > s;
  });
}
function countTasksOnDate(dateStr, excludeId) {
  return state.data.tasks.filter((t) => t.dueDate === dateStr && t.id !== excludeId && t.status !== 'done').length;
}

function findNoteByTitle(title) {
  const norm = (s) => (s || '').trim().toLowerCase();
  const target = norm(title);
  return state.data.notes.find((n) => norm(n.title) === target);
}

function openWikiNote(title) {
  switchTab('notes');
  let note = findNoteByTitle(title);
  if (!note) {
    // Offer to create
    openModal(t('modal.note.add'), `
      <p>${escapeHTML(title)} — ${I18N.getLang() === 'ar' ? 'لا توجد ملاحظة بهذا العنوان. هل تريد إنشاؤها؟' : "doesn't exist. Create it?"}</p>
    `, [
      { label: t('action.cancel'), class: 'btn-outline', onClick: closeModal },
      { label: t('action.add'), class: 'btn-primary', onClick: async () => {
          const newNote = { id: uid(), title, body: '', createdAt: new Date().toISOString() };
          state.data.notes.push(newNote);
          await persist();
          closeModal();
          renderAll();
          openNoteModal(newNote);
      }},
    ]);
    return;
  }
  openNoteModal(note);
}

// ============================================================
// AUTO-UPDATE UI (driven by main process)
// ============================================================
const updateBanner = document.getElementById('update-banner');
const updateText = document.getElementById('update-text');
const updateBtn = document.getElementById('btn-update-action');
let updateState = 'idle';

if (window.api?.onUpdate) {
  window.api.onUpdate((evt) => {
    if (evt.type === 'available') {
      updateState = 'available';
      updateText.textContent = (I18N.getLang() === 'ar'
        ? `يتوفر تحديث ${evt.version}. جارٍ التنزيل...`
        : `Update ${evt.version} available. Downloading…`);
      updateBtn.textContent = '';
      updateBtn.classList.add('hidden');
      updateBanner.classList.remove('hidden');
    } else if (evt.type === 'progress') {
      const pct = Math.round(evt.percent || 0);
      updateText.textContent = (I18N.getLang() === 'ar'
        ? `جارٍ تنزيل التحديث: ${pct}%`
        : `Downloading update: ${pct}%`);
      updateBanner.classList.remove('hidden');
    } else if (evt.type === 'downloaded') {
      updateState = 'downloaded';
      updateText.textContent = (I18N.getLang() === 'ar'
        ? `التحديث ${evt.version} جاهز للتثبيت.`
        : `Update ${evt.version} is ready to install.`);
      updateBtn.textContent = (I18N.getLang() === 'ar' ? 'إعادة التشغيل والتثبيت' : 'Restart & install');
      updateBtn.classList.remove('hidden');
      updateBanner.classList.remove('hidden');
    } else if (evt.type === 'error') {
      updateBanner.classList.add('hidden');
    }
  });
  updateBtn.addEventListener('click', () => {
    if (updateState === 'downloaded') window.api.installUpdate();
  });
}

// ============================================================
// BOOT
// ============================================================
function renderAll() {
  updateCounters();
  renderTasks();
  if (state.activeTab === 'meetings') renderCalendar();
  renderFollowups();
  renderNotes();
  if (state.activeTab === 'stats') renderStats();
}

(async () => {
  const loaded = await storage.load();
  state.data = Object.assign({ tasks: [], meetings: [], teamMembers: [], followUps: [], notes: [] }, loaded);
  state.data.tasks.forEach((tk, i) => { if (tk.order == null) tk.order = i; });
  expandRecurringTasks();
  booted = true;
  renderAll();
  checkNotifications();
  setInterval(checkNotifications, 60_000);
})();
