import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

import { CloudFormation } from '@aws-sdk/client-cloudformation';

export interface DeployOptions {
  stackName?: string;
  region?: string;
  vpcId?: string;
  subnetIds?: string;
  tags?: Record<string, string>;
  profile?: string;
}

export interface DeployResult {
  sseUrl: string;
  registrationUrl: string;
}

export async function deploy(options: DeployOptions = {}): Promise<DeployResult> {
  const {
    stackName = 'mcp-lambda-sam',
    region = process.env.AWS_REGION || 'us-east-1',
    vpcId,
    subnetIds,
    profile,
  } = options;

  const lambdaDistPath = join(__dirname, '../dist/lambdas');
  if (!existsSync(lambdaDistPath)) {
    throw new Error('Lambdas are not built. Please run `npm run build` first.');
  }

  const templatePath = join(__dirname, '../template.yaml');
  // Prepare deploy arguments
  const deployArgs = [
    'deploy',
    '--resolve-s3',
    '--template-file',
    templatePath,
    '--stack-name',
    stackName,
    '--region',
    region,
    '--capabilities',
    'CAPABILITY_NAMED_IAM',
    '--no-confirm-changeset',
  ];

  if (profile) {
    deployArgs.push('--profile', profile);
  }

  // Always pass StackIdentifier, optionally include VPC settings
  const parameterOverrides = [`StackIdentifier=${stackName}`];
  if (vpcId && subnetIds) {
    parameterOverrides.push(`VpcEnabled=true`, `VpcId=${vpcId}`, `SubnetIds=${subnetIds}`);
  }
  deployArgs.push('--parameter-overrides', ...parameterOverrides);

  // Deploy with SAM
  const deployResult = spawnSync('sam', deployArgs, { stdio: 'inherit' });
  if (deployResult.status !== 0) {
    throw new Error('SAM deploy failed');
  }

  // Get function URLs from CloudFormation outputs
  const cfn = new CloudFormation({ region });
  const { Stacks } = await cfn.describeStacks({ StackName: stackName });
  const outputs = Stacks?.[0]?.Outputs || [];

  const mcpUrl = outputs.find(o => o.OutputKey === 'McpFunctionUrl')?.OutputValue;
  const registrationUrl = outputs.find(o => o.OutputKey === 'RegistrationFunctionUrl')?.OutputValue;

  if (!mcpUrl || !registrationUrl) {
    throw new Error('Failed to get function URLs from stack outputs');
  }

  return {
    sseUrl: new URL('/sse', mcpUrl).toString(),
    registrationUrl: new URL('/', registrationUrl).toString(),
  };
}
