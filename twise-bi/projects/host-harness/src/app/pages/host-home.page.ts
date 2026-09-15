import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** A plain host page, to show BI routes living beside the host's own routes. */
@Component({
  selector: 'tw-host-home-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h1>Dashboard</h1>
      <p>This page belongs to the host app. The BI module adds its pages under <code>/reports</code> without touching host routes.</p>
      <div class="links">
        <a routerLink="/reports">Open Reports</a>
        <a routerLink="/embedded">Open an embedded report</a>
      </div>
    </section>
  `,
  styles: `
    .panel { padding: 20px; background: #fff; border: 1px solid var(--color-border); border-radius: var(--radius-lg); max-width: 720px; }
    h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
    p { margin: 0; color: #475467; }
    code { font-size: 12.5px; background: #f2f4f7; padding: 1px 5px; border-radius: 4px; }
    .links { display: flex; gap: 16px; margin-top: 14px; }
    a { color: var(--color-primary); font-weight: 500; text-decoration: none; }
    a:hover { text-decoration: underline; }
  `,
})
export class HostHomePage {}
