const { cpSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function copyBundledModules(context) {
  const resources = context.packager.getResourcesDir(context.appOutDir);
  for (const bundle of ['server', 'runner']) {
    cpSync(
      join(context.packager.info.appDir, bundle, 'node_modules'),
      join(resources, bundle, 'node_modules'),
      { recursive: true },
    );
  }
};
