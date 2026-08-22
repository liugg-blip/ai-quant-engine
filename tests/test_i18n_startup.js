const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8');

function load(search, hash, stored, injected) {
  const body = { nodeType: 1, tagName: 'BODY', hasAttribute: () => false };
  const storage = { qe_ui_language: stored || '' };
  const context = {
    location: { search, hash },
    localStorage: {
      getItem: key => storage[key] || '',
      setItem: (key, value) => { storage[key] = value; }
    },
    document: {
      documentElement: {}, body, title: '',
      createTreeWalker: () => ({ nextNode: () => null })
    },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    MutationObserver: function () { this.observe = function () {}; },
    console
  };
  context.window = context;
  if (injected) context.window.__QE_LAUNCH_LANG__ = injected;
  vm.runInNewContext(source, context);
  return context.window.QE_I18N;
}

const english = load('?qe_lang=en-US', '', 'zh-CN');
assert.strictEqual(english.lang, 'en-US');
assert.strictEqual(english.t('策略引擎'), 'Strategy engine');
assert.strictEqual(load('?qe_lang=zh-CN', '#qe_lang=en-US', 'en-US').lang, 'zh-CN');
assert.strictEqual(load('', '#qe_lang=en-US', 'zh-CN').lang, 'en-US');
assert.strictEqual(load('?qe_lang=zh-CN', '#qe_lang=zh-CN', 'zh-CN', 'en-US').lang, 'en-US');
console.log('i18n startup language tests passed');
