import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly connected = signal<'checking' | 'up' | 'down'>('checking');

  constructor(http: HttpClient) {
    http.get(`${environment.apiBaseUrl}/health`).subscribe({
      next: () => this.connected.set('up'),
      error: () => this.connected.set('down'),
    });
  }
}
