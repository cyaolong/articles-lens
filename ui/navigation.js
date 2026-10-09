export function taskScreen(state) {
  return state.status === "done" || (state.status === "error" && state.reports?.length) ? "result" : "start";
}

// Navigation never owns article data or credentials. The worker owns the task.
export class Navigation {
  screen = "start";
  returnScreen = "start";
  scroll = { start: 0, result: 0, settings: 0 };
  sync(state) {
    const next = taskScreen(state);
    if (this.screen === "settings") { this.returnScreen = next; return false; }
    return this.move(next);
  }
  move(next, scroll = 0) {
    if (next === this.screen) return false;
    this.scroll[this.screen] = scroll;
    this.screen = next;
    return true;
  }
  settings(scroll) {
    this.returnScreen = this.screen;
    this.move("settings", scroll);
  }
  back() { this.screen = this.returnScreen; return this.scroll[this.screen]; }
}
