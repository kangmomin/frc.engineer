// Hub top bar — context label, global search palette, and credit balance.
import { useEffect, useRef, useState } from 'react';
import type { HubTheme } from '../theme';
import type { PlatformSearch } from '../data/platform';
import { flattenSearchResults, isCurrentSearch, isSearchQueryReady, nextSearchIndex, type SearchResult } from '../search';

const MONO = "'JetBrains Mono',monospace";

interface Props {
  t: HubTheme;
  ctx: string;
  credits: number | null;
  walletInitialized?: boolean;
  search: PlatformSearch;
  onSearchSelect: (result: SearchResult) => void;
}

type SearchStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export function TopBar({ t, ctx, credits, walletInitialized, search, onSearchSelect }: Props) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [composing, setComposing] = useState(false);
  const requestSequence = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = 'hub-global-search-results';

  useEffect(() => {
    const trimmed = query.trim();
    if (!isSearchQueryReady(trimmed)) {
      requestSequence.current += 1;
      setResults([]); setStatus('idle'); setActiveIndex(-1);
      return;
    }
    setResults(flattenSearchResults(trimmed, { setups: [], drivers: [] }));
    setStatus('loading'); setOpen(true); setActiveIndex(-1);
    let cancelled = false;
    let controller: AbortController | undefined;
    const timer = window.setTimeout(() => {
      const sequence = ++requestSequence.current;
      controller = new AbortController();
      void search.search(trimmed, controller.signal).then((response) => {
        if (cancelled || !isCurrentSearch(sequence, requestSequence.current)) return;
        const next = flattenSearchResults(trimmed, response);
        setResults(next); setStatus(next.length === 0 ? 'empty' : 'ready');
      }).catch((error: unknown) => {
        if (cancelled || !isCurrentSearch(sequence, requestSequence.current)) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setResults(flattenSearchResults(trimmed, { setups: [], drivers: [] }));
        setStatus('error');
      });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); controller?.abort(); };
  }, [query, search]);

  const select = (result: SearchResult) => {
    onSearchSelect(result); setOpen(false); setActiveIndex(-1); inputRef.current?.focus();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Korean IME uses Enter/arrows to finish or move within composition. They
    // must never select a palette option before the composed value is final.
    if (event.nativeEvent.isComposing || composing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key as 'ArrowDown' | 'ArrowUp';
      if (results.length > 0) { setOpen(true); setActiveIndex((i) => nextSearchIndex(i, results.length, direction)); }
    } else if (event.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault(); select(results[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false); setActiveIndex(-1);
    }
  };
  const statusText = status === 'loading' ? '검색 중…'
    : status === 'empty' ? '일치하는 셋업, 드라이버 또는 트랙이 없습니다.'
      : status === 'error' ? '검색 결과를 불러오지 못했습니다. 트랙 검색은 계속 사용할 수 있습니다.' : '';

  return (
    <header
      className="hubTopBar"
      style={{
        height: 60, flex: 'none', borderBottom: `1px solid ${t.line}`, display: 'flex',
        alignItems: 'center', gap: 18, padding: '0 24px', background: t.rail,
      }}
    >
      <div className="hubTopContext" style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.13em', color: t.t2, fontWeight: 600, whiteSpace: 'nowrap' }}>{ctx}</div>
      <div className="hubSearch" style={{ flex: '1 1 260px', maxWidth: 480, position: 'relative' }}>
        <span className="hubSearchIcon" aria-hidden="true">⌕</span>
        <input ref={inputRef} className="hubSearchInput" value={input}
          onChange={(event) => { setInput(event.target.value); if (!composing) setQuery(event.target.value); }}
          onCompositionStart={() => { setComposing(true); setQuery(''); }}
          onCompositionEnd={(event) => { setComposing(false); setQuery(event.currentTarget.value); }}
          onFocus={() => { if (isSearchQueryReady(query)) setOpen(true); }}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)} onKeyDown={onKeyDown}
          placeholder="셋업 · 드라이버 · 트랙 검색" role="combobox" aria-autocomplete="list"
          aria-expanded={open} aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          aria-label="셋업, 드라이버, 트랙 검색" />
        <div className="hubSearchLive" aria-live="polite">{statusText}</div>
        {open && isSearchQueryReady(query) && (
          <div className="hubSearchPalette" role="presentation">
            {results.length > 0 && <ul id={listboxId} className="hubSearchList" role="listbox" aria-label="검색 결과">
              {results.map((result, index) => <li id={`${listboxId}-${index}`} key={resultKey(result)} role="option"
                aria-selected={index === activeIndex} className={`hubSearchOption${index === activeIndex ? ' is-active' : ''}`}
                onMouseDown={(event) => { event.preventDefault(); select(result); }}><ResultLabel result={result} query={query.trim()} /></li>)}
            </ul>}
            {statusText && <div className="hubSearchState" role={status === 'error' ? 'alert' : 'status'}>{statusText}</div>}
          </div>
        )}
      </div>
      {(credits != null || walletInitialized === false) && (
        <div className="hubCredits" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 13px', background: t.panel2, border: `1px solid ${t.line}`, borderRadius: 9 }}>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: t.accInk, letterSpacing: '.01em' }}>{walletInitialized === false ? '—' : `⬢ ${credits?.toLocaleString('en-US')}`}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: t.t3, fontWeight: 500, letterSpacing: '.05em' }}>{walletInitialized === false ? '미개설' : 'CREDITS'}</span>
        </div>
      )}
    </header>
  );
}

function ResultLabel({ result, query }: { result: SearchResult; query: string }) {
  if (result.type === 'setup') return <><span className="hubSearchKind">SETUP</span><span><Highlighted text={result.card.title} query={query} /><small>{result.card.sellerPersona} · {result.card.gameFormat}</small></span></>;
  if (result.type === 'driver') return <><span className="hubSearchKind">DRIVER</span><span><Highlighted text={result.driver.persona} query={query} /><small>{result.driver.gameFormat}</small></span></>;
  return <><span className="hubSearchKind">TRACK</span><span><Highlighted text={result.track.name} query={query} /><small>{result.track.id >= 39 ? 'F1 26' : 'F1 25 · F1 26'}</small></span></>;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const start = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (start < 0) return <>{text}</>;
  const end = start + query.length;
  return <>{text.slice(0, start)}<mark>{text.slice(start, end)}</mark>{text.slice(end)}</>;
}

function resultKey(result: SearchResult): string {
  if (result.type === 'setup') return `setup-${result.card.id}`;
  if (result.type === 'driver') return `driver-${result.driver.accountId}`;
  return `track-${result.track.id}`;
}
