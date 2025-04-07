# MCP Lambda Layer Design

## Overview
This project implements an MCP (Model Context Protocol) server using AWS Lambda. The architecture is divided into two main aspects:

### 1. System Configuration (Admin Operations)
- **Registration Management**: Adding, updating, and removing Lambda function registrations
- **Permission Management**: Handling IAM roles and resource-based policies
- **Infrastructure Setup**: VPC configuration, security groups, etc.

### 2. System Usage (Client Operations)
- **SSE Streaming**: Establishing and maintaining client connections
- **Command Processing**: Sending commands and receiving responses
- **Session Management**: Creating and cleaning up client sessions

## Component Details

### Configuration Components

1. **Registration Function**:
   - Primary interface for system configuration
   - Manages the registration lifecycle (create/read/update/delete)
   - Handles IAM permission setup
   - Manages DynamoDB entries
   - Administrative endpoint requiring elevated permissions

2. **DynamoDB Registration Table**:
   - Stores configuration data
   - Maintains registration state
   - Access limited to administrative operations

### Runtime Components

1. **SSE Function**:
   - Primary interface for client connections
   - Handles client session lifecycle
   - Streams responses back to clients
   - Read-only access to registration data
   - Client-facing endpoint

2. **Message Function**:
   - Handles client command submissions
   - Validates session existence
   - Routes messages to appropriate queues
   - Client-facing endpoint

## Updated Design

### Components

The system will now include a third Lambda function:

1. **SSE Lambda**:
   - Handles `GET /sse` requests.
   - Generates a unique session ID for each client.
   - Creates an SQS queue for the session.
   - Loads registered tools, resources, and prompts from DynamoDB.
   - Maintains an MCP server instance for the session.
   - Initializes MCP server with loaded resources.
   - Executes commands received from the queue using the MCP server.
   - Streams command responses back to the client.
   - Deletes the SQS queue when the session ends.
   - **Executes the registered Lambda functions** for tools, resources, and prompts
   - Manages session cleanup

2. **Message Lambda**:
   - Handles `POST /message` requests.
   - Validates the session ID by checking the existence of the corresponding SQS queue.
   - Places the command in the session's SQS queue for execution by the SSE Lambda.
   - **No direct Lambda invocation** - just passes messages to SSE Lambda

3. **Registration Lambda**:
   - Handles HTTP requests to register, update, fetch, and delete tools, resources, and prompts.
   - Stores registration details in the DynamoDB table.
   - Ensures the Message Lambda has the necessary permissions to invoke the registered Lambda functions.
   - **Grants invoke permissions to SSE Lambda** (not Message Lambda)
   - Manages resource-based policies for registered functions

4. **DynamoDB Table**:
   - Stores the registration details for tools, resources, and prompts.
   - Each entry includes the type (tool/resource/prompt), name, Lambda ARN, parameters, and metadata required for advertisement and execution.

5. **SQS Queues**:
   - A unique SQS FIFO queue is created for each session.
   - The SSE Lambda listens to the queue, and the Message Lambda writes to it.
   - Queues are deleted when the session ends.

---

### Registration Lambda Details

#### Responsibilities
1. **Manage Registrations**:
   - Handle registration HTTP requests
   - Store registration details in DynamoDB

2. **Ensure Permissions**:
   - Add AWS Lambda Invoke permissions to the SSE Lambda for each registered function
   - Remove permissions when registrations are deleted

#### API Endpoints
1. **POST /register**:
   - Registers a new tool/resource/prompt.
   - Request Body:
     ```json
     {
       "type": "tool",
       "name": "exampleTool",
       "lambdaArn": "arn:aws:lambda:us-east-1:123456789012:function:exampleToolHandler",
       "parameters": { "id": "string" },
       "description": "An example tool"
     }
     ```

2. **PUT /register/{id}**:
   - Updates an existing registration.

3. **DELETE /register/{id}**:
   - Deletes a registration.

4. **GET /register/{id}**:
   - Fetches details of a specific registration.

5. **GET /register**:
   - Fetches all registrations.

#### IAM Permission Management
- **Granting Permissions**:
  ```typescript
  await lambda.addPermission({
    FunctionName: registeredLambdaArn,
    StatementId: `MCP-Execute-${registrationId}`,
    Action: 'lambda:InvokeFunction',
    Principal: 'lambda.amazonaws.com',
    SourceArn: sseLambdaArn
  });
  ```

- **Revoking Permissions**:
  ```typescript
  await lambda.removePermission({
    FunctionName: registeredLambdaArn,
    StatementId: `MCP-Execute-${registrationId}`
  });
  ```

---

### How to Use the System

