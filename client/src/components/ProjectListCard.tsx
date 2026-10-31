import { Link } from 'react-router-dom';
import type { Project, BasketMember } from '../types';
import { deriveBasketTotal, deriveCompositeVerdict } from '../lib/basket';
import { VerdictPill } from './VerdictPill';
import { formatMoney } from '../lib/money'
import { t, ago } from '../lib/i18n'

interface Props {
  project: Project;
  members: BasketMember[];
  lastAlertAt: string | null;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso + 'Z').getTime();
  const min = Math.round(ms / 60000);
  if (min < 60) return ago(min, 'm');
  const hr = Math.round(min / 60);
  if (hr < 48) return ago(hr, 'h');
  return ago(Math.round(hr / 24), 'd');
}

export function ProjectListCard({ project, members, lastAlertAt }: Props) {
  const total = deriveBasketTotal(members);
  const verdict = deriveCompositeVerdict(project, members);
  const pct = total !== null ? Math.min(100, Math.round((total / project.target_total) * 100)) : 0;

  return (
    <Link
      to={`/projects/${project.id}`}
      className="block rounded-lg border border-border bg-surface p-4 hover:border-primary transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-text">{project.name}</h3>
        <VerdictPill tier={verdict} reason={null} size="sm" />
      </div>
      <div className="text-sm text-text-muted mb-2">
        {members.length} {members.length === 1 ? 'item' : 'items'} ·{' '}
        {total !== null ? `${formatMoney(total)}` : '—'} / {formatMoney(project.target_total)} {t('target')}
      </div>
      <div className="w-full h-2 bg-bg rounded overflow-hidden mb-2">
        <div
          className={`h-full transition-all ${verdict === 'BUY' ? 'bg-success' : verdict === 'WAIT' ? 'bg-warning' : 'bg-text-muted'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-text-muted">
        {lastAlertAt ? `Last alert: ${formatRelative(lastAlertAt)}` : t('No alerts yet')}
      </div>
    </Link>
  );
}
