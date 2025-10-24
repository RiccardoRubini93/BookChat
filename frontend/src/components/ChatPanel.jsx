import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './ChatPanel.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function ChatPanel({ currentPage }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('ask'); // 'summarize' or 'ask'
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>💬 Chat</h3>
        <div className="header-actions">
          <span className="current-page-badge">Page {currentPage}</span>
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

      <div className="chat-messages">
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
            <div key={index} className={`message ${message.role}`}>
              <div className="message-content">
                {message.content}
              </div>
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
}

export default ChatPanel;
