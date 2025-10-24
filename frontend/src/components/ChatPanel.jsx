import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './ChatPanel.css';
import { jsPDF } from 'jspdf';

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

  const handleSummarize = async () => {
    setLoading(true);
    
    // Add user message
    const userMessage = { role: 'user', content: `Summarize page ${currentPage}` };
    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await axios.post(`${API_URL}/api/summarize`, {
        page_number: currentPage,
      });

      setMessages(prev => [...prev, response.data]);
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
    const userMessage = { role: 'user', content: inputValue };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');

    try {
      const response = await axios.post(`${API_URL}/api/analyze`, {
        page_number: currentPage,
        question: inputValue,
      });

      setMessages(prev => [...prev, response.data]);
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
    setMessages([]);
  };

  // Export chat messages + notes as PDF
  const handleExportPdf = async () => {
    try {
      // fetch notes for this file (server returns { notes: { page: {text,x,y,...} } })
      let notesPayload = {};
      if (filename) {
        const res = await axios.get(`${API_URL}/api/notes`, { params: { filename } });
        notesPayload = res.data?.notes || {};
      }

      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const margin = 40;
      const pageWidth = doc.internal.pageSize.getWidth();
      const usableWidth = pageWidth - margin * 2;
      let y = margin;

      const title = `Chat & Notes Export${filename ? ' — ' + filename : ''}`;
      doc.setFontSize(14);
      doc.text(title, margin, y);
      y += 20;
      doc.setFontSize(10);
      doc.text(`Exported: ${new Date().toLocaleString()}`, margin, y);
      y += 24;

      // Chat section
      doc.setFontSize(12);
      doc.text('Chat Messages:', margin, y);
      y += 16;
      doc.setFontSize(10);

      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const prefix = m.role === 'user' ? 'User: ' : 'Assistant: ';
        const lines = doc.splitTextToSize(prefix + (m.content || ''), usableWidth);
        for (let j = 0; j < lines.length; j++) {
          if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
          doc.text(lines[j], margin, y);
          y += 14;
        }
        y += 6;
      }

      // Notes section
      if (Object.keys(notesPayload).length > 0) {
        if (y > doc.internal.pageSize.getHeight() - margin - 60) { doc.addPage(); y = margin; }
        y += 6;
        doc.setFontSize(12);
        doc.text('Notes:', margin, y);
        y += 16;
        doc.setFontSize(10);
        Object.entries(notesPayload).forEach(([page, note]) => {
          const header = `Page ${page}:`;
          const headerLines = doc.splitTextToSize(header, usableWidth);
          headerLines.forEach(hline => { if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; } doc.text(hline, margin, y); y += 14; });
          const textLines = doc.splitTextToSize(note.text || '', usableWidth);
          textLines.forEach(tline => { if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; } doc.text(tline, margin + 10, y); y += 12; });
          y += 6;
        });
      }

      // Finish and save
      const fileBase = filename ? filename.replace(/\.[^/.]+$/, '') : 'bookchat_export';
      doc.save(`${fileBase}-chat-notes.pdf`);
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
    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await axios.post(`${API_URL}/api/text-operation`, {
        operation: operation,
        text: text,
        highlight_id: highlightId,
      });

      // attach highlightId to assistant response if present
      const resp = response.data;
      if (highlightId) resp.highlightId = highlightId;
      setMessages(prev => [...prev, resp]);
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
