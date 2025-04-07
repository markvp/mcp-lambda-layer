import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import {
  LambdaClient,
  AddPermissionCommand,
  RemovePermissionCommand,
} from '@aws-sdk/client-lambda';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';

// Set required environment variables before importing handler
process.env.AWS_REGION = 'us-east-1';
process.env.REGISTRATION_TABLE_NAME = 'test-table';
process.env.SSE_FUNCTION_NAME = 'test-sse-function';

import { handler } from '../lambdas/registration';
import { Registration, RegistrationRequest } from '../types/registration';

const dynamoMock = mockClient(DynamoDBClient);
const lambdaMock = mockClient(LambdaClient);

describe('Registration Lambda', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.AWS_REGION = 'us-east-1';
    process.env.REGISTRATION_TABLE_NAME = 'test-table';
    process.env.SSE_FUNCTION_NAME = 'test-sse-function';
    dynamoMock.reset();
    lambdaMock.reset();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  const createEvent = (
    method: string,
    path: string,
    body?: string,
    pathParameters?: Record<string, string>,
  ): APIGatewayProxyEventV2 => ({
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'id.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'id',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: 'IP',
        userAgent: 'agent',
      },
      requestId: 'id',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '12/Mar/2020:19:03:58 +0000',
      timeEpoch: 1583348638390,
    },
    pathParameters,
    body,
    isBase64Encoded: false,
  });

  const validRegistration: RegistrationRequest = {
    type: 'tool' as const,
    name: 'test-tool',
    description: 'A test tool',
    lambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    parameters: {
      input: 'string',
    },
  };

  describe('POST /register', () => {
    it('should create a new registration', async () => {
      dynamoMock.on(PutItemCommand).resolves({});
      lambdaMock.on(AddPermissionCommand).resolves({});

      const event = createEvent('POST', '/register', JSON.stringify(validRegistration));
      const response = await handler(event);

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body as string) as Registration;
      expect(body).toEqual<Registration>({
        ...validRegistration,
        id: expect.stringMatching(/^tool-test-tool/) as string,
      });
    });

    it('should return 400 for invalid registration data', async () => {
      const event = createEvent(
        'POST',
        '/register',
        JSON.stringify({ ...validRegistration, type: 'invalid' }),
      );
      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body as string)).toHaveProperty('error');
    });
  });

  describe('PUT /register/{id}', () => {
    const id = 'tool-test-tool';
    const existingItem = {
      Item: {
        id: { S: id },
        type: { S: 'tool' },
        name: { S: 'test-tool' },
        description: { S: 'A test tool' },
        lambdaArn: { S: 'arn:aws:lambda:us-east-1:123456789012:function:old-function' },
        parameters: { S: JSON.stringify({ input: 'string' }) },
      },
    };

    it('should update an existing registration', async () => {
      dynamoMock.on(GetItemCommand).resolves(existingItem).on(PutItemCommand).resolves({});

      lambdaMock.on(RemovePermissionCommand).resolves({}).on(AddPermissionCommand).resolves({});

      const event = createEvent('PUT', `/register/${id}`, JSON.stringify(validRegistration), {
        id,
      });
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body as string)).toMatchObject({
        ...validRegistration,
        id,
      });
    });

    it('should return 404 for non-existent registration', async () => {
      dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

      const nonExistentRegistration = {
        ...validRegistration,
        name: 'non-existent',
      };
      const nonExistentId = `${nonExistentRegistration.type}-${nonExistentRegistration.name}`;

      const event = createEvent(
        'PUT',
        `/register/${nonExistentId}`,
        JSON.stringify(nonExistentRegistration),
        { id: nonExistentId },
      );
      const response = await handler(event);

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /register', () => {
    it('should list all registrations', async () => {
      const items = [
        {
          id: { S: 'tool-test-tool' },
          ...Object.entries(validRegistration).reduce(
            (acc, [key, value]) => ({
              ...acc,
              [key]: { S: typeof value === 'string' ? value : JSON.stringify(value) },
            }),
            {},
          ),
        },
      ];

      dynamoMock.on(ScanCommand).resolves({ Items: items });

      const event = createEvent('GET', '/register');
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body as string) as Registration[];
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject(validRegistration);
    });

    it('should get a specific registration', async () => {
      const id = 'tool-test-tool';
      const item = {
        Item: {
          id: { S: id },
          ...Object.entries(validRegistration).reduce(
            (acc, [key, value]) => ({
              ...acc,
              [key]: { S: typeof value === 'string' ? value : JSON.stringify(value) },
            }),
            {},
          ),
        },
      };

      dynamoMock.on(GetItemCommand).resolves(item);

      const event = createEvent('GET', `/register/${id}`, undefined, { id });
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body as string)).toMatchObject(validRegistration);
    });
  });

  describe('DELETE /register/{id}', () => {
    const id = 'tool-test-tool';
    const existingItem = {
      Item: {
        id: { S: id },
        type: { S: 'tool' },
        name: { S: 'test-tool' },
        description: { S: 'A test tool' },
        lambdaArn: { S: validRegistration.lambdaArn },
        parameters: { S: JSON.stringify({ input: 'string' }) },
      },
    };

    it('should delete a registration', async () => {
      dynamoMock.on(GetItemCommand).resolves(existingItem).on(DeleteItemCommand).resolves({});

      lambdaMock.on(RemovePermissionCommand).resolves({});

      const event = createEvent('DELETE', `/register/${id}`, undefined, { id });
      const response = await handler(event);

      expect(response.statusCode).toBe(204);
    });

    it('should return 404 for non-existent registration', async () => {
      dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

      const event = createEvent('DELETE', '/register/non-existent', undefined, {
        id: 'non-existent',
      });
      const response = await handler(event);

      expect(response.statusCode).toBe(404);
    });
  });

  it('should return 405 for unsupported methods', async () => {
    const event = createEvent('PATCH', '/register');
    const response = await handler(event);

    expect(response.statusCode).toBe(405);
  });

  it('should handle DynamoDB errors', async () => {
    dynamoMock.on(ScanCommand).rejects(new Error('DynamoDB error'));

    const event = createEvent('GET', '/register');
    const response = await handler(event);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body as string)).toEqual({
      error: 'Internal server error',
    });
  });
});
