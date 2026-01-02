const { execSync } = require('child_process');

const DB_CONTAINER_NAME = 'ticket-bot-db';
const DB_USER = 'postgres';
const DB_PASSWORD = 'password';
const DB_NAME = 'ticketbot';
const DB_PORT = '5432';

const usage = () => {
  console.log('Usage: node db.js {setup|start|stop|restart|clean|logs}');
  console.log('  setup   - Create and start the PostgreSQL container');
  console.log('  start   - Start the existing PostgreSQL container');
  console.log('  stop    - Stop the PostgreSQL container');
  console.log('  restart - Restart the PostgreSQL container');
  console.log('  clean   - Stop and remove the container and its data');
  console.log('  logs    - Show database logs');
  process.exit(1);
};

const run = (command) => {
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    // Error is already printed to stderr by inherit
  }
};

const action = process.argv[2];

switch (action) {
  case 'setup':
    console.log('\x1b[34mSetting up PostgreSQL container...\x1b[0m');
    run(`docker run --name ${DB_CONTAINER_NAME} \
      -e POSTGRES_USER=${DB_USER} \
      -e POSTGRES_PASSWORD=${DB_PASSWORD} \
      -e POSTGRES_DB=${DB_NAME} \
      -p ${DB_PORT}:5432 \
      -d postgres:latest`);
    console.log('\x1b[32mDatabase is setting up!\x1b[0m');
    console.log(`Connection string: \x1b[34mpostgres://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}\x1b[0m`);
    break;

  case 'start':
    console.log('\x1b[34mStarting PostgreSQL container...\x1b[0m');
    run(`docker start ${DB_CONTAINER_NAME}`);
    console.log('\x1b[32mDatabase started.\x1b[0m');
    break;

  case 'stop':
    console.log('\x1b[34mStopping PostgreSQL container...\x1b[0m');
    run(`docker stop ${DB_CONTAINER_NAME}`);
    console.log('\x1b[32mDatabase stopped.\x1b[0m');
    break;

  case 'restart':
    console.log('\x1b[34mRestarting PostgreSQL container...\x1b[0m');
    run(`docker restart ${DB_CONTAINER_NAME}`);
    console.log('\x1b[32mDatabase restarted.\x1b[0m');
    break;

  case 'clean':
    console.log('\x1b[34mRemoving PostgreSQL container and data...\x1b[0m');
    run(`docker stop ${DB_CONTAINER_NAME}`);
    run(`docker rm ${DB_CONTAINER_NAME}`);
    console.log('\x1b[32mDatabase container removed.\x1b[0m');
    break;

  case 'logs':
    run(`docker logs -f ${DB_CONTAINER_NAME}`);
    break;

  default:
    usage();
}
