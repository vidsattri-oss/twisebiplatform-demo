import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { GlobalFiltersService } from './twise/global-filters.service';

describe('App shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders host navigation, including the mounted BI routes', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const links = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.menu-link')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/home', '/reports', '/embedded']);
  });

  it('writes filter bar changes to the shared global filter state', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const select = (fixture.nativeElement as HTMLElement).querySelector('tw-filter-bar select') as HTMLSelectElement;
    select.value = 'Nimr ODC';
    select.dispatchEvent(new Event('change'));
    expect(TestBed.inject(GlobalFiltersService).plant()).toBe('Nimr ODC');
  });
});
