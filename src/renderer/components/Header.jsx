import React from 'react';
import useAppStore from '../store/appStore';

function Header() {
  const { activeTab, setActiveTab, apiResponse, setShowSettings, resetAll } = useAppStore();

  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <span className="logo-icon">&#x26A1;</span>
          <h1>API Switchboard</h1>
        </div>
      </div>

      <nav className="header-tabs">
        <button
          className={`tab-btn ${activeTab === 'input' ? 'active' : ''}`}
          onClick={() => setActiveTab('input')}
        >
          1. Input
        </button>
        <button
          className={`tab-btn ${activeTab === 'response' ? 'active' : ''}`}
          onClick={() => setActiveTab('response')}
          disabled={!apiResponse}
        >
          2. Response
        </button>
      </nav>

      <div className="header-right">
        <button className="btn btn-ghost" onClick={resetAll} title="Reset All">
          Reset
        </button>
        <button className="btn btn-ghost" onClick={() => setShowSettings(true)} title="Settings">
          Settings
        </button>
      </div>
    </header>
  );
}

export default Header;
