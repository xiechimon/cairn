const { cpSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function copyServerModules(context) {
  const resources = context.packager.getResourcesDir(context.appOutDir);
  cpSync(
    join(context.packager.info.appDir, 'server', 'node_modules'),
    join(resources, 'server', 'node_modules'),
    { recursive: true },
  );
};
