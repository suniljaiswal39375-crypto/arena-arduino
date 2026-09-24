import type { ClassroomService } from '@/server/classrooms/service';
type Progress = Awaited<ReturnType<ClassroomService['progress']>>;
export type ProgressRows = Array<Omit<Progress[number], 'cells'> & { cells: Array<Omit<Progress[number]['cells'][number], 'submittedAt'> & { submittedAt: string | null }> }>;
const labels: Record<string, string> = { 'not-submitted': 'Not submitted', submitted: 'Awaiting review', reviewed: 'Reviewed', 'needs-work': 'Needs work' };
export function ProgressView({ rows }: { rows: ProgressRows }) {
  const cells = rows.flatMap(row => row.cells);
  const totals = Object.keys(labels).map(status => ({ status, count: cells.filter(cell => cell.status === status).length }));
  return <section className="panel p-5 space-y-4" aria-labelledby="progress-heading">
    <h3 id="progress-heading" className="text-xl font-semibold">Submission progress</h3>
    <p>Snapshot and teacher-review status only—not verified mission completion, skill mastery or a grade. Late means the latest snapshot was uploaded after its advisory due date.</p>
    <ul className="flex flex-wrap gap-4 text-sm" aria-label="Progress totals">{totals.map(total => <li key={total.status}>{labels[total.status]}: <strong>{total.count}</strong></li>)}</ul>
    {rows.length === 0 ? <p>No members yet.</p> : cells.length === 0 ? <p>No assignments yet.</p> :
      <div className="overflow-x-auto" role="region" aria-label="Submission progress table" tabIndex={0}>
        <table className="w-full text-sm text-left"><caption className="sr-only">Current members by assignment; all statuses are written in text, not just colour.</caption>
          <thead><tr><th className="p-3" scope="col">Learner</th>{rows[0]?.cells.map(cell => <th className="p-3 min-w-40" scope="col" key={cell.assignmentId}>{cell.title}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className="border-t border-[var(--color-border)]"><th scope="row" className="p-3">{row.name ?? 'Learner'}</th>
            {row.cells.map(cell => <td className="p-3" key={cell.assignmentId}><span>{labels[cell.status]}</span>{cell.version !== null && <span className="block text-xs">Version {cell.version}{cell.late ? ' · Late' : ''}</span>}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}
