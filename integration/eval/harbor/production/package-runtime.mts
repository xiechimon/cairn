import { packageProductionRuntime } from './package.mjs';

const [candidateRoot, dependencyRoot, outputDir] = process.argv.slice(2);
if (candidateRoot === undefined || dependencyRoot === undefined || outputDir === undefined) {
  throw new Error(
    'Usage: package-runtime <candidate-root> <trusted-dependency-root> <fresh-output-dir>',
  );
}
process.stdout.write(
  `${JSON.stringify(await packageProductionRuntime({ candidateRoot, dependencyRoot, outputDir }))}\n`,
);
