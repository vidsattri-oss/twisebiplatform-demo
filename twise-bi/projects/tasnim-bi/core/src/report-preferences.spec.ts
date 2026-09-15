import { firstValueFrom } from 'rxjs';
import { LocalReportPreferences, MAX_RECENT_REPORTS, ReportPreferencesState, withFavorite, withOpened } from './report-preferences';

describe('report preferences (R3)', () => {
  beforeEach(() => localStorage.clear());

  it('stars a report at the front and unstars it without duplicates', () => {
    let state: ReportPreferencesState = { favorites: [], recent: [] };
    state = withFavorite(state, 1, true);
    state = withFavorite(state, 4, true);
    state = withFavorite(state, 1, true);
    expect(state.favorites).toEqual([1, 4]);
    expect(withFavorite(state, 1, false).favorites).toEqual([4]);
  });

  it('keeps the ten most recently opened distinct reports', () => {
    let state: ReportPreferencesState = { favorites: [], recent: [] };
    for (let id = 1; id <= 12; id++) state = withOpened(state, id, `2026-09-15T10:${String(id).padStart(2, '0')}:00Z`);
    state = withOpened(state, 5, '2026-09-15T11:00:00Z');
    expect(state.recent).toHaveLength(MAX_RECENT_REPORTS);
    expect(state.recent[0].reportId).toBe(5);
    expect(state.recent.filter((r) => r.reportId === 5)).toHaveLength(1);
  });

  it('the browser implementation remembers choices and survives bad stored data', async () => {
    const prefs = new LocalReportPreferences();
    await firstValueFrom(prefs.setFavorite(3, true));
    await firstValueFrom(prefs.recordOpened(2));
    const loaded = await firstValueFrom(new LocalReportPreferences().load());
    expect(loaded.favorites).toEqual([3]);
    expect(loaded.recent.map((r) => r.reportId)).toEqual([2]);

    localStorage.setItem('tasnim-bi.report-preferences', '{broken');
    expect(await firstValueFrom(prefs.load())).toEqual({ favorites: [], recent: [] });
  });
});
