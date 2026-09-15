import { EnvironmentProviders, Provider, Type, makeEnvironmentProviders } from '@angular/core';
import { provideHighcharts } from 'highcharts-angular';
import { BI_API_BASE_URL, BI_DATA_SOURCE, BiDataSource, HttpBiDataSource } from '@tasnim/bi/core';
import { BI_CHART_PALETTE, BI_FILTER_BRIDGE, BiFilterBridge } from '@tasnim/bi/core';
import { provideBiVisual } from '@tasnim/bi/core';
import { BUILT_IN_VISUALS } from './built-in-visuals';

export interface BiConfig {
  /** Base URL of the /api/bi contract. Defaults to "/api/bi". */
  apiBaseUrl?: string;
  /** Replace the HttpClient data source, e.g. with one that routes through TWise's API services. */
  dataSource?: Type<BiDataSource>;
  /** Maps the host's global filter bar into report filters. */
  filterBridge?: Type<BiFilterBridge>;
  /** Set to false when the host already calls provideHighcharts(). */
  provideHighcharts?: boolean;
  /** Chart colours; defaults to the Al Tasnim logo palette (blue, orange, grey). */
  palette?: readonly string[];
}

/**
 * Registers @tasnim/bi in a host application. Requires provideHttpClient() and
 * provideRouter() from the host. Call provideBiVisual() after this to add or
 * replace visuals.
 */
export function provideBi(config: BiConfig = {}): EnvironmentProviders {
  const providers: (Provider | EnvironmentProviders)[] = [
    { provide: BI_API_BASE_URL, useValue: config.apiBaseUrl ?? '/api/bi' },
    { provide: BI_DATA_SOURCE, useClass: config.dataSource ?? HttpBiDataSource },
    ...BUILT_IN_VISUALS.map(provideBiVisual),
  ];
  if (config.filterBridge) providers.push({ provide: BI_FILTER_BRIDGE, useClass: config.filterBridge });
  if (config.palette?.length) providers.push({ provide: BI_CHART_PALETTE, useValue: config.palette });
  if (config.provideHighcharts !== false) {
    providers.push(
      provideHighcharts({
        instance: () => import('highcharts/esm/highcharts').then((m) => m.default),
        modules: () => [import('highcharts/esm/modules/accessibility')],
      }),
    );
  }
  return makeEnvironmentProviders(providers);
}
