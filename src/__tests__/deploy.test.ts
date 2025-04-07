import { spawnSync } from 'child_process';
import type { SpawnSyncReturns } from 'child_process';

import { CloudFormation, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { mockClient } from 'aws-sdk-client-mock';

import { deploy } from '../deploy';

jest.mock('child_process');

const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const cloudFormationMock = mockClient(CloudFormation);

describe('deploy', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.AWS_REGION = 'us-east-1';
    mockSpawnSync.mockClear();
    cloudFormationMock.reset();
  });

  it('should deploy with default options', async () => {
    mockSpawnSync.mockReturnValueOnce({ status: 0 } as SpawnSyncReturns<Buffer>); // SAM deploy

    cloudFormationMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackId: 'test-stack-id',
          StackName: 'test-stack',
          CreationTime: new Date(),
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [
            {
              OutputKey: 'SseFunctionUrl',
              OutputValue: 'https://sse.example.com/',
            },
            {
              OutputKey: 'RegistrationFunctionUrl',
              OutputValue: 'https://registration.example.com/',
            },
          ],
        },
      ],
    });

    const result = await deploy();

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'sam',
      expect.arrayContaining([
        'deploy',
        '--template-file',
        expect.stringContaining('template.yaml'),
        '--stack-name',
        'mcp-lambda-sam',
        '--region',
        'us-east-1',
      ]),
      expect.any(Object),
    );

    expect(result.sseUrl).toBe('https://sse.example.com/sse');
    expect(result.registrationUrl).toBe('https://registration.example.com/');
  });

  it('should deploy with custom options', async () => {
    const options = {
      stackName: 'custom-stack',
      region: 'eu-west-1',
      vpcId: 'vpc-123',
      subnetIds: 'subnet-1,subnet-2',
      profile: 'custom',
    };

    mockSpawnSync.mockReturnValueOnce({ status: 0 } as SpawnSyncReturns<Buffer>); // SAM deploy

    cloudFormationMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackId: 'test-stack-id',
          StackName: options.stackName,
          CreationTime: new Date(),
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [
            {
              OutputKey: 'SseFunctionUrl',
              OutputValue: 'https://sse.example.com/',
            },
            {
              OutputKey: 'RegistrationFunctionUrl',
              OutputValue: 'https://registration.example.com/',
            },
          ],
        },
      ],
    });

    await deploy(options);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'sam',
      expect.arrayContaining([
        'deploy',
        '--template-file',
        expect.stringContaining('template.yaml'),
        '--stack-name',
        'custom-stack',
        '--region',
        'eu-west-1',
        '--profile',
        'custom',
        '--parameter-overrides',
        'VpcEnabled=true VpcId=vpc-123 SubnetIds=subnet-1,subnet-2',
      ]),
      expect.any(Object),
    );
  });

  it('should throw error if SAM deploy fails', async () => {
    mockSpawnSync.mockReturnValueOnce({ status: 1 } as SpawnSyncReturns<Buffer>);
    await expect(deploy()).rejects.toThrow('SAM deploy failed');
  });

  it('should throw error if CloudFormation outputs are missing', async () => {
    mockSpawnSync.mockReturnValueOnce({ status: 0 } as SpawnSyncReturns<Buffer>); // SAM deploy
    mockSpawnSync.mockReturnValueOnce({ status: 0 } as SpawnSyncReturns<Buffer>); // SAM deploy

    cloudFormationMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackId: 'test-stack-id',
          StackName: 'test-stack',
          CreationTime: new Date(),
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [],
        },
      ],
    });

    await expect(deploy()).rejects.toThrow('Failed to get function URLs from stack outputs');
  });

  it('should throw if registrationUrl is missing', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as SpawnSyncReturns<Buffer>);

    cloudFormationMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackId: 'test-stack-id',
          StackName: 'test-stack',
          CreationTime: new Date(),
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [
            {
              OutputKey: 'SseFunctionUrl',
              OutputValue: 'https://sse.example.com',
            },
          ],
        },
      ],
    });

    await expect(deploy()).rejects.toThrow('Failed to get function URLs from stack outputs');
  });

  it('should throw if CloudFormation outputs are undefined', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 } as SpawnSyncReturns<Buffer>);

    cloudFormationMock.on(DescribeStacksCommand).resolves({
      Stacks: [],
    });

    await expect(deploy()).rejects.toThrow('Failed to get function URLs from stack outputs');
  });

  it('should default to us-east-1 if AWS_REGION is not set', async () => {
    delete process.env.AWS_REGION;

    mockSpawnSync.mockReturnValueOnce({ status: 0 } as SpawnSyncReturns<Buffer>); // SAM deploy
    mockSpawnSync.mockReturnValueOnce({ status: 0 } as SpawnSyncReturns<Buffer>); // SAM deploy

    cloudFormationMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackId: 'test-stack-id',
          StackName: 'test-stack',
          CreationTime: new Date(),
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [
            {
              OutputKey: 'SseFunctionUrl',
              OutputValue: 'https://sse.example.com/',
            },
            {
              OutputKey: 'RegistrationFunctionUrl',
              OutputValue: 'https://registration.example.com/',
            },
          ],
        },
      ],
    });

    const result = await deploy();

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'sam',
      expect.arrayContaining(['--region', 'us-east-1']),
      expect.any(Object),
    );

    expect(result.sseUrl).toBe('https://sse.example.com/sse');
    expect(result.registrationUrl).toBe('https://registration.example.com/');
  });
});
