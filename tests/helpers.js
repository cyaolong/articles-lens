export function responseFor(request) {
  const first = Object.keys(request.state.paragraphs)[0];
  const answers = {};
  for (const [id, q] of Object.entries(request.questions)) {
    if (q.type === "score") answers[id] = { type: "score", score: 2.1, confidence: 0.78, probabilities: { "0": 0, "1": 0, "2": 0.9, "3": 0.1 } };
    else if (q.type === "choice") {
      const choice = id === "main_claim" || id === "causality_location" ? first : "none";
      answers[id] = { type: "choice", choice, confidence: 0.9, probabilities: Object.fromEntries(Object.keys(q.criteria).map(p => [p, p === choice ? 1 : 0])) };
    } else answers[id] = { type: "noul", noul: id === "argumentative" ? 0.95 : id === "causality" ? 0.92 : 0.1 };
  }
  return { model: "jev-1.13.0", answers, usage: { input_tokens: 456, output_tokens: 30 } };
}

export function makeChrome({ origin = "chrome-extension://test-extension/", extraction = null } = {}) {
  const local = {}, session = {}, listeners = [], clicks = [], accessLevels = [], injections = [], broadcasts = [];
  function area(storage, name) {
    return {
      async setAccessLevel(value) { accessLevels.push([name, value.accessLevel]); },
      async get(keys) {
        const wanted = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || storage);
        return structuredClone(Object.fromEntries(wanted.filter(k => k in storage).map(k => [k, storage[k]])));
      },
      async set(values) { Object.assign(storage, structuredClone(values)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; }
    };
  }
  const chrome = {
    runtime: { id: "test-extension", getURL: path => origin + path,
      onMessage: { addListener(listener) { listeners.push(listener); } },
      async sendMessage(message) { broadcasts.push(message); for (const listener of listeners) listener(message, { id: "test-extension", url: origin + "background.js" }, () => {}); }
    },
    storage: { local: area(local, "local"), session: area(session, "session") },
    action: { onClicked: { addListener(listener) { clicks.push(listener); } } },
    sidePanel: { async open() {} },
    scripting: { async executeScript(options) { injections.push(options); return [{ result: null }, { result: extraction }]; } },
    tabs: { async query() { return [{ id: 9, windowId: 1, url: "https://example.test/article" }]; }, async get(id) { return { id, url: "https://example.test/article" }; }, async update() {} }
  };
  async function message(payload, sender = { id: "test-extension", url: origin + "panel.html" }) {
    return await new Promise(resolve => {
      let accepted = false;
      for (const listener of listeners) if (listener(payload, sender, resolve) === true) accepted = true;
      if (!accepted) resolve(undefined);
    });
  }
  return { chrome, local, session, accessLevels, injections, broadcasts, message, clicks };
}
