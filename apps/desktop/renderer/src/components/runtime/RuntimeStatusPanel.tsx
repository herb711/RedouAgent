import type { RuntimeStatusData } from '../../types';

interface RuntimeStatusPanelProps {
  availability?: unknown;
  runtimeStatus?: RuntimeStatusData | null;
  error?: string | null;
  apiMode?: 'ipc' | 'mock';
}

function readAvailability(availability: unknown) {
  const value = availability as {
    available?: boolean;
    status?: string;
    lastError?: { code?: string; message?: string };
    executablePath?: string;
  } | null;
  return {
    available: Boolean(value && value.available),
    status: value && value.status ? value.status : 'unknown',
    code: value && value.lastError ? value.lastError.code : null,
    message: value && value.lastError ? value.lastError.message : null,
    executablePath: value && value.executablePath ? value.executablePath : null,
  };
}

function shortId(id?: string | null) {
  if (!id) return '';
  return id.length > 18 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id;
}

function usageLabel(usage?: Record<string, unknown> | null) {
  if (!usage) return '';
  const entries = Object.entries(usage).filter(([, value]) => typeof value === 'number') as Array<[string, number]>;
  const total = entries.find(([key]) => /total.*tokens?|tokens.*total|total_tokens/i.test(key));
  if (total) return `${total[1].toLocaleString()} tokens`;
  return entries.slice(0, 2).map(([key, value]) => `${key}: ${value.toLocaleString()}`).join(' / ');
}

export function RuntimeStatusPanel({ availability, runtimeStatus, error, apiMode = 'mock' }: RuntimeStatusPanelProps) {
  const redouCodex = readAvailability(availability);
  const statusLabel = apiMode === 'mock' ? 'mock fallback' : redouCodex.available ? 'available' : 'unavailable';
  const runtimeMessage = error
    || runtimeStatus?.lastError?.message
    || runtimeStatus?.stopReason?.message
    || runtimeStatus?.continuation?.message
    || redouCodex.message
    || (apiMode === 'mock' ? 'Electron preload API is not available.' : '');
  const usage = usageLabel(runtimeStatus?.usage);

  return (
    <section className="redou-inspector-card" aria-label="Runtime status">
      <div className="redou-card-title-row">
        <h3>redou-codex runtime</h3>
        <span>{statusLabel}</span>
      </div>
      <div className="redou-env-list">
        <div>
          <span>Bridge</span>
          <strong>{apiMode === 'ipc' ? 'window.redouApi' : 'mock'}</strong>
        </div>
        <div>
          <span>Availability</span>
          <strong>{redouCodex.status}</strong>
        </div>
        {runtimeStatus?.threadStatus ? (
          <div>
            <span>Thread</span>
            <strong>{runtimeStatus.threadStatus}</strong>
          </div>
        ) : null}
        {runtimeStatus?.turnStatus ? (
          <div>
            <span>Turn</span>
            <strong>{runtimeStatus.turnStatus}</strong>
          </div>
        ) : null}
        {runtimeStatus?.stopReason?.code ? (
          <div>
            <span>Stop reason</span>
            <strong>{runtimeStatus.stopReason.code}</strong>
          </div>
        ) : null}
        {runtimeStatus?.activeTurnId ? (
          <div>
            <span>Active turn</span>
            <strong>{shortId(runtimeStatus.activeTurnId)}</strong>
          </div>
        ) : null}
        {runtimeStatus?.activeItem?.title ? (
          <div>
            <span>Active item</span>
            <strong>{runtimeStatus.activeItem.title}</strong>
          </div>
        ) : null}
        {usage ? (
          <div>
            <span>Usage</span>
            <strong>{usage}</strong>
          </div>
        ) : null}
        {redouCodex.code ? (
          <div>
            <span>Error</span>
            <strong>{redouCodex.code}</strong>
          </div>
        ) : null}
        {redouCodex.executablePath ? (
          <div>
            <span>Executable</span>
            <strong>{redouCodex.executablePath}</strong>
          </div>
        ) : null}
      </div>
      {runtimeMessage ? <p className="redou-runtime-note">{runtimeMessage}</p> : null}
    </section>
  );
}
