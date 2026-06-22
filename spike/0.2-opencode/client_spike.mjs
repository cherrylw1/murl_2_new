import { createOpencodeClient } from '@opencode-ai/sdk';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

// Load environment variables from murl_spike's .env
dotenv.config({ path: 'C:/Content/murl_spike/.env' });

if (!process.env.TOGETHER_API_KEY) {
  console.error('Error: TOGETHER_API_KEY is not defined in .env');
  process.exit(1);
}

const opencodePath = 'C:/Content/murl_spike/node_modules/opencode-ai/bin/opencode.exe';
const worktreePath = 'C:/Content/murl_2_new/spike/0.2-opencode/worktree_2';

async function main() {
  console.log('Starting opencode serve...');
  
  // Start opencode serve on port 4096
  const serverProcess = spawn(opencodePath, ['serve', '--port', '4096', '--hostname', '127.0.0.1'], {
    cwd: worktreePath,
    env: { ...process.env },
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[Server Stdout]: ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.log(`[Server Stderr]: ${data.toString().trim()}`);
  });

  // Wait 3 seconds for server to start
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log('Connecting SDK client...');
  const client = createOpencodeClient({
    baseUrl: 'http://127.0.0.1:4096',
    throwOnError: true
  });

  console.log('Creating session...');
  const sessionResponse = await client.session.create({
    body: { title: 'Spike Test Session' }
  });
  console.log('Session response:', JSON.stringify(sessionResponse, null, 2));

  const sessionId = sessionResponse.data.id;
  console.log(`Created session ID: ${sessionId}`);

  console.log('Sending prompt...');
  const promptResponse = await client.session.prompt({
    path: { id: sessionId },
    body: {
      parts: [
        {
          type: 'text',
          text: 'Write a TypeScript function to reverse a string in src/reverse.ts, and add a test in src/reverse.test.ts. When done, write a message stating you are complete.'
        }
      ]
    }
  });

  console.log('Prompt response received:', JSON.stringify(promptResponse, null, 2));

  // Wait 60 seconds to allow execution
  console.log('Waiting for execution to complete...');
  await new Promise((resolve) => setTimeout(resolve, 60000));

  console.log('Fetching session messages...');
  try {
    const messagesResponse = await client.session.messages({
      path: { id: sessionId }
    });
    console.log('Session messages:', JSON.stringify(messagesResponse.data, null, 2));
  } catch (err) {
    console.error('Failed to fetch session messages:', err);
  }

  console.log('Cleaning up...');
  serverProcess.kill();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Spike error:', err);
});
