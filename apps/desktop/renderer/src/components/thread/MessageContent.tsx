import { Check, Code2, Copy, ListChecks, Quote, TerminalSquare } from 'lucide-react';
import { useState, type ReactNode } from 'react';

type MessageBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string; level: number }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'command'; command: string };

interface MessageContentProps {
  body: string;
}

function cleanText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeCodeBlock(info: string, rawCode: string) {
  let language = info.trim().split(/\s+/)[0] || '';
  let code = rawCode.replace(/^\n/, '').replace(/\n$/, '');
  const inlineCodeMatch = !code.trim() && info.trim().match(/^([A-Za-z0-9_+#.-]+)\s+([\s\S]+)$/);
  if (inlineCodeMatch) {
    language = inlineCodeMatch[1];
    code = inlineCodeMatch[2];
  }
  return { language, code };
}

function parsePlainTextBlocks(text: string): MessageBlock[] {
  const lines = cleanText(text).split('\n');
  const blocks: MessageBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quotes: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quotes.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: quotes.join('\n').trim() });
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || ordered) {
      const items: string[] = [];
      const orderedList = Boolean(ordered);
      while (index < lines.length) {
        const item = lines[index].trim().match(orderedList ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/);
        if (!item) break;
        items.push(item[1].trim());
        index += 1;
      }
      blocks.push({ type: 'list', ordered: orderedList, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      const currentTrimmed = current.trim();
      if (!currentTrimmed) break;
      if (/^(#{1,4})\s+/.test(currentTrimmed) || /^>\s?/.test(currentTrimmed) || /^[-*+]\s+/.test(currentTrimmed) || /^\d+[.)]\s+/.test(currentTrimmed)) {
        break;
      }
      paragraph.push(currentTrimmed);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n').trim() });
  }

  return blocks;
}

function parseFencedBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    const before = text.slice(cursor, match.index);
    if (before.trim()) blocks.push(...parsePlainTextBlocks(before));
    const { language, code } = normalizeCodeBlock(match[1] || '', match[2] || '');
    blocks.push({ type: 'code', language, code: code.trim() ? code : match[0].replace(/^```|```$/g, '').trim() });
    cursor = match.index + match[0].length;
  }

  const rest = text.slice(cursor);
  if (rest.trim()) blocks.push(...parsePlainTextBlocks(rest));
  return blocks;
}

function parseMessageBlocks(body: string): MessageBlock[] {
  const text = cleanText(body || '');
  const blocks: MessageBlock[] = [];
  const commandPattern = /<command\b[^>]*>([\s\S]*?)<\/command>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = commandPattern.exec(text)) !== null) {
    const before = text.slice(cursor, match.index);
    if (before.trim()) blocks.push(...parseFencedBlocks(before));
    const command = cleanText(match[1] || '').trim();
    if (command) blocks.push({ type: 'command', command });
    cursor = match.index + match[0].length;
  }

  const rest = text.slice(cursor);
  if (rest.trim()) blocks.push(...parseFencedBlocks(rest));
  return blocks.length ? blocks : [{ type: 'paragraph', text }];
}

function renderPlainText(text: string, keyPrefix: string) {
  const parts = text.split('\n');
  return parts.flatMap((part, index) => (
    index === 0
      ? [part]
      : [<br key={`${keyPrefix}-break-${index}`} />, part]
  ));
}

function InlineMarkdown({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const inlinePattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(text)) !== null) {
    const before = text.slice(cursor, match.index);
    if (before) nodes.push(...renderPlainText(before, `plain-${nodes.length}`));
    if (match[2]) {
      nodes.push(<strong key={`strong-${match.index}`}>{renderPlainText(match[2], `strong-${match.index}`)}</strong>);
    } else if (match[3]) {
      nodes.push(<code key={`code-${match.index}`}>{match[3]}</code>);
    } else if (match[4] && match[5]) {
      nodes.push(
        <a key={`link-${match.index}`} href={match[5]} target="_blank" rel="noreferrer">
          {match[4]}
        </a>,
      );
    }
    cursor = match.index + match[0].length;
  }

  const rest = text.slice(cursor);
  if (rest) nodes.push(...renderPlainText(rest, `plain-${nodes.length}`));
  return <>{nodes}</>;
}

function MessageCodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <figure className="redou-message-code-block">
      <figcaption>
        <span>
          <Code2 size={14} />
          {language || 'code'}
        </span>
        <button type="button" aria-label="复制代码" title="复制代码" onClick={copyCode}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </figcaption>
      <pre><code>{code}</code></pre>
    </figure>
  );
}

function CommandBlock({ command }: { command: string }) {
  return (
    <div className="redou-message-command-block">
      <span className="redou-message-block-icon"><TerminalSquare size={15} /></span>
      <pre>{command}</pre>
    </div>
  );
}

function renderBlock(block: MessageBlock, index: number) {
  if (block.type === 'heading') {
    const HeadingTag = block.level <= 2 ? 'h3' : 'h4';
    return <HeadingTag key={index} className="redou-message-heading"><InlineMarkdown text={block.text} /></HeadingTag>;
  }
  if (block.type === 'list') {
    const ListTag = block.ordered ? 'ol' : 'ul';
    return (
      <div key={index} className="redou-message-list-wrap">
        <span className="redou-message-list-icon"><ListChecks size={15} /></span>
        <ListTag className="redou-message-list">
          {block.items.map((item, itemIndex) => <li key={itemIndex}><InlineMarkdown text={item} /></li>)}
        </ListTag>
      </div>
    );
  }
  if (block.type === 'quote') {
    return (
      <blockquote key={index} className="redou-message-quote">
        <Quote size={15} />
        <p><InlineMarkdown text={block.text} /></p>
      </blockquote>
    );
  }
  if (block.type === 'code') return <MessageCodeBlock key={index} language={block.language} code={block.code} />;
  if (block.type === 'command') return <CommandBlock key={index} command={block.command} />;
  return <p key={index} className="redou-agent-paragraph"><InlineMarkdown text={block.text} /></p>;
}

export function MessageContent({ body }: MessageContentProps) {
  return (
    <div className="redou-agent-content">
      {parseMessageBlocks(body).map(renderBlock)}
    </div>
  );
}
