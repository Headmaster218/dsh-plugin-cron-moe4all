/**
 * dsh-plugin-cron-scheduler 客户端半（零构建）：
 * 在侧边栏底部注册「定时任务」列表区块（sidebar.footer.action，新 id，
 * 不替换 cordis-panel）—— 任务列表 + 新建/编辑/删除 + 手动触发 + SSE 同步。
 *
 * 数据通道：直连插件自建 HTTP 路由（/api/cron/*）：
 * GET/POST /api/cron/jobs、PUT/DELETE /api/cron/jobs/:id、
 * POST /api/cron/jobs/:id/run、GET /api/cron/sessions、SSE /api/cron/events。
 *
 * 配色：全部使用主题 token（Theme.listTokens），不硬编码深色 fallback，
 * 缺失时透明/继承，浅色/深色主题都正确显示。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-cron-moe4all',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    let react = require('react')

    const React = react
    const JOBS_URL = '/api/cron/jobs'
    const SESSIONS_URL = '/api/cron/sessions'
    const EVENTS_URL = '/api/cron/events'
    const NS = 'moe4all.cron'
    const dictionaries = {
      zh: {
        title: '定时任务', success: '成功', failed: '失败', skipped: '跳过', never: '未运行',
        edit: '编辑', remove: '删除', loadFailed: '加载失败：', loading: '加载中...', empty: '暂无定时任务',
        create: '新建任务', add: '+ 新建', editTask: '编辑任务', deleteTask: '删除任务',
        run: '立即运行', cancel: '取消', save: '保存', saving: '保存中...', deleting: '删除中...',
        name: '名称', namePlaceholder: '任务名称', cron: 'Cron（5 字段，如 0 10 * * *）',
        prompt: '指令（到时发送给 Agent）', strategy: '会话策略', newSession: '每次新建', fixedSession: '固定会话',
        chooseSession: '选择会话', sessionPlaceholder: '选择会话',
        requiredName: '请填写任务名称', requiredCron: '请填写 Cron 表达式', requiredPrompt: '请填写指令', requiredSession: '请选择会话',
        confirmDelete: '确定删除「{name}」？此操作不可撤销。', close: '关闭',
      },
      en: {
        title: 'Scheduled tasks', success: 'Succeeded', failed: 'Failed', skipped: 'Skipped', never: 'Not run',
        edit: 'Edit', remove: 'Delete', loadFailed: 'Could not load: ', loading: 'Loading...', empty: 'No scheduled tasks',
        create: 'New task', add: '+ New', editTask: 'Edit task', deleteTask: 'Delete task',
        run: 'Run now', cancel: 'Cancel', save: 'Save', saving: 'Saving...', deleting: 'Deleting...',
        name: 'Name', namePlaceholder: 'Task name', cron: 'Cron (5 fields, e.g. 0 10 * * *)',
        prompt: 'Instruction to send to the Agent', strategy: 'Session strategy', newSession: 'New each time', fixedSession: 'Fixed session',
        chooseSession: 'Choose a session', sessionPlaceholder: 'Choose a session',
        requiredName: 'Enter a task name', requiredCron: 'Enter a Cron expression', requiredPrompt: 'Enter an instruction', requiredSession: 'Choose a session',
        confirmDelete: 'Delete "{name}"? This cannot be undone.', close: 'Close',
      },
    }

    // ---- 主题语义变量（与 cordis-panel/dshmarket 同源，自动跟随浅色/深色主题。
    //      主按钮用 button-primary-fill 背景 + label-primary-inverted 反色文字，
    //      两者配对随主题翻转，保证任何主题下都清晰、不突兀。） ----
    const V = {
      primary: 'var(--dsw-alias-button-primary-fill)',
      primaryText: 'var(--dsw-alias-label-primary-foreground)',
      border: 'var(--dsw-alias-border-l1)',
      overlay: 'var(--dsw-alias-bg-base)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      surface2: 'var(--dsw-alias-bg-base)',
      text: 'var(--dsw-alias-label-primary)',
      text2: 'var(--dsw-alias-label-secondary)',
      danger: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
    }

    // 列表高度：锚定到视口可用空间，任务多时容器内滚动，不撑爆侧栏
    const LIST_CAP = 328
    const MARGIN = 12

    // ---- 样式 ----
    const btnGhost = (danger) => ({
      padding: '2px 8px', borderRadius: '5px',
      border: '1px solid ' + (danger ? V.danger : V.border),
      background: 'transparent', cursor: 'pointer', fontSize: '11px',
      color: danger ? V.danger : V.text,
    })
    const btnPrimary = { padding: '3px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', background: V.primary, color: V.primaryText }
    const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: '6px', border: '1px solid ' + V.border, background: V.surface, color: V.text, fontSize: '12px' }
    const labelStyle = { display: 'block', fontSize: '11px', margin: '9px 0 3px', color: V.text2 }

    // ---- 工具 ----
    const readJSON = async (response) => {
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }
    // 执行状态 → 可读文案 + 颜色
    const statusText = (job, t) => {
      if (job.lastRunStatus === 'success') return { text: t('success'), color: V.success }
      if (job.lastRunStatus === 'failed') return { text: t('failed'), color: V.danger }
      if (job.lastRunStatus === 'skipped') return { text: t('skipped'), color: V.text2 }
      return { text: t('never'), color: V.text2 }
    }

    // ---- 启用开关 ----
    function Switch({ on, onClick, disabled }) {
      return React.createElement('button', {
        type: 'button', role: 'switch', 'aria-checked': on, disabled,
        onClick: () => onClick(!on),
        style: {
          position: 'relative', width: '30px', height: '17px', borderRadius: '9px',
          border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
          // 开启态用主按钮填充色，关闭态用中性边框色；都随主题翻转，始终能看清状态
          background: on ? V.primary : 'var(--dsw-alias-border-l2, #8a8a92)',
          opacity: disabled ? 'var(--dsw-control-disabled-opacity,.5)' : 1, flexShrink: 0, transition: 'background .15s',
        },
      }, React.createElement('span', {
        style: { position: 'absolute', top: '2px', left: on ? '15px' : '2px', width: '13px', height: '13px', borderRadius: '7px', background: V.primaryText, transition: 'left .15s' },
      }))
    }

    // ---- 渲染期兜底 ----
    class SectionBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: undefined } }
      static getDerivedStateFromError(error) { return { error: error instanceof Error ? error.message : String(error) } }
      render() {
        if (this.state.error !== undefined) {
          return React.createElement('div', { style: { padding: '8px', fontSize: '12px', color: V.danger } }, this.props.t('loadFailed'), this.state.error)
        }
        return this.props.children
      }
    }

    // ---- 任务行（紧凑：单行，高度贴近按钮；「立即运行」在编辑弹窗里） ----
    function JobRow({ job, busy, onToggle, onEdit, onDelete, t }) {
      const st = statusText(job, t)
      return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', height: '28px', borderBottom: '1px solid ' + V.border } },
        React.createElement(Switch, { on: job.enabled !== false, disabled: busy, onClick: (next) => onToggle(job, next) }),
        React.createElement('div', { style: { flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'baseline', gap: '6px' } },
          React.createElement('span', { style: { fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: V.text } }, job.name),
          React.createElement('span', { style: { fontSize: '10px', color: V.text2, whiteSpace: 'nowrap' } }, job.schedule),
          React.createElement('span', { style: { fontSize: '10px', color: st.color, flexShrink: 0 } }, st.text),
        ),
        React.createElement('button', { style: btnGhost(false), onClick: () => onEdit(job), title: t('edit'), 'aria-label': t('edit') }, '✎'),
        React.createElement('button', { style: btnGhost(true), onClick: () => onDelete(job), title: t('remove'), 'aria-label': t('remove') }, '×'),
      )
    }

    // ---- 弹窗容器 ----
    function Dialog({ title, onClose, footer, children, t }) {
      return React.createElement('div', {
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
        onClick: (e) => { if (e.target === e.currentTarget) onClose() },
      },
        React.createElement('div', { style: { background: V.surface2, border: '1px solid ' + V.border, borderRadius: '10px', width: '420px', maxWidth: '92vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,.25)' } },
          React.createElement('div', { style: { padding: '12px 16px', borderBottom: '1px solid ' + V.border, fontSize: '13px', fontWeight: 600, color: V.text, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            React.createElement('span', null, title),
            React.createElement('button', { type: 'button', onClick: onClose, title: t('close'), 'aria-label': t('close'), style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: V.text2 } }, '✕'),
          ),
          React.createElement('div', { style: { padding: '4px 16px', overflowY: 'auto', flex: 1, color: V.text } }, children),
          footer && React.createElement('div', { style: { padding: '10px 16px', borderTop: '1px solid ' + V.border, display: 'flex', justifyContent: 'flex-end', gap: '8px' } }, footer),
        ),
      )
    }

    // ---- 新建/编辑弹窗 ----
    function JobFormModal({ job, onClose, onSaved, onRun, t }) {
      const [form, setForm] = React.useState({
        name: (job && job.name) || '', schedule: (job && job.schedule) || '', prompt: (job && job.prompt) || '',
        sessionStrategy: (job && job.sessionStrategy) || 'new', fixedSessionId: (job && job.fixedSessionId) || '', enabled: job ? job.enabled !== false : true,
      })
      const [sessions, setSessions] = React.useState([])
      const [sessionsLoaded, setSessionsLoaded] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const [saving, setSaving] = React.useState(false)
      const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

      // 切到固定会话时拉取会话列表填充下拉
      React.useEffect(() => {
        if (form.sessionStrategy !== 'fixed') return
        let alive = true
        fetch(SESSIONS_URL)
          .then(readJSON)
          .then((r) => { if (alive) { setSessions((r && r.sessions) || []); setSessionsLoaded(true) } })
          .catch((e) => { if (alive) { console.error(e); setSessionsLoaded(true) } })
        return () => { alive = false }
      }, [form.sessionStrategy])

      const save = () => {
        if (saving) return
        // 必填校验只记录文案 key，切换语言时同步更新提示。
        if (!form.name || !form.name.trim()) { setError('requiredName'); return }
        if (!form.schedule || !form.schedule.trim()) { setError('requiredCron'); return }
        if (!form.prompt || !form.prompt.trim()) { setError('requiredPrompt'); return }
        if (form.sessionStrategy === 'fixed' && !form.fixedSessionId) { setError('requiredSession'); return }
        setSaving(true)
        setError(undefined)
        const body = { ...form }
        if (body.sessionStrategy === 'new') delete body.fixedSessionId
        const isEdit = Boolean(job)
        fetch(isEdit ? `${JOBS_URL}/${job.id}` : JOBS_URL, {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then(readJSON)
          .then(() => onSaved())
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setSaving(false))
      }

      const field = (k, t, c) => React.createElement('div', null, React.createElement('label', { style: labelStyle }, t), c)
      const sessionOptions = [
        React.createElement('option', { key: '__empty', value: '' }, sessionsLoaded ? t('sessionPlaceholder') : t('loading')),
      ].concat((sessions || []).map((s) => React.createElement('option', { key: s.id, value: s.id }, s.label)))

      return React.createElement(Dialog, {
        t, title: job ? t('editTask') : t('create'), onClose: () => { if (!saving) onClose() },
        footer: React.createElement(React.Fragment, null,
          job ? React.createElement('button', { style: Object.assign({}, btnPrimary, { marginRight: 'auto' }), onClick: () => { if (job) { onRun(job); onClose() } }, disabled: saving }, t('run')) : null,
          React.createElement('button', { style: btnGhost(false), onClick: onClose, disabled: saving }, t('cancel')),
          React.createElement('button', { style: btnPrimary, onClick: save, disabled: saving }, saving ? t('saving') : t('save'))),
      },
        field('name', t('name'), React.createElement('input', { value: form.name, onChange: (e) => set('name', e.target.value), placeholder: t('namePlaceholder'), disabled: saving, style: inputStyle })),
        field('schedule', t('cron'), React.createElement('input', { value: form.schedule, onChange: (e) => set('schedule', e.target.value), placeholder: '0 10 * * *', disabled: saving, style: inputStyle })),
        field('prompt', t('prompt'), React.createElement('textarea', { value: form.prompt, onChange: (e) => set('prompt', e.target.value), rows: 4, disabled: saving, style: Object.assign({}, inputStyle, { resize: 'vertical', fontFamily: 'inherit' }) })),
        field('sessionStrategy', t('strategy'), React.createElement('select', { value: form.sessionStrategy, onChange: (e) => set('sessionStrategy', e.target.value), disabled: saving, style: inputStyle },
          React.createElement('option', { value: 'new' }, t('newSession')),
          React.createElement('option', { value: 'fixed' }, t('fixedSession')),
        )),
        form.sessionStrategy === 'fixed' ? field('fixedSessionId', t('chooseSession'), React.createElement('select', { value: form.fixedSessionId, onChange: (e) => set('fixedSessionId', e.target.value), disabled: saving, style: inputStyle }, sessionOptions)) : null,
        error !== undefined ? React.createElement('div', { style: { color: V.danger, fontSize: '11px', marginTop: '8px' } }, t(error)) : null,
      )
    }

    // ---- 删除确认弹窗 ----
    function DeleteConfirmModal({ job, onClose, onDeleted, t }) {
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const remove = () => {
        if (busy) return
        setBusy(true)
        setError(undefined)
        fetch(`${JOBS_URL}/${job.id}`, { method: 'DELETE' })
          .then(readJSON)
          .then(() => onDeleted())
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false))
      }
      return React.createElement(Dialog, {
        t, title: t('deleteTask'), onClose: () => { if (!busy) onClose() },
        footer: React.createElement(React.Fragment, null,
          React.createElement('button', { style: btnGhost(false), onClick: onClose, disabled: busy }, t('cancel')),
          React.createElement('button', { style: btnGhost(true), onClick: remove, disabled: busy }, busy ? t('deleting') : t('remove'))),
      },
        React.createElement('p', { style: { fontSize: '12px', margin: '6px 0 0' } }, t('confirmDelete', { name: job.name })),
        error !== undefined ? React.createElement('div', { style: { color: V.danger, fontSize: '11px', marginTop: '8px' } }, error) : null,
      )
    }

    // ---- 主面板 ----
    function CronPanel({ wide, t }) {
      const [jobs, setJobs] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [modal, setModal] = React.useState(undefined)
      const [busyId, setBusyId] = React.useState(undefined)
      const listRef = React.useRef(null)
      const [maxH, setMaxH] = React.useState(LIST_CAP)

      // 自实现锚定最大高度（等同 ui-primitives useAnchoredMaxHeight）
      React.useEffect(() => {
        const el = listRef.current
        if (!el) return
        const fit = () => setMaxH(Math.min(LIST_CAP, Math.max(0, el.getBoundingClientRect().bottom - MARGIN)))
        fit()
        window.addEventListener('resize', fit)
        window.addEventListener('scroll', fit, true)
        return () => { window.removeEventListener('resize', fit); window.removeEventListener('scroll', fit, true) }
      }, [])

      const load = React.useCallback(() => {
        fetch(JOBS_URL)
          .then(readJSON)
          .then((value) => {
            setJobs(Array.isArray(value.jobs) ? value.jobs : [])
            setError(undefined)
          })
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      }, [])

      React.useEffect(() => {
        load()
        let source
        try {
          source = new EventSource(EVENTS_URL)
          source.addEventListener('jobs-changed', () => load())
        } catch { /* EventSource 不可用：挂载与本地变更后的 load() 仍保证同步 */ }
        return () => { if (source) source.close() }
      }, [load])

      const toggleJob = (job, next) => {
        setBusyId(job.id)
        fetch(`${JOBS_URL}/${job.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        })
          .then(readJSON)
          .then(() => load())
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusyId(undefined))
      }

      const runJob = (job) => {
        setBusyId(job.id)
        fetch(`${JOBS_URL}/${job.id}/run`, { method: 'POST' })
          .then(readJSON)
          .then(() => load())
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusyId(undefined))
      }

      const refresh = () => { setModal(undefined); load() }

      // 折叠 rail 态：只显示紧凑时钟符号
      if (!wide) {
        return React.createElement('div', {
          title: t('title'),
          style: {
            width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px', fontFamily: '"Segoe UI Symbol", sans-serif', color: V.text2,
          },
        }, '⏱\uFE0E')
      }

      return React.createElement(SectionBoundary, { t },
        React.createElement('div', { style: { padding: '6px 8px 14px' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' } },
            React.createElement('span', { style: { fontSize: '12px', fontWeight: 600, color: V.text } }, t('title')),
            React.createElement('button', { style: btnPrimary, onClick: () => setModal({ kind: 'form' }) }, t('add')),
          ),
          error !== undefined ? React.createElement('div', { style: { color: V.danger, fontSize: '10px', padding: '2px 0' } }, t('loadFailed'), error) : null,
          jobs === undefined ? React.createElement('div', { style: { padding: '6px 0', textAlign: 'center', color: V.text2, fontSize: '11px' } }, t('loading')) : null,
          (jobs && jobs.length === 0 && !error) ? React.createElement('div', { style: { padding: '6px 0', color: V.text2, fontSize: '11px' } }, t('empty')) : null,
          React.createElement('div', { ref: listRef, style: { maxHeight: maxH, overflowY: 'auto' } },
            (jobs || []).map((job) => React.createElement(JobRow, {
              key: job.id, job, t, busy: busyId === job.id,
              onToggle: toggleJob, onEdit: (j) => setModal({ kind: 'form', job: j }),
              onDelete: (j) => setModal({ kind: 'delete', job: j }),
            })),
          ),
          modal !== undefined && modal.kind === 'form' ? React.createElement(JobFormModal, {
            t, job: modal.job, onClose: () => setModal(undefined), onSaved: refresh, onRun: runJob,
          }) : null,
          modal !== undefined && modal.kind === 'delete' ? React.createElement(DeleteConfirmModal, {
            t, job: modal.job, onClose: () => setModal(undefined), onDeleted: refresh,
          }) : null,
        ),
      )
    }

    // ---- Cordis 插件出口：注册到 sidebar.footer.action（新 id，不碰 cordis-panel） ----
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'cron: bilingual UI')
      ctx.slots.inject('sidebar.footer.action', () => {
        const off = ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'cron-hotplug',
          order: -10,
          locale: NS,
          label: () => ctx.locale.bind(NS)('title'),
        }, (ownerProps) => React.createElement(CronPanel, { wide: !!(ownerProps && ownerProps.wide), t: ownerProps.t }))
        return off
      })
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
