(() => {
  'use strict';
  const STORAGE_KEY = 'naMinhaMao.tasks.v1';
  const TIMER_KEY = 'naMinhaMao.timer.v1';
  const SESSION_KEY = 'naMinhaMao.supabase.session.v1';
  const SYNC_KEY = 'naMinhaMao.supabase.sync.v1';
  const CLOUD = window.NMM_SUPABASE || {};
  const CLOUD_READY = Boolean(CLOUD.url && CLOUD.publishableKey);
  const $ = (id) => document.getElementById(id);
  let tasks = load(STORAGE_KEY, []);
  let timer = load(TIMER_KEY, null);
  let session = consumeAuthCallback() || load(SESSION_KEY, null);
  let syncEnabled = localStorage.getItem(SYNC_KEY) === 'true';
  let releaseTarget = null;
  let detailTaskId = null;
  let currentView = localStorage.getItem('naMinhaMao.view') === 'kanban' ? 'kanban' : 'list';
  const storedPage = localStorage.getItem('naMinhaMao.page');
  let currentPage = ['home','tasks','settings'].includes(storedPage) ? storedPage : 'home';
  let toastTimeout;
  let syncTimeout;
  let syncInFlight = false;
  let syncQueued = false;
  let authBusy = false;
  let authMessageText = '';
  let syncStatusText = '';
  const remoteTaskIds = new Set();
  const remoteCommentIds = new Set();
  const remoteLinkIds = new Set();

  function load(key, fallback) {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
    catch { return fallback; }
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function consumeAuthCallback() {
    const hash = location.hash.startsWith('#') ? new URLSearchParams(location.hash.slice(1)) : null;
    const accessToken = hash?.get('access_token');
    const refreshToken = hash?.get('refresh_token');
    if (!accessToken || !refreshToken) return null;
    const expiresIn = Number(hash.get('expires_in')) || 3600;
    const found = { access_token:accessToken, refresh_token:refreshToken, expires_at:Date.now() + expiresIn * 1000 };
    localStorage.setItem(SESSION_KEY, JSON.stringify(found));
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return found;
  }
  function save(schedule = true) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
    if (schedule) scheduleCloudSync();
  }
  function id() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function dateAtNoon(key) {
    if (!key) return null;
    const [y,m,d] = key.split('-').map(Number);
    return new Date(y, m-1, d, 12, 0, 0);
  }
  function daysSince(key) {
    if (!key) return 0;
    const [y,m,d] = key.split('-').map(Number);
    const [ty,tm,td] = todayKey().split('-').map(Number);
    return Math.max(0, Math.floor((Date.UTC(ty,tm-1,td)-Date.UTC(y,m-1,d))/86400000));
  }
  function formatDate(key) {
    const d = dateAtNoon(key);
    return d ? d.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' }) : '';
  }
  function formatMinutes(minutes) {
    const n = Number(minutes) || 0;
    const h = Math.floor(n/60), m = n%60;
    if (h && m) return `${h} h ${m} min`;
    if (h) return `${h} h`;
    return `${m} min`;
  }
  function elapsedSeconds(task) {
    let elapsed = Number(task.timeSpentSeconds) || 0;
    if (timer?.taskId === task.id && timer.startedAt) elapsed += Math.max(0, Math.floor((Date.now()-timer.startedAt)/1000));
    return elapsed;
  }
  function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }
  function remainingLabel(task) {
    const remaining = (Number(task.estimateMinutes)||0)*60 - elapsedSeconds(task);
    return remaining >= 0 ? `Foco ${clock(remaining)}` : `+${clock(Math.abs(remaining))} além da estimativa`;
  }
  function dueStatus(task) {
    if (!task.dueDate) return '';
    if (task.dueDate < todayKey()) return 'late';
    return '';
  }
  function showToast(message) {
    const node = $('toast');
    node.textContent = message;
    node.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => node.classList.add('hidden'), 4200);
  }
  function setAuthMessage(message, isError = false) {
    authMessageText = message;
    const node = $('authMessage');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error-text', isError);
  }
  function updateAuthUI() {
    if (!CLOUD_READY) {
      $('authStatus').textContent = 'Sincronização indisponível';
      $('authFields').classList.remove('hidden');
      $('loginBtn').disabled = true;
      $('signupBtn').disabled = true;
      $('logoutBtn').classList.add('hidden');
      setAuthMessage('A configuração segura do banco ainda não está disponível.');
      return;
    }
    const connected = Boolean(session?.user?.id && syncEnabled);
    $('authStatus').textContent = connected ? (syncStatusText || `Sincronizado como ${session.user.email || 'sua conta'}`) : 'Modo local';
    $('authFields').classList.toggle('hidden', connected);
    $('loginBtn').classList.toggle('hidden', connected);
    $('signupBtn').classList.toggle('hidden', connected);
    $('logoutBtn').classList.toggle('hidden', !connected);
    $('syncNowBtn').classList.toggle('hidden', !connected);
    $('loginBtn').disabled = authBusy;
    $('signupBtn').disabled = authBusy;
    $('syncNowBtn').disabled = authBusy;
    if (!authMessageText && !authBusy) setAuthMessage(connected ? 'Seus dados sincronizam entre aparelhos e ficam privados na sua conta.' : 'Entre ou crie sua conta para sincronizar. Os dados atuais continuam salvos neste navegador.');
  }
  function setAuthBusy(busy, message = '') {
    authBusy = busy;
    if (message) setAuthMessage(message);
    updateAuthUI();
  }
  function setFormMode() {
    const ready = document.querySelector('input[name="ready"]:checked')?.value === 'yes';
    $('dueField').classList.toggle('hidden', !ready);
    $('rewardField').classList.toggle('hidden', !ready);
    $('blockerField').classList.toggle('hidden', ready);
  }
  function openNewForm() {
    $('taskForm').reset();
    $('taskId').value = '';
    $('details').value = '';
    $('estimate').value = 60;
    document.querySelector('input[name="ready"][value="yes"]').checked = true;
    document.querySelectorAll('input[name="ready"]').forEach(input => input.disabled = false);
    $('formTitle').textContent = 'Nova tarefa';
    $('formPanel').classList.remove('hidden');
    setFormMode();
    $('title').focus();
    $('formPanel').scrollIntoView({ behavior:'smooth', block:'start' });
  }
  function openEditForm(taskId) {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    $('taskForm').reset();
    $('taskId').value = task.id;
    $('title').value = task.title;
    $('details').value = task.details || '';
    $('estimate').value = task.estimateMinutes || 60;
    $('dueDate').value = task.dueDate || '';
    $('reward').value = task.reward || '';
    $('blocker').value = task.blocker || '';
    document.querySelector(`input[name="ready"][value="${task.status === 'waiting' ? 'no' : 'yes'}"]`).checked = true;
    document.querySelectorAll('input[name="ready"]').forEach(input => input.disabled = task.status !== 'waiting');
    $('formTitle').textContent = 'Editar tarefa';
    $('formPanel').classList.remove('hidden');
    setFormMode();
    $('title').focus();
    $('formPanel').scrollIntoView({ behavior:'smooth', block:'start' });
  }
  function closeForm() { $('formPanel').classList.add('hidden'); }
  function renderTask(task, completed = false) {
    const age = daysSince(task.releaseDate);
    const ageText = age === 0 ? 'Liberada hoje' : `Há ${age} ${age === 1 ? 'dia' : 'dias'} liberada`;
    const due = task.dueDate ? `Entrega: ${escapeHTML(formatDate(task.dueDate))}` : 'Sem data de entrega';
    const dueClass = dueStatus(task) ? 'late' : 'age';
    const blocker = task.blocker ? `<div class="task-details"><span>Falta: ${escapeHTML(task.blocker)}</span></div>` : '';
    const description = task.details ? `<div class="task-description">${escapeHTML(task.details)}</div>` : '';
    const reward = task.reward ? `<div class="task-details reward"><span>🎁 ${escapeHTML(task.reward)}</span></div>` : '';
    const commentCount = (task.comments || []).length;
    const linkCount = (task.links || []).length;
    const detailsButton = `<button class="btn small" data-action="details" data-id="${escapeHTML(task.id)}" type="button" aria-label="Detalhes: ${commentCount} pedidos e ${linkCount} links">Detalhes</button>`;
    const progress = task.estimateMinutes ? `${formatMinutes(task.estimateMinutes)} estimados · ${formatMinutes(Math.floor(elapsedSeconds(task)/60))} registrados` : '';
    const timerButton = completed || task.status !== 'active' ? '' : `<button class="btn small ${timer?.taskId === task.id && timer.startedAt ? 'warn' : 'good'}" data-action="timer" data-id="${escapeHTML(task.id)}" type="button">${timer?.taskId === task.id && timer.startedAt ? 'Pausar foco' : 'Começar foco'}</button>`;
    const completeButton = completed
      ? `<button class="btn small" data-action="reopen" data-id="${escapeHTML(task.id)}" type="button">Reabrir</button>`
      : `<button class="btn small primary" data-action="complete" data-id="${escapeHTML(task.id)}" type="button">Concluir</button>`;
    const deleteButton = `<button class="btn small ghost" data-action="delete" data-id="${escapeHTML(task.id)}" type="button">Excluir</button>`;
    const releaseButton = !completed && task.status === 'waiting' ? `<button class="btn small primary" data-action="release" data-id="${escapeHTML(task.id)}" type="button">Já está liberada</button>` : '';
    const editButton = !completed ? `<button class="btn small" data-action="edit" data-id="${escapeHTML(task.id)}" type="button">Editar</button>` : '';
    const activeMeta = task.status === 'active'
      ? `<span class="pill ${dueClass}">${escapeHTML(ageText)}</span><span class="pill ${dueStatus(task) ? 'late' : ''}">${due}</span>`
      : task.status === 'client_review'
        ? `<span class="pill review">Com o cliente · aguardando aprovação</span><span class="pill ${dueStatus(task) ? 'late' : ''}">${due}</span>`
        : `<span class="pill wait">Aguardando liberação</span>`;
    return `<article class="task" data-task="${escapeHTML(task.id)}" tabindex="-1">
      <div class="task-top"><div><div class="task-title">${escapeHTML(task.title)}</div><div class="task-meta">${activeMeta}</div></div>${task.status === 'active' && !completed ? `<span class="pill timer-readout" data-id="${escapeHTML(task.id)}">${escapeHTML(remainingLabel(task))}</span>` : ''}</div>
      ${blocker}
      ${description}
      <div class="task-details"><span>⏱ ${escapeHTML(progress)}</span>${task.status !== 'waiting' ? `<span>📅 Liberada: ${escapeHTML(formatDate(task.releaseDate))}</span>` : ''}</div>
      ${reward}
      ${completed && task.completedAt ? `<div class="task-details"><span>Concluída em ${escapeHTML(formatDate(task.completedDate || task.completedAt.slice(0,10)))}</span></div>` : ''}
      <div class="task-actions">${releaseButton}${timerButton}${editButton}${detailsButton}${completeButton}${deleteButton}</div>
    </article>`;
  }
  function render() {
    const active = tasks.filter(t => t.status === 'active' && !t.completedAt).sort((a,b) => {
      const ageDiff = daysSince(b.releaseDate)-daysSince(a.releaseDate);
      if (ageDiff) return ageDiff;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
    const review = tasks.filter(t => t.status === 'client_review' && !t.completedAt).sort((a,b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    const waiting = tasks.filter(t => t.status === 'waiting' && !t.completedAt).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
    const done = tasks.filter(t => Boolean(t.completedAt)).sort((a,b) => b.completedAt.localeCompare(a.completedAt));
    const total = tasks.length;
    const nextTask = active[0] || null;
    if (nextTask) {
      const meta = [
        nextTask.dueDate ? `Entrega: ${formatDate(nextTask.dueDate)}` : '',
        nextTask.estimateMinutes ? `Estimativa: ${formatMinutes(nextTask.estimateMinutes)}` : ''
      ].filter(Boolean).join(' · ');
      $('nextTaskContent').innerHTML = `<button class="next-task-card" type="button" data-open-task="${escapeHTML(nextTask.id)}" aria-label="Abrir tarefa: ${escapeHTML(nextTask.title)}"><span class="next-task-copy"><span class="next-task-kicker">PRÓXIMA TAREFA</span><strong class="next-task-title">${escapeHTML(nextTask.title)}</strong><span class="next-task-meta">${escapeHTML(meta)}</span></span><span class="next-task-cta">Abrir tarefa <span aria-hidden="true">↗</span></span></button>`;
    } else {
      $('nextTaskContent').innerHTML = '<div class="next-task-empty"><span class="next-task-kicker">PRÓXIMA TAREFA</span><p>Nenhuma tarefa liberada para começar.</p></div>';
    }
    $('activeCount').textContent = active.length;
    $('reviewCount').textContent = review.length;
    $('reviewListCount').textContent = review.length;
    $('reviewBoardCount').textContent = review.length;
    $('waitingCount').textContent = waiting.length;
    $('homeDoneCount').textContent = done.length;
    $('homeTotalText').textContent = `${total} tarefa${total === 1 ? '' : 's'}`;
    const metrics = [
      { count:active.length, bar:'homeActiveBar', progress:'homeActiveProgress', share:'homeActiveShare' },
      { count:review.length, bar:'homeReviewBar', progress:'homeReviewProgress', share:'homeReviewShare' },
      { count:waiting.length, bar:'homeWaitingBar', progress:'homeWaitingProgress', share:'homeWaitingShare' },
      { count:done.length, bar:'homeDoneBar', progress:'homeDoneProgress', share:'homeDoneShare' }
    ];
    metrics.forEach(metric => {
      const percent = total ? Math.round(metric.count / total * 100) : 0;
      $(metric.bar).style.width = `${percent}%`;
      $(metric.progress).setAttribute('aria-valuenow', String(percent));
      $(metric.share).textContent = `${percent}% do total`;
    });
    $('doneCount').textContent = done.length;
    $('activeBoardCount').textContent = active.length;
    $('waitingBoardCount').textContent = waiting.length;
    $('doneBoardCount').textContent = done.length;
    $('estimateTotal').textContent = formatMinutes(active.reduce((sum,t) => sum + (Number(t.estimateMinutes)||0), 0));
    $('activeList').innerHTML = active.length ? active.map(t => renderTask(t)).join('') : '<div class="empty">Nenhuma tarefa liberada por enquanto. Quando estiver com tudo em mãos, registre a liberação.</div>';
    $('reviewList').innerHTML = review.length ? review.map(t => renderTask(t)).join('') : '<div class="empty">Nenhuma tarefa aguardando aprovação do cliente.</div>';
    $('waitingList').innerHTML = waiting.length ? waiting.map(t => renderTask(t)).join('') : '<div class="empty">Nada aguardando liberação.</div>';
    $('doneList').innerHTML = done.length ? done.map(t => renderTask(t,true)).join('') : '<div class="empty">As tarefas concluídas aparecem aqui.</div>';
    $('activeBoard').innerHTML = active.length ? active.map(t => renderTask(t)).join('') : '<div class="empty">Nenhuma tarefa liberada.</div>';
    $('reviewBoard').innerHTML = review.length ? review.map(t => renderTask(t)).join('') : '<div class="empty">Nenhuma tarefa com o cliente.</div>';
    $('waitingBoard').innerHTML = waiting.length ? waiting.map(t => renderTask(t)).join('') : '<div class="empty">Nenhuma tarefa aguardando.</div>';
    $('doneBoardList').innerHTML = done.length ? done.map(t => renderTask(t,true)).join('') : '<div class="empty">Nenhuma tarefa concluída.</div>';
    applyViewMode();
    applyPageMode();
    updateTimerDisplays();
  }
  function applyViewMode() {
    const isBoard = currentView === 'kanban';
    $('listView').classList.toggle('hidden', isBoard);
    $('boardView').classList.toggle('hidden', !isBoard);
    $('listViewBtn').setAttribute('aria-pressed', String(!isBoard));
    $('listViewBtn').setAttribute('aria-selected', String(!isBoard));
    $('boardViewBtn').setAttribute('aria-pressed', String(isBoard));
    $('boardViewBtn').setAttribute('aria-selected', String(isBoard));
  }
  function setView(view) {
    currentView = view === 'kanban' ? 'kanban' : 'list';
    localStorage.setItem('naMinhaMao.view', currentView);
    applyViewMode();
  }
  function applyPageMode() {
    const views = { home:'homePage', tasks:'tasksPage', settings:'settingsPage' };
    Object.entries(views).forEach(([page, id]) => $(id).classList.toggle('hidden', currentPage !== page));
    document.querySelectorAll('.nav-btn[data-page]').forEach(button => {
      if (button.dataset.page === currentPage) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
  function setPage(page) {
    if (!['home','tasks','settings'].includes(page)) return;
    currentPage = page;
    localStorage.setItem('naMinhaMao.page', currentPage);
    applyPageMode();
    if (currentPage === 'tasks') applyViewMode();
  }
  function openTaskInList(taskId) {
    const task = tasks.find(item => String(item.id) === String(taskId) && !item.completedAt);
    if (!task) { showToast('Essa tarefa não está mais disponível para abrir.'); return; }
    setPage('tasks');
    setView('list');
    requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll('#listView .task[data-task]')).find(node => node.dataset.task === String(taskId));
      if (!target) return;
      target.focus({ preventScroll:true });
      target.scrollIntoView({ behavior:'smooth', block:'center' });
      target.classList.add('task-target-highlight');
      window.setTimeout(() => target.classList.remove('task-target-highlight'), 2100);
    });
  }
  function safeHttpUrl(raw) {
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch { return null; }
  }
  function formatTimestamp(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Data não disponível' : date.toLocaleString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function openDetails(taskId) {
    detailTaskId = taskId;
    renderDetails();
    $('detailsDialog').showModal();
  }
  function renderDetails() {
    const task = tasks.find(item => item.id === detailTaskId);
    if (!task) return;
    $('detailTitle').textContent = task.title;
    $('detailDescription').textContent = task.details || 'Nenhum detalhe adicional cadastrado.';
    const comments = (task.comments || []).slice().sort((a,b) => a.createdAt.localeCompare(b.createdAt));
    $('commentTimeline').innerHTML = comments.length ? comments.map(comment => `<article class="timeline-item"><div class="timeline-meta"><span>${escapeHTML(comment.source || 'Manual')}</span><span>${escapeHTML(formatTimestamp(comment.createdAt))}</span></div><div class="timeline-text">${escapeHTML(comment.text)}</div></article>`).join('') : '<div class="empty">Ainda não há pedidos ou comentários registrados.</div>';
    const links = task.links || [];
    $('linksList').innerHTML = links.length ? links.map(link => {
      const url = safeHttpUrl(link.url);
      const label = escapeHTML(link.label || link.url);
      const target = url ? `<a href="${escapeHTML(url.href)}" target="_blank" rel="noopener noreferrer">${label}</a><div class="hint">${escapeHTML(url.href)}</div>` : `<span>${label} — link inválido</span>`;
      return `<div class="link-item"><div>${target}</div><button class="btn small ghost" type="button" data-link-action="remove" data-id="${escapeHTML(link.id)}">Remover</button></div>`;
    }).join('') : '<div class="empty">Nenhum link anexado.</div>';
  }
  function onCommentSubmit(event) {
    event.preventDefault();
    const task = tasks.find(item => item.id === detailTaskId);
    const text = $('commentText').value.trim();
    if (!task || !text) return;
    task.comments ||= [];
    task.comments.push({ id:id(), text, source:$('commentSource').value, createdAt:new Date().toISOString() });
    save(); render(); renderDetails(); $('commentForm').reset();
    showToast('Pedido/comentário adicionado à timeline.');
  }
  function onLinkSubmit(event) {
    event.preventDefault();
    const task = tasks.find(item => item.id === detailTaskId);
    const url = safeHttpUrl($('linkUrl').value.trim());
    if (!task) return;
    if (!url) { showToast('Use um endereço começando com http:// ou https://.'); $('linkUrl').focus(); return; }
    task.links ||= [];
    task.links.push({ id:id(), label:$('linkLabel').value.trim() || url.hostname, url:url.href, createdAt:new Date().toISOString() });
    save(); render(); renderDetails(); $('linkForm').reset();
    showToast('Link anexado à tarefa.');
  }
  function handleLinkAction(event) {
    const button = event.target.closest('button[data-link-action="remove"]');
    if (!button) return;
    const task = tasks.find(item => item.id === detailTaskId);
    if (!task || !window.confirm('Remover este link da tarefa?')) return;
    task.links = (task.links || []).filter(link => link.id !== button.dataset.id);
    save(); render(); renderDetails(); showToast('Link removido.');
  }
  function updateTimerDisplays() {
    document.querySelectorAll('.timer-readout[data-id]').forEach(node => {
      const task = tasks.find(t => t.id === node.dataset.id);
      if (task) node.textContent = remainingLabel(task);
    });
  }
  function pauseTimer() {
    if (!timer?.taskId || !timer.startedAt) return;
    const task = tasks.find(t => t.id === timer.taskId);
    if (task) task.timeSpentSeconds = (Number(task.timeSpentSeconds)||0) + Math.max(0, Math.floor((Date.now()-timer.startedAt)/1000));
    timer = { taskId: task?.id || timer.taskId, startedAt: null };
  }
  function toggleTimer(taskId) {
    if (timer?.taskId === taskId && timer.startedAt) {
      pauseTimer();
      showToast('Foco pausado. Seu tempo foi salvo.');
    } else {
      if (timer?.startedAt) pauseTimer();
      timer = { taskId, startedAt: Date.now() };
      const task = tasks.find(t => t.id === taskId);
      showToast(`Foco iniciado: ${task?.title || 'tarefa'}`);
    }
    save(); render();
  }
  function openRelease(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    releaseTarget = taskId;
    $('releaseTaskName').textContent = task.title;
    $('releaseDue').value = '';
    $('releaseEstimate').value = task.estimateMinutes || 60;
    $('releaseReward').value = task.reward || '';
    $('releaseDialog').showModal();
  }
  function handleListAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const taskId = button.dataset.id;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    switch (button.dataset.action) {
      case 'release': openRelease(taskId); break;
      case 'edit': openEditForm(taskId); break;
      case 'details': openDetails(taskId); break;
      case 'timer': toggleTimer(taskId); break;
      case 'complete': {
        if (!window.confirm(`Concluir “${task.title}”?`)) return;
        if (timer?.taskId === taskId && timer.startedAt) pauseTimer();
        task.completedAt = new Date().toISOString();
        task.completedDate = todayKey();
        save(); render();
        showToast(task.reward ? `Concluída! Recompensa combinada: ${task.reward}` : 'Tarefa concluída. Boa — mais uma etapa feita.');
        break;
      }
      case 'reopen':
        task.completedAt = null; task.completedDate = null; save(); render(); showToast('Tarefa reaberta.'); break;
      case 'delete':
        if (!window.confirm(`Excluir “${task.title}”? Essa ação não pode ser desfeita.`)) return;
        if (timer?.taskId === taskId) timer = null;
        tasks = tasks.filter(t => t.id !== taskId); save(); render(); showToast('Tarefa excluída.'); break;
    }
  }
  function onSubmitTask(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ready = data.get('ready') === 'yes';
    const estimate = Number(data.get('estimate'));
    const title = String(data.get('title')||'').trim();
    if (!Number.isFinite(estimate) || estimate < 5) { $('estimate').focus(); return; }
    if (!title) { $('title').focus(); return; }
    const editId = String(data.get('taskId')||'');
    if (editId) {
      const task = tasks.find(item => item.id === editId);
      if (!task) return;
      const wasWaiting = task.status === 'waiting';
      task.title = title;
      task.details = String(data.get('details')||'').trim();
      task.estimateMinutes = estimate;
      if (wasWaiting && ready) {
        task.status = 'active'; task.releaseDate = todayKey();
        task.dueDate = String(data.get('dueDate')||'') || null;
        task.reward = String(data.get('reward')||'').trim(); task.blocker = '';
      } else if (wasWaiting) {
        task.blocker = String(data.get('blocker')||'').trim();
      } else {
        task.dueDate = String(data.get('dueDate')||'') || null;
        task.reward = String(data.get('reward')||'').trim();
      }
      save(); render(); closeForm(); showToast(wasWaiting && ready ? 'Liberada hoje. A contagem começa agora.' : 'Tarefa atualizada.');
      return;
    }
    const task = {
      id:id(), title, details: String(data.get('details')||'').trim(), comments: [], links: [], status: ready ? 'active' : 'waiting',
      releaseDate: ready ? todayKey() : null, dueDate: ready ? (String(data.get('dueDate')||'') || null) : null,
      estimateMinutes: estimate, reward: ready ? String(data.get('reward')||'').trim() : '',
      blocker: ready ? '' : String(data.get('blocker')||'').trim(), timeSpentSeconds: 0,
      createdAt: new Date().toISOString(), completedAt: null
    };
    tasks.push(task); save(); render(); form.reset(); $('taskId').value = ''; $('estimate').value = 60; closeForm();
    showToast(ready ? 'Tarefa liberada e registrada a partir de hoje.' : 'Tarefa guardada em “Aguardando liberação”.');
  }
  function onReleaseSubmit(event) {
    event.preventDefault();
    const task = tasks.find(t => t.id === releaseTarget);
    if (!task) return;
    const estimate = Number($('releaseEstimate').value);
    if (!Number.isFinite(estimate) || estimate < 5) { $('releaseEstimate').focus(); return; }
    task.status = 'active'; task.releaseDate = todayKey();
    task.dueDate = $('releaseDue').value || null;
    task.estimateMinutes = estimate; task.reward = $('releaseReward').value.trim(); task.blocker = '';
    releaseTarget = null; save(); $('releaseDialog').close(); render();
    showToast('Liberada hoje. A contagem de dias começa agora.');
  }
  function exportBackup() {
    const blob = new Blob([JSON.stringify({ exportedAt:new Date().toISOString(), tasks }, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `na-minha-mao-backup-${todayKey()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); showToast('Backup baixado. Guarde o arquivo em local seguro.');
  }

  function authHeaders(extra = {}) {
    return { apikey:CLOUD.publishableKey, 'Content-Type':'application/json', ...extra };
  }
  async function responseBody(response) {
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      const message = body?.msg || body?.message || body?.error_description || body?.error || `Erro HTTP ${response.status}`;
      throw new Error(String(message));
    }
    return body;
  }
  async function authRequest(path, payload, method = 'POST') {
    const response = await fetch(`${CLOUD.url}/auth/v1/${path}`, {
      method,
      headers:authHeaders(),
      body:payload ? JSON.stringify(payload) : undefined
    });
    return responseBody(response);
  }
  function storeSession(data) {
    if (!data?.access_token || !data?.refresh_token) return false;
    session = {
      access_token:data.access_token,
      refresh_token:data.refresh_token,
      expires_at:Date.now() + (Number(data.expires_in) || 3600) * 1000,
      user:data.user || session?.user || null
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return true;
  }
  async function refreshSession() {
    if (!session?.refresh_token) throw new Error('Sessão expirada. Entre novamente.');
    const data = await authRequest('token?grant_type=refresh_token', { refresh_token:session.refresh_token });
    if (!storeSession(data)) throw new Error('Não foi possível renovar a sessão. Entre novamente.');
  }
  async function ensureFreshSession() {
    if (!session?.access_token) throw new Error('Entre na sua conta para sincronizar.');
    if (!session.expires_at || Date.now() > session.expires_at - 60000) await refreshSession();
  }
  async function getCurrentUser() {
    await ensureFreshSession();
    const response = await fetch(`${CLOUD.url}/auth/v1/user`, {
      headers:authHeaders({ Authorization:`Bearer ${session.access_token}` })
    });
    return responseBody(response);
  }
  async function cloudRequest(path, options = {}, canRetry = true) {
    await ensureFreshSession();
    const headers = authHeaders({ Authorization:`Bearer ${session.access_token}`, ...(options.headers || {}) });
    const response = await fetch(`${CLOUD.url}/rest/v1/${path}`, { ...options, headers });
    if (response.status === 401 && canRetry && session?.refresh_token) {
      await refreshSession();
      return cloudRequest(path, options, false);
    }
    return responseBody(response);
  }
  function taskToRow(task) {
    return {
      id:String(task.id), owner_id:session.user.id, title:task.title, details:task.details || '', status:task.status,
      release_date:task.releaseDate || null, due_date:task.dueDate || null, estimate_minutes:Number(task.estimateMinutes) || 60,
      reward:task.reward || '', blocker:task.blocker || '', time_spent_seconds:Number(task.timeSpentSeconds) || 0,
      created_at:task.createdAt || new Date().toISOString(), completed_at:task.completedAt || null,
      completed_date:task.completedDate || null
    };
  }
  function rowToTask(row) {
    return {
      id:String(row.id), title:row.title, details:row.details || '', status:row.status,
      releaseDate:row.release_date || null, dueDate:row.due_date || null, estimateMinutes:Number(row.estimate_minutes) || 60,
      reward:row.reward || '', blocker:row.blocker || '', timeSpentSeconds:Number(row.time_spent_seconds) || 0,
      createdAt:row.created_at || new Date().toISOString(), completedAt:row.completed_at || null,
      completedDate:row.completed_date || null, comments:[], links:[]
    };
  }
  function clearAuth(keepLocal = true) {
    session = null;
    syncEnabled = false;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SYNC_KEY);
    remoteTaskIds.clear(); remoteCommentIds.clear(); remoteLinkIds.clear();
    syncStatusText = '';
    if (!keepLocal) { tasks = []; timer = null; save(false); }
    updateAuthUI();
  }
  async function loadCloudData() {
    const localTasks = clone(tasks);
    const [taskRows, commentRows, linkRows] = await Promise.all([
      cloudRequest('nmm_tasks?select=*'),
      cloudRequest('nmm_task_comments?select=id,task_id,text,source,created_at'),
      cloudRequest('nmm_task_links?select=id,task_id,label,url,created_at')
    ]);
    remoteTaskIds.clear(); taskRows.forEach(row => remoteTaskIds.add(String(row.id)));
    remoteCommentIds.clear(); commentRows.forEach(row => remoteCommentIds.add(String(row.id)));
    remoteLinkIds.clear(); linkRows.forEach(row => remoteLinkIds.add(String(row.id)));
    const remoteById = new Map(taskRows.map(row => [String(row.id), rowToTask(row)]));
    for (const row of commentRows) {
      const task = remoteById.get(String(row.task_id));
      if (task) task.comments.push({ id:String(row.id), text:row.text, source:row.source || 'Manual', createdAt:row.created_at });
    }
    for (const row of linkRows) {
      const task = remoteById.get(String(row.task_id));
      if (task) task.links.push({ id:String(row.id), label:row.label || '', url:row.url, createdAt:row.created_at });
    }
    const localOnlyTasks = localTasks.filter(task => !remoteById.has(String(task.id)));
    const remoteCommentSet = new Set(remoteCommentIds);
    const remoteLinkSet = new Set(remoteLinkIds);
    const missingLocalComments = localTasks.reduce((sum, task) => sum + (task.comments || []).filter(item => !remoteCommentSet.has(String(item.id))).length, 0);
    const missingLocalLinks = localTasks.reduce((sum, task) => sum + (task.links || []).filter(item => !remoteLinkSet.has(String(item.id))).length, 0);
    const pendingLocalData = localOnlyTasks.length + missingLocalComments + missingLocalLinks;
    if (pendingLocalData && !window.confirm(`Enviar ${pendingLocalData} item(ns) local(is) para a conta privada do Supabase? Nada será apagado do navegador.`)) {
      clearAuth(true);
      setAuthMessage('Nada foi enviado. Você continua no modo local.');
      return false;
    }
    for (const local of localTasks) {
      const remote = remoteById.get(String(local.id));
      if (!remote) {
        remoteById.set(String(local.id), local);
        continue;
      }
      const commentIds = new Set((remote.comments || []).map(item => String(item.id)));
      for (const item of local.comments || []) if (!commentIds.has(String(item.id))) remote.comments.push(item);
      const linkIds = new Set((remote.links || []).map(item => String(item.id)));
      for (const item of local.links || []) if (!linkIds.has(String(item.id))) remote.links.push(item);
    }
    tasks = Array.from(remoteById.values());
    syncEnabled = true;
    localStorage.setItem(SYNC_KEY, 'true');
    setAuthMessage('Seus dados sincronizam entre aparelhos e ficam privados na sua conta.');
    save(false); render(); updateAuthUI();
    return await syncCloud();
  }
  async function syncCloud() {
    if (!session?.user?.id || !syncEnabled) return false;
    if (syncInFlight) { syncQueued = true; return true; }
    syncInFlight = true;
    try {
      do {
        syncQueued = false;
        const currentTasks = clone(tasks);
        const localTaskIds = new Set(currentTasks.map(task => String(task.id)));
        const missingRemoteTasks = Array.from(remoteTaskIds).filter(remoteId => !localTaskIds.has(remoteId));
        for (const taskId of missingRemoteTasks) {
          await cloudRequest(`nmm_tasks?id=eq.${encodeURIComponent(taskId)}`, { method:'DELETE' });
          remoteTaskIds.delete(taskId);
        }
        if (currentTasks.length) {
          const rows = currentTasks.map(taskToRow);
          await cloudRequest('nmm_tasks?on_conflict=id', {
            method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=minimal' }, body:JSON.stringify(rows)
          });
          localTaskIds.forEach(taskId => remoteTaskIds.add(taskId));
        }
        const localComments = currentTasks.flatMap(task => (task.comments || []).map(comment => ({
          id:String(comment.id), task_id:String(task.id), owner_id:session.user.id, text:comment.text,
          source:['Manual','WhatsApp','Radar'].includes(comment.source) ? comment.source : 'Manual',
          created_at:comment.createdAt || new Date().toISOString()
        })));
        const newComments = localComments.filter(row => !remoteCommentIds.has(row.id));
        if (newComments.length) {
          await cloudRequest('nmm_task_comments', { method:'POST', body:JSON.stringify(newComments) });
          newComments.forEach(row => remoteCommentIds.add(row.id));
        }
        const localLinks = currentTasks.flatMap(task => (task.links || []).map(link => ({
          id:String(link.id), task_id:String(task.id), owner_id:session.user.id, label:link.label || '', url:link.url,
          created_at:link.createdAt || new Date().toISOString()
        })));
        const localLinkIds = new Set(localLinks.map(row => row.id));
        for (const linkId of Array.from(remoteLinkIds)) {
          if (!localLinkIds.has(linkId)) {
            await cloudRequest(`nmm_task_links?id=eq.${encodeURIComponent(linkId)}`, { method:'DELETE' });
            remoteLinkIds.delete(linkId);
          }
        }
        const newLinks = localLinks.filter(row => !remoteLinkIds.has(row.id));
        if (newLinks.length) {
          await cloudRequest('nmm_task_links', { method:'POST', body:JSON.stringify(newLinks) });
          newLinks.forEach(row => remoteLinkIds.add(row.id));
        }
        syncStatusText = `Sincronizado · ${new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}`;
        $('authStatus').textContent = syncStatusText;
      } while (syncQueued);
      return true;
    } catch (error) {
      syncStatusText = 'Sincronização pendente';
      $('authStatus').textContent = syncStatusText;
      setAuthMessage('Os dados continuam salvos neste navegador; confira a conexão e tente sincronizar de novo.', true);
      showToast('Não foi possível sincronizar agora. Seus dados locais foram mantidos.');
      console.error('Na Minha Mão cloud sync:', error);
      return false;
    } finally {
      syncInFlight = false;
      updateAuthUI();
    }
  }
  function scheduleCloudSync() {
    if (!session?.user?.id || !syncEnabled) return;
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => syncCloud(), 500);
  }
  async function finishLogin(data) {
    if (!storeSession(data)) throw new Error('A conta foi autenticada, mas a sessão não retornou. Tente entrar novamente.');
    const user = data.user || await getCurrentUser();
    session.user = user;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return await loadCloudData();
  }
  async function signUp() {
    if (!CLOUD_READY) return;
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    if (!email || password.length < 8) { setAuthMessage('Informe seu e-mail e uma senha com pelo menos 8 caracteres.', true); return; }
    setAuthBusy(true, 'Criando sua conta segura…');
    try {
      const data = await authRequest('signup', { email, password });
      if (data.access_token && data.refresh_token) await finishLogin(data);
      else setAuthMessage('Cadastro iniciado. Confirme o e-mail enviado pelo Supabase e depois entre no app.');
    } catch (error) {
      setAuthMessage(`Não consegui criar a conta: ${error.message}`, true);
    } finally { authBusy = false; updateAuthUI(); }
  }
  async function signIn() {
    if (!CLOUD_READY) return;
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    if (!email || !password) { setAuthMessage('Informe seu e-mail e senha.', true); return; }
    setAuthBusy(true, 'Entrando e carregando suas tarefas…');
    try {
      const data = await authRequest('token?grant_type=password', { email, password });
      const connected = await finishLogin(data);
      if (connected) showToast('Conta conectada e tarefas sincronizadas.');
    } catch (error) {
      setAuthMessage(`Não consegui entrar: ${error.message}`, true);
    } finally { authBusy = false; updateAuthUI(); }
  }
  async function signOut() {
    if (!session?.access_token) return;
    setAuthBusy(true, 'Desconectando…');
    try {
      await fetch(`${CLOUD.url}/auth/v1/logout`, { method:'POST', headers:authHeaders({ Authorization:`Bearer ${session.access_token}` }) });
    } catch { /* A sessão local será removida mesmo se estiver offline. */ }
    clearAuth(false); render();
    authBusy = false; updateAuthUI();
    setAuthMessage('Você saiu. As tarefas continuam na conta e serão carregadas ao entrar novamente.');
  }
  async function initializeAuth() {
    updateAuthUI();
    if (!CLOUD_READY || !session?.access_token) return;
    setAuthBusy(true, 'Verificando sua sessão…');
    try {
      await ensureFreshSession();
      session.user = await getCurrentUser();
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      await loadCloudData();
    } catch (error) {
      clearAuth(true);
      setAuthMessage('Sua sessão expirou ou não pôde ser validada. Entre novamente para sincronizar.', true);
    } finally { authBusy = false; updateAuthUI(); }
  }
  async function syncNow() {
    if (!session?.user?.id) return;
    setAuthBusy(true, 'Buscando atualizações…');
    try {
      const synced = await loadCloudData();
      if (synced) showToast('Sincronização concluída.');
    } catch (error) {
      setAuthMessage('Não foi possível atualizar agora. Seus dados locais foram mantidos.', true);
      showToast('A sincronização falhou; nada foi apagado.');
    } finally { authBusy = false; updateAuthUI(); }
  }

  document.querySelector('.main-nav').addEventListener('click', event => {
    const button = event.target.closest('button[data-page]');
    if (button) setPage(button.dataset.page);
  });
  $('nextTaskContent').addEventListener('click', event => {
    const button = event.target.closest('button[data-open-task]');
    if (button) openTaskInList(button.dataset.openTask);
  });
  $('newBtn').addEventListener('click', openNewForm);
  $('closeFormBtn').addEventListener('click', closeForm);
  $('taskForm').addEventListener('submit', onSubmitTask);
  document.querySelectorAll('input[name="ready"]').forEach(input => input.addEventListener('change', setFormMode));
  $('releaseForm').addEventListener('submit', onReleaseSubmit);
  $('cancelReleaseBtn').addEventListener('click', () => $('releaseDialog').close());
  $('exportBtn').addEventListener('click', exportBackup);
  $('activeList').addEventListener('click', handleListAction);
  $('reviewList').addEventListener('click', handleListAction);
  $('waitingList').addEventListener('click', handleListAction);
  $('doneList').addEventListener('click', handleListAction);
  $('activeBoard').addEventListener('click', handleListAction);
  $('reviewBoard').addEventListener('click', handleListAction);
  $('waitingBoard').addEventListener('click', handleListAction);
  $('doneBoardList').addEventListener('click', handleListAction);
  $('listViewBtn').addEventListener('click', () => setView('list'));
  $('boardViewBtn').addEventListener('click', () => setView('kanban'));
  $('closeDetailsBtn').addEventListener('click', () => $('detailsDialog').close());
  $('detailsDialog').addEventListener('close', () => { detailTaskId = null; });
  $('commentForm').addEventListener('submit', onCommentSubmit);
  $('linkForm').addEventListener('submit', onLinkSubmit);
  $('linksList').addEventListener('click', handleLinkAction);
  $('signupBtn').addEventListener('click', signUp);
  $('loginBtn').addEventListener('click', signIn);
  $('logoutBtn').addEventListener('click', signOut);
  $('syncNowBtn').addEventListener('click', syncNow);
  window.addEventListener('online', scheduleCloudSync);
  window.addEventListener('beforeunload', () => save(false));
  setInterval(updateTimerDisplays, 1000);
  setFormMode();
  render();
  initializeAuth();
})();