#### 1. **Build the Environment**
- **Deployment**:
  - Use AWS CloudFormation or the Serverless Framework to deploy the system.
  - The deployment will create the SSE Lambda, Message Lambda, Registration Lambda, DynamoDB table, and necessary IAM roles.
- **Environment Variables**:
  - Configure environment variables for the Lambdas, such as the DynamoDB table name and SQS settings.

#### 2. **Register Resources, Tools, and Prompts**
- **Registration API**:
  - Use the Registration Lambda's HTTP API to register tools, resources, and prompts.
  - Example API endpoints:
    - `POST /register` to add a new registration.
    - `GET /register/{id}` to fetch registration details.
    - `PUT /register/{id}` to update a registration.
    - `DELETE /register/{id}` to remove a registration.
- **Registration Details**:
  - Provide the following information for each registration:
    - **Type**: `tool`, `resource`, or `prompt`.
    - **Name**: A unique name for the registration.
    - **Lambda ARN**: The ARN of the Lambda function implementing the logic.
    - **Parameters**: Input schema for validation.
    - **Description**: A description for advertisement purposes.

#### 3. **Enable Access (IAM)**
- **IAM Roles**:
  - Grant the SSE Lambda, Message Lambda, and Registration Lambda permissions to:
    - Read and write to the DynamoDB table.
    - Create, delete, and access SQS queues.
    - Invoke user-provided Lambda functions.
- **User Permissions**:
  - Provide users with permissions to deploy their Lambda functions and register them with the system.

#### 4. **Connect to the MCP**
- **SSE Endpoint**:
  - Clients connect to the `GET /sse` endpoint to establish a session.
  - The response includes the session ID.
- **Message Endpoint**:
  - Clients send commands to the `POST /message` endpoint.
  - Include the session ID and command details in the request.
- **Execution Flow**:
  - The Message Lambda validates the session ID and retrieves the corresponding registration from DynamoDB.
  - The registered Lambda function is invoked to process the command.
  - The response is sent to the SQS queue for the session ID.
  - The SSE Lambda streams the response back to the client.

---

### Making the System Accessible for Free

#### Serverless Application Repository (SAR)

The Serverless Application Repository (SAR) is the most accessible way to make this system available for free. It allows users to deploy the application directly into their AWS accounts with minimal effort.

#### Steps to Publish on SAR

1. **Prepare the Application**:
   - Package the project as an AWS SAM (Serverless Application Model) template.
   - Ensure the template includes all necessary resources (Lambdas, DynamoDB table, SQS queues, IAM roles, etc.).

2. **Add Metadata**:
   - Include metadata in the SAM template, such as:
     - Application name
     - Description
     - Usage instructions
     - Author information

3. **Publish to SAR**:
   - Use the AWS CLI or AWS Management Console to publish the application to SAR.
   - Example AWS CLI command:
     ```bash
     aws serverlessrepo create-application \
       --author "Your Name" \
       --description "MCP Lambda Layer for serverless MCP services" \
       --name "MCP-Lambda-Layer" \
       --template-body file://template.yaml
     ```

4. **Documentation**:
   - Provide clear documentation for deploying and using the application.
   - Include a README file with setup instructions, configuration options, and examples.

#### Benefits of SAR
- **Ease of Deployment**: Users can deploy the application with a single click.
- **No Additional Costs**: Users only pay for the AWS resources they consume.
- **Broad Reach**: SAR is widely used by developers looking for serverless solutions.

#### Alternative: GitHub Repository
- Publish the project on GitHub with detailed setup instructions.
- Include a pre-configured SAM or CloudFormation template for easy deployment.

#### Next Steps
- Create a SAM template for the project.
- Publish the application to SAR and/or GitHub.

---

### Future Enhancements
- Add support for session expiration to automatically clean up idle sessions.
- Implement rate limiting to prevent abuse of the endpoints.
- Add metrics and monitoring for active sessions and message throughput.

### Optional VPC Configuration

The system can be deployed within a VPC for enhanced security or to access VPC-only resources:

#### Deployment Parameters
- `VpcEnabled`: Enable VPC support (true/false)
- `VpcId`: ID of the VPC to deploy into
- `SubnetIds`: List of subnet IDs for Lambda functions

#### Requirements
1. **Subnets**: 
   - Must have NAT Gateway/Internet Gateway access for external resources
   - Should be in private subnets if possible
   
2. **Security Group**:
   - Auto-created for Lambda functions
   - Allows internal communication between functions

#### Example Deployment with VPC
```bash
sam deploy --parameter-overrides \
  StackIdentifier=prod \
  VpcEnabled=true \
  VpcId=vpc-1234567 \
  SubnetIds=subnet-123,subnet-456
```