import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** A stand-in for the TWise shell around the host's routes. */
@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'tw-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly collapsed = signal(false);
  protected readonly nav = [
    { path: '/home', label: 'Dashboard', icon: 'M4 13h7V4H4v9Zm9 7h7V11h-7v9ZM4 20h7v-5H4v5ZM13 4v5h7V4h-7Z' },
    { path: '/reports', label: 'Reports & BI', icon: 'M6 20V11M12 20V5M18 20v-6M3 20h18' },
  ];
}
