import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { BI_CHART_PALETTE, BI_VISUAL_CONTEXT, Scalar, categoryFields, columnOf, describeError, formatKey, formatValue, measureNames } from '@tasnim/bi/core';

/**
 * The frame document. Plug-in code is never written into it: the code arrives by
 * postMessage and runs inside the sandbox. The CSP blocks every network request
 * (default-src 'none'), so a plug-in can't send data anywhere.
 */
export const PLUGIN_FRAME_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; color: #1D1C21; font: 12px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  #root { position: absolute; inset: 0; overflow: auto; }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var parentWindow = window.parent;
  var impl = null;
  var last = null;
  var send = function (message) { parentWindow.postMessage(message, '*'); };
  var api = {
    select: function (keys, additive) { send({ type: 'bi-plugin:select', keys: keys, additive: !!additive }); },
    seeRecords: function (keys) { send({ type: 'bi-plugin:seeRecords', keys: keys }); }
  };
  var bi = { registerVisual: function (visual) { impl = visual; } };
  var fail = function (error) { send({ type: 'bi-plugin:error', message: String((error && error.message) || error) }); };
  var draw = function () {
    if (!impl || !last) return;
    try { impl.render(document.getElementById('root'), last.data, { theme: last.theme, select: api.select, seeRecords: api.seeRecords }); }
    catch (error) { fail(error); }
  };
  window.addEventListener('message', function (event) {
    if (event.source !== parentWindow) return;
    var message = event.data || {};
    if (message.type === 'bi-plugin:init' && !impl) {
      try {
        new Function('bi', message.code)(bi);
        if (!impl || typeof impl.render !== 'function') throw new Error('The plug-in did not call bi.registerVisual({ render }).');
        send({ type: 'bi-plugin:ready' });
      } catch (error) { fail(error); }
    } else if (message.type === 'bi-plugin:data') {
      last = message;
      draw();
    }
  });
  var timer = 0;
  window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(draw, 60); });
  send({ type: 'bi-plugin:loaded' });
})();
</script>
</body>
</html>`;

const isScalar = (v: unknown): v is Scalar => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const validKeys = (keys: unknown): keys is Scalar[] => Array.isArray(keys) && keys.length > 0 && keys.length <= 2 && keys.every(isScalar);

/**
 * Hosts an installed plug-in visual (V3) in <iframe sandbox="allow-scripts">:
 * an opaque origin with no access to the host page, its cookies, storage or
 * tokens (invariant I8). The frame receives only this visual's query result;
 * the only requests it can make back are "select these keys" and "see records".
 */
@Component({
  selector: 'bi-plugin-visual',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <iframe #frame class="frame" sandbox="allow-scripts" referrerpolicy="no-referrer" [attr.title]="title()" [srcdoc]="frameDocument"></iframe>
    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
  `,
  styles: `
    :host { position: relative; display: block; width: 100%; height: 100%; }
    .frame { display: block; width: 100%; height: 100%; border: 0; background: transparent; }
    .error {
      position: absolute; inset: 0; margin: 0; padding: 12px; display: flex; align-items: center; justify-content: center;
      text-align: center; font-size: 13px; color: var(--bi-danger); background: var(--bi-surface);
    }
  `,
})
export class PluginVisualComponent {
  private readonly ctx = inject(BI_VISUAL_CONTEXT);
  private readonly palette = inject(BI_CHART_PALETTE);
  protected readonly frameDocument = inject(DomSanitizer).bypassSecurityTrustHtml(PLUGIN_FRAME_HTML);
  private readonly frame = viewChild.required<ElementRef<HTMLIFrameElement>>('frame');

  /** Incremented each time the frame document starts, so a reloaded frame is initialised again. */
  private readonly frameStarts = signal(0);
  private readonly ready = signal(false);
  private readonly runtimeError = signal<string | null>(null);

  readonly title = computed(() => `${this.ctx.visualType()?.label ?? 'Plug-in visual'} (sandboxed plug-in)`);
  private readonly code = rxResource({
    params: () => this.ctx.visualType()?.type,
    stream: ({ params }) => this.ctx.dataSource.pluginCode(params),
  });
  readonly error = computed(() => this.runtimeError() ?? (this.code.error() ? describeError(this.code.error(), "This plug-in's code couldn't be loaded.") : null));

  /** The data the plug-in may see: its own result with formatted labels, its selection and the theme. */
  readonly payload = computed(() => {
    const result = this.ctx.result();
    const model = this.ctx.model();
    const visual = this.ctx.definition();
    if (!result || !model) return null;
    const categories = categoryFields(visual);
    const categoryColumns = categories.map((f) => columnOf(model, f));
    const measures = measureNames(visual).map((name) => ({ name, format: model.measures.find((m) => m.name === name)?.format }));
    const selection = this.ctx.selection();
    return {
      data: {
        categories: categories.map((c) => c.column),
        measures,
        rows: result.rows.map((r) => ({
          keys: r.keys,
          labels: r.keys.map((k, i) => formatKey(k, categories[i]?.dateLevel ? 'text' : categoryColumns[i]?.dataType, categoryColumns[i]?.format)),
          values: r.values,
          formatted: r.values.map((v, i) => formatValue(v, measures[i]?.format)),
          highlights: r.highlights,
        })),
        highlighted: result.rows.some((r) => r.highlights !== null),
        selected: selection?.visualId === visual.id ? [...selection.values] : [],
      },
      theme: { palette: [...this.palette], primary: '#2841A3', accent: '#E38200', text: '#1D1C21', muted: '#59585D', grid: '#DDDCE2', surface: '#FFFFFF' },
    };
  });

  constructor() {
    const listener = (event: MessageEvent) => this.handleMessage(event);
    window.addEventListener('message', listener);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('message', listener));

    effect(() => {
      const code = this.code.value();
      if (code !== undefined && this.frameStarts() > 0) this.post({ type: 'bi-plugin:init', code });
    });
    effect(() => {
      const payload = this.payload();
      if (payload && this.ready()) this.post({ type: 'bi-plugin:data', ...payload });
    });
  }

  /** Acts only on messages from this component's own frame, with well-formed keys (I8). */
  handleMessage(event: Pick<MessageEvent, 'source' | 'data'>): void {
    const own = this.frame().nativeElement.contentWindow;
    if (!event.source || event.source !== own) return;
    const message = event.data as { type?: unknown; keys?: unknown; additive?: unknown; message?: unknown } | null;
    switch (message?.type) {
      case 'bi-plugin:loaded':
        this.ready.set(false);
        this.frameStarts.update((n) => n + 1);
        break;
      case 'bi-plugin:ready':
        this.runtimeError.set(null);
        this.ready.set(true);
        break;
      case 'bi-plugin:error':
        this.runtimeError.set(`This visual stopped: ${String(message.message ?? 'unknown error').slice(0, 300)}`);
        break;
      case 'bi-plugin:select':
        if (validKeys(message.keys)) this.ctx.select(message.keys, message.additive === true);
        break;
      case 'bi-plugin:seeRecords':
        if (validKeys(message.keys)) this.ctx.seeRecords(message.keys);
        break;
    }
  }

  private post(message: object): void {
    // A sandboxed frame has an opaque origin, so no target origin can name it; what is sent is this visual's own data.
    this.frame().nativeElement.contentWindow?.postMessage(message, '*');
  }
}
