import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { streamifyResponse, ResponseStream } from 'lambda-stream';

import { getMessageHandler } from './message';
import { getSseHandler } from './sse';

const handleSse = getSseHandler();
const handleMessage = getMessageHandler();

export const handler = streamifyResponse(
  async (event: APIGatewayProxyEventV2, responseStream: ResponseStream): Promise<void> => {
    const {
      requestContext: {
        http: { method, path },
      },
    } = event;

    if (method === 'GET' && path.endsWith('/sse')) {
      return handleSse(event, responseStream);
    }

    if (method === 'POST' && path.endsWith('/message')) {
      return handleMessage(event, responseStream);
    }

    responseStream.write(JSON.stringify({ error: 'Not found' }));
    responseStream.end();
  },
);
