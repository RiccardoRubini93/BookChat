import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './DocumentSidebar.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function DocumentSidebar({ selectedDoc, onSelect }) {
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    async function fetchDocs() {
      try {
        const res = await axios.get(`${API_URL}/api/docs`);
        setDocs(res.data.docs);
      } catch (err) {
        setDocs([]);
      }
    }
    fetchDocs();
  }, [selectedDoc]);

  const handleDelete = async (filename, e) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API_URL}/api/docs`, { params: { filename } });
      setDocs(docs => docs.filter(doc => doc.filename !== filename));
    } catch (err) {
      // Optionally show error
    }
  };

  return (
    <div className="document-sidebar">
      <h4 className="sidebar-title">📚 Documents</h4>
      <ul className="doc-list">
        {docs.length === 0 ? (
          <li className="empty">No documents uploaded</li>
        ) : (
          docs.map(doc => (
            <li 
              key={doc.filename}
              className={`doc-item${doc.filename === selectedDoc ? ' selected' : ''}`}
              onClick={() => onSelect(doc.filename)}
              title={`${doc.filename} (${doc.num_pages} pages)`}
            >
              <span className="doc-name">{doc.filename}</span>
              {doc.chat_count > 0 && (
                <span className="doc-chat-badge" title={`${doc.chat_count} messages`}>{doc.chat_count}</span>
              )}
              <span className="doc-pages">{doc.num_pages} pages</span>
              {doc.last_chat_at && (
                <div className="doc-chat-time">{new Date(doc.last_chat_at).toLocaleString()}</div>
              )}
              <button className="doc-remove" title="Remove document" onClick={e => handleDelete(doc.filename, e)}>
                ×
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export default DocumentSidebar;
