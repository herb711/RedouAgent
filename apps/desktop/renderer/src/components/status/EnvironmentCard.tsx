import { GitBranch, GitPullRequest, HardDrive, Laptop, MoreHorizontal, Settings2 } from 'lucide-react';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import type { EnvironmentInfo } from '../../types';

interface EnvironmentCardProps {
  environment: EnvironmentInfo;
}

export function EnvironmentCard({ environment }: EnvironmentCardProps) {
  return (
    <section className="redou-inspector-card">
      <div className="redou-card-title-row">
        <h3>环境信息</h3>
        <button className="redou-icon-button" type="button" aria-label="Environment settings">
          <Settings2 size={15} />
        </button>
      </div>
      <div className="redou-env-list">
        <div>
          <span>
            <HardDrive size={15} />
            变更
          </span>
          <strong className="redou-change-count">{environment.changes}</strong>
        </div>
        <div>
          <span>
            <Laptop size={15} />
            本地
          </span>
          <RuntimeStatusBadge label={environment.mode} />
        </div>
        <div>
          <span>
            <GitBranch size={15} />
            分支
          </span>
          <strong>{environment.branch}</strong>
        </div>
        <div>
          <span>提交</span>
          <div className="redou-inline-actions">
            <button type="button">{environment.commit}</button>
            <button type="button">推送</button>
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
          <button className="redou-link-button" type="button">{environment.pullRequest}</button>
        </div>
        <div>
          <span>来源</span>
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
