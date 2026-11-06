const os = require('node:os');
const { syncBuiltinESMExports } = require('node:module');

os.hostname = () => 'screens-host';
syncBuiltinESMExports();
