const { spawnSync } = require('child_process');

function checkCommand(command, args = ['--version']) {
  try {
    const result = spawnSync(command, args);
    if (result.status !== 0) {
      throw new Error(`${command} check failed`);
    }
    return true;
  } catch (error) {
    console.error(`Error: ${command} is required but not found.`);
    console.error(`Please install ${command} CLI first.`);
    process.exit(1);
  }
}

// Check AWS CLI
checkCommand('aws');

// Check SAM CLI
checkCommand('sam');

console.log('All prerequisites are installed.');
