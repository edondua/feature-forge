import { useState } from 'react';
import type { PlanActivity } from '../../types';

interface ActivityFeedProps {
  activities: PlanActivity[];
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ActivityFeed({ activities }: ActivityFeedProps) {
  const [expanded, setExpanded] = useState(false);

  if (activities.length === 0) return null;

  const visible = expanded ? activities : activities.slice(-3);

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
      >
        {expanded ? '▾' : '▸'} Activity ({activities.length})
      </button>
      {visible.map(a => (
        <div key={a.id} className="flex items-start gap-2 text-[10px]">
          <span className="text-muted-foreground/50 whitespace-nowrap">{timeAgo(a.timestamp)}</span>
          <span className="text-muted-foreground">
            <strong className="text-foreground/70">{a.actor}</strong> {a.action}
          </span>
        </div>
      ))}
    </div>
  );
}
