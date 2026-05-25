import { GitBranch, GitPullRequest, HardDrive, Laptop, MoreHorizontal, Settings2 } from 'lucide-react';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import type { EnvironmentInfo } from '../../types';

interface EnvironmentCardProps {
  environment: EnvironmentInfo;
  onCommitGitChanges?: () => Promise<void>;
  onPushGitBranch?: () => Promise<void>;
  onCreatePullRequest?: () => Promise<void>;
}

export function EnvironmentCard({ environment, onCommitGitChanges, onPushGitBranch, onCreatePullRequest }: EnvironmentCardProps) {
  return (
    <section className="redou-inspector-card">
      <div className="redou-card-title-row">
        <h3>Environment</h3>
        <button className="redou-icon-button" type="button" aria-label="Environment settings">
          <Settings2 size={15} />
        </button>
      </div>
      <div className="redou-env-list">
        <div>
          <span>
            <HardDrive size={15} />
            Changes
          </span>
          <strong className="redou-change-count">{environment.changes}</strong>
        </div>
        <div>
          <span>
            <Laptop size={15} />
            Local
          </span>
          <RuntimeStatusBadge label={environment.mode} />
        </div>
        <div>
          <span>
            <GitBranch size={15} />
            Branch
          </span>
          <strong>{environment.branch}</strong>
        </div>
        <div>
          <span>Commit</span>
          <div className="redou-inline-actions">
            <button type="button" disabled={!onCommitGitChanges} onClick={onCommitGitChanges}>{environment.commit}</button>
            <button type="button" disabled={!onPushGitBranch} onClick={onPushGitBranch}>Push</button>
            <button type="button" aria-label="More Git actions">
              <MoreHorizontal size={14} />
            </button>
          </div>
        </div>
        <div>
          <span>
            <GitPullRequest size={15} />
            PR
          </span>
          <button className="redou-link-button" type="button" disabled={!onCreatePullRequest} onClick={onCreatePullRequest}>{environment.pullRequest}</button>
        </div>
        <div>
          <span>Source</span>
          <strong>{environment.source}</strong>
        </div>
        {environment.threadId ? (
          <div>
            <span>Thread</span>
            <strong>{environment.threadId}</strong>
          </div>
        ) : null}
        {environment.turnId ? (
          <div>
            <span>Turn</span>
            <strong>{environment.turnId}</strong>
          </div>
        ) : null}
      </div>
    </section>
  );
}
