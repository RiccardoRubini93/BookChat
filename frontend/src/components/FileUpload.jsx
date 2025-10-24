import React, { useState } from 'react';
import axios from 'axios';
import './FileUpload.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function FileUpload({ onUpload }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.pdf')) {
      setError('Please select a PDF file');
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post(`${API_URL}/api/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Pass the PDF URL instead of the file object
      const pdfUrl = `${API_URL}/api/pdf/file`;
      onUpload(pdfUrl, response.data);
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.detail || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="file-upload">
      <div className="upload-card">
        <h1>📚 BookChat</h1>
        <p className="subtitle">Chat with your PDF books</p>
        
        <div className="upload-area">
          <input
            type="file"
            id="file-input"
            accept=".pdf"
            onChange={handleFileChange}
            disabled={uploading}
            style={{ display: 'none' }}
          />
          <label htmlFor="file-input" className="upload-button">
            {uploading ? 'Uploading...' : 'Choose PDF File'}
          </label>
        </div>

        {error && <div className="error-message">{error}</div>}
        
        <div className="upload-info">
          <p>Upload a PDF to start chatting</p>
          <ul>
            <li>📄 View your book page by page</li>
            <li>💬 Summarize any page instantly</li>
            <li>🤔 Ask questions about the content</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default FileUpload;
