import WebSocket from 'ws';

const KEY = process.env.OPENAI_API_KEY || 'YOUR_KEY';
const MODEL = process.env.MODEL || 'gpt-realtime-2';
const url = `wss://api.openai.com/v1/realtime?model=${MODEL}`;

console.log('Connecting to', url);

const ws = new WebSocket(url, {
  headers: {
    Authorization: `Bearer ${KEY}`,
  },
});

ws.on('open', () => {
  console.log('OPEN: connected to OpenAI realtime');
  // Send a basic session.update to test connectivity
  const sessionUpdate = {
    type: 'session.update',
    session: {
      modalities: ['text'],
      instructions: 'Test session from local debug script',
    },
  };
  ws.send(JSON.stringify(sessionUpdate));
});

ws.on('message', (data) => {
  try {
    const text = data.toString();
    console.log('MSG:', text);
  } catch (e) {
    console.log('MSG (binary)');
  }
});

ws.on('error', (err) => {
  console.error('ERROR:', err);
});

ws.on('close', (code, reason) => {
  console.log('CLOSE:', code, reason && reason.toString());
  process.exit(code === 1000 ? 0 : 1);
});
