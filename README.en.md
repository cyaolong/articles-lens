# Article Lens · 文章透镜

[简体中文](README.md)

Analyze an article's argument, evidence and reasoning with Jev. Read web articles, including text-based WeChat articles, or paste the text yourself.

Clicking the extension reads the current article locally. The title and text are sent to TypeSafe only when you click **开始分析** (Start analysis). The interface is Chinese; articles can be in other languages.

## Features

- Six scores: argument structure, evidence, logical coherence, counterarguments, scope and qualifications, and facts versus opinions.
- Four checks: overgeneralization, causal leaps, unsourced numbers and rhetoric replacing evidence.
- View the original passages and export a Markdown report.
- Analyze long articles in groups, cancel requests or review partial results.

Each score is separate; there is no total score. The extension does not check whether facts are true. Model confidence describes certainty in a judgment, not the article's credibility.

## Install

Requires Chrome 116 or later. No build step or server is needed.

1. Download the source or installation ZIP and extract it to a stable folder.
2. Open `chrome://extensions` and enable Developer mode.
3. Click Load unpacked.
4. Select the folder **directly containing `manifest.json`**.
5. Pin Article Lens to the toolbar.

Do not drag the ZIP into Chrome. To upgrade, replace the files in the existing folder and reload the extension. You will need to re-enter a session-stored key. If you install from a new folder, remove the old version you no longer use.

## Add your key

Open Settings from the top-right corner and enter your [TypeSafe/Jev key](https://console.typesafe.ai/), without the `Bearer` prefix. No other provider's key is needed.

By default, the key is kept for the browser session. **在这台电脑记住 Key** (Remember on this computer) stores it locally in the extension, without sync or additional encryption.

**保存并返回** (Save and return) saves settings and returns to the article without starting analysis. Back discards unsaved changes. Removing the key also clears analysis caches.

## Use

Open an article → click the extension → check the text → start analysis.

On the results screen, review scores, checks and original passages, or export a report. **分析另一篇** (Analyze another article) starts a new article and keeps your key, model setting and session caches.

If reading fails, retry or paste the text. On regular web pages, you can also select the article text and click the extension again. Complete any website verification first.

For long articles, each group's scores apply only to that part. If some groups fail, the completed count is shown and partial results can be exported. Reanalysis starts over and may incur more charges.

Reopening the side panel restores the task. Clicking the toolbar again reads the current article, or shows progress if analysis is still running.

## Languages and limits

Articles are sent without translation; quotations keep their original language. Jev reports its best accuracy in English, with varying accuracy in other languages. See [language support](https://docs.typesafe.ai/models#language-support).

The extension does not read text in images, transcribe videos or open links to check sources. Text must contain 80–120,000 characters. Long text is split into groups, without truncation. Grouping rules and display thresholds are in the [design document](docs/design.md).

## Privacy and usage

- Reading happens locally. Text is sent to the TypeSafe API only after you start analysis.
- The background worker puts the key in the request header. It is excluded from article text, extraction scripts and reports.
- No access to cookies or browsing history; no scripts running automatically on all sites.
- The current article and five most recent cached reports are kept in the browser session.
- Analysis uses your TypeSafe account allowance. Rate-limit or busy responses retry once at most; other errors and timeouts do not retry automatically.
- After cancellation, requests already sent may still be processed and billed.

Server-side data handling is covered by [TypeSafe's privacy policy](https://typesafe.ai/legal/privacy-policy) and account terms.

## Development

Checks require Node.js 22+; packaging requires Python 3.10+. The extension itself needs neither.

```sh
npm ci
npm test
npx playwright install chromium
npm run test:e2e
npm run package
npm run test:package
```

On Linux, install browser system dependencies with `npx playwright install --with-deps chromium`.

Browser tests use a temporary Chrome profile, local articles and mocked Jev responses, without real keys. Test results go to `test-results/`; installation packages go to `dist/`.

## Documentation and license

- [Design](docs/design.md): user flow, features and architecture.
- [Verification](docs/verification.md): checks and untested areas.
- [Third-party notices](THIRD_PARTY_NOTICES.md).

MIT licensed. Mozilla Readability uses Apache 2.0. The product approach references [cadeos/jev-grounds](https://github.com/cadeos/jev-grounds). This project is not affiliated with TypeSafe or Grounds.

## Screens

Screenshots use a local test article and mocked responses, not real article ratings.

|Start|Results|Settings|
|---|---|---|
|![Start](docs/screenshots/start.png)|![Results](docs/screenshots/results.png)|![Settings](docs/screenshots/settings.png)|
