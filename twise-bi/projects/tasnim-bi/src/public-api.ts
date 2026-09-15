/*
 * @tasnim/bi — what a host imports at startup: provideBi(), BI_ROUTES and the
 * core types. Visuals, report pages and admin pages live in secondary entry
 * points and load only when a BI route or report opens.
 */
export * from '@tasnim/bi/core';
export * from './provide-bi';
export * from './routes';
export * from './built-in-visuals';
