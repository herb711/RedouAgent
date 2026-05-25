import { ArrowLeft, Camera, ExternalLink, PanelTopOpen, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BrowserData } from '../types';

interface BrowserPageProps {
  browser: BrowserData;
  onBack: () => void;
  onNavigate: (url: string) => void;
  onOpenExternal: (url?: string) => Promise<void>;
  onPopout: (url?: string) => Promise<void>;
  onCaptureScreenshot: (comment: string) => Promise<void>;
}

function normalizeBrowserUrl(value: string, fallback: string) {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function BrowserPage({
  browser,
  onBack,
  onNavigate,
  onOpenExternal,
  onPopout,
  onCaptureScreenshot,
}: BrowserPageProps) {
  const [address, setAddress] = useState(browser.url || browser.homeUrl);
  const url = browser.url || browser.homeUrl;

  useEffect(() => {
    setAddress(url);
  }, [url]);

  function submitAddress() {
    onNavigate(normalizeBrowserUrl(address, browser.homeUrl));
  }

  async function captureComment() {
    const comment = window.prompt('截图评论', '');
    if (comment === null) return;
    await onCaptureScreenshot(comment);
  }

  return (
    <main className="redou-browser-page" aria-label="In-app browser">
      <header className="redou-browser-toolbar">
        <button className="redou-icon-button" type="button" aria-label="Back to thread" title="返回线程" onClick={onBack}>
          <ArrowLeft size={17} />
        </button>
        <form
          className="redou-browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            submitAddress();
          }}
        >
          <input
            value={address}
            aria-label="Browser URL"
            onChange={(event) => setAddress(event.target.value)}
          />
          <button type="submit" aria-label="Navigate" title="打开">
            <RotateCw size={15} />
          </button>
        </form>
        <div className="redou-browser-actions">
          <button className="redou-icon-button" type="button" aria-label="Capture screenshot comment" title="截图评论" onClick={() => void captureComment()}>
            <Camera size={16} />
          </button>
          <button className="redou-icon-button" type="button" aria-label="Pop out browser" title="弹出窗口" onClick={() => void onPopout(url)}>
            <PanelTopOpen size={16} />
          </button>
          <button className="redou-icon-button" type="button" aria-label="Open external browser" title="外部打开" onClick={() => void onOpenExternal(url)}>
            <ExternalLink size={16} />
          </button>
        </div>
      </header>
      <section className="redou-browser-frame" data-status={browser.status || 'ready'}>
        <webview src={url} allowpopups="true" partition="persist:redou-browser" />
      </section>
    </main>
  );
}
