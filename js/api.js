const PROXY_URL = 'https://loopholemap-proxy.mortuexhavoc.workers.dev';

function getCusaKey() {
  return localStorage.getItem('loopholemap_cusa_key') || undefined;
}

async function analyzeRegulation(text) {
  const cusaKey = getCusaKey();
  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'analyze', text, cusaKey })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Analysis failed (${response.status}): ${errText || 'Server error'}`);
  }

  const data = await response.json();
  if (!data.result) throw new Error('Empty response from server');
  return data.result;
}

async function getNodeDetail(nodeData) {
  const cusaKey = getCusaKey();
  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'detail',
      nodeData: {
        title: nodeData.title,
        section: nodeData.section,
        type: nodeData.type,
        description: nodeData.description
      },
      cusaKey
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Detail request failed (${response.status}): ${errText || 'Server error'}`);
  }

  const data = await response.json();
  if (!data.result) throw new Error('Empty detail response');
  return data.result;
}

async function askAI(contextType, contextData, question) {
  const cusaKey = getCusaKey();
  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'ask', contextType, contextData, question, cusaKey })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Ask failed (${response.status}): ${errText || 'Server error'}`);
  }

  const data = await response.json();
  if (!data.result) throw new Error('Empty ask response');
  return data.result;
}

export { analyzeRegulation, getNodeDetail, askAI };
