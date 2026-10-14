import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

test('client follows host locale in the list, form and validation messages', () => {
  const registrations = []
  const state = new Map()
  let language = 'zh', dictionaries, plugin, owner, cursor
  const React = {
    Fragment: 'fragment',
    Component: class { constructor(props) { this.props = props; this.state = {} } },
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const key = `${owner}:${cursor++}`
      if (!state.has(key)) state.set(key, typeof initial === 'function' ? initial() : initial)
      return [state.get(key), value => state.set(key, typeof value === 'function' ? value(state.get(key)) : value)]
    },
    useRef: () => ({ current: null }), useEffect() {}, useCallback: fn => fn,
  }
  const ctx = {
    effect(fn) { fn() },
    locale: {
      register(ns, value) { dictionaries = value; return () => {} },
      bind() { return key => dictionaries[language][key] ?? key },
    },
    slots: {
      inject(name, fn) { fn() },
      register(options, component) { registrations.push({ options, component }) },
    },
  }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }) { plugin = factory(() => React) } } },
  })
  plugin.apply(ctx)
  assert.ok(plugin.inject.includes('locale'))
  assert.equal(registrations[0].options.locale, 'moe4all.cron')
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort())
  const nodes = []
  function render(node) {
    if (node == null || typeof node === 'boolean') return ''
    if (Array.isArray(node)) return node.map(render).join(' ')
    if (typeof node !== 'object') return String(node)
    if (typeof node.type === 'function') {
      owner = node.type.name; cursor = 0
      const result = node.type.prototype?.render ? new node.type(node.props).render() : node.type(node.props)
      return render(result)
    }
    nodes.push(node)
    return render(node.props.children)
  }
  const t = ctx.locale.bind()
  const tree = () => { nodes.length = 0; return render(registrations[0].component({ wide: true, t })) }
  assert.match(tree(), /定时任务/)
  nodes.find(node => node.type === 'button' && render(node.props.children) === '+ 新建').props.onClick()
  assert.match(tree(), /新建任务/)
  nodes.find(node => node.type === 'button' && render(node.props.children) === '保存').props.onClick()
  assert.match(tree(), /请填写任务名称/)
  language = 'en'
  assert.match(tree(), /New task/)
  assert.match(tree(), /Enter a task name/)
  assert.equal(registrations[0].options.label(), 'Scheduled tasks')
  const save = nodes.find(node => node.type === 'button' && render(node.props.children) === 'Save')
  assert.equal(save.props.style.background, 'var(--dsw-alias-button-primary-fill)')
  assert.equal(save.props.style.color, 'var(--dsw-alias-label-primary-foreground)')
})
