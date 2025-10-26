import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import * as XLSX from 'xlsx';
import 'katex/dist/katex.min.css';
import './ChatPanel.css';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import ReactDOM from 'react-dom/client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const ChatPanel = forwardRef(({ currentPage, highlights = [], onJumpToHighlight, filename }, ref) => {
  const [messages, setMessages] = useState([]);
  const messageRefs = useRef([]);
  const messagesContainerRef = useRef(null);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [visualLoading, setVisualLoading] = useState(false);
  const visualTempMapRef = useRef({}); // tempId -> clientId mapping for visual requests
  const [mode, setMode] = useState('ask'); // 'summarize' or 'ask'
  const messagesEndRef = useRef(null);

  // quick suggestion chips removed

  const scrollToBottom = () => {
    const container = messagesContainerRef.current;
    try {
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    } catch (err) {
      // fallback
      messagesEndRef.current?.scrollIntoView();
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load persisted chat for the current filename
  // Load persisted chat for the current filename
  const loadChats = async () => {
    if (!filename) {
      setMessages([]);
      return;
    }
    try {
      const res = await axios.get(`${API_URL}/api/chats`, { params: { filename } });
      const msgs = (res.data?.messages || []).map(m => ({ ...m, content: convertFormulasToLatex(m.content) }));
      setMessages(msgs);
    } catch (err) {
      console.warn('Failed to load chats for', filename, err);
      setMessages([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    // call loadChats but avoid state update if unmounted
    const run = async () => {
      if (cancelled) return;
      await loadChats();
    };
    run();
    return () => { cancelled = true; };
  }, [filename]);

  // Refresh chat when other components notify of updates (e.g., visual analyze)
  useEffect(() => {
    const handler = () => {
      loadChats().catch(err => console.warn('Failed to reload chats on event', err));
    };
    window.addEventListener('chatUpdated', handler);
    return () => window.removeEventListener('chatUpdated', handler);
  }, [filename]);

  // Convert vision-model-style formula tokens into LaTeX inline math ($...$)
  // Example: transforms `( \rho )` or `( l_1 )` into `$\rho$` and `$l_1$` so remark-math + rehype-katex will render.
  const convertFormulasToLatex = (text) => {
    if (!text || typeof text !== 'string') return text;
    let t = text;
    try {
      // Convert explicit LaTeX delimiters into KaTeX-friendly forms:
      // \[ ... \] -> $$ ... $$  (display math)
      t = t.replace(/\\\[([\s\S]*?)\\\]/g, (m, inner) => `$$${inner.trim()}$$`);

      // \( ... \) -> $ ... $  (inline math)
      t = t.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (m, inner) => `$${inner.trim()}$`);

      // Convert any bracketed LaTeX block like: [ \frac{...} ] (even when embedded in text)
      // into display math $$...$$ so KaTeX will render it. This runs before inline parenthesis conversion.
      t = t.replace(/\[\s*([^\]]*\\[a-zA-Z]+[^\]]*)\s*\]/g, (m, inner) => {
        return `$$${inner.trim()}$$`;
      });

      // Replace parenthesized tokens that contain backslash (\), underscore (_), or caret (^) with inline math
      t = t.replace(/\(\s*([^()]{1,80}[_\^\\][^()]*)\s*\)/g, (m, p1) => {
        // clean whitespace inside
        const inner = p1.trim();
        return `$${inner}$`;
      });

      // Also wrap common LaTeX commands that may appear without parentheses, e.g. \rho, \epsilon
      // Avoid double-wrapping if already inside $...$
      t = t.replace(/(^|[^$])((?:\\[a-zA-Z]+))(?![^$]*\$)/g, (m, before, cmd) => {
        // if already preceded by a $ then skip
        if (before && before.endsWith('$')) return m;
        return `${before}$${cmd}$`;
      });
    } catch (err) {
      return text;
    }
    return t;
  };

  // Remove surrounding $ or $$ delimiters if present and trim whitespace
  const stripMathDelimiters = (s) => {
    if (!s || typeof s !== 'string') return s || '';
    let t = s.trim();
    // remove wrapping $$ ... $$
    if (t.startsWith('$$') && t.endsWith('$$')) {
      t = t.slice(2, -2).trim();
      return t;
    }
    // remove wrapping single $ ... $
    if (t.startsWith('$') && t.endsWith('$')) {
      t = t.slice(1, -1).trim();
      return t;
    }
    return t;
  };

  // Simple CSV parser that handles quoted fields (basic implementation)
  const parseCsv = (csv) => {
    if (!csv) return [];
    const rows = [];
    const lines = csv.split(/\r?\n/);
    for (let line of lines) {
      if (line.trim() === '') continue;
      const cells = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i+1] === '"') { cur += '"'; i++; } else { inQuotes = !inQuotes; }
          continue;
        }
        if (ch === ',' && !inQuotes) { cells.push(cur); cur = ''; continue; }
        cur += ch;
      }
      cells.push(cur);
      rows.push(cells);
    }
    return rows;
  };

  const downloadContent = (content, filename, mime='text/plain') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  // Convert structured JSON like { "n": [...], "POD": [...], ... } into tabular rows (array-of-arrays)
  const structuredJsonToRows = (obj) => {
    if (!obj || typeof obj !== 'object') return [];
    // keys order: keep the order as provided by Object.keys
    const keys = Object.keys(obj);
    // if values are arrays, determine max length
    let maxLen = 0;
    const cols = keys.map(k => {
      const v = obj[k];
      if (Array.isArray(v)) { maxLen = Math.max(maxLen, v.length); return v; }
      // if single value, treat as array of length 1
      return [v];
    });
    const rows = [];
    // header
    rows.push(keys);
    for (let i = 0; i < maxLen; i++) {
      const row = keys.map((k, ci) => {
        const col = cols[ci];
        let val = (col && i < col.length) ? col[i] : '';
        if (val === null || typeof val === 'undefined') return '';
        return String(val);
      });
      rows.push(row);
    }
    return rows;
  };

  const rowsToCsv = (rows) => {
    if (!rows || rows.length === 0) return '';
    return rows.map(r => r.map(cell => {
      if (cell == null) return '';
      const s = String(cell);
      if (s.includes(',') || s.includes('\n') || s.includes('"')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')).join('\n');
  };

  const exportToExcel = (rows, filename = 'table.xlsx') => {
    try {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error('Failed to export Excel', err);
      // fallback: download CSV
      const csv = rowsToCsv(rows);
      downloadContent(csv, filename.replace(/\.xlsx?$/i, '.csv'), 'text/csv');
    }
  };

  // Build rows array from a message's structured payload (CSV, table, rows or JSON)
  const getRowsFromMessage = (message) => {
    if (!message || !message.structured) return [];
    const s = message.structured;
    if (s.csv) return parseCsv(s.csv);
    if (s.rows) return s.rows;
    if (s.table) return s.table;
    if (s.json || s.structured) {
      // if message.structured contains nested json payload under 'json' key or is itself the object
      const candidate = s.json ? (typeof s.json === 'string' ? (() => { try { return JSON.parse(s.json); } catch { return s.json; } })() : s.json) : s;
      if (candidate && typeof candidate === 'object') {
        return structuredJsonToRows(candidate);
      }
    }
    return [];
  };

  // Listen for visual selection lifecycle events (from PDFViewer)
  useEffect(() => {
    const onStart = (e) => {
      const tempId = e?.detail?.tempId || `visual-${Date.now()}`;
      const question = e?.detail?.question || '';
      const clientId = makeClientId();
      visualTempMapRef.current[tempId] = clientId;
      // append temporary assistant message
      const tempMsg = { role: 'assistant', content: 'Thinking...', clientId, timestamp: new Date().toISOString() };
      setMessages(prev => [...prev, tempMsg]);
      setVisualLoading(true);
    };

    const onFinish = (e) => {
      const tempId = e?.detail?.tempId;
      const clientId = tempId ? visualTempMapRef.current[tempId] : null;
      if (clientId) {
        // remove temporary assistant message
        setMessages(prev => prev.filter(m => !(m.clientId && m.clientId === clientId)));
        delete visualTempMapRef.current[tempId];
      }
      setVisualLoading(false);
      // reload persisted chats from server
      loadChats().catch(err => console.warn('Failed to reload chats after visual finish', err));
    };

    window.addEventListener('visualRequestStarted', onStart);
    window.addEventListener('visualRequestFinished', onFinish);
    // immediate response fallback: append assistant message if backend returned content
    const onResponse = (e) => {
      const data = e?.detail;
      if (!data) return;
      // data may include { role, content, message, metadata }
      const content = data.content || (data.message && data.message.content) || null;
      if (!content) return;
      // avoid duplicating similar content
      const processed = convertFormulasToLatex(content);
      const exists = messages.some(m => (m.content || '').trim() === (processed || '').trim());
      if (!exists) {
        const assistantMsg = {
          role: 'assistant',
          content: processed,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
    };
    window.addEventListener('visualResponse', onResponse);
    return () => {
      window.removeEventListener('visualRequestStarted', onStart);
      window.removeEventListener('visualRequestFinished', onFinish);
      window.removeEventListener('visualResponse', onResponse);
    };
  }, [filename]);

  // helper to create client-side id for optimistic messages
  const makeClientId = () => `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;

  const replaceMessageByClientId = (clientId, serverMsg) => {
    const processed = serverMsg && serverMsg.content ? { ...serverMsg, content: convertFormulasToLatex(serverMsg.content) } : serverMsg;
    setMessages(prev => prev.map(m => (m.clientId && m.clientId === clientId) ? processed : m));
  };

  const handleSummarize = async () => {
    setLoading(true);
    
    // Add user message
    const clientId = makeClientId();
    const userMessage = { role: 'user', content: `Summarize page ${currentPage}`, clientId };
    setMessages(prev => [...prev, userMessage]);
    // persist user message (include client_id so server echoes it back)
    let serverUserMsg = null;
    if (filename) {
      try {
        const form = new FormData();
        form.append('filename', filename);
        form.append('role', userMessage.role);
        form.append('content', userMessage.content);
        form.append('client_id', clientId);
        const res = await axios.post(`${API_URL}/api/chats`, form);
        serverUserMsg = res.data?.message;
        if (serverUserMsg) replaceMessageByClientId(clientId, serverUserMsg);
      } catch (err) {
        console.warn('Failed to persist user summarize message', err);
      }
    }

    try {
      const response = await axios.post(`${API_URL}/api/summarize`, {
        page_number: currentPage,
      });

      const assistantMsg = response.data;
      // append assistant message locally with a temp clientId so we can replace it with server version
      const assistantClientId = makeClientId();
  const localAssistant = { ...(assistantMsg || {}), clientId: assistantClientId, content: convertFormulasToLatex(assistantMsg?.content || '') };
      setMessages(prev => [...prev, localAssistant]);
      // persist assistant message and replace local copy with server-returned message
      if (filename) {
        try {
          const form = new FormData();
          form.append('filename', filename);
          form.append('role', localAssistant.role || 'assistant');
          form.append('content', localAssistant.content || '');
          form.append('client_id', assistantClientId);
          const res = await axios.post(`${API_URL}/api/chats`, form);
          const serverAssistant = res.data?.message;
          if (serverAssistant) replaceMessageByClientId(assistantClientId, serverAssistant);
        } catch (err) {
          console.warn('Failed to persist assistant summarize message', err);
        }
      }
    } catch (error) {
      console.error('Summarize error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error while summarizing the page.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!inputValue.trim()) return;

    setLoading(true);
    
    // Add user message
    const clientId = makeClientId();
    const userMessage = { role: 'user', content: inputValue, clientId };
    setMessages(prev => [...prev, userMessage]);
    // persist user message
    if (filename) {
      try {
        const form = new FormData();
        form.append('filename', filename);
        form.append('role', userMessage.role);
        form.append('content', userMessage.content);
        form.append('client_id', clientId);
        const res = await axios.post(`${API_URL}/api/chats`, form);
        const serverUserMsg = res.data?.message;
        if (serverUserMsg) replaceMessageByClientId(clientId, serverUserMsg);
      } catch (err) {
        console.warn('Failed to persist user analyze message', err);
      }
    }
    setInputValue('');

    try {
      const response = await axios.post(`${API_URL}/api/analyze`, {
        page_number: currentPage,
        question: inputValue,
      });

      const assistantMsg = response.data;
      const assistantClientId = makeClientId();
  const localAssistant = { ...(assistantMsg || {}), clientId: assistantClientId, content: convertFormulasToLatex(assistantMsg?.content || '') };
      setMessages(prev => [...prev, localAssistant]);
      if (filename) {
        try {
          const form = new FormData();
          form.append('filename', filename);
          form.append('role', localAssistant.role || 'assistant');
          form.append('content', localAssistant.content || '');
          form.append('client_id', assistantClientId);
          const res = await axios.post(`${API_URL}/api/chats`, form);
          const serverAssistant = res.data?.message;
          if (serverAssistant) replaceMessageByClientId(assistantClientId, serverAssistant);
        } catch (err) {
          console.warn('Failed to persist assistant analyze message', err);
        }
      }
    } catch (error) {
      console.error('Analyze error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error while analyzing the page.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAnalyze();
    }
  };

  const handleResetChat = () => {
    // clear local state and server-side chat for this file
    setMessages([]);
    if (filename) {
      axios.delete(`${API_URL}/api/chats`, { params: { filename } }).catch(err => console.warn('Failed to clear chats', err));
    }
  };

  // Copy message content to clipboard (client-side)
  const copyMessageToClipboard = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      // optional: small visual feedback could be added later
    } catch (err) {
      // fallback: create a textarea and copy
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
  };

  // Export chat messages + notes as PDF
  const handleExportPdf = async () => {
    try {
      // Fetch notes for this file
      let notesPayload = {};
      if (filename) {
        // Use a relative path so the request goes to the same origin / proxy as other frontend calls
        // (avoids mismatches between absolute API_URL and the dev server proxy or container host).
          try {
          const res = await axios.get(`${API_URL}/api/notes`, { params: { filename } });
          notesPayload = res.data?.notes || {};
        } catch (err) {
          console.warn('Failed to fetch notes for export:', err);
          notesPayload = {};
        }
      }

      // Create an off-screen container and render the export HTML using React so Markdown + KaTeX render correctly
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.padding = '24px';
      container.style.background = 'white';
      container.style.color = '#222';
      container.style.fontFamily = 'Arial, Helvetica, sans-serif';
      container.style.boxSizing = 'border-box';
      container.style.lineHeight = '1.4';
      container.style.fontSize = '12px';
      container.style.position = 'fixed';
      container.style.left = '-10000px';
      container.style.top = '0';
      document.body.appendChild(container);

      // Render React content into container
      const root = ReactDOM.createRoot(container);
      const ExportContent = () => (
        <div style={{ width: '100%' }}>
          <h2 style={{ margin: '0 0 8px 0' }}>{`Chat & Notes Export${filename ? ' — ' + filename : ''}`}</h2>
          <div style={{ fontSize: '10px', color: '#666', marginBottom: 12 }}>{`Exported: ${new Date().toLocaleString()}`}</div>

          <h3 style={{ fontSize: '14px', margin: '18px 0 8px' }}>Chat</h3>
          <div>
            {messages.map((m, idx) => (
              <div key={idx} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: m.role === 'user' ? '#0b5ed7' : '#333' }}>{m.role === 'user' ? 'User' : 'Assistant'}</div>
                <div style={{ marginTop: 4 }}>
                  <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{m.content}</ReactMarkdown>
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: '14px', margin: '18px 0 8px' }}>Notes</h3>
          <div>
            {Object.entries(notesPayload).length === 0 ? (
              <div style={{ color: '#666' }}>No notes available.</div>
            ) : (
              Object.entries(notesPayload).map(([page, note]) => (
                <div key={page} style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Page {page}</div>
                  <div style={{ marginLeft: 6 }}>
                    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{note.text || ''}</ReactMarkdown>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      );

      root.render(<ExportContent />);

      // Wait a bit for KaTeX/math to render
      await new Promise(res => setTimeout(res, 600));

      // Capture with html2canvas at 2x scale for better quality
      const canvas = await html2canvas(container, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');

      // Create PDF with jsPDF and add image, split into pages if necessary
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Calculate image dims (canvas is in px; convert to points roughly by 0.75 factor if needed)
      const imgProps = { width: canvas.width, height: canvas.height };
      const ratio = imgProps.width / imgProps.height;
      const pdfWidth = pageWidth - 40; // margin 20 left/right
      const pdfHeight = pdfWidth / ratio;

      let remainingHeight = imgProps.height;
      let offsetY = 0;
      const pxPerPt = canvas.width / pdfWidth; // pixels per pdf pt

      while (remainingHeight > 0) {
        const sY = offsetY;
        const sH = Math.min(imgProps.height - offsetY, Math.floor(pageHeight * pxPerPt - 40 * pxPerPt));
        // create temporary canvas slice
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = imgProps.width;
        tmpCanvas.height = sH;
        const tCtx = tmpCanvas.getContext('2d');
        tCtx.drawImage(canvas, 0, sY, imgProps.width, sH, 0, 0, imgProps.width, sH);
        const tmpData = tmpCanvas.toDataURL('image/png');

        if (offsetY > 0) doc.addPage();
        doc.addImage(tmpData, 'PNG', 20, 20, pdfWidth, (sH / pxPerPt) );

        offsetY += sH;
        remainingHeight -= sH;
      }

      const fileBase = filename ? filename.replace(/\.[^/.]+$/, '') : 'bookchat_export';
      doc.save(`${fileBase}-chat-notes.pdf`);

      // cleanup
      try { root.unmount(); } catch (err) {}
      document.body.removeChild(container);
    } catch (err) {
      console.error('Export PDF failed', err);
      alert('Failed to export PDF. See console for details.');
    }
  };

  // accept optional highlightId when invoked from PDFViewer
  const handleTextOperationInternal = async (operation, text, highlightId = null) => {
    setLoading(true);
    
    // Add user message showing what operation was requested
    const operationLabels = {
      summarize: '📝 Summarize',
      rephrase: '✍️ Rephrase',
      explain: '💡 Explain'
    };
    
    const userMessage = { 
      role: 'user', 
      content: `${operationLabels[operation]}: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`,
      highlightId: highlightId || undefined,
    };
    const clientId = makeClientId();
    const userMsgWithId = { ...userMessage, clientId };
    setMessages(prev => [...prev, userMsgWithId]);
    if (filename) {
      try {
        const form = new FormData();
        form.append('filename', filename);
        form.append('role', userMsgWithId.role);
        form.append('content', userMsgWithId.content);
        if (highlightId) form.append('highlightId', highlightId);
        form.append('client_id', clientId);
        const res = await axios.post(`${API_URL}/api/chats`, form);
        const serverUser = res.data?.message;
        if (serverUser) replaceMessageByClientId(clientId, serverUser);
      } catch (err) {
        console.warn('Failed to persist user text-operation message', err);
      }
    }

    try {
      const response = await axios.post(`${API_URL}/api/text-operation`, {
        operation: operation,
        text: text,
        highlight_id: highlightId,
      });

      // attach highlightId to assistant response if present
  const resp = response.data;
  if (highlightId) resp.highlightId = highlightId;
  const assistantClientId = makeClientId();
  const localResp = { ...resp, clientId: assistantClientId, content: convertFormulasToLatex(resp?.content || '') };
  setMessages(prev => [...prev, localResp]);
      if (filename) {
        try {
          const form = new FormData();
          form.append('filename', filename);
          form.append('role', localResp.role || 'assistant');
          form.append('content', localResp.content || '');
          if (localResp.highlightId) form.append('highlightId', localResp.highlightId);
          form.append('client_id', assistantClientId);
          const res2 = await axios.post(`${API_URL}/api/chats`, form);
          const serverAssistant = res2.data?.message;
          if (serverAssistant) replaceMessageByClientId(assistantClientId, serverAssistant);
        } catch (err) {
          console.warn('Failed to persist assistant text-operation message', err);
        }
      }
    } catch (error) {
      console.error('Text operation error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error while processing the text.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  // Expose the handleTextOperation method to parent component
  useImperativeHandle(ref, () => ({
    handleTextOperation: handleTextOperationInternal,
    openMessagesForHighlight: (highlightId) => {
      // find first message with matching highlightId
      const idx = messages.findIndex(m => m.highlightId === highlightId);
      if (idx >= 0) {
        const el = messageRefs.current[idx];
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }));

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>💬 Chat</h3>
        <div className="header-actions">
          <span className="current-page-badge">Page {currentPage}</span>
          <button
            onClick={handleExportPdf}
            className="export-button"
            title="Export chat and notes to PDF"
          >
            ⤓ Export PDF
          </button>
          {messages.length > 0 && (
            <button 
              onClick={handleResetChat}
              className="reset-button"
              title="Clear chat history"
            >
              🗑️ Reset
            </button>
          )}
        </div>
      </div>

      {/* top quick-actions removed */}

  <div className="chat-messages" ref={messagesContainerRef}>
        {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`} ref={el => messageRefs.current[index] = el}>
                {/* avatar initials (clickable if highlightId present) */}
                <button
                  className="avatar"
                  onClick={() => message.highlightId && onJumpToHighlight && onJumpToHighlight(message.highlightId)}
                  aria-hidden={!message.highlightId}
                  title={message.highlightId ? 'Go to highlight' : (message.role === 'assistant' ? 'Assistant' : 'You')}
                >
                  {message.role === 'user' ? 'Me' : 'AI'}
                </button>
                <div className="message-content">
                <ReactMarkdown
                  remarkPlugins={[remarkMath, remarkGfm]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {message.content}
                </ReactMarkdown>

                {/* Structured table or CSV preview (if backend returned structured.csv or structured.table) */}
                {message.structured && (message.structured.csv || message.structured.table || message.structured.rows || message.structured.json) && (() => {
                  const csv = message.structured.csv;
                  let rows = [];
                  if (message.structured.json) {
                    try {
                      const raw = message.structured.json;
                      const parsed = (typeof raw === 'string') ? JSON.parse(raw) : raw;
                      rows = structuredJsonToRows(parsed);
                    } catch (err) {
                      console.warn('Failed to parse structured.json', err);
                      rows = [];
                    }
                  } else if (csv) rows = parseCsv(csv);
                  else if (message.structured.table) rows = message.structured.table;
                  else if (message.structured.rows) rows = message.structured.rows;

                  const headers = rows.length > 0 ? rows[0] : [];
                  const bodyRows = rows.length > 1 ? rows.slice(1) : [];

                  return (
                    <div className="structured-csv" style={{ marginTop: 8, border: '1px solid #eee', padding: 8, borderRadius: 6, background: '#fafafa' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Extracted table</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="msg-btn" onClick={() => {
                            const outCsv = csv ? csv : rowsToCsv(rows);
                            downloadContent(outCsv, `${filename || 'table'}.csv`, 'text/csv');
                          }}>Download CSV</button>
                          <button className="msg-btn" onClick={() => exportToExcel(rows, `${filename || 'table'}.xlsx`)}>Download Excel</button>
                          <button className="msg-btn" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(csv || rowsToCsv(rows)); }}>Copy</button>
                        </div>
                      </div>

                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                          <thead>
                            <tr>
                              {headers.map((h, i) => (
                                <th key={i} style={{ textAlign: 'left', borderBottom: '1px solid #e6e6e6', padding: '6px 8px', background: '#fff' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {bodyRows.map((r, ri) => (
                              <tr key={ri}>
                                {r.map((c, ci) => (
                                  <td key={ci} style={{ padding: '6px 8px', borderBottom: '1px solid #f2f2f2' }}>{c}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* Structured formulas (if backend returned structured.formulas) - render as LaTeX display math */}
                {message.structured && message.structured.formulas && Array.isArray(message.structured.formulas) && (
                  <div className="structured-formulas" style={{ marginTop: 12, border: '1px solid #eee', padding: 10, borderRadius: 6, background: '#fffdf7' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Extracted formulas</div>
                    {message.structured.formulas.map((f, idx) => (
                      <div key={idx} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, color: '#444', marginBottom: 6, fontWeight: 600 }}>{f.variable || `formula ${idx+1}`}</div>
                        <div style={{ background: 'transparent', padding: 6 }}>
                          {(() => {
                            const raw = (f.expression || f.latex || f.expr || '').toString();
                            const clean = stripMathDelimiters(raw);
                            return (
                              <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{`$$${clean}$$`}</ReactMarkdown>
                            );
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quote / thumbnail preview (UI-only): render when backend includes page/thumbnail/quote fields */}
                {(message.page || message.thumbnailUrl || message.quote) && (
                  <div
                    className="quote-card"
                    onClick={() => {
                      // if highlight jump is available, reuse it; otherwise try page-based jump if provided
                      if (message.highlightId && onJumpToHighlight) onJumpToHighlight(message.highlightId);
                    }}
                    title={message.quote ? 'Open referenced page' : 'Preview page'}
                  >
                    <div className="quote-thumb">
                      {message.thumbnailUrl ? (
                        <img src={message.thumbnailUrl} alt={`Page ${message.page || ''}`} />
                      ) : (
                        <div className="thumb-placeholder">{message.page ? `Page ${message.page}` : 'Preview'}</div>
                      )}
                    </div>
                    <div className="quote-body">
                      <div className="quote-text">{message.quote || message.excerpt || ''}</div>
                      {message.page && <div className="quote-meta">Page {message.page}</div>}
                    </div>
                  </div>
                )}
                <div className="message-meta">
                  {message.timestamp && (
                    <span className="message-timestamp">{new Date(message.timestamp).toLocaleString()}</span>
                  )}
                </div>
              </div>

                <div className="message-actions">
                  <button className="msg-btn copy-btn" onClick={() => copyMessageToClipboard(message.content)} aria-label="Copy message">
                    <span className="icon">📋</span>
                  </button>
                  {message.highlightId && (
                    <button className="msg-btn goto-btn" onClick={() => onJumpToHighlight && onJumpToHighlight(message.highlightId)} aria-label="Go to highlight">
                      <span className="icon">🔗</span>
                    </button>
                  )}
                </div>
            </div>
          ))
        }
        {(loading || visualLoading) && (
          <div className="message assistant">
            <div className="message-content loading-message">
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <button 
          onClick={handleSummarize} 
          disabled={loading}
          className="action-button summarize-button"
        >
          📝 Summarize Page
        </button>

        <div className="input-group">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask a question about this page..."
            disabled={loading}
            rows="3"
            className="chat-input"
          />
          <button 
            onClick={handleAnalyze} 
            disabled={loading || !inputValue.trim()}
            className="send-button"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
});

ChatPanel.displayName = 'ChatPanel';

export default ChatPanel;
