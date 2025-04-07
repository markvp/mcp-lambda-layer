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
import { marshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ZodError } from 'zod';

import { APIGatewayResult } from '../../types/lambda';
import {
  RegistrationRequestSchema,
  toDynamoFormat,
  fromDynamoFormat,
  createRegistrationId,
} from '../../types/registration';

const { AWS_REGION, REGISTRATION_TABLE_NAME, SSE_FUNCTION_NAME } = process.env;

if (!AWS_REGION || !REGISTRATION_TABLE_NAME || !SSE_FUNCTION_NAME) {
  throw new Error('Required environment variables are not set');
}

const dynamodbClient = new DynamoDBClient({ region: AWS_REGION });
const lambdaClient = new LambdaClient({ region: AWS_REGION });

async function updateLambdaPermissions(
  registrationId: string,
  lambdaArn: string,
  action: 'add' | 'remove',
): Promise<void> {
  if (action === 'add') {
    await lambdaClient.send(
      new AddPermissionCommand({
        FunctionName: SSE_FUNCTION_NAME,
        StatementId: `MCP-Execute-${registrationId}`,
        Action: 'lambda:InvokeFunction',
        Principal: 'lambda.amazonaws.com',
        SourceArn: lambdaArn,
      }),
    );
  } else {
    await lambdaClient.send(
      new RemovePermissionCommand({
        FunctionName: SSE_FUNCTION_NAME,
        StatementId: `MCP-Execute-${registrationId}`,
      }),
    );
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayResult> {
  const {
    requestContext: {
      http: { method },
    },
    pathParameters,
    body,
  } = event;

  try {
    switch (method) {
      case 'POST': {
        try {
          const registration = RegistrationRequestSchema.parse(JSON.parse(body || '{}'));
          const id = createRegistrationId(registration.type, registration.name);

          await dynamodbClient.send(
            new PutItemCommand({
              TableName: REGISTRATION_TABLE_NAME,
              Item: toDynamoFormat({ ...registration, id }),
            }),
          );

          await updateLambdaPermissions(id, registration.lambdaArn, 'add');

          return {
            statusCode: 201,
            body: JSON.stringify({ id, ...registration }),
          };
        } catch (error) {
          if (error instanceof ZodError) {
            return {
              statusCode: 400,
              body: JSON.stringify({ error: 'Invalid registration data', details: error.issues }),
            };
          }
          throw error;
        }
      }

      case 'PUT': {
        if (!pathParameters?.id) {
          return { statusCode: 400 };
        }

        const registration = RegistrationRequestSchema.parse(JSON.parse(body || '{}'));
        const newId = `${registration.type}-${registration.name}`;

        if (newId !== pathParameters.id) {
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Cannot change registration ID' }),
          };
        }

        // Get existing registration to check if Lambda ARN changed
        const { Item: existingItem } = await dynamodbClient.send(
          new GetItemCommand({
            TableName: REGISTRATION_TABLE_NAME,
            Key: marshall({ id: pathParameters.id }),
          }),
        );

        if (!existingItem) {
          return { statusCode: 404 };
        }

        const { lambdaArn: existingArn } = fromDynamoFormat(existingItem);

        // Update registration in DynamoDB
        await dynamodbClient.send(
          new PutItemCommand({
            TableName: REGISTRATION_TABLE_NAME,
            Item: toDynamoFormat({ id: pathParameters.id, ...registration }),
          }),
        );

        // Update permissions if Lambda ARN changed
        if (existingArn !== registration.lambdaArn) {
          await updateLambdaPermissions(pathParameters.id, existingArn, 'remove');
          await updateLambdaPermissions(pathParameters.id, registration.lambdaArn, 'add');
        }

        return {
          statusCode: 200,
          body: JSON.stringify({ id: pathParameters.id, ...registration }),
        };
      }

      case 'GET': {
        if (pathParameters?.id) {
          const { Item } = await dynamodbClient.send(
            new GetItemCommand({
              TableName: REGISTRATION_TABLE_NAME,
              Key: marshall({ id: pathParameters.id }),
            }),
          );

          if (!Item) {
            return { statusCode: 404 };
          }

          return {
            statusCode: 200,
            body: JSON.stringify(fromDynamoFormat(Item)),
          };
        }

        const { Items = [] } = await dynamodbClient.send(
          new ScanCommand({ TableName: REGISTRATION_TABLE_NAME }),
        );

        return {
          statusCode: 200,
          body: JSON.stringify(Items.map(fromDynamoFormat)),
        };
      }

      case 'DELETE': {
        if (!pathParameters?.id) {
          return { statusCode: 400 };
        }

        const { Item } = await dynamodbClient.send(
          new GetItemCommand({
            TableName: REGISTRATION_TABLE_NAME,
            Key: marshall({ id: pathParameters.id }),
          }),
        );

        if (!Item) {
          return { statusCode: 404 };
        }

        const { lambdaArn } = fromDynamoFormat(Item);

        await dynamodbClient.send(
          new DeleteItemCommand({
            TableName: REGISTRATION_TABLE_NAME,
            Key: marshall({ id: pathParameters.id }),
          }),
        );

        await updateLambdaPermissions(pathParameters.id, lambdaArn, 'remove');

        return { statusCode: 204 };
      }

      default:
        return { statusCode: 405 };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}
