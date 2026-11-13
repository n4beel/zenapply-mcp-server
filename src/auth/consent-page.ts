export function renderConsentPage(params: {
  clientId: string;
  clientName?: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  error?: string;
}): string {
  const { clientId, clientName, redirectUri, state, codeChallenge, error } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZenApply MCP — Connect Client</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f4f6f8;
      color: #1a202c;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: white;
      padding: 32px;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      width: 100%;
      max-width: 440px;
    }
    h1 {
      font-size: 20px;
      font-weight: 600;
      margin-top: 0;
      margin-bottom: 8px;
    }
    p {
      font-size: 14px;
      color: #4a5568;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .error {
      background: #fff5f5;
      border: 1px solid #feb2b2;
      color: #c53030;
      padding: 12px;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 20px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 6px;
      color: #2d3748;
    }
    input[type="text"] {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #cbd5e0;
      border-radius: 6px;
      font-size: 15px;
      box-sizing: border-box;
      margin-bottom: 20px;
      font-family: monospace;
      letter-spacing: 1px;
    }
    input[type="text"]:focus {
      outline: none;
      border-color: #3182ce;
      box-shadow: 0 0 0 1px #3182ce;
    }
    button {
      width: 100%;
      background: #2b6cb0;
      color: white;
      border: none;
      padding: 12px;
      border-radius: 6px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    button:hover {
      background: #2c5282;
    }
    .client-info {
      background: #edf2f7;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 12px;
      color: #4a5568;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize MCP Client</h1>
    <p>Enter the one-time enrollment code minted via the ZenApply MCP CLI to connect <strong>${escapeHtml(clientName || clientId)}</strong>.</p>
    
    <div class="client-info">
      <div><strong>Client:</strong> ${escapeHtml(clientName || clientId)}</div>
      <div><strong>Redirect:</strong> ${escapeHtml(redirectUri)}</div>
    </div>

    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}

    <form method="POST" action="/authorize/consent">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
      ${state ? `<input type="hidden" name="state" value="${escapeHtml(state)}">` : ''}
      
      <label for="enrollment_code">One-time Enrollment Code</label>
      <input type="text" id="enrollment_code" name="enrollment_code" required autofocus placeholder="e.g. 7f8a9b2c..." autocomplete="off">
      
      <button type="submit">Authorize Connection</button>
    </form>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
