import React, { useEffect } from 'react';
import useAppStore from './store/appStore';
import Header from './components/Header';
import CurlInput from './components/CurlInput';
import RequestPreview from './components/RequestPreview';
import ResponseViewer from './components/ResponseViewer';
import ExportModal from './components/ExportModal';
import BulkTransportModal from './components/BulkTransportModal';
import Settings from './components/Settings';
import StatusBar from './components/StatusBar';

function App() {
  const { showSettings, showExportModal, showBulkTransport, activeTab, setConfig, setGoogleAuth } = useAppStore();

  // Load config on mount
  useEffect(() => {
    async function loadConfig() {
      if (!window.switchboard) return; // Dev mode without Electron
      const keys = ['n8nWebhookUrl', 'googleClientId', 'googleClientSecret', 'googleScriptId', 'googleWebAppUrl'];
      const config = {};
      for (const key of keys) {
        config[key] = await window.switchboard.getConfig(key) || '';
      }
      setConfig(config);

      // Check Google auth status
      const authStatus = await window.switchboard.googleAuthCheck();
      setGoogleAuth(authStatus);
    }
    loadConfig();
  }, []);

  return (
    <div className="app">
      <Header />
      <main className="app-main">
        {activeTab === 'input' && (
          <div className="panels">
            <CurlInput />
            <RequestPreview />
          </div>
        )}
        {activeTab === 'response' && <ResponseViewer />}
      </main>
      <StatusBar />
      {showExportModal && <ExportModal />}
      {showBulkTransport && <BulkTransportModal />}
      {showSettings && <Settings />}
    </div>
  );
}

export default App;
