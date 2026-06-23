import React, { useEffect, useState } from 'react';

interface HealthStatus {
  status: string;
  coreAlive: boolean;
  message: string;
}

export default function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.murl.healthCheck()
      .then((data) => {
        setHealth(data);
      })
      .catch((err) => {
        setError(err.message || String(err));
      });
  }, []);

  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#F5F5F5',
      padding: '40px',
      maxWidth: '600px',
      margin: '0 auto'
    }}>
      <h1 style={{ fontWeight: 600, letterSpacing: '-0.02em', fontSize: '24px', marginBottom: '20px' }}>
        Murl Conductor Shell
      </h1>
      
      {error && (
        <div style={{ color: '#FF3333', padding: '16px', border: '1px solid #FF3333', borderRadius: '4px', backgroundColor: 'rgba(255, 51, 51, 0.1)' }}>
          <strong>Error connecting to main process:</strong> {error}
        </div>
      )}

      {health ? (
        <div style={{
          border: '1px solid #333333',
          padding: '24px',
          borderRadius: '6px',
          backgroundColor: '#121212',
          lineHeight: '1.6'
        }}>
          <div><strong>IPC Bridge Status:</strong> {health.status}</div>
          <div><strong>@murl/core Status:</strong> {health.coreAlive ? 'Connected' : 'Disconnected'}</div>
          <div style={{ marginTop: '12px', color: '#888888', fontStyle: 'italic' }}>
            {health.message}
          </div>
        </div>
      ) : (
        !error && <div style={{ color: '#888888' }}>Checking health status...</div>
      )}
    </div>
  );
}
