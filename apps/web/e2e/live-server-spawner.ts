import { bootLiveServer } from './live-server';

const server = await bootLiveServer(null);
process.stdout.write(`${server.home}\n`);
