import { ArrowRight, PlugZap, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { redouApi, type McpServerConfig } from '../../api/redouApi';

export function McpPanel() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const result = await redouApi.listMcpServers().finally(() => setLoading(false));
    if (result.ok) {
      setServers(((result.data as { servers?: McpServerConfig[] } | null)?.servers) || []);
      setMessage('');
    } else {
      setMessage(result.error?.message || 'Failed to load MCP servers.');
    }
  }

  function openMcpCenter() {
    window.dispatchEvent(new CustomEvent('redou:open-extensions', { detail: { kind: 'mcp' } }));
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="redou-panel-stack">
      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>MCP</h3>
          <button className="redou-icon-button" type="button" aria-label="Refresh MCP summary" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} className={loading ? 'redou-spin-icon' : undefined} />
          </button>
        </div>
        <p className="redou-muted-copy">MCP 服务器已移至 插件中心 &gt; MCP 统一管理。</p>
        {message ? <p className="redou-muted-copy">{message}</p> : null}
        <button className="redou-primary-button" type="button" onClick={openMcpCenter}>
          <PlugZap size={14} />
          <span>前往插件中心 &gt; MCP</span>
          <ArrowRight size={14} />
        </button>
      </section>

      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Configured servers</h3>
          <span>{servers.length}</span>
        </div>
        <div className="redou-resource-list">
          {servers.length ? servers.slice(0, 5).map((server) => (
            <article className="redou-resource-row redou-resource-row-stack" key={server.name}>
              <div>
                <strong>{server.name}</strong>
                <span>{server.transport === 'stdio' ? server.command : server.url}</span>
                <small>{server.enabled === false ? 'disabled' : 'ready'}</small>
              </div>
            </article>
          )) : (
            <div className="redou-empty-compact">No MCP servers configured.</div>
          )}
        </div>
      </section>
    </div>
  );
}
