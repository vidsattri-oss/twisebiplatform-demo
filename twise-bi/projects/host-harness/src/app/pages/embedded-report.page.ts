import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ReportComponent } from '@tasnim/bi/report';

/**
 * A TWise host page that embeds a report directly instead of routing to it —
 * the "Chart Details" style of page, read-only for viewers.
 */
@Component({
  selector: 'tw-embedded-report-page',
  imports: [ReportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Wells Readiness — Chart Details</h1>
      <p>Embedded with &lt;bi-report [reportId]="1" [canEdit]="false" /&gt; inside a TWise page.</p>
    </header>
    <bi-report [reportId]="1" [canEdit]="false" />
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; }
    .page-header h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .page-header p { margin: 2px 0 0; font-size: 13px; color: #475467; }
  `,
})
export class EmbeddedReportPage {}
