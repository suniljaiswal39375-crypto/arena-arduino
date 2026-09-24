import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressView } from './ProgressView';
describe('submission progress presentation', () => {
  it('uses explicit accessible statuses, counts and non-mastery language', () => {
    const html = renderToStaticMarkup(<ProgressView rows={[{ id: 's', name: '<Learner>', cells: [
      { assignmentId: 'a', title: 'Circuit', status: 'not-submitted', submittedAt: null, late: false, version: null },
      { assignmentId: 'b', title: 'Blink', status: 'needs-work', submittedAt: '2026-09-24', late: true, version: 2 },
    ] }]} />);
    for (const text of ['Not submitted', 'Needs work', 'Version 2', 'Late', 'not verified', 'scope="col"', 'scope="row"', '&lt;Learner&gt;']) expect(html).toContain(text);
    expect(html).not.toContain('<Learner>');
  });
  it('explains empty class and no-assignment states', () => {
    expect(renderToStaticMarkup(<ProgressView rows={[]} />)).toContain('No members yet');
    expect(renderToStaticMarkup(<ProgressView rows={[{ id: 's', name: null, cells: [] }]} />)).toContain('No assignments yet');
  });
});
