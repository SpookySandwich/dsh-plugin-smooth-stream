import fs from 'node:fs';

const body = fs.readFileSync(new URL('./plugin.client.js', import.meta.url), 'utf8');
const out = [
  "window.__ModuleLoader__.load({",
  "  id: 'dsh-plugin-smooth-stream',",
  "  factory: (require) => {",
  "    const React = require('react');",
  "    const styles = {",
  "      insert(css) {",
  "        if (typeof document === 'undefined') return function () {};",
  "        const prev = document.querySelector('style[data-plugin=\"dsh-plugin-smooth-stream\"]');",
  "        if (prev) {",
  "          prev.textContent = css;",
  "          return function () { prev.remove(); };",
  "        }",
  "        const tag = document.createElement('style');",
  "        tag.dataset.plugin = 'dsh-plugin-smooth-stream';",
  "        tag.textContent = css;",
  "        document.head.appendChild(tag);",
  "        return function () { tag.remove(); };",
  "      }",
  "    };",
  "    return (function () {",
  body,
  "    })();",
  "  }",
  "});",
  "",
].join('\n');
fs.writeFileSync(new URL('./lib/client.js', import.meta.url), out);
console.error('wrote lib/client.js', out.length);
