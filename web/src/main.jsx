// The bridge between index.html and React. It finds the empty <div id="root"> and tells
// React to render our App component inside it.

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  // StrictMode is a development-only helper that runs some code twice on purpose to
  // surface bugs early. It does not run in a production build.
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
