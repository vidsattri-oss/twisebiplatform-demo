import { Component } from '@angular/core';

/**
 * AI mode — explicit demo placeholder per instruction. No live model call;
 * the "generated" answer below is a static, clearly-labeled example so the
 * demo can show the intended interaction shape without pretending it's live.
 */
@Component({
  selector: 'app-ai-placeholder',
  standalone: true,
  templateUrl: './ai-placeholder.component.html',
  styleUrl: './ai-placeholder.component.css',
})
export class AiPlaceholderComponent {
  readonly examplePrompt = 'Show productivity % by crew, only crews below 80% this month';
  readonly exampleChips = [
    { k: 'Measure', v: 'Productivity % (DIVIDE)' },
    { k: 'Group By', v: 'Crew' },
    { k: 'Filter', v: 'Month = Current' },
    { k: 'Filter', v: 'Productivity % < 80%' },
  ];
}
