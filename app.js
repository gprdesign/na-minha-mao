(() => {
  'use strict';
  const STORAGE_KEY = 'naMinhaMao.tasks.v1';
  const TIMER_KEY = 'naMinhaMao.timer.v1';
  const $ = (id) => document.getElementById(id);
  let tasks = load(STORAGE_KEY, []);
  let timer = load(TIMER_KEY, null);
  let releaseTarget = null;
  let toastTimeout;

  function load(key, fallback) {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
    catch { return fallback; }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
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
  function setFormMode() {
    const ready = document.querySelector('input[name="ready"]:checked')?.value === 'yes';
    $('dueField').classList.toggle('hidden', !ready);
    $('rewardField').classList.toggle('hidden', !ready);
    $('blockerField').classList.toggle('hidden', ready);
  }
  function openNewForm() {
    $('taskForm').reset();
    $('taskId').value = '';
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
    $('estimate').value = task.estimateMinutes || 60;
    $('dueDate').value = task.dueDate || '';
    $('reward').value = task.reward || '';
    $('blocker').value = task.blocker || '';
    document.querySelector(`input[name="ready"][value="${task.status === 'active' ? 'yes' : 'no'}"]`).checked = true;
    document.querySelectorAll('input[name="ready"]').forEach(input => input.disabled = task.status === 'active');
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
    const reward = task.reward ? `<div class="task-details reward"><span>🎁 ${escapeHTML(task.reward)}</span></div>` : '';
    const progress = task.estimateMinutes ? `${formatMinutes(task.estimateMinutes)} estimados · ${formatMinutes(Math.floor(elapsedSeconds(task)/60))} registrados` : '';
    const timerButton = completed ? '' : `<button class="btn small ${timer?.taskId === task.id && timer.startedAt ? 'warn' : 'good'}" data-action="timer" data-id="${escapeHTML(task.id)}" type="button">${timer?.taskId === task.id && timer.startedAt ? 'Pausar foco' : 'Começar foco'}</button>`;
    const completeButton = completed
      ? `<button class="btn small" data-action="reopen" data-id="${escapeHTML(task.id)}" type="button">Reabrir</button>`
      : `<button class="btn small primary" data-action="complete" data-id="${escapeHTML(task.id)}" type="button">Concluir</button>`;
    const deleteButton = `<button class="btn small ghost" data-action="delete" data-id="${escapeHTML(task.id)}" type="button">Excluir</button>`;
    const releaseButton = !completed && task.status === 'waiting' ? `<button class="btn small primary" data-action="release" data-id="${escapeHTML(task.id)}" type="button">Já está liberada</button>` : '';
    const editButton = !completed ? `<button class="btn small" data-action="edit" data-id="${escapeHTML(task.id)}" type="button">Editar</button>` : '';
    const activeMeta = task.status === 'active' ? `<span class="pill ${dueClass}">${escapeHTML(ageText)}</span><span class="pill ${dueStatus(task) ? 'late' : ''}">${due}</span>` : `<span class="pill wait">Aguardando liberação</span>`;
    return `<article class="task" data-task="${escapeHTML(task.id)}">
      <div class="task-top"><div><div class="task-title">${escapeHTML(task.title)}</div><div class="task-meta">${activeMeta}</div></div>${task.status === 'active' && !completed ? `<span class="pill timer-readout" data-id="${escapeHTML(task.id)}">${escapeHTML(remainingLabel(task))}</span>` : ''}</div>
      ${blocker}
      <div class="task-details"><span>⏱ ${escapeHTML(progress)}</span>${task.status === 'active' ? `<span>📅 Liberada: ${escapeHTML(formatDate(task.releaseDate))}</span>` : ''}</div>
      ${reward}
      ${completed && task.completedAt ? `<div class="task-details"><span>Concluída em ${escapeHTML(formatDate(task.completedDate || task.completedAt.slice(0,10)))}</span></div>` : ''}
      <div class="task-actions">${releaseButton}${timerButton}${editButton}${completeButton}${deleteButton}</div>
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
    const waiting = tasks.filter(t => t.status === 'waiting' && !t.completedAt).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
    const done = tasks.filter(t => Boolean(t.completedAt)).sort((a,b) => b.completedAt.localeCompare(a.completedAt));
    $('activeCount').textContent = active.length;
    $('waitingCount').textContent = waiting.length;
    $('doneCount').textContent = done.length;
    $('estimateTotal').textContent = formatMinutes(active.reduce((sum,t) => sum + (Number(t.estimateMinutes)||0), 0));
    $('activeList').innerHTML = active.length ? active.map(t => renderTask(t)).join('') : '<div class="empty">Nenhuma tarefa liberada por enquanto. Quando estiver com tudo em mãos, registre a liberação.</div>';
    $('waitingList').innerHTML = waiting.length ? waiting.map(t => renderTask(t)).join('') : '<div class="empty">Nada aguardando liberação.</div>';
    $('doneList').innerHTML = done.length ? done.map(t => renderTask(t,true)).join('') : '<div class="empty">As tarefas concluídas aparecem aqui.</div>';
    updateTimerDisplays();
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
      id: id(), title, status: ready ? 'active' : 'waiting',
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

  $('newBtn').addEventListener('click', openNewForm);
  $('closeFormBtn').addEventListener('click', closeForm);
  $('taskForm').addEventListener('submit', onSubmitTask);
  document.querySelectorAll('input[name="ready"]').forEach(input => input.addEventListener('change', setFormMode));
  $('releaseForm').addEventListener('submit', onReleaseSubmit);
  $('cancelReleaseBtn').addEventListener('click', () => $('releaseDialog').close());
  $('exportBtn').addEventListener('click', exportBackup);
  $('activeList').addEventListener('click', handleListAction);
  $('waitingList').addEventListener('click', handleListAction);
  $('doneList').addEventListener('click', handleListAction);
  window.addEventListener('beforeunload', save);
  setInterval(updateTimerDisplays, 1000);
  setFormMode();
  render();
})();
