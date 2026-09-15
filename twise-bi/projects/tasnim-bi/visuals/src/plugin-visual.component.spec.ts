import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BI_VISUAL_CONTEXT, BiVisualContext, Scalar, SemanticModel, VisualDefinition, formatValue } from '@tasnim/bi/core';
import { PLUGIN_FRAME_HTML, PluginVisualComponent } from './plugin-visual.component';

describe('PluginVisualComponent sandbox (I8)', () => {
  function setup() {
    const selected: [Scalar[], boolean][] = [];
    const recordsOpened: Scalar[][] = [];
    const model: SemanticModel = { id: 1, name: 'Ops', relationships: [], tables: [], measures: [] };
    const ctx = {
      definition: signal<VisualDefinition>({ id: 'v1', type: 'bullet-chart', roles: { category: [{ table: 'crews', column: 'name' }], values: [{ measure: 'Hours' }] }, filters: [] }),
      visualType: signal({ type: 'bullet-chart', label: 'Bullet chart', icon: '', dataKind: 'aggregate', roles: [], defaultInteraction: 'highlight', loadComponent: () => Promise.resolve(PluginVisualComponent) }),
      model: signal(model),
      filterContext: signal(null),
      result: signal(undefined),
      loading: signal(false),
      selection: signal(null),
      slicerFilter: signal(null),
      editMode: signal(false),
      dataSource: { pluginCode: () => of('bi.registerVisual({ render() {} })') },
      format: formatValue,
      select: (keys: Scalar[], additive: boolean) => selected.push([keys, additive]),
      seeRecords: (keys: Scalar[]) => recordsOpened.push(keys),
      setSlicerFilter: () => undefined,
      openDataPointMenu: () => undefined,
    } as unknown as BiVisualContext;
    TestBed.configureTestingModule({ providers: [{ provide: BI_VISUAL_CONTEXT, useValue: ctx }] });
    const fixture = TestBed.createComponent(PluginVisualComponent);
    fixture.detectChanges();
    const iframe = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    return { component: fixture.componentInstance, iframe, selected, recordsOpened };
  }

  it('renders an iframe sandboxed to scripts only, whose document blocks network access', () => {
    const { iframe } = setup();
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(PLUGIN_FRAME_HTML).toContain("default-src 'none'");
    expect(PLUGIN_FRAME_HTML).not.toContain('allow-same-origin');
    expect(PLUGIN_FRAME_HTML).not.toContain('registerVisual({ render() {} })');
  });

  it('acts only on well-formed messages from its own frame', () => {
    const { component, iframe, selected, recordsOpened } = setup();
    component.handleMessage({ source: window, data: { type: 'bi-plugin:select', keys: ['Crew A'], additive: false } });
    component.handleMessage({ source: iframe.contentWindow, data: { type: 'bi-plugin:select', keys: [{ not: 'a scalar' }], additive: false } });
    component.handleMessage({ source: iframe.contentWindow, data: { type: 'bi-plugin:select', keys: [], additive: false } });
    expect(selected).toEqual([]);

    component.handleMessage({ source: iframe.contentWindow, data: { type: 'bi-plugin:select', keys: ['Crew A'], additive: true } });
    component.handleMessage({ source: iframe.contentWindow, data: { type: 'bi-plugin:seeRecords', keys: ['Crew B'] } });
    expect(selected).toEqual([[['Crew A'], true]]);
    expect(recordsOpened).toEqual([['Crew B']]);
  });

  it('shows a plug-in error reported by its frame', () => {
    const { component, iframe } = setup();
    component.handleMessage({ source: iframe.contentWindow, data: { type: 'bi-plugin:error', message: 'render is not a function' } });
    expect(component.error()).toBe('This visual stopped: render is not a function');
  });
});
