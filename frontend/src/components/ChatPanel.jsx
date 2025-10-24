import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
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
  const [mode, setMode] = useState('ask'); // 'summarize' or 'ask'
  const messagesEndRef = useRef(null);

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
  useEffect(() => {
    let cancelled = false;
    const loadChats = async () => {
      if (!filename) {
        setMessages([]);
        return;
      }
      try {
        const res = await axios.get(`${API_URL}/api/chats`, { params: { filename } });
        if (!cancelled) {
          setMessages(res.data?.messages || []);
        }
      } catch (err) {
        console.warn('Failed to load chats for', filename, err);
        if (!cancelled) setMessages([]);
      }
    };
    loadChats();
    return () => { cancelled = true; };
  }, [filename]);

  // helper to create client-side id for optimistic messages
  const makeClientId = () => `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;

  const replaceMessageByClientId = (clientId, serverMsg) => {
    setMessages(prev => prev.map(m => (m.clientId && m.clientId === clientId) ? serverMsg : m));
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
      const localAssistant = { ...(assistantMsg || {}), clientId: assistantClientId };
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
      const localAssistant = { ...(assistantMsg || {}), clientId: assistantClientId };
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
      const localResp = { ...resp, clientId: assistantClientId };
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

  <div className="chat-messages" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <p>👋 Start a conversation!</p>
            <p className="empty-hint">
              Click "Summarize" to get a summary of the current page,
              or ask a question about the content.
            </p>
          </div>
        ) : (
          messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`} ref={el => messageRefs.current[index] = el}>
              <div className="message-content">
                <ReactMarkdown
                  remarkPlugins={[remarkMath, remarkGfm]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {message.content}
                </ReactMarkdown>
                {message.timestamp && (
                  <div className="message-timestamp">{new Date(message.timestamp).toLocaleString()}</div>
                )}
              </div>
              {message.highlightId && (
                <div className="message-badge" onClick={() => onJumpToHighlight && onJumpToHighlight(message.highlightId)} title="Jump to highlight">
                  🔗 Highlight
                </div>
              )}
            </div>
          ))
        )}
        {loading && (
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
