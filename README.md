# MCP Lambda SAM

Model Context Protocol (MCP) implementation using AWS Lambda and SAM.

## Overview

This project provides a serverless implementation of the Model Context Protocol, with two distinct interfaces:

1. **System Configuration** (Administrative):
   - Registration of MCP tools, resources, and prompts
   - IAM permission management
   - Infrastructure setup and configuration

2. **System Usage** (Client):
   - Establishing SSE connections
   - Sending commands
   - Receiving streaming responses

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│   Client    │────▶│ SSE Lambda  │◀───▶│ Registration │
└─────────────┘     │(Streaming)  │     │   DynamoDB   │
      │             └─────────────┘     └──────────────┘
      │                   ▲
      │                   │
      │             ┌─────┴─────┐
      └────────────▶│  Message  │
                    │  Lambda   │
                    └───────────┘
```

## System Configuration Guide (Administrators)

This section is for system administrators who need to configure and manage the MCP server.

### Deployment

```bash
npx @markvp/mcp-lambda-sam deploy
```

The command will interactively prompt for administrative configuration:
- Stack name (for multiple instances)
- AWS Region
- VPC configuration (optional)
- IAM role configuration

### Registration API

Use these endpoints to manage MCP tools, resources, and prompts:

#### Register a New Tool
```bash
curl -X POST ${REGISTRATION_URL}/register \
  -H "Content-Type: application/json" \
  -d '{
    "type": "tool",
    "name": "example",
    "description": "Example tool",
    "lambdaArn": "arn:aws:lambda:region:account:function:name",
    "parameters": {
      "input": "string"
    }
  }'
```

#### Update Registration
```bash
curl -X PUT ${REGISTRATION_URL}/register/{id} -d '...'
```

#### Delete Registration
```bash
curl -X DELETE ${REGISTRATION_URL}/register/{id}
```

#### List Registrations
```bash
curl ${REGISTRATION_URL}/register
```

### Required IAM Permissions

#### For Administrators
Administrators need these permissions to manage registrations:
```json
{
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Action": [
            "lambda:InvokeFunctionUrl",
            "lambda:AddPermission",
            "lambda:RemovePermission"
        ],
        "Resource": [
            "arn:aws:lambda:${region}:${account}:function:${stack-id}-mcp-registration"
        ]
    }]
}
```

#### For Registered Functions
Each registered function needs:
```json
{
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Action": [
            "lambda:AddPermission",
            "lambda:RemovePermission"
        ],
        "Resource": "arn:aws:lambda:${region}:${account}:function:${function-name}"
    }]
}
```

## System Usage Guide (Clients)

This section is for clients who want to use the MCP server.

### Required IAM Permissions

Clients need these permissions to use the MCP server:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": "lambda:InvokeFunctionUrl",
            "Resource": [
                "arn:aws:lambda:${region}:${account}:function:${stack-id}-mcp-sse",
                "arn:aws:lambda:${region}:${account}:function:${stack-id}-mcp-message"
            ]
        }
    ]
}
```

### Connecting to the Server

1. **Establish SSE Connection**:
```typescript
const sse = new EventSource(SSE_URL, {
  headers: { 
    Authorization: 'AWS4-HMAC-SHA256 ...' // AWS IAM signature
  }
});

sse.onmessage = (event) => {
  console.log(JSON.parse(event.data));
};
```

2. **Send Commands**:
```typescript
const response = await fetch(MESSAGE_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'AWS4-HMAC-SHA256 ...' // AWS IAM signature
  },
  body: JSON.stringify({
    sessionId: 'session-123',
    command: {
      type: 'tool',
      name: 'example',
      parameters: {
        input: 'test'
      }
    }
  })
});
```

### Error Handling

#### Common Client Errors
- `401`: Invalid/missing AWS credentials
- `403`: Insufficient permissions
- `404`: Invalid session ID
- `429`: Rate limit exceeded

#### Troubleshooting
1. **Connection Issues**:
   - Verify AWS credentials
   - Check IAM permissions
   - Ensure network connectivity

2. **Command Execution Errors**:
   - Verify session ID is active
   - Check command format matches tool registration
   - Ensure parameters match schema

## Requirements

- AWS CLI installed and configured
- AWS SAM CLI installed
- Node.js 20.x or later
- An AWS account with permissions to create:
  - Lambda functions
  - DynamoDB tables
  - IAM roles
  - SQS queues

## AWS SAM CLI Setup

To deploy this application locally or to AWS using the AWS SAM CLI:

1. Install the AWS SAM CLI: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
2. Ensure it's available in your PATH:
   ```bash
   sam --version
   ```
3. Build and deploy the application:
   ```bash
   sam build
   sam deploy --guided
   ```
4. Follow the prompts to configure the stack name, region, capabilities, and parameter overrides.

You can rerun `sam deploy` without `--guided` to use saved configuration.

## Installation

You can install and deploy this application in four ways:

### 1. Using AWS Serverless Application Repository (SAR)

The easiest way to deploy the MCP server is through the AWS Serverless Application Repository (SAR):

- Go to the [SAR Console](https://serverlessrepo.aws.amazon.com/applications)
- Search for **mcp-lambda-sam** by Mark Van Proctor
- Click **Deploy**
- Set your parameters:
  - `StackIdentifier`: Unique ID for this MCP server instance
  - `VpcEnabled`: Set to `true` if deploying in a VPC
  - `VpcId` and `SubnetIds`: Provide only if `VpcEnabled` is `true`
- Follow the prompts to deploy

Alternatively, you can deploy from the AWS CLI:
```bash
aws serverlessrepo create-cloud-formation-change-set \
  --application-id arn:aws:serverlessrepo:REGION:ACCOUNT_ID:applications/mcp-lambda-sam \
  --stack-name your-stack-name \
  --parameter-overrides '[{"name":"StackIdentifier","value":"default"}]'
```
Replace `REGION` and `ACCOUNT_ID` with the appropriate values for your deployment.
  
### 2. Using npx (CLI)

```bash
npx @markvp/mcp-lambda-sam deploy
```

The command will interactively prompt for administrative configuration:
- Stack name (for multiple instances)
- AWS Region
- VPC configuration (optional)
- IAM role configuration

### 3. Local Development and Deployment

```bash
# Install dependencies
npm install

# Deploy (after installing)
npm run deploy

# Or deploy directly with npx
npx @markvp/mcp-lambda-sam deploy

# Run tests
npm test

# Build
npm run build

# Lint
npm run lint
```

### 4. Programmatic Usage After Install

After installing the package, you can use it programmatically:
```javascript
import { deploy } from '@markvp/mcp-lambda-sam';

// Usage example
deploy();
```

## Development

```bash
# Install dependencies
npm install

# Deploy (after installing)
npm run deploy

# Or deploy directly with npx
npx @markvp/mcp-lambda-sam deploy

# Run tests
npm test

# Build
npm run build

# Lint
npm run lint
```

### Publishing to SAR

If you're contributing to this project and need to publish updates to SAR:

1. Package the application:
```bash
npm run package:sar
```

2. Publish to SAR:
```bash
npm run publish:sar
```

3. Make the application public (one-time setup):
   - Go to AWS Console > Serverless Application Repository
   - Select the application
   - Click "Share" and choose "Public"
   - Apply the following sharing policy:
   ```json
   {
       "Version": "2012-10-17",
       "Statement": [
           {
               "Effect": "Allow",
               "Principal": "*",
               "Action": "serverlessrepo:CreateCloudFormationTemplate",
               "Resource": "arn:aws:serverlessrepo:${region}:${account-id}:applications/mcp-lambda-sam"
           }
       ]
   }
   ```

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
