import { PlugZap, TestTube2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { redouApi } from '../../api/redouApi';

interface McpServer {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  lastTest?: {
    ok: boolean;
    stdout?: string;
    stderr?: string;
    testedAt?: string;
  } | null;
}

export function McpPanel() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [message, setMessage] = useState('');

  function applyResult(data: unknown) {
    setServers(((data as { servers?: McpServer[] })?.servers) || []);
  }

  async function load() {
    const result = await redouApi.listMcpServers();
    if (result.ok) applyResult(result.data);
    else setMessage(result.error?.message || 'Failed to load MCP servers.');
  }

  async function install() {
    const result = await redouApi.installMcpServer({ name, command, args });
    if (!result.ok) {
      setMessage(result.error?.message || 'Failed to install MCP server.');
      return;
    }
    applyResult(result.data);
    setName('');
    setCommand('');
    setArgs('');
  }

  async function remove(server: McpServer) {
    if (!window.confirm(`Remove MCP server "${server.name}"?`)) return;
    const result = await redouApi.removeMcpServer({ name: server.name });
    if (result.ok) applyResult(result.data);
    else setMessage(result.error?.message || 'Failed to remove MCP server.');
  }

  async function test(server: McpServer) {
    const result = await redouApi.testMcpServer({ name: server.name });
    if (result.ok) {
      applyResult(result.data);
      const lastTest = (result.data as { lastTest?: { ok?: boolean } })?.lastTest;
      setMessage(lastTest?.ok ? `${server.name} command found.` : `${server.name} command was not found.`);
    } else {
      setMessage(result.error?.message || 'Failed to test MCP server.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="redou-panel-stack">
      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>MCP servers</h3>
          <PlugZap size={15} />
        </div>
        <div className="redou-compact-form redou-compact-form-stack">
          <input value={name} placeholder="Server name" onChange={(event) => setName(event.target.value)} />
          <input value={command} placeholder="Command" onChange={(event) => setCommand(event.target.value)} />
          <input value={args} placeholder="Args" onChange={(event) => setArgs(event.target.value)} />
          <button className="redou-primary-button" type="button" disabled={!name.trim() || !command.trim()} onClick={() => void install()}>
            <PlugZap size={14} />
            Add server
          </button>
        </div>
        {message ? <p className="redou-muted-copy">{message}</p> : null}
      </section>

      <section className="redou-inspector-card">
        <div className="redou-card-title-row">
          <h3>Configured servers</h3>
          <span>{servers.length}</span>
        </div>
        <div className="redou-resource-list">
          {servers.length ? servers.map((server) => (
            <article className="redou-resource-row redou-resource-row-stack" key={server.name}>
              <div>
                <strong>{server.name}</strong>
                <span>{server.command} {(server.args || []).join(' ')}</span>
                {server.lastTest ? <small>{server.lastTest.ok ? 'Command available' : 'Command missing'}</small> : null}
              </div>
              <button type="button" aria-label="Test MCP server" onClick={() => void test(server)}>
                <TestTube2 size={14} />
              </button>
              <button type="button" aria-label="Remove MCP server" onClick={() => void remove(server)}>
                <Trash2 size={14} />
              </button>
            </article>
          )) : (
            <div className="redou-empty-compact">No MCP servers configured.</div>
          )}
        </div>
      </section>
    </div>
  );
}
