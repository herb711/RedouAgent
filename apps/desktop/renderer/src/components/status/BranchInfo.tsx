import { GitBranch } from 'lucide-react';

interface BranchInfoProps {
  branch: string;
}

export function BranchInfo({ branch }: BranchInfoProps) {
  return (
    <div className="redou-branch-info">
      <span>分支</span>
      <strong>
        <GitBranch size={13} />
        {branch}
      </strong>
    </div>
  );
}
