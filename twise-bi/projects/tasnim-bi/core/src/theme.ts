import { InjectionToken } from '@angular/core';

/** Al Tasnim / TWise logo colours. */
export const BI_BRAND = { blue: '#2841A3', orange: '#E38200', grey: '#59585D' } as const;

/**
 * Chart colours in logo order (blue, orange, grey), then lighter and deeper
 * steps of the same three hues so adjacent categories stay distinguishable.
 */
export const BI_LOGO_PALETTE: readonly string[] = ['#2841A3', '#E38200', '#59585D', '#6F84D9', '#F2AE4B', '#9B9AA0', '#1B2C73', '#A35E00'];

/** Series and category colours for built-in charts. Override with provideBi({ palette }). */
export const BI_CHART_PALETTE = new InjectionToken<readonly string[]>('BI_CHART_PALETTE', { factory: () => BI_LOGO_PALETTE });
