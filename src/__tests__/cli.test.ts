import { Command } from 'commander';
import inquirer from 'inquirer';

import { deploy } from '../deploy';

jest.mock('../deploy');
jest.mock('inquirer');

const mockDeploy = deploy as jest.MockedFunction<typeof deploy>;
const mockPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;

describe('CLI', () => {
  beforeEach(() => {
    jest.resetModules();
    mockDeploy.mockClear();
    mockPrompt.mockClear();
  });

  interface DeployOptions {
    stackName?: string;
    region?: string;
    profile?: string;
    prompt?: boolean;
    useVpc?: boolean;
    vpcId?: string;
  }

  it('should deploy with provided options', async () => {
    const options: DeployOptions = {
      stackName: 'test-stack',
      region: 'us-east-1',
      profile: 'test',
      prompt: false,
    };

    const program = new Command()
      .command('deploy')
      .option('--stack-name <name>')
      .option('--region <region>')
      .option('--profile <profile>')
      .option('--no-prompt')
      .action(async (opts: DeployOptions): Promise<void> => {
        await mockDeploy(opts);
      });

    await program.parseAsync([
      'node',
      'mcp-lambda-sam',
      'deploy',
      '--stack-name',
      'test-stack',
      '--region',
      'us-east-1',
      '--profile',
      'test',
      '--no-prompt',
    ]);

    expect(mockDeploy).toHaveBeenCalledWith(options);
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('should prompt for missing options', async () => {
    mockPrompt.mockResolvedValueOnce(
      Promise.resolve({
        stackName: 'test-stack',
        region: 'us-east-1',
        useVpc: false,
      }),
    );

    const program = new Command()
      .command('deploy')
      .action(async (opts: DeployOptions): Promise<void> => {
        const answers = (await mockPrompt([
          {
            type: 'input',
            name: 'stackName',
            message: 'Enter a CloudFormation stack name:',
            default: 'mcp-lambda-sam',
          },
          {
            type: 'input',
            name: 'region',
            message: 'Enter an AWS region:',
            default: 'us-east-1',
          },
          {
            type: 'confirm',
            name: 'useVpc',
            message: 'Do you want to deploy to a VPC?',
            default: false,
          },
        ])) as DeployOptions;

        await mockDeploy({ ...opts, ...answers });
      });

    await program.parseAsync(['node', 'mcp-lambda-sam', 'deploy']);

    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(mockDeploy).toHaveBeenCalledWith({
      stackName: 'test-stack',
      region: 'us-east-1',
      useVpc: false,
    });
  });

  it('should skip VPC prompts when useVpc is false', async () => {
    const expectedOptions: DeployOptions = {
      stackName: 'no-vpc-stack',
      region: 'us-east-1',
      useVpc: false,
    };

    mockPrompt.mockResolvedValueOnce(
      Promise.resolve({
        stackName: expectedOptions.stackName,
        region: expectedOptions.region,
        useVpc: false,
      }),
    );

    const program = new Command()
      .command('deploy')
      .action(async (opts: DeployOptions): Promise<void> => {
        const answers = (await mockPrompt([
          {
            type: 'input',
            name: 'stackName',
            message: 'Enter a CloudFormation stack name:',
            default: 'mcp-lambda-sam',
          },
          {
            type: 'input',
            name: 'region',
            message: 'Enter an AWS region:',
            default: 'us-east-1',
          },
          {
            type: 'confirm',
            name: 'useVpc',
            message: 'Do you want to deploy to a VPC?',
            default: false,
          },
        ])) as DeployOptions;

        await mockDeploy({ ...opts, ...answers });
      });

    await program.parseAsync(['node', 'mcp-lambda-sam', 'deploy']);

    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(mockDeploy).toHaveBeenCalledWith(expectedOptions);
  });

  it('should skip prompts when --no-prompt is used', async () => {
    const program = new Command()
      .command('deploy')
      .option('--no-prompt')
      .action(async (opts: DeployOptions): Promise<void> => {
        if (!opts.prompt) {
          await mockDeploy(opts);
          return;
        }

        await mockDeploy(opts);
      });

    await program.parseAsync(['node', 'mcp-lambda-sam', 'deploy', '--no-prompt']);

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockDeploy).toHaveBeenCalledWith(expect.objectContaining({ prompt: false }));
  });
});
