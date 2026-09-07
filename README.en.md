# dsh-plugin-smooth-stream

[简体中文](README.md) | English

[![npm](https://img.shields.io/npm/v/dsh-plugin-smooth-stream)](https://www.npmjs.com/package/dsh-plugin-smooth-stream)
[![CI](https://github.com/SpookySandwich/dsh-plugin-smooth-stream/actions/workflows/ci.yml/badge.svg)](https://github.com/SpookySandwich/dsh-plugin-smooth-stream/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.2--rc.1-4b8dff)](https://github.com/deepseek-ai/deepseek-harness)
[![deepseek1024](https://img.shields.io/badge/deepseek1024-listed-4b8dff)](https://deepseek1024.com/plugins/SpookySandwich/dsh-smooth-stream)
[![stars](https://img.shields.io/github/stars/SpookySandwich/dsh-plugin-smooth-stream?style=flat&label=stars)](https://github.com/SpookySandwich/dsh-plugin-smooth-stream/stargazers)

Replaces token-by-token streaming twitch with paragraph-batched, fading reveals. Scroll follows smoothly while streaming, and reasoning blocks show a live one-line summary.

**Left: native DSH rendering · Right: Smooth Stream** — same question, started together:

![comparison demo](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/demo.gif)

## Install

```bash
dsh plugin --profile web add dsh-plugin-smooth-stream
```

Takes effect in any open session. Settings live under Settings → **Smooth Stream**.

## What it changes

- **Paragraph-batched reveal** — body text no longer jitters in token by token; it accumulates and enters a paragraph at a time with a fade. Batch boundaries avoid unclosed code fences and tables, so half-rendered Markdown never appears.
- **Smooth scroll-follow** — while streaming, the conversation glides toward the bottom covering a fraction of the remaining distance each frame: large appends catch up without teleporting. Scrolling up hands control back to you; returning to the bottom re-engages the follow.
- **Reasoning summary** — while thinking runs, the collapsed row live-scrolls its latest line, with soft fades instead of hard clipping at both edges. When a turn completes, a closing underline retracts — finished, not merely stopped.
- **Markdown & math** — body text renders through the host's own renderer: code highlighting, copy buttons, tables and KaTeX math look exactly like native output.

## Settings

The **Smooth Stream** section in the settings panel; changes apply live and persist:

| Setting | Default | Notes |
|---|---|---|
| Enable Smooth Stream | On | Off hands rendering back to the built-in view instantly — handy for comparing |
| Reveal animation | Fade | Fade / Rise / Dissolve / Wipe / Focus / Glow / Iris / Soak |
| Animation duration | 520 ms | Entrance duration (120–1200 ms) |
| Batch size | 500 chars | Text accumulated before a batch reveals; smaller feels more live, larger reads calmer |
| Smooth scroll-follow | On | The streaming-time scroll glide |

Includes a live preview and one-click reset. The settings UI follows DSH's display language.

## Reveal styles

Eight entrances, each tuned to its own rhythm; all recorded over the same reply for a direct comparison.

| Fade | Rise |
|---|---|
| ![fade](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/fade.gif) | ![rise](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/rise.gif) |
| **Dissolve** | **Wipe** |
| ![dissolve](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/dissolve.gif) | ![wipe](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/wipe.gif) |
| **Focus** | **Glow** |
| ![focus](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/focus.gif) | ![glow](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/glow.gif) |
| **Iris** | **Soak** |
| ![iris](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/iris.gif) | ![soak](https://raw.githubusercontent.com/SpookySandwich/dsh-plugin-smooth-stream/main/assets/variants/soak.gif) |

## Compatibility

This release targets DSH `0.1.2-rc.1`. Run `npm ci`, `npm test`, and `npm run check:package` to verify the build and package. Restart DSH after updating.


- Updated for dsh `0.1.2-rc.1` client services, Markdown and image APIs; automated tests cover loading and component rendering.
- This plugin owns the conversation view's assistant rendering (the `assistant-step` cell of `conversation.chat.node`) and is mutually exclusive with other plugins that take over the same rendering — with both installed, only one wins.
- Respects `prefers-reduced-motion`: with reduced motion enabled, all animation and smooth scrolling switch off.
- A rendering failure degrades to plain text for that message instead of breaking the conversation.

## License

[MIT](LICENSE)
